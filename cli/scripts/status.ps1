
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "DONUT STATUS"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

# ── Azure DevOps connectivity ──
$azdoOk = $false
if ($_c.azdo.base_uri -match "https?://([^/]+)") {
    $remoteHost = $Matches[1]
    Print_Text "Checking connectivity to $remoteHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($remoteHost)
        $azdoOk = $true
    } catch {
        Print_Error "Cannot reach $remoteHost - is your VPN connected?"
        throw "Network error: cannot resolve $remoteHost. Connect your VPN and try again."
    }
}

# ── Site reachability ──
Print_Text "Checking site reachability..."
$siteUrl = "http://localhost/$($_c.local.site_id)/go.aspx"
$siteStatus = "unknown"
$siteOk = $false
try {
    $response = Invoke-WebRequest -Uri $siteUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $siteStatus = "HTTP $($response.StatusCode)"
    $siteOk = $true
} catch {
    $httpCode = $_.Exception.Response.StatusCode.value__
    if ($httpCode) {
        $siteStatus = "HTTP $httpCode"
    } else {
        $innerMsg = $_.Exception.InnerException.Message
        if ($innerMsg -match "No connection|actively refused") {
            $siteStatus = "connection refused"
        } elseif ($innerMsg -match "timed out") {
            $siteStatus = "timed out"
        } else {
            $siteStatus = "unreachable"
        }
    }
}

# ── Git branch status ──
Print_Text "Checking git repository status..."
$repoPath = $_c.local.repository
$gitBranch = ""
$gitAhead = 0
$gitBehind = 0
$gitDirty = $false
if (Test-Path $repoPath) {
    try {
        $gitBranch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>$null
        git -C "$repoPath" fetch -q 2>$null
        $gitStatusLine = git -C "$repoPath" status -sb 2>$null | Select-Object -First 1
        if ($gitStatusLine -match '\[ahead (\d+)') { $gitAhead = [int]$Matches[1] }
        if ($gitStatusLine -match 'behind (\d+)') { $gitBehind = [int]$Matches[1] }
        $dirtyFiles = @(git -C "$repoPath" status --porcelain 2>$null)
        $gitDirty = $dirtyFiles.Count -gt 0
    } catch {
        $gitBranch = "(error)"
    }
} else {
    $gitBranch = "(not found)"
}

# ── Packages info ──
Print_Text "Querying packages..."
$masterPkgs = @()
try {
    if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
        $pkgRows = Invoke-Sqlcmd -ServerInstance "(local)" -Database $_c.local.site_id -Username $_c.local.db_user -Password $_c.local.db_password `
            -Query "SELECT XMLInfo, IIF((Special&1)<>0, 'master', 'closed') as Status FROM Meta_Products WHERE MetaType=2 AND (Special&64)=0 ORDER BY IIF((Special&1)=1,0,1), XMLInfo" `
            -QueryTimeout 5
        $masterPkgs = @($pkgRows | Where-Object { $_.Status -eq 'master' } | ForEach-Object { $_.XMLInfo })
    }
} catch {}

# ── Active PRs ──
Print_Text "Fetching pull requests..."
$activePRs = @()
try {
    $ApiHeaders = GetApiHeaders -AzDoToken $_c.azdo.token
    $srcRef = [uri]::EscapeDataString("refs/heads/$($_c.feature_branch)")
    $prResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET -TimeoutSec 15 `
        -Uri "$($_c.azdo.base_uri)/_apis/git/repositories/$($_c.azdo.repository)/pullrequests?api-version=7.0&searchCriteria.sourceRefName=$srcRef&searchCriteria.status=active"
    foreach ($pr in $prResponse.value) {
        $activePRs += @{
            id    = $pr.pullRequestId
            title = $pr.title
            url   = "$($_c.azdo.base_uri)/_git/$($_c.azdo.repository)/pullrequest/$($pr.pullRequestId)"
        }
    }
} catch {}

# ── Build JSON card data ──
$workitemId = if ($_c.workitem_id) { $_c.workitem_id } else { "" }
$workitemTitle = ""
if ($_c.workitem_id) {
    $branchParts = $_c.feature_branch -split '[-/]'
    $idIndex = [array]::IndexOf($branchParts, $_c.workitem_id)
    if ($idIndex -ge 0 -and ($idIndex + 1) -lt $branchParts.Count) {
        $workitemTitle = ($branchParts[($idIndex+1)..($branchParts.Count-1)] -join ' ')
    }
}

$cardData = @{
    site = @{
        id     = $_c.local.site_id
        ok     = $siteOk
        status = $siteStatus
        path   = $_c.local.site_path
    }
    git = @{
        branch = $gitBranch
        target = $_c.target_branch
        ahead  = $gitAhead
        behind = $gitBehind
        dirty  = $gitDirty
    }
    repo = @{
        name = $_c.azdo.repository
        org  = $_c.azdo.organization
    }
    workitem = @{
        id    = $workitemId
        title = $workitemTitle
    }
    packages = @{
        config = @($_c.packages)
        master = @($masterPkgs)
    }
    prs = @($activePRs | ForEach-Object { @{ id = $_.id; title = $_.title; url = $_.url } })
    azdo = @{
        ok      = $azdoOk
        baseUri = $_c.azdo.base_uri
    }
}

$json = $cardData | ConvertTo-Json -Depth 4 -Compress
Write-Host "[CARD:status]$json[/CARD]"
