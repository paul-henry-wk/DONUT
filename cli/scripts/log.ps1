[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module -Name "$RootPath\cli\modules\paths" -Force
$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

$LogsDir = "$RootPath\$($Paths.LogsDir)"

if (-not (Test-Path $LogsDir)) {
    Write-Host "No logs found in $LogsDir" -ForegroundColor DarkYellow
    exit 0
}

$logFiles = @(Get-ChildItem -Path $LogsDir -Filter "session_*.log" -Name | Sort-Object -Descending)

if ($logFiles.Count -eq 0) {
    Write-Host "No session logs found." -ForegroundColor DarkYellow
    exit 0
}

if ($env:DONUT_GUI -eq "1") {
    # In DONUT GUI, show the most recent log
    $selected = $logFiles[0]
    Write-Host "Showing latest log: $selected" -ForegroundColor Magenta
    Get-Content -Path "$LogsDir\$selected" | Write-Host
} elseif ($UseGum) {
    $selected = $logFiles | gum choose --header "Select a log file to view"
    if (-not $selected) { exit 0 }

    $content = Get-Content -Path "$LogsDir\$selected" -Raw
    $content | gum pager --soft-wrap
} else {
    Write-Host "Available log files:" -ForegroundColor Magenta
    for ($i = 0; $i -lt [Math]::Min($logFiles.Count, 10); $i++) {
        Write-Host "  $($i+1). $($logFiles[$i])"
    }
    $choice = Read-Host "Select [1]"
    $idx = if ($choice) { [int]$choice - 1 } else { 0 }
    $selected = $logFiles[$idx]

    Get-Content -Path "$LogsDir\$selected" | Write-Host
}
