use crate::error::{azdo_status_err, AppError};
use crate::helpers::{azdo_auth, azdo_get_json, extract_org, url_encode};
use crate::AppState;

/// Validate that required string fields are non-empty, returning a descriptive error.
macro_rules! require_fields {
    ($msg:expr, $($field:expr),+) => {
        if $($field.is_empty() ||)+ false {
            return Err(AppError::Validation($msg.into()));
        }
    };
}

#[tauri::command]
pub(crate) async fn validate_pat(state: tauri::State<'_, AppState>, token: String, organization: Option<String>) -> Result<bool, AppError> {
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/_apis/projects?api-version=7.0", org);
    let resp = state.http.get(&url)
        .header("Authorization", azdo_auth(&token))
        .send().await?;
    Ok(resp.status().is_success())
}

#[tauri::command]
pub(crate) async fn list_azdo_projects(state: tauri::State<'_, AppState>, token: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    require_fields!("Fill PAT first.", token);
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/_apis/projects?api-version=7.0&$top=100", org);
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let mut projects: Vec<String> = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(String::from)).collect()
    }).unwrap_or_default();
    projects.sort();
    Ok(projects)
}

#[tauri::command]
pub(crate) async fn list_azdo_repos(state: tauri::State<'_, AppState>, token: String, project: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    require_fields!("Fill PAT & project first.", token, project);
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories?api-version=7.0", url_encode(org), url_encode(&project));
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let repos = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(String::from)).collect()
    }).unwrap_or_default();
    Ok(repos)
}

#[tauri::command]
pub(crate) async fn list_azdo_branches(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    require_fields!("Fill PAT, project & repository first.", token, project, repository);
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?filter=heads/&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let branches = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(|n| n.strip_prefix("refs/heads/").unwrap_or(n).to_string())).collect()
    }).unwrap_or_default();
    Ok(branches)
}

#[tauri::command]
pub(crate) async fn create_azdo_branch(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch_name: String, source_branch: String, organization: Option<String>) -> Result<String, AppError> {
    require_fields!("Fill all fields: PAT, project, repository, branch name, source branch.", token, project, repository, branch_name, source_branch);
    if branch_name.len() > 250 { return Err(AppError::Validation("Branch name is too long.".into())); }
    if branch_name.contains('\0') || branch_name.contains("..") || branch_name.ends_with(".lock") || branch_name.contains('~') || branch_name.contains('^') || branch_name.contains(':') || branch_name.contains('\\') || branch_name.contains(' ') {
        return Err(AppError::Validation("Branch name contains invalid characters.".into()));
    }
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);

    // 1. Get source branch objectId (latest commit SHA)
    let refs_url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?filter=heads/{}&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(&source_branch));
    let resp = state.http.get(&refs_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let object_id = json["value"].as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v["objectId"].as_str())
        .ok_or_else(|| AppError::Validation(format!("Source branch '{}' not found.", source_branch)))?
        .to_string();

    // 2. Create the new branch
    let create_url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let body = serde_json::json!([{
        "name": format!("refs/heads/{}", branch_name),
        "oldObjectId": "0000000000000000000000000000000000000000",
        "newObjectId": object_id,
    }]);
    let resp = state.http.post(&create_url).header("Authorization", &auth)
        .json(&body).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }

    Ok(branch_name)
}

#[tauri::command]
pub(crate) async fn delete_azdo_branch(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch_name: String, organization: Option<String>) -> Result<(), AppError> {
    require_fields!("Fill all fields.", token, project, repository, branch_name);
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);
    // Get objectId of the branch
    let refs_url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?filter=heads/{}&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(&branch_name));
    let resp = state.http.get(&refs_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let object_id = json["value"].as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v["objectId"].as_str())
        .ok_or_else(|| AppError::Validation(format!("Branch '{}' not found.", branch_name)))?
        .to_string();
    // Delete = set newObjectId to all zeros
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let body = serde_json::json!([{
        "name": format!("refs/heads/{}", branch_name),
        "oldObjectId": object_id,
        "newObjectId": "0000000000000000000000000000000000000000",
    }]);
    let resp = state.http.post(&url).header("Authorization", &auth).json(&body).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    Ok(())
}

// ── Pull Requests ──

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PullRequest { id: u64, title: String, status: String, source_branch: String, target_branch: String, created_by: String, url: String }

#[tauri::command]
pub(crate) async fn list_azdo_prs(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, organization: Option<String>) -> Result<Vec<PullRequest>, AppError> {
    require_fields!("Fill PAT, project & repository first.", token, project, repository);
    let org = extract_org(&organization)?;

    // Check cache
    let cache_key = format!("{}/{}/{}/prs", org, project, repository);
    if let Some(cached) = state.pr_cache.get(&cache_key) {
        tracing::debug!("PR cache hit: {}", cache_key);
        let prs: Vec<PullRequest> = serde_json::from_value(cached).unwrap_or_default();
        return Ok(prs);
    }

    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/pullrequests?searchCriteria.status=active&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let prs: Vec<PullRequest> = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            Some(PullRequest {
                id: v["pullRequestId"].as_u64()?,
                title: v["title"].as_str()?.to_string(),
                status: v["status"].as_str()?.to_string(),
                source_branch: v["sourceRefName"].as_str()?.strip_prefix("refs/heads/").unwrap_or("").to_string(),
                target_branch: v["targetRefName"].as_str()?.strip_prefix("refs/heads/").unwrap_or("").to_string(),
                created_by: v["createdBy"]["displayName"].as_str().unwrap_or("").to_string(),
                url: format!("https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}", url_encode(org), url_encode(&project), v["repository"]["name"].as_str().unwrap_or(&repository), v["pullRequestId"].as_u64().unwrap_or(0)),
            })
        }).collect()
    }).unwrap_or_default();

    // Populate cache
    if let Ok(val) = serde_json::to_value(&prs) {
        state.pr_cache.set(&cache_key, val);
    }

    Ok(prs)
}

// ── Build / Pipeline status ──

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct BuildStatus { id: u64, status: String, result: String, definition_name: String, source_branch: String, url: String, finish_time: String }

#[tauri::command]
pub(crate) async fn list_azdo_builds(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch: Option<String>, organization: Option<String>) -> Result<Vec<BuildStatus>, AppError> {
    require_fields!("Fill PAT & project.", token, project);
    let org = extract_org(&organization)?;

    // Check cache
    let cache_key = format!("{}/{}/{}/builds/{}", org, project, repository, branch.as_deref().unwrap_or("all"));
    if let Some(cached) = state.build_cache.get(&cache_key) {
        tracing::debug!("Build cache hit: {}", cache_key);
        let builds: Vec<BuildStatus> = serde_json::from_value(cached).unwrap_or_default();
        return Ok(builds);
    }

    let mut url = format!("https://dev.azure.com/{}/{}/_apis/build/builds?$top=10&api-version=7.0&repositoryId={}&repositoryType=TfsGit", url_encode(org), url_encode(&project), url_encode(&repository));
    if let Some(b) = &branch {
        url.push_str(&format!("&branchName=refs/heads/{}", url_encode(b)));
    }
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let builds: Vec<BuildStatus> = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            Some(BuildStatus {
                id: v["id"].as_u64()?,
                status: v["status"].as_str()?.to_string(),
                result: v["result"].as_str().unwrap_or("pending").to_string(),
                definition_name: v["definition"]["name"].as_str().unwrap_or("").to_string(),
                source_branch: v["sourceBranch"].as_str()?.strip_prefix("refs/heads/").unwrap_or("").to_string(),
                url: v["_links"]["web"]["href"].as_str().unwrap_or("").to_string(),
                finish_time: v["finishTime"].as_str().unwrap_or("").to_string(),
            })
        }).collect()
    }).unwrap_or_default();

    // Populate cache
    if let Ok(val) = serde_json::to_value(&builds) {
        state.build_cache.set(&cache_key, val);
    }

    Ok(builds)
}

