[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

# ══════════════════════════════════════════════════════════════════
# ADMINISTRATOR CHECK
# ══════════════════════════════════════════════════════════════════

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Print_Error "This script must be run as Administrator."
    Print_Text "  -> WizManager, IIS, and SQL Server operations require elevated privileges."
    Print_Text "  -> Right-click PowerShell or DONUT and select 'Run as Administrator'."
    throw "Administrator privileges are required."
}

Print_Script_Title "INSTALL SITE"

# ── Load Config ──
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$SitePath   = $_c.local.site_path
$SiteId     = $_c.local.site_id
$EnaPath    = $_c.local.ena_path
$DbUser     = $_c.local.db_user
$DbPassword = $_c.local.db_password

# Override from wizard (environment variables set by DONUT GUI)
if ($env:DONUT_OVERRIDE_ENA_PATH) {
    $_c.local.ena_path = $env:DONUT_OVERRIDE_ENA_PATH
    $EnaPath = $env:DONUT_OVERRIDE_ENA_PATH
    Print_Text "  (ENA path from wizard: $EnaPath)"
}
if ($env:DONUT_OVERRIDE_SITE_PATH) {
    $_c.local.site_path = $env:DONUT_OVERRIDE_SITE_PATH
    $SitePath = $env:DONUT_OVERRIDE_SITE_PATH
    $SiteId = Split-Path $SitePath -Leaf
    Print_Text "  (Site path from wizard: $SitePath)"
}

# ── Derive install directory (2 levels up from site path) ──
# Example: C:\Enablon\Instance1013\Sites\WizGRC.10.13 → C:\Enablon\Instance1013
$SitesDir   = Split-Path $SitePath -Parent
$InstallDir = Split-Path $SitesDir -Parent
$WizManager = "$InstallDir\Binary\WizManager.exe"
$LogsDir    = "$InstallDir\Logs"

Print_SubTitle "Site ID:       $SiteId"
Print_SubTitle "Site path:     $SitePath"
Print_SubTitle "Install dir:   $InstallDir"
Print_SubTitle "ENA archive:   $EnaPath"

# ── Timeout configuration (seconds, 0 = no timeout) ──
$WizManagerTimeoutSec = if ($env:DONUT_WIZMGR_TIMEOUT) { [int]$env:DONUT_WIZMGR_TIMEOUT } else { 0 }

# ══════════════════════════════════════════════════════════════════
# VALIDATIONS
# ══════════════════════════════════════════════════════════════════

# 1. ENA path must be set
if (-not $EnaPath) {
    Print_Error "No ENA archive path configured."
    Print_Text "  -> Go to Config > step 1 > 'ENA archive path' and select your .ENA file."
    throw "ena_path is required. Set it in your .env.json configuration."
}

# 2. ENA file must exist
if (-not (Test-Path $EnaPath)) {
    Print_Error "ENA archive not found: '$EnaPath'"
    Print_Text "  -> Check the path in Config > 'ENA archive path'."
    Print_Text "  -> Make sure the file has not been moved or deleted."
    throw "ENA file does not exist: $EnaPath"
}

# 3. ENA must have the right extension
if ($EnaPath -inotmatch '\.ena$') {
    Print_Warning "File '$EnaPath' does not have a .ena extension. Proceeding anyway..."
}

# 4. WizManager must exist
if (-not (Test-Path $WizManager)) {
    Print_Error "WizManager.exe not found at '$WizManager'"
    Print_Text "  -> Expected location: $InstallDir\Binary\WizManager.exe"
    Print_Text "  -> Ensure Enablon Application Server is installed at '$InstallDir'."
    Print_Text "  -> The install directory is derived from site_path: 2 levels up."
    Print_Text "     site_path:    $SitePath"
    Print_Text "     install_dir:  $InstallDir"
    throw "WizManager.exe not found. Install Enablon Application Server or fix site_path."
}

# 5. Check IIS is installed and running
Print_Title "Checking IIS service"
$w3svc = Get-Service -Name 'W3SVC' -ErrorAction SilentlyContinue
if (-not $w3svc) {
    Print_Error "IIS (W3SVC service) is not installed."
    Print_Text "  -> Install IIS via 'Turn Windows features on or off' or:"
    Print_Text "     Install-WindowsFeature -Name Web-Server -IncludeManagementTools"
    throw "IIS is not installed. WizManager requires IIS to create the site."
} elseif ($w3svc.Status -ne 'Running') {
    Print_Warning "IIS (W3SVC) is installed but not running (status: $($w3svc.Status))."
    Print_Text "  -> Starting W3SVC..."
    try {
        Start-Service -Name 'W3SVC'
        Print_Status "W3SVC started"
    } catch {
        Print_Error "Failed to start W3SVC: $($_.Exception.Message)"
        throw "IIS service could not be started."
    }
} else {
    Print_Status "IIS (W3SVC) is running"
}

