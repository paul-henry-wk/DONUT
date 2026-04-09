
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json",
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

# In GUI mode, confirmation is handled by the frontend danger dialog

Print_Script_Title "CLEANUP$(if ($DryRun) { ' (preview)' })"
Print_Text "Sweeping crumbs off the counter..."

Print_Title "Loading Configuration"
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false
Print_Status "Environment: $EnvFile"

$items = @()

# ── 1. Scan old .enzp commits ──
Print_Title "Old Commits"
$commitsPath = "$($_c.local.repository)\Commits"
if (Test-Path $commitsPath) {
    $enzpFiles = @(Get-ChildItem "$commitsPath\*.enzp" -File -ErrorAction SilentlyContinue)
    if ($enzpFiles.Count -gt 0) {
        $size = ($enzpFiles | Measure-Object -Property Length -Sum).Sum
        foreach ($f in $enzpFiles) {
            $items += @{ Type = "commit"; Path = $f.FullName; Name = $f.Name; Size = $f.Length }
        }
        Print_Text "$($enzpFiles.Count) .enzp file(s) ($([math]::Round($size / 1KB)) KB)"
    } else {
        Print_Text "Commits folder is already clean."
    }
} else {
    Print_Text "No commits folder found."
}

# ── 2. Scan DONUT temp files (.bin/) ──
Print_Title "Temp Files"
$binDir = "$RootPath\$($Paths.BinDir)"
if (Test-Path $binDir) {
    $tempPatterns = @("*.tmp", "*.err", "*_error.txt")
    $tempFiles = @()
    foreach ($pattern in $tempPatterns) {
        $tempFiles += @(Get-ChildItem "$binDir\$pattern" -File -ErrorAction SilentlyContinue)
    }
    $cookies = @(Get-ChildItem "$binDir\local_site_*_session.json" -File -ErrorAction SilentlyContinue)
    $tempFiles += $cookies

    if ($tempFiles.Count -gt 0) {
        foreach ($f in $tempFiles) {
            $items += @{ Type = "temp"; Path = $f.FullName; Name = $f.Name; Size = $f.Length }
        }
        $size = ($tempFiles | Measure-Object -Property Length -Sum).Sum
        Print_Text "$($tempFiles.Count) temp file(s) ($([math]::Round($size / 1KB)) KB)"
    } else {
        Print_Text "No temp files to clean."
    }
} else {
    Print_Text "No .bin directory found."
}

# ── 3. Scan old logs (keep last 10) ──
Print_Title "Old Logs"
$logsDir = "$RootPath\$($Paths.LogsDir)"
if (Test-Path $logsDir) {
    $logFiles = @(Get-ChildItem "$logsDir\*.log" -File | Sort-Object LastWriteTime -Descending)
    if ($logFiles.Count -gt 10) {
        $toRemove = @($logFiles | Select-Object -Skip 10)
        foreach ($f in $toRemove) {
            $items += @{ Type = "log"; Path = $f.FullName; Name = $f.Name; Size = $f.Length }
        }
        $size = ($toRemove | Measure-Object -Property Length -Sum).Sum
        Print_Text "$($toRemove.Count) old log(s) ($([math]::Round($size / 1KB)) KB) — keeping last 10"
    } else {
        Print_Text "Only $($logFiles.Count) log file(s) — nothing to clean."
    }
} else {
    Print_Text "No logs directory found."
}

# ── 4. Scan git clone temp files ──
Print_Title "Git Temp Files"
$gitTempFiles = @(Get-ChildItem "$RootPath\_git_clone_err.tmp" -ErrorAction SilentlyContinue)
$enzpTemp = @(Get-ChildItem "$env:TEMP\donut_enzp_*" -ErrorAction SilentlyContinue)
$gitTempFiles += $enzpTemp
if ($gitTempFiles.Count -gt 0) {
    foreach ($f in $gitTempFiles) {
        $items += @{ Type = "git-temp"; Path = $f.FullName; Name = $f.Name; Size = $f.Length }
    }
    Print_Text "$($gitTempFiles.Count) git temp file(s)"
} else {
    Print_Text "No git temp files found."
}

# ── Summary table ──
$totalSize = ($items | Measure-Object -Property Size -Sum).Sum
if (-not $totalSize) { $totalSize = 0 }

if ($items.Count -eq 0) {
    Write-Host
    Print_Status "Everything is already clean. Nothing to do."
    exit 0
}

Write-Host
Print_Title "Cleanup Summary"

# Display items grouped by type
$grouped = $items | Group-Object -Property Type
foreach ($group in $grouped) {
    $label = switch ($group.Name) {
        "commit"   { "Commits (.enzp)" }
        "temp"     { "Temp files" }
        "log"      { "Old logs" }
        "git-temp" { "Git temp" }
    }
    $groupSize = ($group.Group | Measure-Object -Property Size -Sum).Sum
    Print_SubTitle "  $label ($($group.Count) file(s), $([math]::Round($groupSize / 1KB)) KB)"
    foreach ($item in $group.Group) {
        Print_Text "    $($item.Name)"
    }
}

Write-Host
$sizeKB = [math]::Round($totalSize / 1KB)
Print_Text "Total: $($items.Count) file(s), $sizeKB KB to free"

# ── Dry-run mode: stop here ──
if ($DryRun) {
    Write-Host
    Print_Status "Preview complete. $($items.Count) file(s) ($sizeKB KB) will be cleaned."
    exit 0
}

# ── Execute cleanup ──
Print_Title "Cleaning"
$cleaned = 0
$freedBytes = 0
foreach ($item in $items) {
    try {
        Remove-Item $item.Path -Force -ErrorAction Stop
        $cleaned++
        $freedBytes += $item.Size
    } catch {
        Print_Warning "Could not remove: $($item.Name) — $($_.Exception.Message)"
    }
}

Write-Host
Print_Status "Cleanup complete: $cleaned file(s) removed, $([math]::Round($freedBytes / 1KB)) KB freed."
