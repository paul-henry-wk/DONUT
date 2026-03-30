#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Validation(String),
    #[error("PAT expired or unauthorized. Regenerate your Personal Access Token.")]
    Unauthorized,
    #[error("Access denied. Check PAT permissions.")]
    Forbidden,
    #[error("Not found. Check organization/project/repository names.")]
    NotFound,
    #[error("Azure DevOps API error: {0}")]
    AzdoApi(u16),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}

pub(crate) fn azdo_status_err(status: reqwest::StatusCode) -> AppError {
    match status.as_u16() {
        401 => AppError::Unauthorized,
        403 => AppError::Forbidden,
        404 => AppError::NotFound,
        code => AppError::AzdoApi(code),
    }
}
