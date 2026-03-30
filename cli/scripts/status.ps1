
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

# ── Site reachability ──
Print_Title "Local Site"
Print_Text "Checking site reachability..."
$siteUrl = "http://localhost/$($_c.local.site_id)/go.aspx"
try {
    $response = Invoke-WebRequest -Uri $siteUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $siteStatus = "reachable (HTTP $($response.StatusCode))"
    $siteOk = $true
} catch {
    $httpCode = $_.Exception.Response.StatusCode.value__
    if ($httpCode) {
        $siteStatus = "HTTP $httpCode"
    } else {
        $innerMsg = $_.Exception.InnerException.Message
        if ($innerMsg -match "No connection|actively refused") {
            $siteStatus = "connection refused (IIS stopped or site not started?)"
        } elseif ($innerMsg -match "timed out") {
            $siteStatus = "timed out after 5s"
        } else {
            $siteStatus = "unreachable: $($_.Exception.Message)"
        }
    }
    $siteOk = $false
}

# ── Git branch status ──
Print_Title "Repository"
Print_Text "Checking git repository status..."
$repoPath = $_c.local.repository
$gitBranch = ""
$gitAhead = ""
$gitBehind = ""
if (Test-Path $repoPath) {
    try {
        $gitBranch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>$null
        git -C "$repoPath" fetch -q 2>$null
        $gitStatus = git -C "$repoPath" status -sb 2>$null | Select-Object -First 1
        if ($gitStatus -match '\[ahead (\d+)') { $gitAhead = "$($Matches[1]) ahead" }
        if ($gitStatus -match 'behind (\d+)') { $gitBehind = "$($Matches[1]) behind" }
    } catch {
        $gitBranch = "(git error: $($_.Exception.Message))"
    }
} else {
    $gitBranch = "(repository not found)"
}

# ── Packages info ──
Print_Title "Packages"
Print_Text "Querying master packages from database..."
$masterPkgs = @()
try {
    if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
        $pkgRows = Invoke-Sqlcmd -ServerInstance "(local)" -Database $_c.local.site_id -Username $_c.local.db_user -Password $_c.local.db_password `
            -Query "SELECT XMLInfo, IIF((Special&1)<>0, 'master', 'closed') as Status FROM Meta_Products WHERE MetaType=2 AND (Special&64)=0 ORDER BY IIF((Special&1)=1,0,1), XMLInfo" `
            -QueryTimeout 5
        $masterPkgs = $pkgRows | Where-Object { $_.Status -eq 'master' } | ForEach-Object { $_.XMLInfo }
    }
} catch {
    Print_Warning "Could not query packages: $($_.Exception.Message)"
}

# ── Active PRs ──
Print_Title "Pull Requests"
Print_Text "Fetching active pull requests from Azure DevOps..."
$activePRs = @()
try {
    $ApiHeaders = GetApiHeaders -AzDoToken $_c.azdo.token
    $srcRef = [uri]::EscapeDataString("refs/heads/$($_c.feature_branch)")
    $prResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET -TimeoutSec 15 `
        -Uri "$($_c.azdo.base_uri)/_apis/git/repositories/$($_c.azdo.repository)/pullrequests?api-version=7.0&searchCriteria.sourceRefName=$srcRef&searchCriteria.status=active"
    foreach ($pr in $prResponse.value) {
        $activePRs += @{ id = $pr.pullRequestId; title = $pr.title; url = "$($_c.azdo.base_uri)/_git/$($_c.azdo.repository)/pullrequest/$($pr.pullRequestId)" }
    }
} catch {
    Print_Warning "Could not fetch PRs: $($_.Exception.Message)"
}

# ── Display ──
Write-Host

if ($env:DONUT_GUI -ne "1" -and $UseGum) {
    $siteIcon = if ($siteOk) { "OK" } else { "FAIL" }
    $statusLines = @(
        "Site:       $($_c.local.site_id) [$siteIcon] $siteStatus",
        "Branch:     $gitBranch $(if ($gitAhead) { "($gitAhead)" }) $(if ($gitBehind) { "($gitBehind)" })",
        "Target:     $($_c.target_branch)",
        "Repository: $($_c.azdo.repository)",
        "Workitem:   $(if ($_c.workitem_id) { '#' + $_c.workitem_id } else { '(none)' })",
        "",
        "Config packages: $($_c.packages -join ', ')",
        "Master on site:  $(if ($masterPkgs) { $masterPkgs -join ', ' } else { '(unknown)' })"
    )

    if ($activePRs.Count -gt 0) {
        $statusLines += ""
        $statusLines += "Active PRs:"
        foreach ($pr in $activePRs) {
            $statusLines += "  #$($pr.id) - $($pr.title)"
        }
    } else {
        $statusLines += ""
        $statusLines += "Active PRs:  (none)"
    }

    $borderColor = if ($siteOk) { "10" } else { "196" }
    gum style --border rounded --border-foreground $borderColor --padding "0 2" --foreground 252 ($statusLines -join "`n")
} else {
    Print_Text "Site:       $($_c.local.site_id) - $siteStatus"
    Print_Text "Branch:     $gitBranch $gitAhead $gitBehind"
    Print_Text "Target:     $($_c.target_branch)"
    Print_Text "Repository: $($_c.azdo.repository)"
    Print_Text "Workitem:   $(if ($_c.workitem_id) { '#' + $_c.workitem_id } else { '(none)' })"
    Print_Text "Packages:   $($_c.packages -join ', ')"
    Print_Text "Master:     $(if ($masterPkgs) { $masterPkgs -join ', ' } else { '(unknown)' })"
    if ($activePRs.Count -gt 0) {
        Print_SubTitle "Active PRs:"
        foreach ($pr in $activePRs) {
            Print_Text "  #$($pr.id) - $($pr.title)"
        }
    }
}

Write-Host
