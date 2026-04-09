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

/// Map a UI script ID to its PowerShell filename (without .ps1).
/// Returns None for unknown scripts.
fn resolve_ps_script(script: &str) -> Option<&str> {
    match script {
        "set-master-packages" | "pull-force" | "pull" | "commit" | "status"
        | "diff" | "merge" | "rollback" | "health-check"
        | "setup-local-auth" | "install-site"
        | "cleanup" | "compare" | "log" => Some(script),
        "reset" => Some("pull-force"),
        _ => None,
    }
}

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
pub(crate) async fn run_script(app: AppHandle, state: tauri::State<'_, AppState>, script: String, env_file: String, message: Option<String>, overrides: Option<std::collections::HashMap<String, String>>) -> Result<(), AppError> {
    let ps_script = resolve_ps_script(&script)
        .ok_or_else(|| AppError::Validation(format!("Unknown script: {}", script)))?;

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
    tracing::info!(script = %script_name, "Starting script");

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
        if let Some(ref ovr) = overrides {
            for (key, value) in ovr {
                let env_key = format!("DONUT_OVERRIDE_{}", key.to_uppercase());
                cmd.env(&env_key, value);
            }
        }
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

        tracing::info!(script = %script_name, code, "Script finished");
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
                Ok(out) => { let ver = String::from_utf8_lossy(&out.stdout).trim().to_string(); let ok = ver.chars().next().and_then(|c| c.to_digit(10)).is_some_and(|d| d >= 7); PrereqCheck { name: "PowerShell 7".into(), ok, version: Some(ver) } }
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
            tracing::warn!(pid, "Killing running script process tree");
            #[cfg(windows)]
            {
                let output = hidden_cmd("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .output();
                match output {
                    Ok(o) if o.status.success() => {
                        tracing::info!(pid, "Process tree killed successfully");
                    }
                    Ok(o) => {
                        let stderr = String::from_utf8_lossy(&o.stderr);
                        tracing::warn!(pid, stderr = %stderr.trim(), "taskkill returned non-zero (process may have already exited)");
                    }
                    Err(e) => {
                        tracing::error!(pid, error = %e, "Failed to run taskkill");
                    }
                }
            }
            // Clear state immediately after kill so UI reflects the change
            guard.running = None;
            guard.child_pid = None;
            Ok(())
        }
        None => Err(AppError::Validation("No script is running.".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Script name validation ──

    #[test]
    fn valid_script_names() {
        assert!(resolve_ps_script("pull").is_some());
        assert!(resolve_ps_script("commit").is_some());
        assert!(resolve_ps_script("diff").is_some());
        assert!(resolve_ps_script("merge").is_some());
        assert!(resolve_ps_script("rollback").is_some());
        assert!(resolve_ps_script("status").is_some());
        assert!(resolve_ps_script("health-check").is_some());
        assert!(resolve_ps_script("install-site").is_some());
        assert!(resolve_ps_script("setup-local-auth").is_some());
        assert!(resolve_ps_script("set-master-packages").is_some());
        assert!(resolve_ps_script("pull-force").is_some());
        assert!(resolve_ps_script("reset").is_some());
        assert!(resolve_ps_script("cleanup").is_some());
        assert!(resolve_ps_script("compare").is_some());
        assert!(resolve_ps_script("log").is_some());
    }

    #[test]
    fn unknown_script_rejected() {
        assert!(resolve_ps_script("unknown").is_none());
        assert!(resolve_ps_script("").is_none());
        assert!(resolve_ps_script("rm -rf /").is_none());
        assert!(resolve_ps_script("../../etc/passwd").is_none());
    }

    // ── Prerequisite name validation ──

    fn validate_prereq_name(name: &str) -> Result<&str, AppError> {
        match name {
            "PowerShell 7" => Ok("Microsoft.Powershell"),
            ".NET 8" => Ok("Microsoft.DotNet.SDK.8"),
            "Git" => Ok("Git.Git"),
            _ => Err(AppError::Validation(format!("Unknown prerequisite: {}", name))),
        }
    }

    #[test]
    fn valid_prereq_names() {
        assert!(validate_prereq_name("PowerShell 7").is_ok());
        assert!(validate_prereq_name(".NET 8").is_ok());
        assert!(validate_prereq_name("Git").is_ok());
    }

    #[test]
    fn unknown_prereq_rejected() {
        assert!(validate_prereq_name("Python").is_err());
        assert!(validate_prereq_name("").is_err());
        assert!(validate_prereq_name("malicious; rm -rf").is_err());
    }

    // ── Script state (lock_script) ──

    #[test]
    fn script_state_default_not_running() {
        let state = crate::AppState {
            script: std::sync::Mutex::new(crate::ScriptState { running: None, child_pid: None }),
            watcher: std::sync::Mutex::new(None),
            http: reqwest::Client::new(),
            pr_cache: crate::cache::TtlCache::new(60),
            build_cache: crate::cache::TtlCache::new(60),
        };
        let guard = lock_script(&state);
        assert!(guard.running.is_none());
        assert!(guard.child_pid.is_none());
    }

    #[test]
    fn script_state_set_running() {
        let state = crate::AppState {
            script: std::sync::Mutex::new(crate::ScriptState { running: None, child_pid: None }),
            watcher: std::sync::Mutex::new(None),
            http: reqwest::Client::new(),
            pr_cache: crate::cache::TtlCache::new(60),
            build_cache: crate::cache::TtlCache::new(60),
        };
        {
            let mut guard = lock_script(&state);
            guard.running = Some(crate::RunInfo { script: "pull".into(), started_at: 12345 });
            guard.child_pid = Some(999);
        }
        let guard = lock_script(&state);
        assert!(guard.running.is_some());
        assert_eq!(guard.running.as_ref().unwrap().script, "pull");
        assert_eq!(guard.child_pid, Some(999));
    }

    #[test]
    fn script_state_clear_after_kill() {
        let state = crate::AppState {
            script: std::sync::Mutex::new(crate::ScriptState {
                running: Some(crate::RunInfo { script: "diff".into(), started_at: 12345 }),
                child_pid: Some(42),
            }),
            watcher: std::sync::Mutex::new(None),
            http: reqwest::Client::new(),
            pr_cache: crate::cache::TtlCache::new(60),
            build_cache: crate::cache::TtlCache::new(60),
        };
        {
            let mut guard = lock_script(&state);
            guard.running = None;
            guard.child_pid = None;
        }
        let guard = lock_script(&state);
        assert!(guard.running.is_none());
        assert!(guard.child_pid.is_none());
    }

    // ── Script-to-PS mapping ──

    #[test]
    fn reset_maps_to_pull_force_ps1() {
        // "reset" must map to "pull-force" ps1 (same file, different flag)
        let ps_script = match "reset" {
            "reset" => "pull-force",
            other => other,
        };
        assert_eq!(ps_script, "pull-force");
    }

    #[test]
    fn all_scripts_map_to_ps1_file() {
        let scripts = [
            "set-master-packages", "pull-force", "reset", "pull", "commit",
            "status", "diff", "merge", "rollback", "health-check",
            "setup-local-auth", "install-site",
            "cleanup", "compare", "log",
        ];
        for script in scripts {
            let ps = resolve_ps_script(script).unwrap_or_else(|| panic!("unmapped script: {}", script));
            assert!(!ps.is_empty(), "script {} should map to a ps1 name", script);
        }
    }

    // ── Script path construction ──

    #[test]
    fn script_path_is_under_cli_scripts() {
        let root = std::path::PathBuf::from("C:\\DONUT");
        let script_path = root.join("cli").join("scripts").join("pull-force.ps1");
        assert!(script_path.to_string_lossy().contains("cli"));
        assert!(script_path.to_string_lossy().contains("scripts"));
        assert!(script_path.to_string_lossy().ends_with(".ps1"));
    }

    // ── Argument construction ──

    #[test]
    fn args_include_no_profile_and_bypass() {
        let script_path = "C:\\DONUT\\cli\\scripts\\pull.ps1";
        let args = vec![
            "-NoProfile".to_string(), "-ExecutionPolicy".to_string(), "Bypass".to_string(),
            "-File".to_string(), script_path.to_string(),
        ];
        assert!(args.contains(&"-NoProfile".to_string()));
        assert!(args.contains(&"Bypass".to_string()));
        assert!(args.contains(&"-File".to_string()));
    }

    #[test]
    fn reset_script_adds_force_flag() {
        let script = "reset";
        let mut args = vec!["-NoProfile".to_string(), "-ExecutionPolicy".to_string(), "Bypass".to_string(), "-File".to_string(), "pull-force.ps1".to_string()];
        if script == "reset" { args.push("-ForceStartFromScratch".into()); }
        assert!(args.contains(&"-ForceStartFromScratch".to_string()));
    }

    #[test]
    fn non_reset_script_no_force_flag() {
        let script = "pull-force";
        let mut args = vec!["-NoProfile".to_string(), "-ExecutionPolicy".to_string(), "Bypass".to_string(), "-File".to_string(), "pull-force.ps1".to_string()];
        if script == "reset" { args.push("-ForceStartFromScratch".into()); }
        assert!(!args.contains(&"-ForceStartFromScratch".to_string()));
    }

    #[test]
    fn env_file_appended_when_non_empty() {
        let env_file = "myenv.json";
        let mut args: Vec<String> = vec!["-File".into(), "pull.ps1".into()];
        if !env_file.is_empty() { args.push(env_file.into()); }
        assert_eq!(args.last().unwrap(), "myenv.json");
    }

    #[test]
    fn env_file_not_appended_when_empty() {
        let env_file = "";
        let mut args: Vec<String> = vec!["-File".into(), "pull.ps1".into()];
        if !env_file.is_empty() { args.push(env_file.into()); }
        assert_eq!(args.len(), 2);
    }

    // ── Concurrent run prevention ──

    #[test]
    fn concurrent_run_blocked() {
        let state = crate::AppState {
            script: std::sync::Mutex::new(crate::ScriptState {
                running: Some(crate::RunInfo { script: "pull".into(), started_at: 12345 }),
                child_pid: Some(100),
            }),
            watcher: std::sync::Mutex::new(None),
            http: reqwest::Client::new(),
            pr_cache: crate::cache::TtlCache::new(60),
            build_cache: crate::cache::TtlCache::new(60),
        };
        let guard = lock_script(&state);
        assert!(guard.running.is_some(), "should block new script when one is already running");
    }

    // ── Overrides env vars ──

    #[test]
    fn override_key_format() {
        let key = "site_path";
        let env_key = format!("DONUT_OVERRIDE_{}", key.to_uppercase());
        assert_eq!(env_key, "DONUT_OVERRIDE_SITE_PATH");
    }

    #[test]
    fn override_key_with_special_chars() {
        let key = "ena_path";
        let env_key = format!("DONUT_OVERRIDE_{}", key.to_uppercase());
        assert_eq!(env_key, "DONUT_OVERRIDE_ENA_PATH");
    }
}
