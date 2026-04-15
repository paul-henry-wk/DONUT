
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "HEALTH CHECK"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$checks = @()

# ── 1. Site path exists ──
Print_Title "Site Path"
if (Test-Path $_c.local.site_path) {
    $siteSize = [math]::Round((Get-ChildItem $_c.local.site_path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
    Print_Status "OK - $($_c.local.site_path) (${siteSize} MB)"
    $checks += @{ name = "Site path"; ok = $true; detail = "${siteSize} MB" }
} else {
    Print_Error "Site path not found: $($_c.local.site_path)"
    $checks += @{ name = "Site path"; ok = $false; detail = "not found" }
}

# ── 2. Site reachability ──
Print_Title "Site Reachability"
$siteUrl = "http://localhost/$($_c.local.site_id)/go.aspx"
try {
    $response = Invoke-WebRequest -Uri $siteUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Print_Status "OK - HTTP $($response.StatusCode)"
    $checks += @{ name = "Site HTTP"; ok = $true; detail = "HTTP $($response.StatusCode)" }
} catch {
    $httpDetail = "unreachable"
    $httpStatus = $_.Exception.Response.StatusCode.value__
    if ($httpStatus) {
        $httpDetail = "HTTP $httpStatus"
        Print_Error "Site returned HTTP $httpStatus : $siteUrl"
    } else {
        Print_Error "Unreachable: $siteUrl"
    }
    # ── Investigate cause ──
    # IIS running?
    $iisRunning = $null -ne (Get-Service W3SVC -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' })
    if (-not $iisRunning) {
        Print_Text "  -> IIS (W3SVC) is not running. Try: iisreset /start"
        $httpDetail += " (IIS stopped)"
    } else {
        Print_Text "  -> IIS (W3SVC) is running"
        # Check AppPool
        try {
            $poolCheck = Start-Process -FilePath "powershell" -ArgumentList '-NoProfile', '-Command', "Import-Module WebAdministration; (Get-Item ""IIS:\AppPools\$($_c.local.site_id)"" -EA Stop).State" -PassThru -NoNewWindow -RedirectStandardOutput "$RootPath\$($Paths.PoolState)" -RedirectStandardError "$RootPath\$($Paths.PoolError)" -ErrorAction Stop
            $poolCheck.WaitForExit(10000)
            $poolState = (Get-Content "$RootPath\$($Paths.PoolState)" -Raw -ErrorAction SilentlyContinue).Trim()
            Remove-Item "$RootPath\$($Paths.PoolState)", "$RootPath\$($Paths.PoolError)" -ErrorAction SilentlyContinue
            if ($poolState -eq 'Started') {
                Print_Text "  -> AppPool '$($_c.local.site_id)' is Started"
            } elseif ($poolState) {
                Print_Warning "  -> AppPool '$($_c.local.site_id)' is $poolState — try starting it in IIS Manager"
                $httpDetail += " (AppPool $poolState)"
            } else {
                Print_Warning "  -> AppPool '$($_c.local.site_id)' not found — check site_id in config"
                $httpDetail += " (AppPool not found)"
            }
        } catch {
            Print_Text "  -> Could not query AppPool (needs admin rights)"
        }
        # Check if port 80 is listening
        $port80 = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
        if (-not $port80) {
            Print_Warning "  -> Nothing listening on port 80"
            $httpDetail += " (port 80 closed)"
        }
        # Check if site_id virtual directory exists in IIS
        $iisPath = "$($env:SystemRoot)\System32\inetsrv\appcmd.exe"
        if (Test-Path $iisPath) {
            $appList = & $iisPath list app 2>$null | Select-String "/$($_c.local.site_id)/"
            if (-not $appList) {
                Print_Warning "  -> No IIS application found for '/$($_c.local.site_id)/' — check IIS configuration"
                $httpDetail += " (IIS app missing)"
            } else {
                Print_Text "  -> IIS application '/$($_c.local.site_id)/' exists"
            }
        }
    }
    $checks += @{ name = "Site HTTP"; ok = $false; detail = $httpDetail }
}

# ── 3. SQL Server connectivity ──
Print_Title "SQL Server"
try {
    $sqlResult = & sqlcmd -S "(local)" -d "$($_c.local.site_id)" -U "$($_c.local.db_user)" -P "$($_c.local.db_password)" -Q "SELECT 1" -h -1 -W -t 5 2>&1
    if ($LASTEXITCODE -eq 0) {
        Print_Status "OK - Connected to '$($_c.local.site_id)'"
        $checks += @{ name = "SQL Server"; ok = $true; detail = $_c.local.site_id }
    } else {
        Print_Error "SQL connection failed"
        $checks += @{ name = "SQL Server"; ok = $false; detail = "connection failed" }
    }
} catch {
    $sqlErr = $_.Exception.Message
    if ($sqlErr -match "not recognized|cannot find") {
        Print_Error "sqlcmd is not installed or not in PATH"
        Print_Text "  -> Install SQL Server command-line tools: winget install Microsoft.SqlServer.SqlCmd"
    } elseif ($sqlErr -match "Login failed") {
        Print_Error "SQL login failed for user '$($_c.local.db_user)' on database '$($_c.local.site_id)'"
        Print_Text "  -> Check db_user and db_password in your environment config"
    } elseif ($sqlErr -match "Cannot open database|does not exist") {
        Print_Error "Database '$($_c.local.site_id)' does not exist on (local)"
        Print_Text "  -> Check site_id in config, or ensure SQL Server is running"
    } else {
        Print_Error "SQL connection failed: $sqlErr"
    }
    $checks += @{ name = "SQL Server"; ok = $false; detail = $sqlErr -replace '[\r\n]+', ' ' }
}

# ── 4. Git repository ──
Print_Title "Git Repository"
$repoPath = $_c.local.repository
if (Test-Path "$repoPath\.git") {
    $branch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>$null
    $dirty = git -C "$repoPath" status --porcelain 2>$null
    $dirtyCount = @($dirty | Where-Object { $_ }).Count
    $status = if ($dirtyCount -eq 0) { "clean" } else { "$dirtyCount uncommitted change(s)" }
    Print_Status "OK - $branch ($status)"
    $checks += @{ name = "Git repo"; ok = $true; detail = "$branch ($status)" }
} elseif (Test-Path $repoPath) {
    Print_Warning "Repository exists but no .git folder"
    $checks += @{ name = "Git repo"; ok = $false; detail = "no .git" }
} else {
    Print_Warning "Repository not cloned yet: $repoPath (run Pull Force first)"
    $checks += @{ name = "Git repo"; ok = $true; detail = "not cloned yet" }
}

# ── 5. Azure DevOps connectivity ──
Print_Title "Azure DevOps"
Print_Text "Testing Azure DevOps connectivity..."
if ($_c.azdo.token) {
    try {
        $ApiHeaders = GetApiHeaders -AzDoToken $_c.azdo.token
        $repoResponse = Invoke-RestMethod -Headers $ApiHeaders -Method GET `
            -Uri "$($_c.azdo.base_uri)/_apis/git/repositories/$($_c.azdo.repository)?api-version=7.0" -TimeoutSec 10
        Print_Status "OK - Repository '$($repoResponse.name)' accessible"
        $checks += @{ name = "Azure DevOps"; ok = $true; detail = $repoResponse.name }
    } catch {
        $azdoStatus = $_.Exception.Response.StatusCode.value__
        if ($azdoStatus -eq 401 -or $azdoStatus -eq 403) {
            Print_Error "PAT expired or unauthorized (HTTP $azdoStatus)"
            Print_Text "  -> Regenerate your PAT in Azure DevOps > User Settings > Personal Access Tokens"
            Print_Text "  -> Required scopes: Code (Read & Write), Work Items (Read), Build (Read)"
            $checks += @{ name = "Azure DevOps"; ok = $false; detail = "PAT expired (HTTP $azdoStatus)" }
        } elseif ($azdoStatus -eq 404) {
            Print_Error "Repository '$($_c.azdo.repository)' not found (HTTP 404)"
            Print_Text "  -> Check repository name in config. Current: '$($_c.azdo.repository)'"
            Print_Text "  -> Project URL: $($_c.azdo.base_uri)"
            $checks += @{ name = "Azure DevOps"; ok = $false; detail = "repo not found (404)" }
        } elseif ($azdoStatus) {
            Print_Error "Azure DevOps API error (HTTP $azdoStatus): $($_.Exception.Message)"
            $checks += @{ name = "Azure DevOps"; ok = $false; detail = "HTTP $azdoStatus" }
        } else {
            Print_Error "Cannot reach Azure DevOps: $($_.Exception.Message)"
            Print_Text "  -> Check your network/VPN connection"
            $checks += @{ name = "Azure DevOps"; ok = $false; detail = "unreachable: $($_.Exception.Message)" }
        }
    }
} else {
    Print_Warning "No PAT configured"
    $checks += @{ name = "Azure DevOps"; ok = $false; detail = "no PAT" }
}

# ── 6. IIS AppPool ──
Print_Title "IIS Application Pools"
Print_Text "Querying IIS application pools..."
try {
    $iisProc = Start-Process -FilePath "powershell" -ArgumentList '-NoProfile', '-Command', '"Import-Module WebAdministration; Get-ChildItem IIS:\AppPools | Select-Object Name, State | Format-Table -AutoSize | Out-String"' -PassThru -NoNewWindow -RedirectStandardOutput "$RootPath\$($Paths.IISAppPoolOutput)" -RedirectStandardError "$RootPath\$($Paths.IISAppPoolError)" -ErrorAction Stop
    $finished = $iisProc.WaitForExit(15000) # 15s timeout
    if (-not $finished) {
        $iisProc.Kill()
        Print_Warning "IIS AppPool query timed out after 15s"
        $checks += @{ name = "IIS AppPools"; ok = $true; detail = "timed out" }
    } else {
        $appPools = Get-Content "$RootPath\$($Paths.IISAppPoolOutput)" -Raw -ErrorAction SilentlyContinue
        if ($appPools) {
            Write-Host $appPools
            $checks += @{ name = "IIS AppPools"; ok = $true; detail = "listed" }
        } else {
            Print_Warning "Could not list IIS AppPools (run DONUT as administrator)"
            $checks += @{ name = "IIS AppPools"; ok = $true; detail = "skipped (no admin)" }
        }
    }
    Remove-Item "$RootPath\$($Paths.IISAppPoolOutput)" -ErrorAction SilentlyContinue
    Remove-Item "$RootPath\$($Paths.IISAppPoolError)" -ErrorAction SilentlyContinue
} catch {
    Print_Warning "IIS not available: $($_.Exception.Message)"
    $checks += @{ name = "IIS AppPools"; ok = $false; detail = "not available: $($_.Exception.Message)" }
}

# ── 7. VPN / Parent site connectivity ──
if ($_c.local.parent_site -match "https?://([^/]+)") {
    $parentHost = $Matches[1]
    Print_Title "VPN / Parent Site"
    Print_Text "Checking connectivity to $parentHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($parentHost)
        Print_Status "OK - $parentHost is reachable"
        $checks += @{ name = "VPN"; ok = $true; detail = "$parentHost reachable" }
    } catch {
        Print_Warning "Cannot reach $parentHost — VPN may not be connected"
        $checks += @{ name = "VPN"; ok = $false; detail = "VPN disconnected?" }
    }
}

# ── 8. Disk space ──
Print_Title "Disk Space"
$drive = (Split-Path $_c.local.site_path -Qualifier)
$disk = Get-PSDrive ($drive -replace ':', '') -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.Free / 1GB, 1)
    $totalGB = [math]::Round(($disk.Used + $disk.Free) / 1GB, 1)
    $pct = [math]::Round($disk.Free / ($disk.Used + $disk.Free) * 100)
    if ($freeGB -lt 5) {
        Print_Warning "Low disk space: ${freeGB} GB free / ${totalGB} GB ($pct%)"
        $checks += @{ name = "Disk space"; ok = $false; detail = "${freeGB} GB free" }
    } else {
        Print_Status "OK - ${freeGB} GB free / ${totalGB} GB ($pct%)"
        $checks += @{ name = "Disk space"; ok = $true; detail = "${freeGB} GB free" }
    }
}

# ── Summary ──
$okCount = @($checks | Where-Object { $_.ok }).Count
$failCount = @($checks | Where-Object { -not $_.ok }).Count

if ($env:DONUT_GUI -eq "1") {
    # Emit structured card for DONUT GUI
    $cardData = @{
        checks = @($checks | ForEach-Object { @{ name = $_.name; ok = $_.ok; detail = $_.detail } })
        passed = $okCount
        failed = $failCount
    }
    $json = $cardData | ConvertTo-Json -Depth 3 -Compress
    Write-Host "[CARD:health]$json[/CARD]"
} elseif ($UseGum) {
    $summaryLines = $checks | ForEach-Object {
        $icon = if ($_.ok) { "OK" } else { "FAIL" }
        "  [$icon] $($_.name): $($_.detail)"
    }
    $borderColor = if ($failCount -eq 0) { "10" } else { "214" }
    gum style --border rounded --border-foreground $borderColor --padding "0 2" --foreground 252 --bold "Health Check: $okCount passed, $failCount failed" ($summaryLines -join "`n")
} else {
    Print_SubTitle "Summary: $okCount passed, $failCount failed"
    foreach ($check in $checks) {
        $icon = if ($check.ok) { "OK  " } else { "FAIL" }
        if ($check.ok) {
            Print_SubTitle "  [$icon] $($check.name): $($check.detail)"
        } else {
            Print_Error "  [$icon] $($check.name): $($check.detail)"
        }
    }
}