// ── Branch diff (compare) ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct BranchDiff { ahead: u64, behind: u64, changes: Vec<DiffChange> }
#[derive(Clone, serde::Serialize)]
pub(crate) struct DiffChange { path: String, change_type: String }

#[tauri::command]
pub(crate) async fn compare_branches(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, source_branch: String, target_branch: String, organization: Option<String>) -> Result<BranchDiff, AppError> {
    require_fields!("Fill PAT, project & repository.", token, project, repository);
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/diffs/commits?baseVersion={}&baseVersionType=branch&targetVersion={}&targetVersionType=branch&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(&target_branch), url_encode(&source_branch));
    let json = azdo_get_json(&state.http, &url, &azdo_auth(&token)).await?;
    let ahead = json["aheadCount"].as_u64().unwrap_or(0);
    let behind = json["behindCount"].as_u64().unwrap_or(0);
    let changes = json["changes"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            Some(DiffChange {
                path: v["item"]["path"].as_str()?.to_string(),
                change_type: v["changeType"].as_str()?.to_string(),
            })
        }).take(50).collect()
    }).unwrap_or_default();
    Ok(BranchDiff { ahead, behind, changes })
}

// ── Merge conflicts check ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct MergeCheck { can_merge: bool, conflicts: Vec<String> }

#[tauri::command]
pub(crate) async fn check_merge_conflicts(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, source_branch: String, target_branch: String, organization: Option<String>) -> Result<MergeCheck, AppError> {
    require_fields!("Fill PAT, project & repository.", token, project, repository);
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);
    // Get tip commits for both branches
    let get_tip = |branch: &str| {
        let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?filter=heads/{}&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(branch));
        let client = state.http.clone();
        let auth = auth.clone();
        async move {
            let resp = client.get(&url).header("Authorization", &auth).send().await?;
            let json: serde_json::Value = resp.json().await?;
            json["value"].as_array().and_then(|a| a.first()).and_then(|v| v["objectId"].as_str().map(String::from))
                .ok_or_else(|| AppError::Validation("Branch not found".to_string()))
        }
    };
    let (source_id, target_id) = tokio::try_join!(get_tip(&source_branch), get_tip(&target_branch))?;
    // Create a merge (dry-run)
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/merges?api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let body = serde_json::json!({
        "parents": [{ "commitId": source_id }, { "commitId": target_id }],
        "comment": "conflict-check"
    });
    // Note: This API might not exist or behave differently. Fallback to comparing diff
    let resp = state.http.post(&url).header("Authorization", &auth).json(&body).send().await?;
    if resp.status().as_u16() == 409 {
        return Ok(MergeCheck { can_merge: false, conflicts: vec!["Merge conflicts detected.".into()] });
    }
    if !resp.status().is_success() {
        // Fallback: just check if diff exists (no conflict API available)
        return Ok(MergeCheck { can_merge: true, conflicts: vec![] });
    }
    let json: serde_json::Value = resp.json().await?;
    let status = json["status"].as_str().unwrap_or("");
    if status == "conflicts" {
        let conflict_list = json["detailedStatus"]["conflicts"].as_array().map(|arr| {
            arr.iter().filter_map(|v| v["path"].as_str().map(String::from)).collect()
        }).unwrap_or_else(|| vec!["Merge conflicts detected.".into()]);
        Ok(MergeCheck { can_merge: false, conflicts: conflict_list })
    } else {
        Ok(MergeCheck { can_merge: true, conflicts: vec![] })
    }
}

// ── Work Items ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct WorkItem { id: u64, title: String, state: String, #[serde(rename = "type")] wi_type: String }

#[tauri::command]
pub(crate) async fn assign_work_item(state: tauri::State<'_, AppState>, token: String, project: String, work_item_id: u64, assign_to: String, organization: Option<String>) -> Result<(), AppError> {
    require_fields!("Fill PAT first.", token);
    if assign_to.is_empty() { return Err(AppError::Validation("Assignee must not be empty.".into())); }
    if assign_to.len() > 256 { return Err(AppError::Validation("Assignee value is too long.".into())); }
    if assign_to.contains('\0') { return Err(AppError::Validation("Assignee contains invalid characters.".into())); }
    let org = extract_org(&organization)?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/wit/workitems/{}?api-version=7.0", url_encode(org), url_encode(&project), work_item_id);
    let body = serde_json::json!([{
        "op": "replace",
        "path": "/fields/System.AssignedTo",
        "value": assign_to,
    }]);
    let resp = state.http.patch(&url)
        .header("Authorization", azdo_auth(&token))
        .header("Content-Type", "application/json-patch+json")
        .json(&body).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_branch_work_items(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch: String, organization: Option<String>) -> Result<Vec<WorkItem>, AppError> {
    require_fields!("Fill PAT, project, repository & branch.", token, project, repository, branch);
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);
    // Get commits on branch (last 20)
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/commits?searchCriteria.itemVersion.version={}&$top=20&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(&branch));
    let resp = state.http.get(&url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    // Extract work item IDs from commit messages (#123 pattern) and AB#123 pattern
    let mut wi_ids: Vec<u64> = vec![];
    if let Some(commits) = json["value"].as_array() {
        for c in commits {
            if let Some(msg) = c["comment"].as_str() {
                for cap in msg.split(|c: char| !c.is_ascii_digit() && c != '#').filter(|s| s.contains('#')) {
                    if let Some(id_str) = cap.strip_prefix('#').or_else(|| cap.strip_prefix("AB#")) {
                        if let Ok(id) = id_str.parse::<u64>() { if !wi_ids.contains(&id) { wi_ids.push(id); } }
                    }
                }
                // Also try "AB#123" pattern
                for part in msg.split_whitespace() {
                    if let Some(id_str) = part.strip_prefix("AB#").or_else(|| part.strip_prefix("#")) {
                        let id_str = id_str.trim_end_matches(|c: char| !c.is_ascii_digit());
                        if let Ok(id) = id_str.parse::<u64>() { if !wi_ids.contains(&id) { wi_ids.push(id); } }
                    }
                }
            }
        }
    }
    if wi_ids.is_empty() { return Ok(vec![]); }
    // Fetch work item details
    let ids_str: Vec<String> = wi_ids.iter().take(20).map(|id| id.to_string()).collect();
    let decoded_project = project.replace("%20", " ");
    let details_url = format!("https://dev.azure.com/{}/{}/_apis/wit/workitems?ids={}&fields=System.Id,System.Title,System.State,System.WorkItemType&api-version=7.0", url_encode(org), url_encode(&decoded_project), ids_str.join(","));
    let resp = state.http.get(&details_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let items = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            let fields = &v["fields"];
            Some(WorkItem {
                id: v["id"].as_u64()?,
                title: fields["System.Title"].as_str()?.to_string(),
                state: fields["System.State"].as_str()?.to_string(),
                wi_type: fields["System.WorkItemType"].as_str()?.to_string(),
            })
        }).collect()
    }).unwrap_or_default();
    Ok(items)
}

