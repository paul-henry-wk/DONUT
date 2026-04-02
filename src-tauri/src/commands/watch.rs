use std::time::Duration;
use tauri::{AppHandle, Emitter};
use notify_debouncer_full::{new_debouncer, DebouncedEvent};
use notify::RecursiveMode;

use crate::error::AppError;
use crate::helpers::{app_root, validate_env_name};
use crate::AppState;
use super::ScriptEvent;

#[tauri::command]
pub(crate) async fn start_watch(app: AppHandle, state: tauri::State<'_, AppState>, env_file: String) -> Result<(), AppError> {
    // Load env config to get site_path
    let env_name = validate_env_name(&env_file)?;
    let env_path = app_root().join("working-environments").join(&env_name);
    let data = std::fs::read_to_string(&env_path)?;
    let config: serde_json::Value = serde_json::from_str(&data)?;
    let site_path = config.get("local")
        .and_then(|l| l.get("site_path"))
        .and_then(|p| p.as_str())
        .ok_or_else(|| AppError::Validation("No site_path in config".into()))?
        .to_string();

    let repo_path = config.get("local")
        .and_then(|l| l.get("repository"))
        .and_then(|p| p.as_str())
        .unwrap_or(&site_path)
        .to_string();

    let watch_path = std::path::PathBuf::from(&repo_path);
    if !watch_path.exists() {
        return Err(AppError::Validation(format!("Watch path does not exist: {}", repo_path)));
    }

    // Stop existing watcher if any
    { let mut g = state.watcher.lock().unwrap_or_else(|e| e.into_inner()); *g = None; }

    let app_handle = app.clone();
    let root = app_root();
    let env_for_diff = env_file.clone();

    let mut debouncer = new_debouncer(
        Duration::from_secs(2),
        None,
        move |events: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            if let Ok(evts) = events {
                if evts.is_empty() { return; }
                let _ = app_handle.emit("script-event", ScriptEvent {
                    event_type: "log".into(),
                    text: Some(format!("[STATUS] File changes detected ({} files)", evts.len())),
                    script: Some("watch".into()),
                    code: None,
                });
                // Run diff script in a separate thread to avoid blocking the watcher
                let script_path = root.join("cli").join("scripts").join("diff.ps1");
                let env_clone = env_for_diff.clone();
                let root_clone = root.clone();
                let app_clone = app_handle.clone();
                std::thread::spawn(move || {
                    let output = crate::helpers::hidden_cmd("pwsh")
                        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            &script_path.to_string_lossy(), &env_clone])
                        .current_dir(&root_clone)
                        .env("NO_COLOR", "1")
                        .env("DONUT_GUI", "1")
                        .output();

                    if let Ok(out) = output {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        for line in stdout.lines() {
                            let text = line.trim_end().to_string();
                            if !text.is_empty() {
                                let _ = app_clone.emit("script-event", ScriptEvent {
                                    event_type: "log".into(),
                                    text: Some(text),
                                    script: Some("watch".into()),
                                    code: None,
                                });
                            }
                        }
                    }
                });
            }
        },
    ).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

    debouncer.watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

    let _ = app.emit("script-event", ScriptEvent {
        event_type: "log".into(),
        text: Some(format!("[STATUS] Watching: {}", repo_path)),
        script: Some("watch".into()),
        code: None,
    });

    { let mut g = state.watcher.lock().unwrap_or_else(|e| e.into_inner()); *g = Some(debouncer); }

    Ok(())
}

#[tauri::command]
pub(crate) fn stop_watch(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let mut g = state.watcher.lock().unwrap_or_else(|e| e.into_inner());
    *g = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn is_watching(state: tauri::State<'_, AppState>) -> bool {
    let g = state.watcher.lock().unwrap_or_else(|e| e.into_inner());
    g.is_some()
}
