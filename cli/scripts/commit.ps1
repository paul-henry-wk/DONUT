
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json",
    [Parameter(Mandatory = $true)]
    [string] $Message
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"
CheckPrerequisites

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "COMMIT"
Print_Text "Packaging the donut for delivery..."

Print_Title "Loading Configuration"
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile
Print_Status "Environment: $EnvFile"

Print_Title "Validating Prerequisites"
CheckLocalSiteExists -LocalSite $_c.local.site_path
Print_Status "Site path OK"

# Check Azure DevOps connectivity
if ($_c.azdo.base_uri -match "https?://([^/]+)") {
    $remoteHost = $Matches[1]
    Print_Text "Checking connectivity to $remoteHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($remoteHost)
    } catch {
        Print_Error "Cannot reach $remoteHost - is your VPN connected?"
        throw "Network error: cannot resolve $remoteHost. Connect your VPN and try again."
    }
}

try {
    CheckDependencies -RootPath $RootPath -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -SiteParams $_c.local.site_api_params
    Print_Status "Dependencies OK"
} catch {
    if ($_.Exception.Message -match "not allowed|unauthorized|access") {
        Print_Error "Site access denied (user: '$($_c.local.user)')"
        Print_Text "  -> Check password in Config tab > local.password"
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
        Print_Text "  -> Try opening the site in a browser to confirm credentials"
    }
    throw
}
Metadata_CheckBranchExistsLocaly -Repository $_c.local.repository -Branch $_c.feature_branch -Message "You must pull-force at least once before being able to commit."
Print_Status "Branch '$($_c.feature_branch)' exists locally"
if ($_c.convert_md) {
    foreach ($package in $_c.packages) {
        $repository = "$($_c.local.repository_metadata)\$package"
        Metadata_CheckBranchExistsLocaly -Repository $repository -Branch $_c.md_branches.start.local -Message "Did you deactivate metadata conversion during pull-force ? You must pull-force with the conversion active at least once before being able to commit."
    }
}

# Initialization
ValidateCommitMessage -Message $Message
if ([string]::IsNullOrEmpty($_c.workitem_id)) {
    Print_Warning "No workitem has been defined in the environment configuration file. It is not blocking but you can use it to prefill parts of the pull requests automatically."
    Print_Request
    $Workitem = $null
} else {
    try {
        $Workitem = GetWorkItem -WorkitemId $_c.workitem_id -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token
    } catch {
        Print_Warning "Could not fetch work item '$($_c.workitem_id)': $($_.Exception.Message)"
        $Workitem = $null
    }
}
$Title = if ($Workitem) { $Workitem.title } else { $Message}

# ── Preview before commit ──
if ($env:DONUT_GUI -eq "1") {
    Print_Title "Commit Preview"
    Print_Text "Message:    $Message"
    Print_Text "Branch:     $($_c.feature_branch) -> $($_c.target_branch)"
    Print_Text "Repository: $($_c.azdo.repository)"
    Print_Text "Packages:   $($_c.packages -join ', ')"
    Print_Text "Work Item:  $(if ($Workitem) { '#' + $Workitem.id + ' - ' + $Workitem.title } else { '(none)' })"
    Print_Text "PR Title:   $Title"
} elseif ($UseGum) {
    $preview = @(
        "Message:    $Message",
        "Branch:     $($_c.feature_branch) -> $($_c.target_branch)",
        "Repository: $($_c.azdo.repository)",
        "Packages:   $($_c.packages -join ', ')",
        "Workitem:   $(if ($Workitem) { '#' + $Workitem.id + ' - ' + $Workitem.title } else { '(none)' })",
        "PR Title:   $Title",
        "Metadata:   $(if ($_c.convert_md) { 'enabled' } else { 'disabled' })"
    )
    gum style --border rounded --border-foreground 212 --padding "0 2" --foreground 252 --bold "Commit Preview" ($preview -join "`n")
    Write-Host
    gum confirm "Proceed with commit?" --default=Yes
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "Commit cancelled."
        exit 0
    }
    Write-Host
}

Print_Title "Checking Site Switches"
EnablonCheckSwitches -SiteParams $_c.local.site_api_params -Switches $_c.local.switches

Print_Title "Preparing Repository"
Print_Text "Checking out $($_c.feature_branch)..."
CheckoutBranch -Repository $_c.local.repository -SourceBranch $_c.target_branch -Branch $_c.feature_branch -ExpectedToExist $true | Out-Null
EmptyCommitsFolder -Repository $_c.local.repository
Print_Status "Repository ready"