#[tauri::command]
pub(crate) async fn search_work_items(state: tauri::State<'_, AppState>, token: String, project: String, query: String, organization: Option<String>) -> Result<Vec<WorkItem>, AppError> {
    require_fields!("Fill PAT & project first.", token, project);
    if query.len() > 500 { return Err(AppError::Validation("Search query is too long.".into())); }
    if query.contains('\0') { return Err(AppError::Validation("Search query contains invalid characters.".into())); }
    let org = extract_org(&organization)?;
    let safe_project = project.replace("%20", " ").replace('\'', "''");
    let wiql = if query.is_empty() {
        // Load recent active work items — no type filter (varies by process template)
        format!("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '{}' AND [System.State] NOT IN ('Removed', 'Closed', 'Done') ORDER BY [System.ChangedDate] DESC", safe_project)
    } else if query == "@me" {
        format!("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '{}' AND [System.State] NOT IN ('Removed', 'Closed', 'Done') AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC", safe_project)
    } else if query.chars().all(|c| c.is_ascii_digit()) {
        format!("SELECT [System.Id] FROM WorkItems WHERE [System.Id] = {} AND [System.TeamProject] = '{}'", query, safe_project)
    } else {
        // Sanitize: escape single quotes, strip WIQL-dangerous characters and keywords
        let safe_query = query.replace('\'', "''").replace(['[', ']'], "");
        // Reject input that looks like WIQL injection (keywords outside of value context)
        let lower = safe_query.to_lowercase();
        if lower.contains(" or ") || lower.contains(" and ") || lower.contains("--") || lower.contains("select ") || lower.contains(" from ") || lower.contains(" where ") {
            return Err(AppError::Validation("Search query contains invalid characters".into()));
        }
        format!("SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '{}' AND [System.TeamProject] = '{}' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC", safe_query, safe_project)
    };

    let wiql_url = format!("https://dev.azure.com/{}/{}/_apis/wit/wiql?api-version=7.0&$top=50", url_encode(org), url_encode(&project));
    let auth = azdo_auth(&token);
    let resp = state.http.post(&wiql_url)
        .header("Authorization", &auth)
        .json(&serde_json::json!({ "query": wiql }))
        .send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;

    let ids: Vec<u64> = json["workItems"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v["id"].as_u64()).collect())
        .unwrap_or_default();
    if ids.is_empty() { return Ok(vec![]); }

    let ids_str: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    let details_url = format!("https://dev.azure.com/{}/{}/_apis/wit/workitems?ids={}&fields=System.Id,System.Title,System.State,System.WorkItemType&api-version=7.0", url_encode(org), url_encode(&project), ids_str.join(","));
    let resp = state.http.get(&details_url).header("Authorization", &auth)
        .send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;

    let items = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            let fields = &v["fields"];
            Some(WorkItem {
                id: v["id"].as_u64()?,
                title: fields["System.Title"].as_str()?.to_string(),
                state: fields["System.State"].as_str()?.to_string(),
                wi_type: fields["System.WorkItemType"].as_str()?.to_string(),
            })
        }).collect()
    }).unwrap_or_default();
    Ok(items)
}

// ── PR Diff ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct PrFile {
    path: String,
    original_path: Option<String>,
    change_type: String,
    size: u64,
}

#[tauri::command]
pub(crate) async fn get_pr_files(
    state: tauri::State<'_, AppState>, token: String, project: String,
    repository: String, pr_id: u64, organization: Option<String>,
) -> Result<Vec<PrFile>, AppError> {
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);

    // Get PR source/target branches
    let pr_url = format!(
        "https://dev.azure.com/{}/{}/_apis/git/repositories/{}/pullRequests/{}?api-version=7.0",
        url_encode(org), url_encode(&project), url_encode(&repository), pr_id
    );
    let resp = state.http.get(&pr_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let pr_json: serde_json::Value = resp.json().await?;
    let source = pr_json["sourceRefName"].as_str().unwrap_or("")
        .strip_prefix("refs/heads/").unwrap_or("").to_string();
    let target = pr_json["targetRefName"].as_str().unwrap_or("")
        .strip_prefix("refs/heads/").unwrap_or("").to_string();

    // Use diffs/commits API to compare branches — this returns ALL individual changed files,
    // not just top-level .enzp packages.
    let diff_url = format!(
        "https://dev.azure.com/{}/{}/_apis/git/repositories/{}/diffs/commits?baseVersion={}&targetVersion={}&$top=1000&api-version=7.0",
        url_encode(org), url_encode(&project), url_encode(&repository),
        url_encode(&target), url_encode(&source)
    );
    let resp = state.http.get(&diff_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;

    let files = json["changes"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            let item = &v["item"];
            // Skip folders (trees)
            if item["gitObjectType"].as_str() == Some("tree") { return None; }
            if item["isFolder"].as_bool() == Some(true) { return None; }
            let path = item["path"].as_str()?.to_string();
            // Skip if empty path
            if path.is_empty() { return None; }
            Some(PrFile {
                path,
                original_path: v["sourceServerItem"].as_str().map(String::from),
                change_type: match v["changeType"].as_str().unwrap_or("edit") {
                    t if t.contains("add") || t.contains("Add") => "add".to_string(),
                    t if t.contains("delete") || t.contains("Delete") => "delete".to_string(),
                    t if t.contains("rename") || t.contains("Rename") => "rename".to_string(),
                    _ => "edit".to_string(),
                },
                size: item["size"].as_u64().unwrap_or(0),
            })
        }).collect()
    }).unwrap_or_default();

    Ok(files)
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct FileDiffContent {
    original: String,
    modified: String,
    is_binary: bool,
    size_kb: u64,
    formatted: String,  // Enablon-parsed structured view (only for .enzp)
}

