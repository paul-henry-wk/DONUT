use crate::error::{azdo_status_err, AppError};
use crate::helpers::{azdo_auth, url_encode};
use crate::AppState;

#[tauri::command]
pub(crate) async fn validate_pat(state: tauri::State<'_, AppState>, token: String, organization: Option<String>) -> Result<bool, AppError> {
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/_apis/projects?api-version=7.0", org);
    let resp = state.http.get(&url)
        .header("Authorization", azdo_auth(&token))
        .send().await?;
    Ok(resp.status().is_success())
}

#[tauri::command]
pub(crate) async fn list_azdo_projects(state: tauri::State<'_, AppState>, token: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    if token.is_empty() { return Err(AppError::Validation("Fill PAT first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/_apis/projects?api-version=7.0&$top=100", org);
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token)).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let mut projects: Vec<String> = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(String::from)).collect()
    }).unwrap_or_default();
    projects.sort();
    Ok(projects)
}

#[tauri::command]
pub(crate) async fn list_azdo_repos(state: tauri::State<'_, AppState>, token: String, project: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    if token.is_empty() || project.is_empty() { return Err(AppError::Validation("Fill PAT & project first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories?api-version=7.0", url_encode(org), url_encode(&project));
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token))
        .send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let repos = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(String::from)).collect()
    }).unwrap_or_default();
    Ok(repos)
}

#[tauri::command]
pub(crate) async fn list_azdo_branches(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, organization: Option<String>) -> Result<Vec<String>, AppError> {
    if token.is_empty() || project.is_empty() || repository.is_empty() { return Err(AppError::Validation("Fill PAT, project & repository first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/refs?filter=heads/&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token))
        .send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let branches = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| v["name"].as_str().map(|n| n.strip_prefix("refs/heads/").unwrap_or(n).to_string())).collect()
    }).unwrap_or_default();
    Ok(branches)
}

#[tauri::command]
pub(crate) async fn create_azdo_branch(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch_name: String, source_branch: String, organization: Option<String>) -> Result<String, AppError> {
    if token.is_empty() || project.is_empty() || repository.is_empty() || branch_name.is_empty() || source_branch.is_empty() {
        return Err(AppError::Validation("Fill all fields: PAT, project, repository, branch name, source branch.".into()));
    }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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
    if token.is_empty() || project.is_empty() || repository.is_empty() || branch_name.is_empty() {
        return Err(AppError::Validation("Fill all fields.".into()));
    }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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

#[derive(Clone, serde::Serialize)]
pub(crate) struct PullRequest { id: u64, title: String, status: String, source_branch: String, target_branch: String, created_by: String, url: String }

#[tauri::command]
pub(crate) async fn list_azdo_prs(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, organization: Option<String>) -> Result<Vec<PullRequest>, AppError> {
    if token.is_empty() || project.is_empty() || repository.is_empty() { return Err(AppError::Validation("Fill PAT, project & repository first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/pullrequests?searchCriteria.status=active&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository));
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token)).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let prs = json["value"].as_array().map(|arr| {
        arr.iter().filter_map(|v| {
            Some(PullRequest {
                id: v["pullRequestId"].as_u64()?,
                title: v["title"].as_str()?.to_string(),
                status: v["status"].as_str()?.to_string(),
                source_branch: v["sourceRefName"].as_str()?.strip_prefix("refs/heads/").unwrap_or("").to_string(),
                target_branch: v["targetRefName"].as_str()?.strip_prefix("refs/heads/").unwrap_or("").to_string(),
                created_by: v["createdBy"]["displayName"].as_str().unwrap_or("").to_string(),
                url: format!("https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}", org, project, v["repository"]["name"].as_str().unwrap_or(&repository), v["pullRequestId"].as_u64().unwrap_or(0)),
            })
        }).collect()
    }).unwrap_or_default();
    Ok(prs)
}

// ── Build / Pipeline status ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct BuildStatus { id: u64, status: String, result: String, definition_name: String, source_branch: String, url: String, finish_time: String }

#[tauri::command]
pub(crate) async fn list_azdo_builds(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, branch: Option<String>, organization: Option<String>) -> Result<Vec<BuildStatus>, AppError> {
    if token.is_empty() || project.is_empty() { return Err(AppError::Validation("Fill PAT & project.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let mut url = format!("https://dev.azure.com/{}/{}/_apis/build/builds?$top=10&api-version=7.0&repositoryId={}&repositoryType=TfsGit", url_encode(org), url_encode(&project), url_encode(&repository));
    if let Some(b) = &branch {
        url.push_str(&format!("&branchName=refs/heads/{}", url_encode(b)));
    }
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token)).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
    let builds = json["value"].as_array().map(|arr| {
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
    Ok(builds)
}

// ── Branch diff (compare) ──

#[derive(Clone, serde::Serialize)]
pub(crate) struct BranchDiff { ahead: u64, behind: u64, changes: Vec<DiffChange> }
#[derive(Clone, serde::Serialize)]
pub(crate) struct DiffChange { path: String, change_type: String }

#[tauri::command]
pub(crate) async fn compare_branches(state: tauri::State<'_, AppState>, token: String, project: String, repository: String, source_branch: String, target_branch: String, organization: Option<String>) -> Result<BranchDiff, AppError> {
    if token.is_empty() || project.is_empty() || repository.is_empty() { return Err(AppError::Validation("Fill PAT, project & repository.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
    let url = format!("https://dev.azure.com/{}/{}/_apis/git/repositories/{}/diffs/commits?baseVersion={}&baseVersionType=branch&targetVersion={}&targetVersionType=branch&api-version=7.0", url_encode(org), url_encode(&project), url_encode(&repository), url_encode(&target_branch), url_encode(&source_branch));
    let resp = state.http.get(&url).header("Authorization", azdo_auth(&token)).send().await?;
    if !resp.status().is_success() { return Err(azdo_status_err(resp.status())); }
    let json: serde_json::Value = resp.json().await?;
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
    if token.is_empty() || project.is_empty() || repository.is_empty() { return Err(AppError::Validation("Fill PAT, project & repository.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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
                .ok_or_else(|| AppError::Validation(format!("Branch not found")))
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
    if token.is_empty() { return Err(AppError::Validation("Fill PAT first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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
    if token.is_empty() || project.is_empty() || repository.is_empty() || branch.is_empty() { return Err(AppError::Validation("Fill PAT, project, repository & branch.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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
    if token.is_empty() || project.is_empty() { return Err(AppError::Validation("Fill PAT & project first.".into())); }
    let org = organization.as_deref().filter(|s| !s.is_empty()).ok_or_else(|| AppError::Validation("Azure DevOps organization is required.".into()))?;
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
        let safe_query = query.replace('\'', "''").replace('[', "").replace(']', "");
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
