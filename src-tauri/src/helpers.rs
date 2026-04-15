use std::path::PathBuf;
use base64::Engine;

use crate::error::{azdo_status_err, AppError};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn log_dir() -> PathBuf {
    app_root().join(".bin").join("logs")
}

/// Simple file-based tracing: writes to daily log file without heavy dependencies.
/// Uses tracing macros throughout the app but routes output to a plain file writer.
pub(crate) fn init_logging() {
    let log_dir = log_dir();
    let _ = std::fs::create_dir_all(&log_dir);
    let date = {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let days = now / 86400;
        // Simple date: YYYY-MM-DD from epoch days
        let (y, m, d) = epoch_days_to_ymd(days);
        format!("{:04}-{:02}-{:02}", y, m, d)
    };
    let log_path = log_dir.join(format!("donut.{}.log", date));

    // Open log file in append mode
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let file = std::sync::Mutex::new(std::io::BufWriter::new(file));
        // Set a simple tracing subscriber that writes to the file
        let _ = tracing::subscriber::set_global_default(FileSubscriber { file });
    }
}

fn epoch_days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Civil days from epoch algorithm (simplified)
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

struct FileSubscriber {
    file: std::sync::Mutex<std::io::BufWriter<std::fs::File>>,
}

impl tracing::Subscriber for FileSubscriber {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata.level() <= &tracing::Level::INFO
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, event: &tracing::Event<'_>) {
        use std::fmt::Write as FmtWrite;
        use std::io::Write;
        let mut msg = String::new();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let _ = write!(msg, "{} [{}] ", now, event.metadata().level());
        // Extract message from event fields
        struct Visitor<'a>(&'a mut String);
        impl tracing::field::Visit for Visitor<'_> {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    let _ = write!(self.0, "{:?}", value);
                } else {
                    let _ = write!(self.0, " {}={:?}", field.name(), value);
                }
            }
            fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                if field.name() == "message" {
                    let _ = write!(self.0, "{}", value);
                } else {
                    let _ = write!(self.0, " {}={}", field.name(), value);
                }
            }
        }
        event.record(&mut Visitor(&mut msg));
        if let Ok(mut f) = self.file.lock() {
            let _ = writeln!(f, "{}", msg);
            let _ = f.flush();
        }
    }
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

/// Extract and validate the Azure DevOps organization from an Option<String>.
pub(crate) fn extract_org(organization: &Option<String>) -> Result<&str, AppError> {
    organization.as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))
}

pub(crate) fn app_root() -> PathBuf {
    std::env::var("DONUT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        })
}

pub(crate) fn validate_env_name(name: &str) -> Result<String, AppError> {
    if name.len() > 100 || name.contains('\0') || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::Validation("Invalid file name".into()));
    }
    if name == ".env.json" || (name.starts_with(".env-") && name.ends_with(".json")) {
        Ok(name.to_string())
    } else {
        Err(AppError::Validation("Invalid file name".into()))
    }
}

/// Sanitize a string for safe use as a PowerShell -File argument.
/// In -File mode, PS does NOT interpret arguments as code, so $, (), {} are safe.
/// We only reject characters that could break shell argument boundaries.
pub(crate) fn sanitize_ps_arg(s: &str) -> Result<String, AppError> {
    if s.contains('\0') {
        return Err(AppError::Validation("Argument contains null byte".into()));
    }
    // Only reject shell operators that could escape argument boundaries
    for ch in ['|', ';', '`', '<', '>'] {
        if s.contains(ch) {
            return Err(AppError::Validation(format!("Argument contains forbidden character: {}", ch)));
        }
    }
    Ok(s.to_string())
}

/// Filter out noisy lines that clutter the terminal
pub(crate) fn is_noise(text: &str) -> bool {
    // Whitespace-only lines (blank lines from PowerShell Write-Host)
    if text.trim().is_empty() { return true; }
    let t = text.to_lowercase();
    // Git safe.directory warnings
    if t.contains("safe.directory") && t.contains("not absolute") { return true; }
    // Git credential helper noise
    if t.starts_with("credential") && t.contains("helper") { return true; }
    // Empty gum style borders/padding
    if text.chars().all(|c| c == '─' || c == '│' || c == '╭' || c == '╮' || c == '╰' || c == '╯' || c == '║' || c == '═' || c == '╔' || c == '╗' || c == '╚' || c == '╝' || c == ' ') { return true; }
    // PowerShell progress/verbose noise
    if t.starts_with("verbose:") || t.starts_with("debug:") { return true; }
    // Git noise
    if text.starts_with("\\ No newline") { return true; }
    // Separator-only lines (dashes, equals)
    if text.len() >= 3 && text.trim().chars().all(|c| c == '-' || c == '=' || c == ' ') { return true; }
    false
}