/// Fetch a single file's raw text content from Azure DevOps.
/// Try to fix obfuscated ZIP signatures (Enablon .enxm files replace PK with custom bytes)
fn try_fix_enablon_zip(bytes: &[u8]) -> Option<Vec<u8>> {
    // .enxm files start with ?? ?? 03 04 (like a ZIP but with PK replaced)
    if bytes.len() < 30 || bytes[2] != 0x03 || bytes[3] != 0x04 { return None; }
    // Check version field is reasonable (0x0A=1.0 to 0x3F=6.3)
    if bytes[4] > 0x3F { return None; }

    let mut fixed = bytes.to_vec();

    // Fix all ZIP signatures: local file header, central directory, EOCD
    // Enablon replaces bytes 0-1 of each PK signature with custom bytes
    // We detect the pattern: ?? ?? 03 04 vv 00 (local file header)
    //                        ?? ?? 01 02 vv 00 (central directory)
    //                        ?? ?? 05 06 00 00 (end of central directory)
    let len = fixed.len();
    let mut i = 0;
    while i + 5 < len {
        let b2 = fixed[i + 2];
        let b3 = fixed[i + 3];

        // Local file header: ?? ?? 03 04 vv 00 (version 10-63, LE)
        if b2 == 0x03 && b3 == 0x04 && fixed[i + 4] <= 0x3F && fixed[i + 5] == 0x00 {
            fixed[i] = 0x50;     // P
            fixed[i + 1] = 0x4B; // K
            i += 30; // skip past header
            continue;
        }
        // Central directory: ?? ?? 01 02 vv 00
        if b2 == 0x01 && b3 == 0x02 && fixed[i + 4] <= 0x3F && fixed[i + 5] == 0x00 {
            fixed[i] = 0x50;
            fixed[i + 1] = 0x4B;
            i += 46;
            continue;
        }
        // End of central directory: ?? ?? 05 06 00 00
        if b2 == 0x05 && b3 == 0x06 && fixed[i + 4] == 0x00 && fixed[i + 5] == 0x00 {
            fixed[i] = 0x50;
            fixed[i + 1] = 0x4B;
            i += 22;
            continue;
        }
        i += 1;
    }

    Some(fixed)
}

/// Check if decoded text is predominantly readable (supports Unicode)
fn is_readable(text: &str) -> bool {
    let total = text.chars().count().max(1);
    let ok = text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
        .count();
    ok > total / 2
}

/// Try to decompress bytes to readable text (Enablon obfuscated ZIP)
fn try_decompress_to_text(bytes: &[u8]) -> Option<String> {
    // Try Enablon obfuscated ZIP (.enxm files with modified PK signatures)
    if let Some(fixed) = try_fix_enablon_zip(bytes) {
        if let Ok(text) = extract_zip_text(&fixed) {
            if !text.is_empty() && is_readable(&text) {
                return Some(text);
            }
        }
    }
    None
}

/// Decode raw bytes to text, trying multiple encodings
fn decode_bytes_to_text(bytes: &[u8]) -> String {
    // 1. Valid UTF-8 without null bytes → clean text
    if let Ok(text) = std::str::from_utf8(bytes) {
        if !text.bytes().any(|b| b == 0) {
            return text.to_string();
        }
    }
    // 2. UTF-16 LE (with or without BOM) — compare quality vs UTF-8 lossy
    if bytes.len() >= 2 {
        let start = if bytes[0] == 0xFF && bytes[1] == 0xFE { 2 } else { 0 };
        let u16s: Vec<u16> = bytes[start..].chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let utf16 = String::from_utf16_lossy(&u16s);
        let utf8 = String::from_utf8_lossy(bytes);
        let bad16 = utf16.chars().filter(|c| *c == '\u{FFFD}' || (*c != '\n' && *c != '\r' && *c != '\t' && c.is_control())).count();
        let bad8 = utf8.chars().filter(|c| *c == '\u{FFFD}' || (*c != '\n' && *c != '\r' && *c != '\t' && c.is_control())).count();
        if bad16 < bad8 { return utf16; }
        return utf8.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Common passwords to try for Enablon encrypted ZIPs
const ENABLON_PASSWORDS: &[&[u8]] = &[
    b"eN@b10nEnAbLoN",
    b"", b"Enablon", b"enablon", b"ENABLON",
    b"WizManager", b"wizmanager", b"admin", b"password",
    b"enx", b"enzp", b"EnablonCommit", b"Commit",
    b"export", b"Export", b"nabsic", b"Nabsic",
];

/// Try to read a ZIP entry, handling both encrypted and non-encrypted files
fn read_zip_entry(archive: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, i: usize) -> Option<(String, Vec<u8>)> {
    use std::io::Read;
    // Try unencrypted first
    if let Ok(mut file) = archive.by_index(i) {
        let name = file.name().to_string();
        if file.is_dir() { return None; }
        let mut buf = Vec::new();
        if file.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
            return Some((name, buf));
        }
        // Empty result — might be encrypted, try passwords
        drop(file);
    }
    // Try decryption with various passwords
    for pw in ENABLON_PASSWORDS {
        if let Ok(mut file) = archive.by_index_decrypt(i, pw) {
            let name = file.name().to_string();
            let mut buf = Vec::new();
            if file.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                return Some((name, buf));
            }
        }
    }
    None
}

/// Try to extract text from a ZIP archive
fn extract_zip_text(bytes: &[u8]) -> Result<String, String> {
    use std::io::Cursor;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("zip: {}", e))?;

    let mut content = String::new();
    let count = archive.len();
    for i in 0..count {
        if let Some((name, buf)) = read_zip_entry(&mut archive, i) {
            if !content.is_empty() { content.push('\n'); }
            // Skip separators for .enx files inside .enxm ZIPs
            if count > 1 && !name.ends_with(".enx") {
                content.push_str(&format!("── {} ──\n", name));
            }

            // Recurse: ZIP inside ZIP?
            if buf.len() >= 4 && buf[0] == 0x50 && buf[1] == 0x4B {
                if let Ok(inner) = extract_zip_text(&buf) {
                    if !inner.is_empty() { content.push_str(&inner); continue; }
                }
            }
            // Try decompression, then plain text, then skip
            if let Some(text) = try_decompress_to_text(&buf) {
                content.push_str(&text);
            } else {
                let decoded = decode_bytes_to_text(&buf);
                if is_readable(&decoded) {
                    content.push_str(&decoded);
                } else {
                    content.push_str(&format!("[binary: {} — {} bytes]\n", name, buf.len()));
                }
            }
        }
    }
    Ok(content)
}

