use crate::error::AppError;

const SERVICE_NAME: &str = "DONUT";

fn credential_key(env_name: &str) -> String {
    format!("donut-pat-{}", env_name)
}

#[tauri::command]
pub(crate) fn store_pat(env_name: String, token: String) -> Result<(), AppError> {
    if env_name.is_empty() {
        return Err(AppError::Validation("Environment name is required.".into()));
    }
    let key = credential_key(&env_name);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Validation(format!("Credential store error: {}", e)))?;
    entry.set_password(&token)
        .map_err(|e| AppError::Validation(format!("Failed to store PAT: {}", e)))?;
    tracing::info!(env = %env_name, "PAT stored in credential manager");
    Ok(())
}

#[tauri::command]
pub(crate) fn get_pat(env_name: String) -> Result<Option<String>, AppError> {
    if env_name.is_empty() {
        return Ok(None);
    }
    let key = credential_key(&env_name);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Validation(format!("Credential store error: {}", e)))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(keyring::Error::Ambiguous(_)) => Ok(None),
        Err(e) => Err(AppError::Validation(format!("Failed to read PAT: {}", e))),
    }
}

#[tauri::command]
pub(crate) fn delete_pat(env_name: String) -> Result<(), AppError> {
    if env_name.is_empty() {
        return Ok(());
    }
    let key = credential_key(&env_name);
    let entry = keyring::Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Validation(format!("Credential store error: {}", e)))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) | Err(keyring::Error::Ambiguous(_)) => Ok(()),
        Err(e) => Err(AppError::Validation(format!("Failed to delete PAT: {}", e))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_key_format() {
        assert_eq!(credential_key("myenv"), "donut-pat-myenv");
        assert_eq!(credential_key(".env-prod.json"), "donut-pat-.env-prod.json");
    }

    #[test]
    fn store_pat_rejects_empty_env() {
        let result = store_pat(String::new(), "token".into());
        assert!(result.is_err());
    }

    #[test]
    fn get_pat_returns_none_for_empty_env() {
        let result = get_pat(String::new()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn delete_pat_ok_for_empty_env() {
        let result = delete_pat(String::new());
        assert!(result.is_ok());
    }
}
