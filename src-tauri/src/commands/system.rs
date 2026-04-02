use std::io::Write;
use std::path::PathBuf;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::error::AppError;
use crate::helpers::{app_root, hidden_cmd, strip_ansi};

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
pub(crate) async fn browse_file(default_path: Option<String>, filter: Option<String>) -> Result<Option<String>, AppError> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let initial = default_path.unwrap_or_else(|| "C:\\".to_string());
            let safe_path = escape_ps_single_quote(&initial);
            let filter_str = filter.unwrap_or_else(|| "ENA files (*.ena)|*.ena|All files (*.*)|*.*".to_string());
            let safe_filter = escape_ps_single_quote(&filter_str);
            let cmd = format!(
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = 'Select file'; $f.Filter = '{}'; $f.InitialDirectory = '{}'; if ($f.ShowDialog() -eq 'OK') {{ $f.FileName }} else {{ '' }}",
                safe_filter, safe_path
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
    let db_password = password.unwrap_or_default();

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
pub(crate) fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use std::process::Command;
        // Quick check: try to read a protected registry key
        Command::new("net")
            .args(["session"])
            .creation_flags(0x08000000)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    { true }
}

#[tauri::command]
pub(crate) fn open_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Validation("Invalid URL".into()));
    }
    // Use cmd /C start with empty title to open URLs correctly (handles query params).
    // URL is pre-validated to start with http(s):// above, safe from injection.
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();
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

// ── Enablon instance scanner ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct EnablonInstance {
    path: String,
    name: String,
    has_wiz_manager: bool,
}

#[tauri::command]
pub(crate) fn scan_enablon_instances() -> Vec<EnablonInstance> {
    let mut instances = Vec::new();
    let mut seen = std::collections::HashSet::new();
    // Scan common Enablon install roots
    let roots = ["C:\\Enablon", "D:\\Enablon", "C:\\inetpub", "D:\\inetpub", "C:\\", "D:\\"];
    for root in &roots {
        let root_path = std::path::Path::new(root);
        if !root_path.exists() { continue; }
        if let Ok(entries) = std::fs::read_dir(root_path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() { continue; }
                // Check if this directory has Binary\WizManager.exe
                let wiz = p.join("Binary").join("WizManager.exe");
                let sites_dir = p.join("Sites");
                if wiz.exists() || sites_dir.exists() {
                    let path_str = p.to_string_lossy().to_string();
                    if seen.insert(path_str.clone()) {
                        instances.push(EnablonInstance {
                            name: entry.file_name().to_string_lossy().to_string(),
                            has_wiz_manager: wiz.exists(),
                            path: path_str,
                        });
                    }
                }
            }
        }
    }
    instances.sort_by(|a, b| a.name.cmp(&b.name));
    instances
}

// ── Self-update ──

const GITHUB_REPO: &str = "paul-henry-wk/DONUT";

#[derive(serde::Serialize)]
pub(crate) struct UpdateInfo {
    available: bool,
    current_version: String,
    latest_version: String,
    download_url: String,
    release_notes: String,
}

