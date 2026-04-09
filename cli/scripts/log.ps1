[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Import-Module -Name "$RootPath\cli\modules\paths" -Force
Import-Module -Name "$RootPath\cli\modules\print" -Force

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)
$IsGUI = $env:DONUT_GUI -eq "1"

$LogsDir = "$RootPath\$($Paths.LogsDir)"

if (-not (Test-Path $LogsDir)) {
    Print_Warning "No logs directory found."
    Print_Text "Logs are created when you run scripts. Run a script first."
    exit 0
}

# Exclude DONUT internal logs (donut.YYYY-MM-DD.log)
$logFiles = @(Get-ChildItem -Path $LogsDir -Filter "*.log" -File |
    Where-Object { $_.Name -notmatch '^donut\.' } |
    Sort-Object LastWriteTime -Descending)

if ($logFiles.Count -eq 0) {
    Print_Warning "No log files found."
    Print_Text "Logs are created when you run scripts. Run a script first."
    exit 0
}

# Parse log file info
function ParseLogInfo($file) {
    $name = $file.BaseName
    $parts = $name -split '_', 2
    $scriptName = $parts[0]
    $timestamp = ""
    if ($parts.Count -gt 1 -and $parts[1] -match '^\d+$') {
        try {
            $epoch = [long]$parts[1]
            $date = [DateTimeOffset]::FromUnixTimeSeconds($epoch).LocalDateTime
            $timestamp = $date.ToString("yyyy-MM-dd HH:mm")
        } catch { $timestamp = $parts[1] }
    }
    $sizeKB = [math]::Round($file.Length / 1KB, 1)

    $lastLine = Get-Content $file.FullName -Tail 1 -ErrorAction SilentlyContinue
    $result = "?"
    if ($lastLine -match 'exit code:\s*(\d+)') {
        $code = $Matches[1]
        $result = if ($code -eq "0") { "OK" } else { "FAILED" }
    }

    return @{ Script = $scriptName; Date = $timestamp; Size = $sizeKB; Result = $result; File = $file }
}

if ($IsGUI) {
    Print_Script_Title "SESSION LOGS"
    Print_Text "$($logFiles.Count) session(s) found"

    # Chronological order: oldest first, most recent at the bottom (natural scroll)
    $shown = [Math]::Min($logFiles.Count, 20)
    $subset = @($logFiles | Select-Object -First $shown)
    [array]::Reverse($subset)

    foreach ($file in $subset) {
        $info = ParseLogInfo $file
        if ($info.Size -lt 0.1) { continue }

        $resultHtml = if ($info.Result -eq "OK") { "OK" } elseif ($info.Result -eq "FAILED") { "FAILED" } else { "" }
        $extra = "$resultHtml  $($info.Size)KB"

        Write-Host "[SECTION:$($info.Script.ToUpper()) - $($info.Date)] $extra"

        $content = Get-Content $info.File.FullName -ErrorAction SilentlyContinue
        if ($content) {
            # Sanitize lines: strip terminal-triggering prefixes
            $clean = @()
            foreach ($line in $content) {
                if ($line -match '^---\s*exit code') { continue }
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $line = $line -replace '^\[(TITLE|STATUS|END|ERR|WARN|SUB)\] ', ''
                $line = $line -replace '^\[SECTION[:\]].*', ''
                $line = $line -replace '^\[/SECTION\]', ''
                if ($line -match '^DIFF\s') { $line = "  $line" }
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $clean += $line
            }

            if ($clean.Count -le 60) {
                # Short log: show everything
                foreach ($line in $clean) { Write-Host $line }
            } else {
                # Long log: prioritize errors/warnings + show the tail (result is at the end)
                $important = @()
                $tail = @($clean | Select-Object -Last 30)

                # Collect ERR/WARN/Exception lines not already in tail
                $tailSet = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($t in $tail) { $tailSet.Add($t) | Out-Null }

                foreach ($line in $clean) {
                    if ($tailSet.Contains($line)) { continue }
                    if ($line -match 'ERR|WARN|Exception|FAIL|error|warning' -and $line -notmatch 'erroraction|ErrorActionPreference|0 error|0 warning') {
                        $important += $line
                    }
                }

                # Show: first 5 lines (context) + important lines + tail
                $head = @($clean | Select-Object -First 5)
                foreach ($line in $head) { Write-Host $line }

                if ($important.Count -gt 0) {
                    Write-Host "--- errors/warnings ---"
                    $maxImportant = [Math]::Min($important.Count, 15)
                    for ($k = 0; $k -lt $maxImportant; $k++) {
                        Write-Host $important[$k]
                    }
                    if ($important.Count -gt $maxImportant) {
                        Write-Host "... ($($important.Count - $maxImportant) more)"
                    }
                }

                $skipped = $clean.Count - $head.Count - $tail.Count
                if ($skipped -gt 0) {
                    Write-Host "--- ... $skipped lines skipped ... ---"
                }
                foreach ($line in $tail) { Write-Host $line }
            }
        }

        Write-Host "[/SECTION]"
    }
} elseif ($UseGum) {
    $choices = $logFiles | ForEach-Object {
        $info = ParseLogInfo $_
        "$($info.Script) | $($info.Date) | $($info.Size)KB | $($info.Result)"
    }
    $selected = $choices | gum choose --header "Select a log file to view"
    if (-not $selected) { exit 0 }

    $idx = [array]::IndexOf($choices, $selected)
    $content = Get-Content -Path $logFiles[$idx].FullName -Raw
    $content | gum pager --soft-wrap
} else {
    Write-Host "Available log files:" -ForegroundColor Magenta
    for ($i = 0; $i -lt [Math]::Min($logFiles.Count, 10); $i++) {
        $info = ParseLogInfo $logFiles[$i]
        Write-Host "  $($i+1). $($info.Script) | $($info.Date) | $($info.Result)"
    }
    $choice = Read-Host "Select [1]"
    $idx = if ($choice) { [int]$choice - 1 } else { 0 }

    Get-Content -Path $logFiles[$idx].FullName | Write-Host
}