# 6. Check if site already exists — backup config before overwrite
if (Test-Path $SitePath) {
    Print_Warning "Site directory already exists at '$SitePath'."
    Print_Text "  -> The existing site will be OVERWRITTEN by WizManager (/overwrite all)."

    # Backup important config files before overwrite
    $backupDir = "$SitePath\.backup-before-install-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    $filesToBackup = @(
        "$SitePath\web.config"
        "$SitePath\connectionStrings.config"
        "$SitePath\appSettings.config"
    )
    $backedUp = @()
    foreach ($file in $filesToBackup) {
        if (Test-Path $file) { $backedUp += $file }
    }
    if ($backedUp.Count -gt 0) {
        New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
        foreach ($file in $backedUp) {
            Copy-Item -Path $file -Destination $backupDir -Force
        }
        Print_Status "Backed up $($backedUp.Count) config file(s) to $backupDir"
        foreach ($file in $backedUp) {
            Print_Text "    $(Split-Path $file -Leaf)"
        }
    }
}

# 7. Verify SQL Server connectivity
Print_Title "Checking SQL Server connectivity"
$sqlOk = $false
try {
    if (Get-Command 'Sqlcmd' -ErrorAction SilentlyContinue) {
        $result = & Sqlcmd -S "(local)" -U $DbUser -P $DbPassword -Q "SELECT 1" -h -1 -W -t 5 -l 5 2>&1
        if ($LASTEXITCODE -eq 0) { $sqlOk = $true }
    } elseif (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
        Invoke-Sqlcmd -ServerInstance "(local)" -Username $DbUser -Password $DbPassword -Query "SELECT 1" -QueryTimeout 5 -ConnectionTimeout 5 | Out-Null
        $sqlOk = $true
    }
} catch {}

if ($sqlOk) {
    Print_Status "SQL Server is reachable (user: $DbUser)"
} else {
    Print_Warning "Cannot connect to SQL Server (local) with user '$DbUser'."
    Print_Text "  -> WizManager may fail if SQL auth is incorrect."
    Print_Text "  -> Check db_user and db_password in Config."
}

# 8. Check available disk space (ENA files can be large)
Print_Title "Checking disk space"
$drive = (Split-Path $InstallDir -Qualifier)
$disk = Get-PSDrive ($drive -replace ':', '') -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.Free / 1GB, 1)
    $enaSize = (Get-Item $EnaPath).Length
    $enaSizeGB = [math]::Round($enaSize / 1GB, 1)
    Print_Text "ENA size: ${enaSizeGB} GB | Free on ${drive}: ${freeGB} GB"
    # ENA extraction can require ~3x the archive size
    if ($disk.Free -lt ($enaSize * 3)) {
        Print_Warning "Low disk space! ENA extraction may require ~${([math]::Round($enaSize * 3 / 1GB, 1))} GB."
        Print_Text "  -> Free up space on $drive or install to a different drive."
    } else {
        Print_Status "Disk space OK"
    }
} else {
    Print_Text "Could not check disk space for drive $drive"
}

# ══════════════════════════════════════════════════════════════════
# INSTALLATION
# ══════════════════════════════════════════════════════════════════

# Helper: display recent WizManager log tail on error/warning/timeout
function Show-WizManagerLogs {
    param(
        [string] $LogsDir,
        [string] $Label = "error"
    )
    if (-not (Test-Path $LogsDir)) { return }

    $recentLog = Get-ChildItem -Path $LogsDir -Filter "*.log" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($recentLog) {
        Print_Text ""
        Print_SubTitle "Last WizManager log ($Label): $($recentLog.Name)"
        $tail = Get-Content $recentLog.FullName -Tail 30 -ErrorAction SilentlyContinue
        if ($tail) {
            foreach ($line in $tail) {
                Print_Text "  | $line"
            }
        }
        Print_Text "  -> Full log: $($recentLog.FullName)"
    }
}

Print_Title "Installing site '$SiteId' from ENA archive"
Print_Text "Command: WizManager.exe /quiet /nocheck /nostop /exitcode /add `"$EnaPath|$SiteId`" /addas /overwrite all"
if ($WizManagerTimeoutSec -gt 0) {
    Print_Text "Timeout: $WizManagerTimeoutSec seconds"
} else {
    Print_Text "Timeout: none (set DONUT_WIZMGR_TIMEOUT env var in seconds to add one)"
}
Print_Text ""

# Run WizManager with elapsed time display
$startTime = Get-Date

$process = Start-Process -FilePath $WizManager `
    -ArgumentList "/quiet", "/nocheck", "/nostop", "/exitcode", "/add", "`"$EnaPath|$SiteId`"", "/addas", "/overwrite", "all" `
    -PassThru -NoNewWindow

# Wait with progress indicator and optional timeout
$timedOut = $false
while (-not $process.HasExited) {
    $elapsed = (Get-Date) - $startTime
    $elapsedStr = "{0:mm\:ss}" -f $elapsed
    Write-Host "`r  Elapsed: $elapsedStr — WizManager running..." -NoNewline

    # Check timeout
    if ($WizManagerTimeoutSec -gt 0 -and $elapsed.TotalSeconds -ge $WizManagerTimeoutSec) {
        $timedOut = $true
        Print_Text ""
        Print_Error "WizManager exceeded timeout of $WizManagerTimeoutSec seconds."
        Print_Text "  -> Killing WizManager process (PID: $($process.Id))..."
        try {
            $process.Kill()
            $process.WaitForExit(5000) | Out-Null
        } catch {
            Print_Warning "Could not kill WizManager: $($_.Exception.Message)"
        }
        break
    }

    Start-Sleep -Seconds 2
}
Write-Host ""

