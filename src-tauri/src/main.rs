#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;

mod error;
mod helpers;
mod cache;
mod commands;

use commands::*;

// ── State ──

pub(crate) struct ScriptState {
    pub running: Option<RunInfo>,
    pub child_pid: Option<u32>,
}

pub(crate) struct AppState {
    script: Mutex<ScriptState>,
    http: reqwest::Client,
    watcher: Mutex<Option<notify_debouncer_full::Debouncer<notify::RecommendedWatcher, notify_debouncer_full::RecommendedCache>>>,
    pr_cache: cache::TtlCache<serde_json::Value>,
    build_cache: cache::TtlCache<serde_json::Value>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct RunInfo {
    script: String,
    started_at: u64,
}

// ── Main ──

fn cleanup_old_logs() {
    let log_dir = helpers::log_dir();
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        let Some(cutoff) = std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(30 * 24 * 3600)) else { return };
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if modified < cutoff {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

/// Pre-warm the PowerShell runtime so subsequent script launches are faster.
/// Spawns `pwsh` once at startup — the OS caches the runtime in memory.
fn prewarm_pwsh() {
    std::thread::spawn(|| {
        let _ = helpers::hidden_cmd("pwsh")
            .args(["-NoProfile", "-NonInteractive", "-Command", "exit 0"])
            .output();
    });
}

fn main() {
    // ── Initialize structured logging (simple file-based) ──
    helpers::init_logging();
    tracing::info!("DONUT starting");

    cleanup_old_logs();
    prewarm_pwsh();
    tauri::Builder::default()
        .manage(AppState {
            script: Mutex::new(ScriptState { running: None, child_pid: None }),
            watcher: Mutex::new(None),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("Failed to create HTTP client"),
            pr_cache: cache::TtlCache::new(60),
            build_cache: cache::TtlCache::new(60),
        })
        .invoke_handler(tauri::generate_handler![
            get_version, get_package_mapping, list_envs, get_env, save_env, create_env, delete_env, rename_env, clone_env, list_templates, create_env_from_template,
            check_prereqs, install_prereq, quick_health, run_script, get_run_status,
            browse_folder, browse_file, read_text_file, export_file, validate_pat,
            list_azdo_projects, list_azdo_repos, list_azdo_branches, create_azdo_branch, delete_azdo_branch,
            list_azdo_prs, list_azdo_builds, compare_branches, check_merge_conflicts,
            search_work_items, list_branch_work_items, assign_work_item,
            get_pr_files, get_file_diff,
            list_sql_packages, kill_running_script, reset_git_credentials, is_admin, open_url, open_file, scan_local_sites, scan_enablon_instances, list_instance_sites, get_as_version, run_instance_action, git_preview,
            check_for_updates, apply_update, build_bug_report_url,
            start_watch, stop_watch, is_watching,
            store_pat, get_pat, delete_pat,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                tracing::info!("DONUT shutting down");
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(guard) = state.script.lock() {
                        if let Some(pid) = guard.child_pid {
                            tracing::warn!(pid, "Killing running script on exit");
                            #[cfg(windows)]
                            { let _ = helpers::hidden_cmd("taskkill").args(["/F", "/T", "/PID", &pid.to_string()]).output(); }
                        }
                    }
                }
            }
        });
}
