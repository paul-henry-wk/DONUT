use crate::helpers::hidden_cmd;
use crate::AppState;

#[derive(serde::Serialize)]
pub(crate) struct HealthStatus { iis: bool, sql: bool, site: bool, vpn: bool, iis_detail: String, sql_detail: String, site_detail: String, vpn_detail: String }

#[tauri::command]
pub(crate) async fn quick_health(site_path: String, site_id: String, db_user: String, db_password: String, parent_site: String) -> HealthStatus {
    let _ = site_path; // reserved for future use
    let site_id2 = site_id.clone();
    let db_user2 = db_user.clone();
    let db_pass2 = db_password.clone();
    let parent2 = parent_site.clone();

    let (iis_r, sql_r, site_r, vpn_r) = tokio::join!(
        // IIS check
        tokio::task::spawn_blocking(move || {
            match hidden_cmd("sc").args(["query", "W3SVC"]).output() {
                Ok(out) => {
                    let s = String::from_utf8_lossy(&out.stdout);
                    if s.contains("RUNNING") { (true, "running".into()) }
                    else if s.contains("STOPPED") { (false, "stopped".into()) }
                    else { (false, "unknown".into()) }
                }
                Err(_) => (false, "not found".into()),
            }
        }),
        // SQL check
        tokio::task::spawn_blocking(move || {
            match hidden_cmd("sqlcmd").args(["-S", "(local)", "-d", &site_id2, "-U", &db_user2, "-Q", "SELECT 1", "-h", "-1", "-W", "-t", "3"]).env("SQLCMDPASSWORD", &db_pass2).output() {
                Ok(out) => {
                    if out.status.success() { (true, "connected".into()) }
                    else { let e = String::from_utf8_lossy(&out.stderr); (false, e.lines().next().unwrap_or("failed").to_string()) }
                }
                Err(_) => (false, "sqlcmd not found".into()),
            }
        }),
        // Site HTTP check (TCP connect to localhost:80 + raw HTTP GET)
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            match std::net::TcpStream::connect_timeout(&"127.0.0.1:80".parse().unwrap(), std::time::Duration::from_secs(3)) {
                Ok(mut stream) => {
                    let req = format!("GET /{}/go.aspx HTTP/1.0\r\nHost: localhost\r\n\r\n", site_id);
                    let _ = stream.write_all(req.as_bytes());
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
                    let mut buf = [0u8; 256];
                    match stream.read(&mut buf) {
                        Ok(n) => {
                            let resp = String::from_utf8_lossy(&buf[..n]);
                            if let Some(code) = resp.split_whitespace().nth(1) {
                                let c: u16 = code.parse().unwrap_or(0);
                                if c > 0 && c < 400 { (true, format!("HTTP {}", c)) } else { (false, format!("HTTP {}", c)) }
                            } else { (false, "bad response".into()) }
                        }
                        Err(_) => (false, "timeout".into()),
                    }
                }
                Err(_) => (false, "connection refused".into()),
            }
        }),
        // VPN check (DNS resolve)
        tokio::task::spawn_blocking(move || {
            if parent2.is_empty() { return (true, "n/a".into()); }
            let host = parent2.replace("https://", "").replace("http://", "").split('/').next().unwrap_or("").to_string();
            if host.is_empty() { return (true, "n/a".into()); }
            match std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), 443)) {
                Ok(_) => (true, "connected".into()),
                Err(_) => (false, "unreachable".into()),
            }
        }),
    );

    let (iis_ok, iis_d) = iis_r.unwrap_or((false, "error".into()));
    let (sql_ok, sql_d) = sql_r.unwrap_or((false, "error".into()));
    let (site_ok, site_d) = site_r.unwrap_or((false, "error".into()));
    let (vpn_ok, vpn_d) = vpn_r.unwrap_or((false, "error".into()));

    HealthStatus { iis: iis_ok, sql: sql_ok, site: site_ok, vpn: vpn_ok, iis_detail: iis_d, sql_detail: sql_d, site_detail: site_d, vpn_detail: vpn_d }
}

#[derive(serde::Serialize)]
pub(crate) struct SiteAuthResult { pub ok: bool, pub detail: String }