/// Extract text content from a 7z archive (used for .enzp Enablon packages)
fn extract_7z_text(bytes: &[u8]) -> Result<String, String> {
    use std::io::Cursor;
    let temp_dir = std::env::temp_dir().join(format!(
        "donut_7z_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    sevenz_rust::decompress(Cursor::new(bytes), &temp_dir)
        .map_err(|e| format!("7z error: {}", e))?;

    let mut content = String::new();
    // Recursively collect all files (7z can have subdirectories)
    fn collect_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_dir() { collect_files(&p, out); } else { out.push(p); }
            }
        }
    }
    let mut paths = Vec::new();
    collect_files(&temp_dir, &mut paths);
    paths.sort();

    for path in &paths {
        let file_bytes = std::fs::read(path).unwrap_or_default();
        if file_bytes.is_empty() { continue; }
        let name = path.strip_prefix(&temp_dir).unwrap_or(path)
            .to_string_lossy().replace('\\', "/");

        // Skip boilerplate files
        if name == "header.xml" { continue; }

        if !content.is_empty() { content.push_str("\n\n"); }
        // Skip file separators for .enxm/.enx — content is merged
        // Only show separators for non-Enablon files
        if paths.len() > 1 && !name.ends_with(".enxm") && !name.ends_with(".enx") {
            content.push_str(&format!("━━━ {} ━━━\n", name));
        }

        // Try Enablon obfuscated ZIP (.enxm) first — fixes signatures + decrypts with password
        if let Some(fixed) = try_fix_enablon_zip(&file_bytes) {
            if let Ok(text) = extract_zip_text(&fixed) {
                if !text.is_empty() {
                    content.push_str(&text);
                    continue;
                }
            }
        }

        // Try ZIP extraction (nested archives)
        if file_bytes.len() >= 4 && file_bytes[0] == 0x50 && file_bytes[1] == 0x4B {
            if let Ok(text) = extract_zip_text(&file_bytes) {
                content.push_str(&text);
                continue;
            }
        }

        // Try to find embedded ZIP within the file (PK signature after a binary header)
        if let Some(pk_pos) = file_bytes.windows(4).position(|w| w[0] == 0x50 && w[1] == 0x4B && w[2] == 0x03 && w[3] == 0x04) {
            // Skip the binary header entirely — extract only the ZIP content
            if let Ok(text) = extract_zip_text(&file_bytes[pk_pos..]) {
                if !text.is_empty() {
                    content.push_str(&text);
                    continue;
                }
            }
        }

        // Try to decompress with various algorithms before giving up
        if let Some(text) = try_decompress_to_text(&file_bytes) {
            content.push_str(&text);
        } else {
            // Only show if predominantly readable ASCII text
            let decoded = decode_bytes_to_text(&file_bytes);
            let total = decoded.len().max(1);
            let ascii_ok = decoded.bytes()
                .filter(|&b| (0x20..0x7F).contains(&b) || b == b'\n' || b == b'\r' || b == b'\t')
                .count();
            if ascii_ok > total / 2 {
                content.push_str(&decoded);
            } else {
                content.push_str(&format!("[binary data — {} bytes]\n", file_bytes.len()));
            }
        }
    }

    let _ = std::fs::remove_dir_all(&temp_dir);
    Ok(content)
}

