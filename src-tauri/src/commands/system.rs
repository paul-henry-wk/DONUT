use std::io::Write;
use std::path::PathBuf;

use crate::error::AppError;
use crate::helpers::{hidden_cmd, strip_ansi};

/// Escape a string for safe embedding inside a PowerShell single-quoted string.
/// In PS single-quoted strings, the only special char is `'` which is escaped as `''`.
/// We also strip any characters that could break out of the string context.
fn escape_ps_single_quote(s: &str) -> String {
    s.chars()
        .filter(|c| *c != '\0' && *c != '\n' && *c != '\r')
        .collect::<String>()
        .replace('\'', "''")
}

#[tauri::command]
pub(crate) async fn browse_folder(default_path: Option<String>) -> Result<Option<String>, AppError> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let initial = default_path.unwrap_or_else(|| "C:\\".to_string());
            let safe_path = escape_ps_single_quote(&initial);
            let cmd = format!(
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select site folder'; $f.SelectedPath = '{}'; if ($f.ShowDialog() -eq 'OK') {{ $f.SelectedPath }} else {{ '' }}",
                safe_path
            );
            let output = hidden_cmd("pwsh")
                .args(["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", &cmd])
                .output()?;
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(if path.is_empty() { None } else { Some(path) })
        }
        #[cfg(not(windows))]
        Ok(None)
    }).await.map_err(|e| AppError::Validation(e.to_string()))?
}

#[tauri::command]
pub(crate) async fn list_sql_packages(site_path: String, password: Option<String>) -> Result<Vec<String>, AppError> {
    if site_path.is_empty() { return Err(AppError::Validation("Set a site path first.".into())); }
    let db_name = PathBuf::from(&site_path).file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Validation("Cannot determine database name from site path.".into()))?;
    let db_password = password.unwrap_or_else(|| String::new());

    tokio::task::spawn_blocking(move || {
        let mut cmd = hidden_cmd("sqlcmd");
        cmd.args(["-S", "(local)", "-d", &db_name, "-U", "sa",
            "-Q", "SET NOCOUNT ON; SELECT XMLInfo FROM Meta_Products WHERE MetaType=2 AND (Special&64)=0 ORDER BY ProductName",
            "-h", "-1", "-W"])
            .env("SQLCMDPASSWORD", &db_password);
        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound { AppError::Validation("sqlcmd not found. Install SQL Server command line tools.".into()) }
            else { AppError::Io(e) }
        })?;
        let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr)).trim().to_string();
        if !stderr.is_empty() { return Err(AppError::Validation(stderr)); }
        Ok(String::from_utf8_lossy(&output.stdout).lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('(') && !l.contains("rows affected"))
            .collect())
    }).await.map_err(|e| AppError::Validation(e.to_string()))?
}

#[tauri::command]
pub(crate) fn reset_git_credentials() -> Result<String, AppError> {
    // Clear stored git credentials for dev.azure.com
    let output = hidden_cmd("git")
        .args(["credential", "reject"])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(b"protocol=https\nhost=dev.azure.com\n\n")?;
            }
            child.wait()
        });
    match output {
        Ok(_) => Ok("Git credentials for dev.azure.com cleared. Next git operation will re-authenticate.".into()),
        Err(e) => Err(AppError::Validation(format!("Failed to clear credentials: {}", e))),
    }
}

#[tauri::command]
pub(crate) fn open_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Validation("Invalid URL".into()));
    }
    // Use explorer.exe directly instead of cmd /C start to avoid shell metacharacter injection.
    // explorer.exe receives the URL as a single argument, no shell parsing involved.
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&url);
        let _ = cmd.spawn();
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn open_file(path: String) -> Result<(), AppError> {
    if path.is_empty() || path.contains('\0') {
        return Err(AppError::Validation("Invalid file path".into()));
    }
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Validation(format!("Path not found: {}", path)));
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub(crate) struct LocalSite { path: String, version: String, name: String }

#[tauri::command]
pub(crate) async fn scan_local_sites() -> Vec<LocalSite> {
    // Scan common root folders for site folders matching pattern: {version}/WizRisk.{name}
    let mut sites = Vec::new();
    let roots = ["C:\\inetpub", "D:\\inetpub", "C:\\", "D:\\"];
    for root in &roots {
        let root_path = std::path::Path::new(root);
        if !root_path.exists() { continue; }
        if let Ok(versions) = std::fs::read_dir(root_path) {
            for ver_entry in versions.flatten() {
                let ver_path = ver_entry.path();
                if !ver_path.is_dir() { continue; }
                let ver_name = ver_entry.file_name().to_string_lossy().to_string();
                // Look for WizRisk.* folders inside version folder
                if let Ok(sites_in_ver) = std::fs::read_dir(&ver_path) {
                    for site_entry in sites_in_ver.flatten() {
                        let site_name = site_entry.file_name().to_string_lossy().to_string();
                        if site_name.starts_with("WizRisk.") && site_entry.path().is_dir() {
                            sites.push(LocalSite {
                                path: site_entry.path().to_string_lossy().to_string(),
                                version: ver_name.clone(),
                                name: site_name,
                            });
                        }
                    }
                }
                // Also check if the folder itself is a WizRisk folder (flat structure)
                if ver_name.starts_with("WizRisk.") {
                    sites.push(LocalSite {
                        path: ver_path.to_string_lossy().to_string(),
                        version: String::new(),
                        name: ver_name,
                    });
                }
            }
        }
    }
    sites.sort_by(|a, b| a.name.cmp(&b.name));
    sites
}