$duration = (Get-Date) - $startTime
$durationStr = "{0:mm\:ss}" -f $duration

if ($timedOut) {
    Print_Text "WizManager was terminated after timeout (duration: $durationStr)"
    # Show recent logs on timeout
    Show-WizManagerLogs -LogsDir $LogsDir -Label "timeout"
    throw "WizManager timed out after $WizManagerTimeoutSec seconds."
}

$exitCode = $process.ExitCode
Print_Text ""
Print_Text "WizManager exited with code $exitCode (duration: $durationStr)"

switch ($exitCode) {
    0 {
        Print_Status "WizManager: installation completed successfully (NoError)"
    }
    1 {
        Print_Warning "WizManager: installation completed with warnings"
        Show-WizManagerLogs -LogsDir $LogsDir -Label "warnings"
    }
    2 {
        Print_Error "WizManager: installation failed with a script error"
        Show-WizManagerLogs -LogsDir $LogsDir -Label "error"
        throw "WizManager installation failed (exit code 2: Error)"
    }
    3 {
        Print_Error "WizManager: installation was aborted"
        Show-WizManagerLogs -LogsDir $LogsDir -Label "abort"
        throw "WizManager installation aborted (exit code 3: Abort)"
    }
    default {
        Print_Warning "WizManager: unexpected exit code $exitCode"
        Show-WizManagerLogs -LogsDir $LogsDir -Label "unexpected"
    }
}

# ══════════════════════════════════════════════════════════════════
# POST-INSTALLATION CHECKS
# ══════════════════════════════════════════════════════════════════

# Verify site directory was created
Print_Title "Post-installation checks"
$siteExists = $false
if (Test-Path $SitePath) {
    Print_Status "Site directory exists: $SitePath"
    $siteExists = $true
} else {
    Print_Warning "Site directory not found at '$SitePath' after installation."
    Print_Text "  -> WizManager may have used a different SiteID."
    Print_Text "  -> Check installed sites in $SitesDir"
    if (Test-Path $SitesDir) {
        $installed = Get-ChildItem $SitesDir -Directory | Select-Object -ExpandProperty Name
        Print_Text "  -> Found sites: $($installed -join ', ')"
    }
}

# Verify database was created
Print_Title "Verifying database"
$dbExists = $false
try {
    if (Get-Command 'Sqlcmd' -ErrorAction SilentlyContinue) {
        $dbCheck = & Sqlcmd -S "(local)" -U $DbUser -P $DbPassword -Q "SELECT DB_ID('$SiteId')" -h -1 -W -t 5 -l 5 2>&1
        if ($dbCheck -match '\d+') {
            Print_Status "Database '$SiteId' exists"
            $dbExists = $true
        } else {
            Print_Warning "Database '$SiteId' not found. WizManager may have used a different name."
        }
    }
} catch {
    Print_Text "Could not verify database (non-critical): $($_.Exception.Message)"
}

# Generate site config (auth service)
Print_Title "Generating site config (auth service)"
try {
    & $WizManager /generateSiteConfig $SiteId
    if ($LASTEXITCODE -eq 0) {
        Print_Status "Site config generated"
    } else {
        Print_Warning "generateSiteConfig returned exit code $LASTEXITCODE"
    }
} catch {
    Print_Warning "generateSiteConfig failed: $($_.Exception.Message)"
    Print_Text "  -> This is optional and can be done later."
}

# Recycle app pool to apply changes
Print_Title "Recycling IIS Application Pool"
try {
    & $WizManager /recycleapppool $SiteId
    if ($LASTEXITCODE -eq 0) {
        Print_Status "AppPool recycled for '$SiteId'"
    } else {
        Print_Warning "recycleapppool returned exit code $LASTEXITCODE"
    }
} catch {
    Print_Warning "AppPool recycle failed: $($_.Exception.Message)"
    Print_Text "  -> Try running 'iisreset' manually as administrator."
}

# ══════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════

$summary = @{
    success       = ($exitCode -le 1)
    exit_code     = $exitCode
    site_id       = $SiteId
    site_path     = $SitePath
    site_exists   = $siteExists
    db_exists     = $dbExists
    duration      = $durationStr
    ena_path      = $EnaPath
}

# Expose summary as JSON env var for DONUT GUI consumption
$env:DONUT_INSTALL_RESULT = ($summary | ConvertTo-Json -Compress)

Print_Script_End "Install Site completed. Site '$SiteId' is ready." -Links @("http://localhost/$SiteId")
Print_Text ""
Print_Text "  Next steps:"
Print_Text "    1. Run 'Setup Local Auth' to configure the admin account & developer password"
Print_Text "    2. Run 'Set Master Packages' to configure packages"
Print_Text "    3. Open http://localhost/$SiteId in a browser to verify the site"