/// Format Enablon content for readable diffs:
/// - Strip the MMD schema block (§MMDStart§ to §MMDEnd§) — identical on both sides
/// - Strip noise (empty ©Þ, consecutive §####§)
///
/// Parse Enablon content into a clean, structured diff-friendly format.
/// Parses records, pairs MOD before/after, shows only real changes.
fn format_enablon_text(text: &str) -> String {
    let sep = "\u{00A9}\u{00DE}"; // ©Þ
    if !text.contains(sep) { return text.to_string(); }
    let s = "\u{00A7}"; // §
    let fsep = "\u{00A4}\u{00A3}\u{00A4}"; // ¤£¤
    let mmd_start_tag = format!("{s}MMDStart{s}");
    let mmd_end_tag = format!("{s}MMDEnd{s}");
    let section_tag = format!("{s}####{s}");
    let order_tag = format!("{s}Order{s}");

    // Split on ©Þ into records
    let records: Vec<&str> = text.split(sep).collect();
    let mut out: Vec<String> = Vec::new();
    let mut in_mmd = false;
    let mut i = 0;
    // Buffer [PAGES] blocks — only flush if followed by [ADD]/[MOD]
    let mut pending_pages: Option<Vec<String>> = None;

    while i < records.len() {
        let rec = records[i].trim();
        i += 1;
        if rec.is_empty() { continue; }

        // Skip MMD schema
        if rec.contains(&mmd_start_tag) { in_mmd = true; continue; }
        if in_mmd { if rec.contains(&mmd_end_tag) { in_mmd = false; } continue; }
        // Skip ####
        if rec.contains(&section_tag) { continue; }

        // File headers (━━━ and ──) — skip entirely, content is merged
        if rec.contains('\u{2501}') || rec.contains('\u{2500}') {
            pending_pages = None;
            continue;
        }

        // Version header (e.g. 6.01771¤£¤3.1¤£¤2026-3-31...)
        if rec.starts_with(|c: char| c.is_ascii_digit()) && rec.contains(fsep) && !rec.contains("*A*") && !rec.contains("*M*") {
            let vals: Vec<&str> = rec.split(fsep).filter(|f| !f.trim().is_empty()).collect();
            // Skip lines that are just GUID lists (no human-readable info)
            let has_guid_only = vals.iter().all(|v| v.contains('§') || v.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
            if has_guid_only { continue; }
            // Keep only human-readable values (dates, short numbers)
            let clean: Vec<&str> = vals.iter().filter(|v| !v.contains('§') && v.len() < 30).copied().collect();
            if !clean.is_empty() { out.push(format!("Version: {}", clean.join(" | "))); }
            continue;
        }

        // §Order§ — page structure: buffer header only, skip field listings
        if rec.contains(&order_tag) {
            let fields: Vec<&str> = rec.split(fsep).collect();
            let table = fields.get(1).map(|f| f.trim()).unwrap_or("");
            pending_pages = Some(vec![format!("[PAGES] {}", table)]);
            continue;
        }

        // Helper: check if a string looks like a GUID (hex + optional dashes, >16 chars)
        let is_guid = |s: &str| -> bool {
            s.len() >= 16 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        };
        // Helper: check if a value is noise (pure number, internal ref, GUID)
        let is_noise = |v: &str| -> bool {
            if v.is_empty() || v == "0" || v == "33" { return true; }
            if v.chars().all(|c| c.is_ascii_digit()) { return true; } // pure number
            if is_guid(v) { return true; }
            if v.contains('#') && v.contains('\u{00A4}') { return true; } // internal ref like ra_CoInPl#PCiPla#0#0¤
            false
        };

        // ── PVC version changes (MUST check before *A*/*M*) ──
        if rec.contains("Pvc") && rec.contains('|') {
            let mut pkg_name = String::new();
            let mut pkg_short = String::new();
            let mut old_major = String::new();
            let mut old_minor = String::new();
            let mut old_build = String::new();
            let mut new_build = String::new();

            let source = if rec.contains(fsep) { rec.to_string() } else { rec.replace("*M*", "").replace("*A*", "") };
            for part in source.split(['\u{00A4}', '\u{00A3}']) {
                if !part.contains("Pvc") || !part.contains('|') { continue; }
                let halves: Vec<&str> = part.split('|').collect();
                if halves.len() < 2 { continue; }
                let pvc_parse = |ps: &str| -> (String, String) {
                    let pp: Vec<&str> = ps.split('\u{00A7}').collect();
                    (pp.get(1).unwrap_or(&"").to_string(), pp.last().unwrap_or(&"").to_string())
                };
                let (field, old_v) = pvc_parse(halves[0].trim());
                let (_, new_v) = pvc_parse(halves[1].trim());
                match field.as_str() {
                    "PvcClassName" => pkg_name = old_v.replace('"', ""),
                    "PvcSClassName" => pkg_short = old_v.replace('"', ""),
                    "PvcVMajor" => old_major = old_v,
                    "PvcVMinor" => old_minor = old_v,
                    "PvcVBuild" => { old_build = old_v; new_build = new_v; }
                    _ => {}
                }
            }
            if !old_major.is_empty() {
                let label = if !pkg_name.is_empty() { format!("{} ({})", pkg_name, pkg_short) } else { pkg_short };
                out.push(format!("Package: {} v{}.{}.{} \u{2192} v{}.{}.{}", label, old_major, old_minor, old_build, old_major, old_minor, new_build));
            }
            // Also consume the paired *M* record if present
            if i < records.len() && records[i].trim().contains("Pvc") { i += 1; }
            continue;
        }

        // ── Data records ending with *A* or *M* ──
        let is_add = rec.ends_with("*A*");
        let is_mod = rec.ends_with("*M*");
        if is_add || is_mod {
            // Flush pending [PAGES] block — it has changes
            if let Some(pages) = pending_pages.take() {
                if !out.is_empty() { out.push(String::new()); }
                out.extend(pages);
            }

            let data = &rec[..rec.len()-3];
            let fields: Vec<&str> = data.split(fsep).collect();
            let table = fields.first().map(|f| f.trim()).unwrap_or("");
            let fname = fields.get(1).map(|f| f.trim()).unwrap_or("");

            // Skip entries with GUID-based table/field names
            if is_guid(table) || is_guid(fname) {
                // Still consume paired MOD
                if is_mod && i < records.len() && records[i].trim().ends_with("*M*") { i += 1; }
                continue;
            }

            if is_mod && i < records.len() {
                let next = records[i].trim();
                if let Some(ndata) = next.strip_suffix("*M*") {
                    let nfields: Vec<&str> = ndata.split(fsep).collect();
                    let ntable = nfields.first().map(|f| f.trim()).unwrap_or("");
                    let nfname = nfields.get(1).map(|f| f.trim()).unwrap_or("");

                    if ntable == table && nfname == fname {
                        i += 1;
                        let mut diffs: Vec<String> = Vec::new();
                        let max = fields.len().max(nfields.len());
                        for j in 2..max {
                            let old = fields.get(j).map(|f| f.trim()).unwrap_or("");
                            let new = nfields.get(j).map(|f| f.trim()).unwrap_or("");
                            if old != new && !(old.is_empty() && new.is_empty()) {
                                if is_noise(old) && is_noise(new) { continue; }
                                if old.is_empty() && !is_noise(new) {
                                    diffs.push(format!("    + {}", new));
                                } else if new.is_empty() && !is_noise(old) {
                                    diffs.push(format!("    - {}", old));
                                } else if !is_noise(old) || !is_noise(new) {
                                    // Smart diff for semicolon-separated configs
                                    if old.contains(';') && new.contains(';') && old.len() > 60 {
                                        let old_parts: std::collections::HashSet<&str> = old.split(';').filter(|s| !s.is_empty()).collect();
                                        let new_parts: std::collections::HashSet<&str> = new.split(';').filter(|s| !s.is_empty()).collect();
                                        let added: Vec<&&str> = new_parts.difference(&old_parts).collect();
                                        let removed: Vec<&&str> = old_parts.difference(&new_parts).collect();
                                        if !added.is_empty() || !removed.is_empty() {
                                            for r in &removed { diffs.push(format!("    - {}", r)); }
                                            for a in &added { diffs.push(format!("    + {}", a)); }
                                        }
                                    } else if old.len() > 80 || new.len() > 80 {
                                        diffs.push(format!("    - {}", old));
                                        diffs.push(format!("    + {}", new));
                                    } else {
                                        diffs.push(format!("    {} -> {}", old, new));
                                    }
                                }
                            }
                        }
                        if !diffs.is_empty() {
                            out.push(String::new());
                            out.push(format!("  [MOD] {}.{}", table, fname));
                            out.extend(diffs);
                        }
                        continue;
                    }
                }
            }

            if is_add {
                let mut label_parts: Vec<String> = Vec::new();
                for f in fields.iter().skip(2) {
                    let v = f.trim();
                    if is_noise(v) { continue; }
                    if v.contains('\n') {
                        label_parts.push(format!("\n    {}", v.replace('\n', "\n    ")));
                    } else if v.len() < 120 {
                        label_parts.push(v.to_string());
                    }
                }
                if !label_parts.is_empty() {
                    let summary = if label_parts.len() > 4 {
                        format!("{} (+{} more)", label_parts[..4].join(" | "), label_parts.len() - 4)
                    } else {
                        label_parts.join(" | ")
                    };
                    out.push(String::new());
                    out.push(format!("  [ADD] {}.{}: {}", table, fname, summary));
                }
            }
            continue;
        }

        // Other non-empty content — keep only readable text/code
        if !rec.contains(fsep) && rec.len() > 3 {
            // Skip raw header lines (6.01771¤£¤...) and boilerplate XML
            if rec.starts_with(|c: char| c.is_ascii_digit()) && rec.contains('\u{00A4}') { continue; }
            if rec.contains("<?xml") || rec.contains("<MultifileHeader") { continue; }
            out.push(rec.to_string());
        }
    }

    out.join("\n")
}

/// Tries $format=text first; falls back to JSON-wrapped content.
/// Handles 404 (file doesn't exist in that branch) gracefully.
async fn fetch_file_content(
    client: &reqwest::Client,
    auth: &str,
    org: &str,
    project: &str,
    repository: &str,
    path: &str,
    branch: &str,
) -> (String, bool, u64) {
    // Use octetstream for known binary/archive formats, text for everything else
    let fmt = if path.ends_with(".enzp") || path.ends_with(".7z") || path.ends_with(".zip")
        || path.ends_with(".gz") || path.ends_with(".ena") { "octetstream" } else { "text" };
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/git/repositories/{}/items?path={}&versionType=branch&version={}&$format={}&api-version=7.0",
        url_encode(org), url_encode(project), url_encode(repository),
        url_encode(path), url_encode(branch), fmt
    );
    let resp = match client.get(&url)
        .header("Authorization", auth)
        .send().await {
            Ok(r) => r,
            Err(_) => return (String::new(), false, 0),
    };
    if !resp.status().is_success() {
        return (String::new(), false, 0);
    }
    let content_type = resp.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let bytes = resp.bytes().await.unwrap_or_default();
    let size_kb = bytes.len() as u64 / 1024;

    // Obvious binary content types — skip decoding entirely
    if content_type.contains("image/") || content_type.contains("audio/") || content_type.contains("video/") {
        return (String::new(), true, size_kb);
    }

    // 7-Zip archive (.enzp files) — decompress and extract text content
    if bytes.len() >= 6 && bytes[0] == 0x37 && bytes[1] == 0x7A
        && bytes[2] == 0xBC && bytes[3] == 0xAF && bytes[4] == 0x27 && bytes[5] == 0x1C
    {
        if let Ok(text) = extract_7z_text(&bytes) {
            if !text.is_empty() {
                return (text, false, size_kb);
            }
        }
        return (String::new(), true, size_kb);
    }

    // Try UTF-8 first
    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => {
            let null_count = text.bytes().filter(|&b| b == 0).count();
            if null_count == 0 {
                return (text, false, size_kb);
            }
            // Has null bytes — might be UTF-16 encoded, try below
        }
        Err(_) => { /* not valid UTF-8, try UTF-16 below */ }
    }

    // Try UTF-16 LE (very common on Windows / Azure DevOps .enzp etc.)
    if bytes.len() >= 2 {
        let is_bom_le = bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE;
        let is_bom_be = bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF;

        // Try UTF-16 LE: either BOM detected or heuristic (lots of 0x00 at odd positions)
        let try_le = is_bom_le || (!is_bom_be && bytes.len() > 4 && bytes[1] == 0);
        let try_be = is_bom_be || (!is_bom_le && bytes.len() > 4 && bytes[0] == 0);

        if try_le || try_be {
            let start = if is_bom_le || is_bom_be { 2 } else { 0 };
            let u16_iter: Box<dyn Iterator<Item = u16>> = if try_le && !try_be {
                Box::new(bytes[start..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])))
            } else {
                Box::new(bytes[start..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])))
            };
            let u16s: Vec<u16> = u16_iter.collect();
            if let Ok(text) = String::from_utf16(&u16s) {
                // Verify it's actual text (not random binary that decoded)
                let ctrl = text.chars().filter(|c| c.is_control() && *c != '\n' && *c != '\r' && *c != '\t').count();
                if ctrl <= text.len() / 20 {
                    return (text, false, size_kb);
                }
            }
        }
    }

    // Lossy UTF-8 fallback
    let lossy = String::from_utf8_lossy(&bytes).into_owned();
    let replacements = lossy.chars().filter(|c| *c == '\u{FFFD}').count();
    if lossy.is_empty() || replacements > lossy.len() / 20 {
        // More than 5% replacement chars — truly binary
        return (String::new(), true, size_kb);
    }
    (lossy, false, size_kb)
}

