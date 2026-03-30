
[CmdletBinding()]
param(
    [string] $EnvFile
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

if ($env:DONUT_GUI -eq "1") {
    throw "Interactive init is not supported in DONUT GUI mode. Create or edit environment files in DONUT Config instead."
}

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)
if (-not $UseGum) {
    throw "gum is required for interactive init. Install it with: winget install charmbracelet.gum"
}

# ══════════════════════════════════════════════════
#  DONUT INIT — Interactive environment setup
# ══════════════════════════════════════════════════

gum style --border double --border-foreground 213 --padding "0 2" --foreground 213 --bold `
    "DONUT INIT" `
    "Create a new working environment"
Write-Host

# ── 1. Environment name ──
$defaultName = if ($EnvFile) { $EnvFile } else { ".env.json" }
$envName = gum input --header "Environment file name" --value $defaultName --placeholder ".env.json or .env-mydev.json"
if (-not $envName) { exit 0 }
if ($envName -notmatch "^\.env") { $envName = ".env-$envName.json" }
if ($envName -notmatch "\.json$") { $envName = "$envName.json" }

$envPath = "$RootPath\working-environments\$envName"
if (Test-Path $envPath) {
    gum confirm "File '$envName' already exists. Overwrite?" --default=No
    if ($LASTEXITCODE -ne 0) { exit 0 }
}

# ── 2. Azure DevOps connection ──
gum style --foreground 212 --bold "Azure DevOps"

$azdoOrg = gum input --header "Organization" --value "" --placeholder "your-org"
$azdoProject = gum input --header "Project" --value "" --placeholder "YourProject"
$azdoToken = gum input --header "Personal Access Token (PAT)" --password --placeholder "Paste your PAT here"

if (-not $azdoToken) {
    gum style --foreground 196 "PAT is required."
    exit 1
}

$AzDoBaseURI = "https://dev.azure.com/$azdoOrg/$azdoProject"
$ApiHeaders = GetApiHeaders -AzDoToken $azdoToken

# ── 3. Select repository from AzDo ──
gum style --foreground 212 --bold "Repository"

try {
    gum spin --spinner dot --title "Fetching repositories from Azure DevOps..." -- pwsh -NoProfile -Command "Start-Sleep -Milliseconds 100"
    $reposResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET -Uri "$AzDoBaseURI/_apis/git/repositories?api-version=7.0"
    $repoNames = $reposResponse.value | Where-Object { $_.name -match "^Package\." } | ForEach-Object { $_.name } | Sort-Object

    if ($repoNames.Count -gt 0) {
        $azdoRepo = $repoNames | gum filter --header "Select repository" --placeholder "Type to filter..."
    } else {
        $azdoRepo = gum input --header "Repository name" --placeholder "Package.XXX"
    }
} catch {
    gum style --foreground 214 "Could not fetch repositories: $_"
    $azdoRepo = gum input --header "Repository name" --placeholder "Package.XXX"
}
if (-not $azdoRepo) { exit 0 }

# ── 4. Select branches from the repository ──
gum style --foreground 212 --bold "Branches"

try {
    $branchesResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET -Uri "$AzDoBaseURI/_apis/git/repositories/$azdoRepo/refs?filter=heads/&api-version=7.0"
    $branchNames = $branchesResponse.value | ForEach-Object { $_.name -replace '^refs/heads/', '' } | Sort-Object
} catch {
    $branchNames = @("master", "main")
}

$targetBranch = $branchNames | gum filter --header "Target branch (base)" --placeholder "master"
if (-not $targetBranch) { $targetBranch = "master" }

$featureBranch = gum input --header "Feature branch name" --placeholder "feature/my-feature" --value "feature/"
if (-not $featureBranch) { exit 0 }

# ── 5. Work item (optional) ──
gum style --foreground 212 --bold "Work Item (optional)"

$workitemId = ""
$searchWI = gum confirm "Search for a work item?" --default=Yes 2>&1
if ($LASTEXITCODE -eq 0) {
    try {
        # WIQL query: recent work items assigned to current user
        $wiqlBody = @{
            query = "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC"
        } | ConvertTo-Json

        $wiqlResponse = Invoke-RestMethod -Headers $ApiHeaders -Method POST -Uri "$AzDoBaseURI/_apis/wit/wiql?api-version=7.0&`$top=30" -Body $wiqlBody -ContentType "application/json"

        if ($wiqlResponse.workItems.Count -gt 0) {
            $wiIds = ($wiqlResponse.workItems | ForEach-Object { $_.id }) -join ","
            $batchResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET -Uri "$AzDoBaseURI/_apis/wit/workitems?ids=$wiIds&fields=System.Id,System.Title,System.WorkItemType,System.State&api-version=7.0"

            $wiChoices = $batchResponse.value | ForEach-Object {
                "$($_.id) | $($_.fields.'System.WorkItemType') | $($_.fields.'System.Title')"
            }

            $selected = $wiChoices | gum filter --header "Select work item" --placeholder "Type to search..."
            if ($selected) {
                $workitemId = ($selected -split '\|')[0].Trim()
            }
        } else {
            gum style --faint "No work items found assigned to you."
            $workitemId = gum input --header "Work Item ID (or leave empty)" --placeholder "123456"
        }
    } catch {
        gum style --foreground 214 "Could not fetch work items: $_"
        $workitemId = gum input --header "Work Item ID (or leave empty)" --placeholder "123456"
    }
}