Print_Title "Committing Changes"
Print_Text "Baking the donut... extracting packages from site"
try {
    EnablonStatus -SiteParams $_c.local.site_api_params -Action "commit" -Packages $_c.packages
    Print_Text "Setting up upstream branch..."
    Push -Repository $_c.local.repository -AzDoRepository $_c.azdo.repository -Branch $_c.feature_branch
    Print_Text "Committing packages on site..."
    $CommitedPackages = EnablonCommit -SiteParams $_c.local.site_api_params -Packages $_c.packages
    Print_Status "Site commit done"
    Print_Text "Pushing package changes..."
    EnablonPush -SiteParams $_c.local.site_api_params -Packages $_c.packages
    Print_Status "Packages pushed to local repository"
} catch {
    $errMsg = $_.Exception.Message
    Print_Error "Commit operation failed: $errMsg"
    if ($errMsg -match "Parent site configuration is invalid|WsdlLocation") {
        Print_Text "  -> The parent site path '$($_c.local.parent_site)' seems incorrect or unreachable."
        Print_Text "  -> Go to Config tab > 'local.parent_site' and update it."
        Print_Text "  -> The parent site must be accessible at: http://localhost$($_c.local.parent_site)/"
    } elseif ($errMsg -match "not allowed|unauthorized|access|401") {
        Print_Text "  -> Check your credentials in Config tab > 'local.user' and 'local.password'."
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
    } else {
        Print_Text "  -> Check that the local site is running and packages are accessible."
        Print_Text "  -> Verify: http://localhost/$($_c.local.site_id)"
    }
    throw
}

Print_Title "Push to Azure DevOps"
Print_Text "Delivering the donut to the bakery..."
$PackagesMsg = ($CommitedPackages | ForEach-Object {" $([PSCustomObject]$_.xmltag) $([PSCustomObject]$_.version)"}) -join " |"
Commit -Repository $_c.local.repository -Message "$Message |$PackagesMsg"
Push -Repository $_c.local.repository -AzDoRepository $_c.azdo.repository -Branch $_c.feature_branch
Print_Status "Code pushed to Azure DevOps"

if ($_c.convert_md) {
    # Update Metadata Repository with Local Site State
    Print_Title "Metadata Conversion"
    Print_Text "Converting and saving metadata to git... this may take a while."
    foreach ($package in $_c.packages) {
        $repository = "$($_c.local.repository_metadata)\$package"
        Metadata_CreateBranch -Repository $repository -Branch $_c.md_branches.end.local -SourceBranches ($_c.md_branches.end.$package, $_c.md_branches.start.local)
    }
    Metadata_SaveToGit -RootPath $RootPath -Repository $_c.local.repository_metadata -SitePath $_c.local.site_path -SiteId $_c.local.site_id -Branch $_c.md_branches.end.local -Message $Message -DBUser $_c.local.db_user -DBSafePassw0rd $_c.local.db_password

    Print_Status "Metadata saved to git."

    # Manage Metadata Repository
    Print_Text "Pushing metadata and creating view-diff pull requests..."
    $Metadata_PR_URIs = @{}
    foreach ($package in $_c.packages) {
        $repository = "$($_c.local.repository_metadata)\$package"
        Metadata_Push -Repository $repository -Branch $_c.md_branches.start.local -AzDoRepository $_c.azdo.repository_metadata -AzDoBranch $_c.md_branches.start.$package
        Metadata_Push -Repository $repository -Branch $_c.md_branches.end.local -AzDoRepository $_c.azdo.repository_metadata -AzDoBranch $_c.md_branches.end.$package

        # Create Pull Request on Metadata Repository (view diff)
        $Metadata_PR_Id = CreatePullRequest -AzDoRepository $_c.azdo.repository_metadata -sourceBranch $_c.md_branches.end.$package -targetBranch $_c.md_branches.start.$package -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -Title "[ViewDiff] $Title" -Description "View Diff of branch '$($_c.feature_branch)'."
        $Metadata_PR_URIs[$package] = "$($_c.azdo.base_uri)/_git/$($_c.azdo.repository_metadata)/pullrequest/$($Metadata_PR_Id)"
    }
}

# Create Pull Request on Feature Repository
if ($_c.convert_md) {
    $Description = "Follow this link to review the changes made in the builder :`n$($Metadata_PR_URIs.GetEnumerator().ForEach({ "$($_.Key): $($_.Value)?_a=files" }) -join "`n")"
} else {
    $Description = $Title
}
Print_Title "Creating Pull Request"
Print_Text "Adding the cherry on top..."
try {
    $PR_Id = CreatePullRequest -AzDoRepository $_c.azdo.repository -sourceBranch $_c.feature_branch -targetBranch $_c.target_branch -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -Title $Title -Description $Description -Identifier $_c.hash -Workitem $Workitem
    $PR_URI = "$($_c.azdo.base_uri)/_git/$($_c.azdo.repository)/pullrequest/$PR_Id"
    Print_Status "Pull Request #$PR_Id created"
} catch {
    $errMsg = $_.Exception.Message
    Print_Error "Failed to create/update pull request: $errMsg"
    Print_Text "  -> Code was pushed successfully. You may need to create the PR manually in Azure DevOps."
    if ($errMsg -match "401|403|unauthorized|expired|access denied") {
        Print_Text "  -> Your Azure DevOps PAT may be expired or missing permissions."
        Print_Text "  -> Go to Config tab > 'azdo.token' and update your PAT."
        Print_Text "  -> Generate a new one at: Azure DevOps > User Settings > Personal Access Tokens."
    }
    throw
}

$Links = @("PR Link : $PR_URI")
if ($_c.convert_md) {
    $Links += @(
        "PR View Diff Links :",
        ($Metadata_PR_URIs | Format-Table @{Label="Package"; Expression={$_.Name}}, @{Label="URI"; Expression={$_.Value}} -AutoSize | Out-String)
    )
}
Print_Script_End "Your work is now on Azure DevOps." -Links $Links