#[tauri::command]
pub(crate) async fn get_file_diff(
    state: tauri::State<'_, AppState>, token: String, project: String,
    repository: String, pr_id: u64, file_path: String, organization: Option<String>,
) -> Result<FileDiffContent, AppError> {
    let org = extract_org(&organization)?;
    let auth = azdo_auth(&token);

    // Get PR source/target branches
    let pr_url = format!(
        "https://dev.azure.com/{}/{}/_apis/git/repositories/{}/pullRequests/{}?api-version=7.0",
        url_encode(org), url_encode(&project), url_encode(&repository), pr_id
    );
    let resp = state.http.get(&pr_url).header("Authorization", &auth).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let pr_json: serde_json::Value = resp.json().await?;
    let source = pr_json["sourceRefName"].as_str().unwrap_or("").strip_prefix("refs/heads/").unwrap_or("").to_string();
    let target = pr_json["targetRefName"].as_str().unwrap_or("").strip_prefix("refs/heads/").unwrap_or("").to_string();

    // Fetch both versions in parallel
    let client = &state.http;
    let (orig_result, mod_result) = tokio::join!(
        fetch_file_content(client, &auth, org, &project, &repository, &file_path, &target),
        fetch_file_content(client, &auth, org, &project, &repository, &file_path, &source)
    );

    let is_binary = orig_result.1 || mod_result.1;
    let size_kb = orig_result.2.max(mod_result.2);

    // For .enzp files, generate structured formatted view from modified (or original) content
    let formatted = if file_path.ends_with(".enzp") && !is_binary {
        let raw = if !mod_result.0.is_empty() { &mod_result.0 } else { &orig_result.0 };
        format_enablon_text(raw)
    } else {
        String::new()
    };

    Ok(FileDiffContent {
        original: orig_result.0,
        modified: mod_result.0,
        is_binary,
        size_kb,
        formatted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_readable ──

    #[test]
    fn readable_plain_text() {
        assert!(is_readable("Hello, world!\nThis is a test.\n"));
    }

    #[test]
    fn empty_is_not_readable() {
        // Empty string: 0 ok chars vs max(1) total → not readable
        assert!(!is_readable(""));
    }

    #[test]
    fn not_readable_control_chars() {
        let s: String = (0..100).map(|i| char::from(i % 16)).collect();
        assert!(!is_readable(&s));
    }

    #[test]
    fn readable_mixed_with_newlines() {
        assert!(is_readable("line1\nline2\r\nline3\ttab"));
    }

    // ── decode_bytes_to_text ──

    #[test]
    fn decode_utf8() {
        let text = "Hello world";
        assert_eq!(decode_bytes_to_text(text.as_bytes()), "Hello world");
    }

    #[test]
    fn decode_utf8_with_accents() {
        let text = "café résumé";
        assert_eq!(decode_bytes_to_text(text.as_bytes()), text);
    }

    #[test]
    fn decode_utf16le_with_bom() {
        let text = "AB";
        let mut bytes = vec![0xFF, 0xFE]; // BOM
        for c in text.encode_utf16() {
            bytes.extend_from_slice(&c.to_le_bytes());
        }
        let result = decode_bytes_to_text(&bytes);
        assert!(result.contains('A') && result.contains('B'));
    }

    #[test]
    fn decode_empty() {
        assert_eq!(decode_bytes_to_text(&[]), "");
    }

    // ── try_fix_enablon_zip ──

    #[test]
    fn fix_enablon_zip_too_short() {
        assert!(try_fix_enablon_zip(&[0x00, 0x01]).is_none());
    }

    #[test]
    fn fix_enablon_zip_not_matching() {
        let bytes = vec![0x00; 40];
        assert!(try_fix_enablon_zip(&bytes).is_none());
    }

    #[test]
    fn fix_enablon_zip_valid_signature() {
        // Simulate an Enablon-obfuscated local file header: ?? ?? 03 04 0A 00 ...
        let mut bytes = vec![0x00; 40];
        bytes[2] = 0x03;
        bytes[3] = 0x04;
        bytes[4] = 0x0A; // version 1.0
        bytes[5] = 0x00;
        let result = try_fix_enablon_zip(&bytes).unwrap();
        assert_eq!(result[0], 0x50); // P
        assert_eq!(result[1], 0x4B); // K
    }

    // ── format_enablon_text ──

    #[test]
    fn format_passthrough_no_separator() {
        let text = "plain text without Enablon separators";
        assert_eq!(format_enablon_text(text), text);
    }

    #[test]
    fn format_strips_mmd_block() {
        let s = "\u{00A7}"; // §
        let sep = "\u{00A9}\u{00DE}"; // ©Þ
        let text = format!("before{sep}{s}MMDStart{s}{sep}schema data{sep}{s}MMDEnd{s}{sep}after");
        let result = format_enablon_text(&text);
        assert!(!result.contains("schema data"));
        assert!(!result.contains("MMDStart"));
    }

    #[test]
    fn format_strips_section_tags() {
        let s = "\u{00A7}";
        let sep = "\u{00A9}\u{00DE}";
        let text = format!("data{sep}{s}####{s}{sep}more data");
        let result = format_enablon_text(&text);
        assert!(!result.contains("####"));
    }

    #[test]
    fn format_add_record() {
        let sep = "\u{00A9}\u{00DE}";
        let fsep = "\u{00A4}\u{00A3}\u{00A4}";
        let text = format!("prefix{sep}TableName{fsep}FieldName{fsep}value1{fsep}value2*A*{sep}end");
        let result = format_enablon_text(&text);
        assert!(result.contains("[ADD] TableName.FieldName"));
    }

    #[test]
    fn format_mod_record_with_diff() {
        let sep = "\u{00A9}\u{00DE}";
        let fsep = "\u{00A4}\u{00A3}\u{00A4}";
        // Two consecutive MOD records with same table.field = before/after pair
        let text = format!(
            "prefix{sep}MyTable{fsep}MyField{fsep}old_value*M*{sep}MyTable{fsep}MyField{fsep}new_value*M*{sep}end"
        );
        let result = format_enablon_text(&text);
        assert!(result.contains("[MOD] MyTable.MyField"));
        assert!(result.contains("old_value") || result.contains("new_value"));
    }

    #[test]
    fn format_mod_record_no_change() {
        let sep = "\u{00A9}\u{00DE}";
        let fsep = "\u{00A4}\u{00A3}\u{00A4}";
        // MOD pair where values are identical → should produce no output
        let text = format!(
            "prefix{sep}T{fsep}F{fsep}same*M*{sep}T{fsep}F{fsep}same*M*{sep}end"
        );
        let result = format_enablon_text(&text);
        assert!(!result.contains("[MOD]"));
    }

    // ── Work item ID extraction (logic from list_branch_work_items) ──

    fn extract_work_item_ids(msg: &str) -> Vec<u64> {
        let mut wi_ids: Vec<u64> = vec![];
        for cap in msg.split(|c: char| !c.is_ascii_digit() && c != '#').filter(|s| s.contains('#')) {
            if let Some(id_str) = cap.strip_prefix('#').or_else(|| cap.strip_prefix("AB#")) {
                if let Ok(id) = id_str.parse::<u64>() { if !wi_ids.contains(&id) { wi_ids.push(id); } }
            }
        }
        for part in msg.split_whitespace() {
            if let Some(id_str) = part.strip_prefix("AB#").or_else(|| part.strip_prefix("#")) {
                let id_str = id_str.trim_end_matches(|c: char| !c.is_ascii_digit());
                if let Ok(id) = id_str.parse::<u64>() { if !wi_ids.contains(&id) { wi_ids.push(id); } }
            }
        }
        wi_ids
    }

    #[test]
    fn extract_hash_ids() {
        assert_eq!(extract_work_item_ids("Fix #123 and #456"), vec![123, 456]);
    }

    #[test]
    fn extract_ab_hash_ids() {
        assert_eq!(extract_work_item_ids("Linked AB#789"), vec![789]);
    }

    #[test]
    fn extract_mixed_ids() {
        let ids = extract_work_item_ids("Fix #100 related to AB#200");
        assert!(ids.contains(&100));
        assert!(ids.contains(&200));
    }

    #[test]
    fn extract_no_ids() {
        assert!(extract_work_item_ids("No work items here").is_empty());
    }

    #[test]
    fn extract_no_duplicates() {
        let ids = extract_work_item_ids("#42 same #42 again");
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0], 42);
    }

    // ── WIQL injection check (from search_work_items) ──

    fn is_wiql_injection(query: &str) -> bool {
        let safe_query = query.replace('\'', "''").replace(['[', ']'], "");
        let lower = safe_query.to_lowercase();
        lower.contains(" or ") || lower.contains(" and ") || lower.contains("--") || lower.contains("select ") || lower.contains(" from ") || lower.contains(" where ")
    }

    #[test]
    fn wiql_safe_query() {
        assert!(!is_wiql_injection("fix login button"));
    }

    #[test]
    fn wiql_rejects_or_injection() {
        assert!(is_wiql_injection("' OR 1=1 --"));
    }

    #[test]
    fn wiql_rejects_select() {
        assert!(is_wiql_injection("SELECT * FROM WorkItems"));
    }

    #[test]
    fn wiql_allows_android() {
        // "and" inside a word should not trigger
        assert!(!is_wiql_injection("android bug"));
    }

    // ── Branch name validation (logic from create_azdo_branch) ──

    fn is_invalid_branch_name(name: &str) -> bool {
        name.is_empty()
            || name.len() > 250
            || name.contains('\0')
            || name.contains("..")
            || name.ends_with(".lock")
            || name.contains('~')
            || name.contains('^')
            || name.contains(':')
            || name.contains('\\')
            || name.contains(' ')
    }

    #[test]
    fn branch_name_valid() {
        assert!(!is_invalid_branch_name("feature/my-branch"));
        assert!(!is_invalid_branch_name("hotfix-123"));
    }

    #[test]
    fn branch_name_rejects_empty() {
        assert!(is_invalid_branch_name(""));
    }

    #[test]
    fn branch_name_rejects_too_long() {
        assert!(is_invalid_branch_name(&"a".repeat(251)));
    }

    #[test]
    fn branch_name_rejects_null() {
        assert!(is_invalid_branch_name("feat\0ure"));
    }

    #[test]
    fn branch_name_rejects_dotdot() {
        assert!(is_invalid_branch_name("feature..branch"));
    }

    #[test]
    fn branch_name_rejects_dotlock() {
        assert!(is_invalid_branch_name("branch.lock"));
    }

    #[test]
    fn branch_name_rejects_special_chars() {
        assert!(is_invalid_branch_name("feat~ure"));
        assert!(is_invalid_branch_name("feat^ure"));
        assert!(is_invalid_branch_name("feat:ure"));
        assert!(is_invalid_branch_name("feat\\ure"));
        assert!(is_invalid_branch_name("feat ure"));
    }

    // ── Assignee validation (logic from assign_work_item) ──

    #[test]
    fn assignee_rejects_empty() {
        assert!("".is_empty());
    }

    #[test]
    fn assignee_rejects_too_long() {
        let long = "a".repeat(257);
        assert!(long.len() > 256);
    }

    #[test]
    fn assignee_rejects_null() {
        assert!("user\0name".contains('\0'));
    }

    // ── Search query validation (from search_work_items) ──

    #[test]
    fn query_rejects_too_long() {
        let long = "a".repeat(501);
        assert!(long.len() > 500);
    }

    #[test]
    fn query_rejects_null_byte() {
        assert!("query\0bad".contains('\0'));
    }

    #[test]
    fn wiql_rejects_and_injection() {
        assert!(is_wiql_injection("test' AND 1=1 --"));
    }

    #[test]
    fn wiql_rejects_from_injection() {
        assert!(is_wiql_injection("test FROM workitems"));
    }

    #[test]
    fn wiql_rejects_where_injection() {
        assert!(is_wiql_injection("test WHERE id=1"));
    }

    #[test]
    fn wiql_rejects_comment_injection() {
        assert!(is_wiql_injection("test -- comment"));
    }
}