# ── 6. Local site ──
gum style --foreground 212 --bold "Local Site"

# Try to auto-detect sites
$sitePaths = @()
$siteDirs = @("C:\inetpub", "D:\inetpub")
foreach ($dir in $siteDirs) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Recurse -Filter "db" -Directory -Depth 4 -ErrorAction SilentlyContinue | ForEach-Object {
            $sitePaths += $_.Parent.FullName
        }
    }
}

if ($sitePaths.Count -gt 0) {
    $sitePath = $sitePaths | gum filter --header "Select local site (or type a path)" --placeholder "C:\\Sites\\..."
} else {
    $sitePath = gum input --header "Local site path" --placeholder "C:\\Sites\\v100\\WizXXX.10.0"
}
if (-not $sitePath) { exit 0 }

$parentSite = gum input --header "Parent site URL" --placeholder "https://your-server/10.0/WizXXX.10.0/"
$siteUser = gum input --header "Site user" --value "admin"
$sitePassword = gum input --header "Site password" --password --placeholder "krt0N.XXX"
$dbUser = gum input --header "DB user" --value "sa"
$dbPassword = gum input --header "DB password" --password --placeholder ""

# ── 7. Packages ──
gum style --foreground 212 --bold "Packages"

$packages = @()
$siteId = Split-Path $sitePath -Leaf

# Try to query SQL for packages
$selectFromSQL = gum confirm "Fetch packages from local database?" --default=Yes 2>&1
if ($LASTEXITCODE -eq 0) {
    try {
        $mtp_ModulePackage = 2
        $pdFlg_SubMaster = 64

        $query = "SELECT XMLInfo, ProductName FROM Meta_Products WHERE MetaType=$mtp_ModulePackage AND (Special&$pdFlg_SubMaster)=0 ORDER BY ProductName"

        $pkgRows = Invoke-Sqlcmd -ServerInstance "(local)" -Database $siteId -Username $dbUser -Password $dbPassword -Query $query -QueryTimeout 5
        $pkgChoices = $pkgRows | ForEach-Object { "$($_.XMLInfo) - $($_.ProductName)" }

        if ($pkgChoices.Count -gt 0) {
            $selected = $pkgChoices | gum choose --no-limit --header "Select working packages"
            $packages = @($selected | ForEach-Object { ($_ -split ' - ')[0].Trim() } | Where-Object { $_ })
        }
    } catch {
        gum style --foreground 214 "Could not fetch packages from DB: $_"
        $pkgInput = gum input --header "Packages (comma-separated)" --placeholder "EHS_Core, EHS_Reporting"
        $packages = @($pkgInput -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
} else {
    $pkgInput = gum input --header "Packages (comma-separated)" --placeholder "EHS_Core, EHS_Reporting"
    $packages = @($pkgInput -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# ── 8. Git config ──
$gitUsername = git config --global user.name 2>$null
$gitEmail = git config --global user.email 2>$null

# ── 9. Build and write config ──
$config = [ordered]@{
    workitem_id = $workitemId
    feature_branch = $featureBranch
    target_branch = $targetBranch
    packages = $packages

    local = [ordered]@{
        site_path = $sitePath
        parent_site = $parentSite
        user = $siteUser
        password = $sitePassword
        db_user = $dbUser
        db_password = $dbPassword
    }

    azdo = [ordered]@{
        organization = $azdoOrg
        project = $azdoProject
        token = $azdoToken
        repository = $azdoRepo
    }
}

# Only add git section if not using global defaults
if ($gitUsername -and $gitEmail) {
    gum style --faint "Git user: $gitUsername <$gitEmail> (from git config --global)"
} else {
    $config.git = [ordered]@{
        username = gum input --header "Git username" --placeholder "John Doe"
        email = gum input --header "Git email" --placeholder "john@example.com"
    }
}

$json = $config | ConvertTo-Json -Depth 10
$json | Set-Content -Path $envPath -Encoding utf8

Write-Host
gum style --border rounded --border-foreground 10 --padding "0 2" --foreground 10 `
    "Environment '$envName' created successfully!" `
    "" `
    "Branch:   $featureBranch -> $targetBranch" `
    "Repo:     $azdoRepo" `
    "Packages: $($packages -join ', ')" `
    "Site:     $siteId" `
    "" `
    "Run 'donut.bat' to start working."
Write-Host