pub(crate) fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&next) = chars.peek() {
                if next == '[' {
                    chars.next();
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if nc.is_ascii_alphabetic() { break; }
                    }
                    continue;
                }
                if next == ']' {
                    chars.next();
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if nc == '\x07' || nc == '\\' { break; }
                    }
                    continue;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

pub(crate) fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Create a Command with CREATE_NO_WINDOW on Windows
pub(crate) fn hidden_cmd(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub(crate) fn azdo_auth(token: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(format!(":{}", token));
    format!("Basic {}", encoded)
}

/// URL-encode a string for safe use in Azure DevOps API URL path segments.
pub(crate) fn url_encode(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

/// Retry an async HTTP request with exponential backoff.
/// Retries on network errors and 429/5xx status codes.
/// Does NOT retry on 401/403/404 (these are permanent errors).
pub(crate) async fn azdo_get_json(
    client: &reqwest::Client,
    url: &str,
    auth: &str,
) -> Result<serde_json::Value, AppError> {
    let delays = [0, 500, 1500]; // ms: immediate, 500ms, 1.5s
    let mut last_err = None;
    for (attempt, delay_ms) in delays.iter().enumerate() {
        if attempt > 0 {
            tracing::debug!(url, attempt, delay_ms, "AzDO API retry");
            tokio::time::sleep(std::time::Duration::from_millis(*delay_ms)).await;
        }
        match client.get(url).header("Authorization", auth).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.json().await.map_err(AppError::from);
                }
                // Don't retry auth/not-found errors
                if matches!(status.as_u16(), 401 | 403 | 404) {
                    tracing::warn!(url, status = status.as_u16(), "AzDO API permanent error");
                    return Err(azdo_status_err(status));
                }
                // Retry on 429 (rate limit) and 5xx
                if status.as_u16() == 429 || status.is_server_error() {
                    tracing::warn!(url, status = status.as_u16(), attempt, "AzDO API retryable error");
                    last_err = Some(azdo_status_err(status));
                    continue;
                }
                return Err(azdo_status_err(status));
            }
            Err(e) => {
                // Network error — retry
                tracing::warn!(url, attempt, error = %e, "AzDO API network error");
                last_err = Some(AppError::Http(e));
                continue;
            }
        }
    }
    tracing::error!(url, "AzDO API all retries exhausted");
    Err(last_err.unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_env_name ──

    #[test]
    fn valid_default_env() {
        assert_eq!(validate_env_name(".env.json").unwrap(), ".env.json");
    }

    #[test]
    fn valid_named_env() {
        assert_eq!(validate_env_name(".env-prod.json").unwrap(), ".env-prod.json");
        assert_eq!(validate_env_name(".env-10.12.json").unwrap(), ".env-10.12.json");
    }

    #[test]
    fn reject_path_traversal() {
        assert!(validate_env_name("../.env.json").is_err());
        assert!(validate_env_name(".env-../../etc/passwd.json").is_err());
    }

    #[test]
    fn reject_slashes() {
        assert!(validate_env_name(".env-foo/bar.json").is_err());
        assert!(validate_env_name(".env-foo\\bar.json").is_err());
    }

    #[test]
    fn reject_null_byte() {
        assert!(validate_env_name(".env-foo\0.json").is_err());
    }

    #[test]
    fn reject_too_long() {
        let long_name = format!(".env-{}.json", "a".repeat(100));
        assert!(validate_env_name(&long_name).is_err());
    }

    #[test]
    fn reject_bad_pattern() {
        assert!(validate_env_name("config.json").is_err());
        assert!(validate_env_name(".env-foo.txt").is_err());
        assert!(validate_env_name("").is_err());
    }

    // ── sanitize_ps_arg ──

    #[test]
    fn safe_commit_message() {
        assert_eq!(sanitize_ps_arg("fix bug #123").unwrap(), "fix bug #123");
        assert_eq!(sanitize_ps_arg("update readme").unwrap(), "update readme");
    }

    #[test]
    fn allow_dollar_parens_braces() {
        // These are safe in -File mode
        assert!(sanitize_ps_arg("fix $variable issue").is_ok());
        assert!(sanitize_ps_arg("fix bug (issue #123)").is_ok());
        assert!(sanitize_ps_arg("add config {key: value}").is_ok());
    }

    #[test]
    fn reject_pipe() {
        assert!(sanitize_ps_arg("msg | rm -rf").is_err());
    }

    #[test]
    fn reject_semicolon() {
        assert!(sanitize_ps_arg("msg; malicious").is_err());
    }

    #[test]
    fn reject_backtick() {
        assert!(sanitize_ps_arg("msg `cmd`").is_err());
    }

    #[test]
    fn reject_null() {
        assert!(sanitize_ps_arg("msg\0bad").is_err());
    }

    // ── strip_ansi ──

    #[test]
    fn strip_color_codes() {
        assert_eq!(strip_ansi("\x1b[31mred text\x1b[0m"), "red text");
    }

    #[test]
    fn strip_bold() {
        assert_eq!(strip_ansi("\x1b[1mbold\x1b[0m"), "bold");
    }

    #[test]
    fn passthrough_plain() {
        assert_eq!(strip_ansi("no ansi here"), "no ansi here");
    }

    #[test]
    fn strip_osc_sequences() {
        assert_eq!(strip_ansi("\x1b]0;title\x07text"), "text");
    }

    // ── is_noise ──

    #[test]
    fn noise_safe_directory() {
        assert!(is_noise("fatal: unsafe repository: safe.directory is not absolute"));
    }

    #[test]
    fn noise_verbose() {
        assert!(is_noise("VERBOSE: something"));
        assert!(is_noise("debug: some debug"));
    }

    #[test]
    fn noise_box_chars() {
        assert!(is_noise("╭──────────╮"));
        assert!(is_noise("║          ║"));
    }

    #[test]
    fn not_noise_regular() {
        assert!(!is_noise("Building packages..."));
        assert!(!is_noise("Commit successful"));
    }

    // ── azdo_auth ──

    #[test]
    fn basic_auth_format() {
        let auth = azdo_auth("mytoken");
        assert!(auth.starts_with("Basic "));
        let decoded = String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(auth.strip_prefix("Basic ").unwrap()).unwrap()
        ).unwrap();
        assert_eq!(decoded, ":mytoken");
    }

    // ── url_encode ──

    #[test]
    fn encode_spaces() {
        assert_eq!(url_encode("Vision Platform"), "Vision%20Platform");
    }

    #[test]
    fn encode_special_chars() {
        assert_eq!(url_encode("feature/my-branch"), "feature%2Fmy-branch");
    }

    #[test]
    fn passthrough_safe_chars() {
        assert_eq!(url_encode("simple"), "simple");
    }

    // ── azdo_get_json ──

    #[tokio::test]
    async fn azdo_get_json_rejects_empty_url() {
        let client = reqwest::Client::new();
        let result = azdo_get_json(&client, "", "Basic xxx").await;
        assert!(result.is_err());
    }

    // ── extract_org ──

    #[test]
    fn extract_org_valid() {
        let org = Some("myorg".to_string());
        assert_eq!(extract_org(&org).unwrap(), "myorg");
    }

    #[test]
    fn extract_org_none() {
        assert!(extract_org(&None).is_err());
    }

    #[test]
    fn extract_org_empty() {
        let org = Some("".to_string());
        assert!(extract_org(&org).is_err());
    }

    // ── epoch_days_to_ymd ──

    #[test]
    fn epoch_2024_01_01() {
        // 2024-01-01 = day 19723 since epoch
        let (y, m, d) = epoch_days_to_ymd(19723);
        assert_eq!((y, m, d), (2024, 1, 1));
    }

    #[test]
    fn epoch_1970_01_01() {
        let (y, m, d) = epoch_days_to_ymd(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }
}
