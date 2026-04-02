use crate::error::AppError;
use crate::helpers::{app_root, validate_env_name};

#[tauri::command]
pub(crate) fn get_version() -> Result<serde_json::Value, AppError> {
    let path = app_root().join("cli").join("config").join("version.json");
    let data = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&data)?)
}

/// Returns a flat map of GUID (lowercase, no dashes) → friendly package name
/// from cli/config/packages.json
#[tauri::command]
pub(crate) fn get_package_mapping() -> Result<std::collections::HashMap<String, String>, AppError> {
    let path = app_root().join("cli").join("config").join("packages.json");
    let data = std::fs::read_to_string(&path)?;
    let json: serde_json::Value = serde_json::from_str(&data)?;

    let mut map = std::collections::HashMap::new();
    if let Some(mapping) = json["Mapping"].as_object() {
        for (_prefix, guids) in mapping {
            if let Some(obj) = guids.as_object() {
                for (guid, name) in obj {
                    if let Some(name_str) = name.as_str() {
                        // Normalize GUID: lowercase, no dashes
                        map.insert(guid.to_lowercase().replace('-', ""), name_str.to_string());
                    }
                }
            }
        }
    }
    Ok(map)
}

#[tauri::command]
pub(crate) fn list_envs() -> Vec<String> {
    let dir = app_root().join("working-environments");
    if !dir.exists() { let _ = std::fs::create_dir_all(&dir); }

    // Seed a default config from the standard template on first launch
    let has_env = std::fs::read_dir(&dir).ok().is_some_and(|mut entries| {
        entries.any(|e| {
            let n = e.ok().map(|e| e.file_name().to_string_lossy().to_string()).unwrap_or_default();
            n == ".env.json" || (n.starts_with(".env-") && n.ends_with(".json"))
        })
    });
    if !has_env {
        let tmpl_path = app_root().join("templates").join("standard.json");
        if tmpl_path.exists() {
            if let Ok(data) = std::fs::read_to_string(&tmpl_path) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&data) {
                    if let Some(obj) = json.as_object_mut() { obj.remove("_template"); }
                    let default_path = dir.join(".env.json");
                    let _ = std::fs::write(&default_path, serde_json::to_string_pretty(&json).unwrap_or_default());
                }
            }
        }
    }

    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![]; };
    let mut files: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name == ".env.json" || (name.starts_with(".env-") && name.ends_with(".json")) {
                Some(name)
            } else { None }
        })
        .collect();
    files.sort();
    files
}

#[tauri::command]
pub(crate) fn get_env(name: String) -> Result<serde_json::Value, AppError> {
    let name = validate_env_name(&name)?;
    let path = app_root().join("working-environments").join(&name);
    let data = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&data)?)
}

#[tauri::command]
pub(crate) fn save_env(name: String, config: serde_json::Value) -> Result<(), AppError> {
    let name = validate_env_name(&name)?;
    let dir = app_root().join("working-environments");
    if !dir.exists() { std::fs::create_dir_all(&dir)?; }
    let path = dir.join(&name);
    let data = serde_json::to_string_pretty(&config)?;
    // Atomic write: write to temp file then rename to avoid corruption on crash
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &data)?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn create_env(name: String) -> Result<(), AppError> {
    let filename = if name.starts_with(".env") && name.ends_with(".json") {
        name.clone()
    } else {
        format!(".env-{}.json", name)
    };
    validate_env_name(&filename)?;
    let dir = app_root().join("working-environments");
    if !dir.exists() { std::fs::create_dir_all(&dir)?; }
    let path = dir.join(&filename);
    if path.exists() { return Err(AppError::Validation(format!("{} already exists", filename))); }
    let default = serde_json::json!({
        "feature_branch": "", "target_branch": "", "packages": [],
        "local": { "site_path": "", "password": "" },
        "azdo": { "token": "", "repository": "" }
    });
    std::fs::write(&path, serde_json::to_string_pretty(&default).unwrap())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_env(name: String) -> Result<(), AppError> {
    let name = validate_env_name(&name)?;
    std::fs::remove_file(app_root().join("working-environments").join(&name))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn rename_env(old_name: String, new_name: String) -> Result<String, AppError> {
    let old = validate_env_name(&old_name)?;
    let new_filename = if new_name.starts_with(".env") && new_name.ends_with(".json") {
        new_name.clone()
    } else {
        format!(".env-{}.json", new_name)
    };
    validate_env_name(&new_filename)?;
    let dir = app_root().join("working-environments");
    let old_path = dir.join(&old);
    let new_path = dir.join(&new_filename);
    if !old_path.exists() { return Err(AppError::Validation(format!("{} not found", old))); }
    if new_path.exists() { return Err(AppError::Validation(format!("{} already exists", new_filename))); }
    std::fs::rename(&old_path, &new_path)?;
    Ok(new_filename)
}

#[derive(serde::Serialize)]
pub(crate) struct TemplateInfo { name: String, description: String, filename: String }

#[tauri::command]
pub(crate) fn list_templates() -> Vec<TemplateInfo> {
    let dir = app_root().join("templates");
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![]; };
    entries.filter_map(|e| e.ok()).filter_map(|e| {
        let filename = e.file_name().to_string_lossy().to_string();
        if !filename.ends_with(".json") { return None; }
        let data = std::fs::read_to_string(e.path()).ok()?;
        let json: serde_json::Value = serde_json::from_str(&data).ok()?;
        let tmpl = json.get("_template")?;
        Some(TemplateInfo {
            name: tmpl.get("name")?.as_str()?.to_string(),
            description: tmpl.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string(),
            filename,
        })
    }).collect()
}

#[tauri::command]
pub(crate) fn create_env_from_template(name: String, template: String) -> Result<(), AppError> {
    let filename = if name.starts_with(".env") && name.ends_with(".json") { name.clone() } else { format!(".env-{}.json", name) };
    validate_env_name(&filename)?;
    // Validate template filename to prevent path traversal
    if template.contains('/') || template.contains('\\') || template.contains("..") || template.contains('\0') || !template.ends_with(".json") {
        return Err(AppError::Validation("Invalid template name".into()));
    }
    let tmpl_path = app_root().join("templates").join(&template);
    if !tmpl_path.exists() { return Err(AppError::Validation(format!("Template '{}' not found", template))); }
    let data = std::fs::read_to_string(&tmpl_path)?;
    let mut json: serde_json::Value = serde_json::from_str(&data)?;
    // Strip _template metadata
    if let Some(obj) = json.as_object_mut() { obj.remove("_template"); }
    let dir = app_root().join("working-environments");
    if !dir.exists() { std::fs::create_dir_all(&dir)?; }
    let path = dir.join(&filename);
    if path.exists() { return Err(AppError::Validation(format!("{} already exists", filename))); }
    std::fs::write(&path, serde_json::to_string_pretty(&json)?)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn clone_env(source: String, new_name: String) -> Result<(), AppError> {
    let source = validate_env_name(&source)?;
    let dest_filename = if new_name.starts_with(".env") && new_name.ends_with(".json") {
        new_name.clone()
    } else {
        format!(".env-{}.json", new_name)
    };
    validate_env_name(&dest_filename)?;
    let dir = app_root().join("working-environments");
    let src_path = dir.join(&source);
    let dest_path = dir.join(&dest_filename);
    if dest_path.exists() { return Err(AppError::Validation(format!("{} already exists", dest_filename))); }
    std::fs::copy(&src_path, &dest_path)?;
    Ok(())
}