/// Test Enablon site admin credentials by performing the same authenticated API call the
/// PowerShell scripts use (CallLocalAPI → sGetVersion, new-session path). Lets users verify
/// `local.user` / `local.password` against an existing site before running Setup.
#[tauri::command]
pub(crate) async fn test_site_auth(state: tauri::State<'_, AppState>, site_id: String, user: String, password: String) -> Result<SiteAuthResult, crate::error::AppError> {
    if site_id.is_empty() || user.is_empty() {
        return Ok(SiteAuthResult { ok: false, detail: "Site path and user are required.".into() });
    }
    let url = format!("http://localhost/{}/?v=/dlv/PickAndChoose&fct=sGetVersion", site_id);
    let body = serde_json::json!({
        "fct_name": "sGetVersion",
        "params": { "nVersionType": 1, "sObjectTag": "Autodelivery", "nObjectType": 20 },
        "authentication": { "userid": user, "password": password, "siteid": site_id }
    });
    let resp = state.http.post(&url)
        .header("Content-Type", "application/json; charset=utf-8")
        .timeout(std::time::Duration::from_secs(8))
        .json(&body)
        .send().await;
    match resp {
        Err(e) => {
            if e.is_connect() || e.is_timeout() {
                Ok(SiteAuthResult { ok: false, detail: format!("Site unreachable at http://localhost/{} — is IIS running and the site started?", site_id) })
            } else {
                Ok(SiteAuthResult { ok: false, detail: format!("Request failed: {}", e) })
            }
        }
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            // Enablon replies HTTP 200 with JSON { status, error }; status == "OK" means success.
            let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
            let enablon_status = json["status"].as_str().unwrap_or("");
            let error_msg = json["error"].as_str().unwrap_or("");
            if enablon_status.eq_ignore_ascii_case("OK") {
                Ok(SiteAuthResult { ok: true, detail: "Credentials accepted.".into() })
            } else if error_msg.to_lowercase().contains("authentication") || status.as_u16() == 401 {
                Ok(SiteAuthResult { ok: false, detail: "Authentication failed — wrong password, or 'Force SSL' is enabled in WizManager. For an existing site, run Setup Auth to align credentials.".into() })
            } else if !error_msg.is_empty() || status.is_success() {
                // Auth passed but the function errored for another reason → credentials are valid.
                Ok(SiteAuthResult { ok: true, detail: "Credentials accepted (site reachable).".into() })
            } else {
                Ok(SiteAuthResult { ok: false, detail: format!("Unexpected response (HTTP {}).", status.as_u16()) })
            }
        }
    }
}

// ── Testable helper functions (extracted from async blocks for unit testing) ──

#[cfg(test)]
fn parse_iis_output(stdout: &str) -> (bool, String) {
    if stdout.contains("RUNNING") { (true, "running".into()) }
    else if stdout.contains("STOPPED") { (false, "stopped".into()) }
    else { (false, "unknown".into()) }
}

#[cfg(test)]
fn parse_http_status_line(response: &str) -> (bool, String) {
    if let Some(code) = response.split_whitespace().nth(1) {
        let c: u16 = code.parse().unwrap_or(0);
        if c > 0 && c < 400 { (true, format!("HTTP {}", c)) }
        else { (false, format!("HTTP {}", c)) }
    } else {
        (false, "bad response".into())
    }
}

#[cfg(test)]
fn parse_vpn_host(parent_site: &str) -> String {
    parent_site
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── IIS output parsing ──

    #[test]
    fn iis_running() {
        let (ok, detail) = parse_iis_output("SERVICE_NAME: W3SVC\n  STATE: 4  RUNNING\n");
        assert!(ok);
        assert_eq!(detail, "running");
    }

    #[test]
    fn iis_stopped() {
        let (ok, detail) = parse_iis_output("SERVICE_NAME: W3SVC\n  STATE: 1  STOPPED\n");
        assert!(!ok);
        assert_eq!(detail, "stopped");
    }

    #[test]
    fn iis_unknown() {
        let (ok, detail) = parse_iis_output("unexpected output");
        assert!(!ok);
        assert_eq!(detail, "unknown");
    }

    #[test]
    fn iis_empty() {
        let (ok, detail) = parse_iis_output("");
        assert!(!ok);
        assert_eq!(detail, "unknown");
    }

    // ── HTTP status line parsing ──

    #[test]
    fn http_200() {
        let (ok, detail) = parse_http_status_line("HTTP/1.1 200 OK");
        assert!(ok);
        assert_eq!(detail, "HTTP 200");
    }

    #[test]
    fn http_302() {
        let (ok, detail) = parse_http_status_line("HTTP/1.1 302 Found");
        assert!(ok);
        assert_eq!(detail, "HTTP 302");
    }

    #[test]
    fn http_404() {
        let (ok, detail) = parse_http_status_line("HTTP/1.1 404 Not Found");
        assert!(!ok);
        assert_eq!(detail, "HTTP 404");
    }

    #[test]
    fn http_500() {
        let (ok, detail) = parse_http_status_line("HTTP/1.1 500 Internal Server Error");
        assert!(!ok);
        assert_eq!(detail, "HTTP 500");
    }

    #[test]
    fn http_bad_response() {
        let (ok, detail) = parse_http_status_line("");
        assert!(!ok);
        assert_eq!(detail, "bad response");
    }

    // ── VPN host parsing ──

    #[test]
    fn vpn_https_url() {
        assert_eq!(parse_vpn_host("https://mysite.enablon.com/app"), "mysite.enablon.com");
    }

    #[test]
    fn vpn_http_url() {
        assert_eq!(parse_vpn_host("http://mysite.com/path"), "mysite.com");
    }

    #[test]
    fn vpn_plain_hostname() {
        assert_eq!(parse_vpn_host("mysite.enablon.com"), "mysite.enablon.com");
    }

    #[test]
    fn vpn_empty() {
        assert_eq!(parse_vpn_host(""), "");
    }

    #[test]
    fn vpn_https_no_path() {
        assert_eq!(parse_vpn_host("https://server.example.com"), "server.example.com");
    }
}