#[tauri::command]
pub(crate) async fn check_for_updates(
    state: tauri::State<'_, crate::AppState>,
) -> Result<UpdateInfo, AppError> {
    // Read current version from version.json
    let version_path = app_root().join("cli").join("config").join("version.json");
    let current = if version_path.exists() {
        let data: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&version_path)?)?;
        data["version"].as_str().unwrap_or("0.0.0").to_string()
    } else {
        "0.0.0".to_string()
    };

    // Query GitHub Releases API
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );
    let resp = state
        .http
        .get(&url)
        .header("User-Agent", "DONUT-Updater")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await?;

    if !resp.status().is_success() {
        return Ok(UpdateInfo {
            available: false,
            current_version: current.clone(),
            latest_version: current,
            download_url: String::new(),
            release_notes: "Could not reach GitHub.".into(),
        });
    }

    let data: serde_json::Value = resp.json().await?;
    let latest = data["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let notes = data["body"].as_str().unwrap_or("").to_string();

    // Find the first .zip asset
    let download_url = data["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|x| {
                x["name"]
                    .as_str()
                    .map(|n| n.ends_with(".zip"))
                    .unwrap_or(false)
            })
        })
        .and_then(|x| x["browser_download_url"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(UpdateInfo {
        available: !latest.is_empty() && latest != current && !download_url.is_empty(),
        current_version: current,
        latest_version: latest,
        download_url,
        release_notes: notes,
    })
}

#[tauri::command]
pub(crate) async fn apply_update(
    download_url: String,
    state: tauri::State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    // Validate URL origin
    if !download_url.starts_with("https://github.com/") {
        return Err(AppError::Validation("Invalid download URL.".into()));
    }

    let root = app_root();
    let update_dir = root.join("_update");
    let zip_path = root.join("_update.zip");

    // Download the release zip
    let resp = state
        .http
        .get(&download_url)
        .header("User-Agent", "DONUT-Updater")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::Validation(format!(
            "Download failed: HTTP {}",
            resp.status()
        )));
    }
    let bytes = resp.bytes().await?;
    std::fs::write(&zip_path, &bytes)?;

    // Extract zip
    let _ = std::fs::remove_dir_all(&update_dir);
    std::fs::create_dir_all(&update_dir)?;

    let file = std::fs::File::open(&zip_path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| AppError::Validation(format!("Invalid zip: {}", e)))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Validation(format!("Zip error: {}", e)))?;

        let name = entry.name().to_string();
        // Path traversal protection
        if name.contains("..") || name.starts_with('/') || name.starts_with('\\') {
            continue;
        }

        let out_path = update_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    let _ = std::fs::remove_file(&zip_path);

    // If zip had a single top-level folder, use its contents
    let content_dir = {
        let entries: Vec<_> = std::fs::read_dir(&update_dir)?
            .filter_map(|e| e.ok())
            .collect();
        if entries.len() == 1 && entries[0].path().is_dir() {
            entries[0].path()
        } else {
            update_dir.clone()
        }
    };

    // Build a batch script that waits for the app to exit, then replaces files
    let exe_name = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "DONUT.exe".into());

    let root_str = root.to_string_lossy().replace('/', "\\");
    let content_str = content_dir.to_string_lossy().replace('/', "\\");

    let bat = format!(
        "@echo off\r\ncd /d \"{root}\"\r\necho Updating DONUT, please wait...\r\n:wait\r\ntasklist /FI \"IMAGENAME eq {exe}\" 2>NUL | find /I \"{exe}\" >NUL\r\nif \"%ERRORLEVEL%\"==\"0\" (\r\n    timeout /t 1 /nobreak >nul\r\n    goto wait\r\n)\r\nxcopy /E /Y /Q \"{content}\\*\" \"{root}\\\" >nul\r\nrmdir /S /Q \"_update\" >nul 2>&1\r\necho Update complete. Restarting...\r\nstart \"\" \"{exe}\"\r\n(goto) 2>nul & del \"%~f0\"",
        root = root_str,
        exe = exe_name,
        content = content_str,
    );

    let bat_path = root.join("_update.bat");
    std::fs::write(&bat_path, &bat)?;

    // Launch the updater script and exit the app
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", bat_path.to_string_lossy().as_ref()])
            .current_dir(&root)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();
    }

    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── escape_ps_single_quote ──

    #[test]
    fn escape_plain_string() {
        assert_eq!(escape_ps_single_quote("hello"), "hello");
    }

    #[test]
    fn escape_single_quotes() {
        assert_eq!(escape_ps_single_quote("it's"), "it''s");
    }

    #[test]
    fn escape_multiple_quotes() {
        assert_eq!(escape_ps_single_quote("a'b'c"), "a''b''c");
    }

    #[test]
    fn escape_strips_null() {
        assert_eq!(escape_ps_single_quote("ab\0cd"), "abcd");
    }

    #[test]
    fn escape_strips_newlines() {
        assert_eq!(escape_ps_single_quote("line1\nline2\rline3"), "line1line2line3");
    }

    #[test]
    fn escape_preserves_spaces_and_special() {
        assert_eq!(escape_ps_single_quote("C:\\Program Files\\App"), "C:\\Program Files\\App");
    }

    // ── open_url validation ──

    #[test]
    fn open_url_rejects_non_http() {
        let result = open_url("ftp://example.com".into());
        assert!(result.is_err());
    }

    #[test]
    fn open_url_accepts_https() {
        // On CI/test, this will try to spawn a process but won't fail validation
        let result = open_url("https://example.com".into());
        assert!(result.is_ok());
    }

    #[test]
    fn open_url_accepts_http() {
        let result = open_url("http://localhost/site".into());
        assert!(result.is_ok());
    }

    #[test]
    fn open_url_rejects_javascript() {
        let result = open_url("javascript:alert(1)".into());
        assert!(result.is_err());
    }

    // ── open_file validation ──

    #[test]
    fn open_file_rejects_empty() {
        let result = open_file(String::new());
        assert!(result.is_err());
    }

    #[test]
    fn open_file_rejects_null_byte() {
        let result = open_file("C:\\path\0evil".into());
        assert!(result.is_err());
    }

    #[test]
    fn open_file_rejects_nonexistent() {
        let result = open_file("C:\\definitely_nonexistent_path_12345".into());
        assert!(result.is_err());
    }
}
