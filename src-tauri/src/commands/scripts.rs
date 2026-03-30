use std::io::Write;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::error::AppError;
use crate::helpers::{app_root, hidden_cmd, is_noise, now_ts, sanitize_ps_arg, strip_ansi, validate_env_name};
use crate::AppState;

#[derive(Clone, serde::Serialize)]
pub(crate) struct ScriptEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

#[derive(serde::Serialize)]
pub(crate) struct PrereqCheck { name: String, ok: bool, #[serde(skip_serializing_if = "Option::is_none")] version: Option<String> }

/// Helper to lock AppState.script with poisoning recovery.
fn lock_script(state: &AppState) -> std::sync::MutexGuard<'_, crate::ScriptState> {
    state.script.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
pub(crate) fn get_run_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let guard = lock_script(&state);
    match &guard.running {
        Some(info) => Ok(serde_json::json!({ "running": true, "current": info })),
        None => Ok(serde_json::json!({ "running": false, "current": null })),
    }
}

#[tauri::command]
pub(crate) async fn run_script(app: AppHandle, state: tauri::State<'_, AppState>, script: String, env_file: String, message: Option<String>) -> Result<(), AppError> {
    let ps_script = match script.as_str() {
        "set-master-packages" => "set-master-packages", "pull-force" => "pull-force",
        "reset" => "pull-force", "pull" => "pull", "commit" => "commit", "status" => "status",
        "diff" => "diff", "merge" => "merge", "rollback" => "rollback", "health-check" => "health-check",
        _ => return Err(AppError::Validation(format!("Unknown script: {}", script))),
    };

    let root = app_root();
    let script_path = root.join("cli").join("scripts").join(format!("{}.ps1", ps_script));
    let mut args = vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), script_path.to_string_lossy().to_string()];
    if !env_file.is_empty() {
        validate_env_name(&env_file)?;
        args.push(env_file);
    }
    if script == "reset" { args.push("-ForceStartFromScratch".into()); }
    if let Some(msg) = message {
        let safe_msg = sanitize_ps_arg(&msg)?;
        args.push(safe_msg);
    }

    let script_name = script.clone();
    // Atomic check-and-set: hold lock across both check and set to prevent TOCTOU race
    {
        let mut guard = lock_script(&state);
        if guard.running.is_some() { return Err(AppError::Validation("A script is already running.".into())); }
        guard.running = Some(crate::RunInfo { script: script_name.clone(), started_at: now_ts() });
    }

    let _ = app.emit("script-event", ScriptEvent { event_type: "run-start".into(), script: Some(script_name.clone()), text: None, code: None });

    // Persistent log file
    let log_dir = crate::helpers::log_dir();
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join(format!("{}_{}.log", ps_script, now_ts()));
    let log_file: Arc<Mutex<Option<std::fs::File>>> = Arc::new(Mutex::new(
        std::fs::File::create(&log_path).ok()
    ));

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut cmd = AsyncCommand::new("pwsh");
        cmd.args(&args).current_dir(&root).env("NO_COLOR", "1").env("DONUT_GUI", "1").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        #[cfg(windows)] cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit("script-event", ScriptEvent { event_type: "error".into(), text: Some(format!("Failed to start: {}", e)), script: None, code: None });
                { let mut g = lock_script(app_handle.state::<AppState>().inner()); g.running = None; }
                return;
            }
        };

        if let Some(pid) = child.id() { let mut g = lock_script(app_handle.state::<AppState>().inner()); g.child_pid = Some(pid); }

        // Use Option::take — returns None if pipe unavailable instead of panicking
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = app_handle.emit("script-event", ScriptEvent { event_type: "error".into(), text: Some("Failed to capture stdout".into()), script: None, code: None });
                { let mut g = lock_script(app_handle.state::<AppState>().inner()); g.running = None; g.child_pid = None; }
                return;
            }
        };
        let stderr = match child.stderr.take() {
            Some(s) => s,
            None => {
                let _ = app_handle.emit("script-event", ScriptEvent { event_type: "error".into(), text: Some("Failed to capture stderr".into()), script: None, code: None });
                { let mut g = lock_script(app_handle.state::<AppState>().inner()); g.running = None; g.child_pid = None; }
                return;
            }
        };
        let app_out = app_handle.clone();
        let app_err = app_handle.clone();
        let log_out = log_file.clone();
        let log_err = log_file.clone();

        let stdout_task = tokio::spawn(async move {
            let mut r = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = r.next_line().await {
                let text = strip_ansi(&line).trim_end().to_string();
                if !text.is_empty() && !is_noise(&text) {
                    let _ = app_out.emit("script-event", ScriptEvent { event_type: "log".into(), text: Some(text.clone()), script: None, code: None });
                    if let Ok(mut guard) = log_out.lock() {
                        if let Some(f) = guard.as_mut() { let _ = writeln!(f, "{}", text); }
                    }
                }
            }
        });
        let stderr_task = tokio::spawn(async move {
            let mut r = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = r.next_line().await {
                let text = strip_ansi(&line).trim_end().to_string();
                if !text.is_empty() && !is_noise(&text) {
                    let _ = app_err.emit("script-event", ScriptEvent { event_type: "error".into(), text: Some(text.clone()), script: None, code: None });
                    if let Ok(mut guard) = log_err.lock() {
                        if let Some(f) = guard.as_mut() { let _ = writeln!(f, "ERR: {}", text); }
                    }
                }
            }
        });

        let _ = stdout_task.await;
        let _ = stderr_task.await;
        let code = child.wait().await.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);

        // Write exit code to log
        if let Ok(mut guard) = log_file.lock() {
            if let Some(f) = guard.as_mut() { let _ = writeln!(f, "\n--- exit code: {} ---", code); }
        }

        { let mut g = lock_script(app_handle.state::<AppState>().inner()); g.running = None; g.child_pid = None; }
        let _ = app_handle.emit("script-event", ScriptEvent { event_type: "run-end".into(), script: Some(script_name), text: None, code: Some(code) });
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn check_prereqs() -> Vec<PrereqCheck> {
    let (pwsh, dotnet, git) = tokio::join!(
        tokio::task::spawn_blocking(|| {
            match hidden_cmd("pwsh").args(["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]).output() {
                Ok(out) => { let ver = String::from_utf8_lossy(&out.stdout).trim().to_string(); let ok = ver.chars().next().and_then(|c| c.to_digit(10)).map_or(false, |d| d >= 7); PrereqCheck { name: "PowerShell 7".into(), ok, version: Some(ver) } }
                Err(_) => PrereqCheck { name: "PowerShell 7".into(), ok: false, version: None },
            }
        }),
        tokio::task::spawn_blocking(|| {
            match hidden_cmd("dotnet").args(["--list-sdks"]).output() {
                Ok(out) => { let s = String::from_utf8_lossy(&out.stdout); let ok = s.lines().any(|l| l.trim_start().starts_with("8.")); PrereqCheck { name: ".NET 8".into(), ok, version: None } },
                Err(_) => PrereqCheck { name: ".NET 8".into(), ok: false, version: None },
            }
        }),
        tokio::task::spawn_blocking(|| {
            match hidden_cmd("git").args(["--version"]).output() {
                Ok(out) => { let ver = String::from_utf8_lossy(&out.stdout).trim().replace("git version ", ""); PrereqCheck { name: "Git".into(), ok: true, version: Some(ver) } }
                Err(_) => PrereqCheck { name: "Git".into(), ok: false, version: None },
            }
        }),
    );
    vec![
        pwsh.unwrap_or(PrereqCheck { name: "PowerShell 7".into(), ok: false, version: None }),
        dotnet.unwrap_or(PrereqCheck { name: ".NET 8".into(), ok: false, version: None }),
        git.unwrap_or(PrereqCheck { name: "Git".into(), ok: false, version: None }),
    ]
}

#[tauri::command]
pub(crate) async fn install_prereq(app: AppHandle, name: String) -> Result<(), AppError> {
    let winget_id = match name.as_str() {
        "PowerShell 7" => "Microsoft.Powershell",
        ".NET 8" => "Microsoft.DotNet.SDK.8",
        "Git" => "Git.Git",
        _ => return Err(AppError::Validation(format!("Unknown prerequisite: {}", name))),
    };

    let app_handle = app.clone();
    let prereq_name = name.clone();

    tauri::async_runtime::spawn(async move {
        let _ = app_handle.emit("prereq-event", serde_json::json!({ "name": prereq_name, "status": "installing" }));

        let result = tokio::task::spawn_blocking(move || {
            hidden_cmd("winget")
                .args(["install", "--id", winget_id, "--source", "winget",
                       "--accept-package-agreements", "--accept-source-agreements"])
                .output()
        }).await;

        match result {
            Ok(Ok(output)) => {
                let success = output.status.success();
                let msg = String::from_utf8_lossy(if success { &output.stdout } else { &output.stderr }).trim().to_string();
                let _ = app_handle.emit("prereq-event", serde_json::json!({
                    "name": prereq_name, "status": if success { "done" } else { "error" }, "message": msg
                }));
            }
            _ => {
                let _ = app_handle.emit("prereq-event", serde_json::json!({
                    "name": prereq_name, "status": "error", "message": "winget not found or failed to start"
                }));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn kill_running_script(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let mut guard = lock_script(&state);
    match guard.child_pid {
        Some(pid) => {
            #[cfg(windows)]
            { let _ = hidden_cmd("taskkill").args(["/F", "/T", "/PID", &pid.to_string()]).output(); }
            // Clear state immediately after kill so UI reflects the change
            guard.running = None;
            guard.child_pid = None;
            Ok(())
        }
        None => Err(AppError::Validation("No script is running.".into())),
    }
}
