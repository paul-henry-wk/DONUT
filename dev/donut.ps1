#!/usr/bin/env pwsh
# ╔══════════════════════════════════════════════════╗
# ║  DONUT — DevOps Nabsic Unified Tool             ║
# ╚══════════════════════════════════════════════════╝

[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $Script,
    [string] $Message
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path $PSScriptRoot -Parent

# ── Gum check ──
$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)
if (-not $UseGum) {
    Write-Host "gum is not installed. Install it with: winget install charmbracelet.gum" -ForegroundColor Red
    Write-Host "Falling back to classic mode..." -ForegroundColor DarkYellow
    Write-Host
}

# ── Version & Banner ──
$VersionFile = "$RootPath\cli\config\version.json"
$Version = (Get-Content -Raw -Path $VersionFile | ConvertFrom-Json).version

if ($UseGum) {
    gum style --border double --border-foreground 213 --padding "0 2" --foreground 213 --bold `
        "DONUT v$Version" `
        "DevOps Nabsic Unified Tool"
    Write-Host
} else {
    Write-Host
    Write-Host "  DONUT v$Version - DevOps Nabsic Unified Tool" -ForegroundColor Magenta
    Write-Host
}

# ── Auto-update check (non-blocking, 5s timeout) ──
try {
    $currentBranch = git -C "$RootPath" symbolic-ref --short HEAD 2>$null
    if ($currentBranch -eq "main") {
        $localHash = git -C "$RootPath" rev-parse HEAD 2>$null
        # Fetch with timeout to avoid hanging on network issues
        $fetchJob = Start-Job -ScriptBlock { param($p) git -C $p fetch origin main -q 2>$null } -ArgumentList $RootPath
        $null = Wait-Job $fetchJob -Timeout 5
        Remove-Job $fetchJob -Force -ErrorAction SilentlyContinue

        $remoteHash = git -C "$RootPath" rev-parse origin/main 2>$null
        if ($localHash -and $remoteHash -and $localHash -ne $remoteHash) {
            if ($UseGum) {
                gum style --foreground 214 "A new version of DONUT is available."
                gum confirm "Update now?" --default=Yes 2>&1
                if ($LASTEXITCODE -eq 0) {
                    git -C "$RootPath" pull origin main -q
                    if ($UseGum) { gum style --foreground 10 "Updated! Please re-run donut." }
                    else { Write-Host "Updated! Please re-run donut." -ForegroundColor Green }
                    exit 0
                }
            } else {
                Write-Host "A new version of DONUT is available. Run 'git pull' to update." -ForegroundColor DarkYellow
            }
            Write-Host
        }
    }
} catch {
    # Non-critical, silently continue
}

# ── Select environment file ──
if (-not $EnvFile) {
    $envDir = "$RootPath\working-environments"
    $envFiles = @(Get-ChildItem -Path $envDir -Filter ".env*.json" -Name -ErrorAction SilentlyContinue)

    if ($envFiles.Count -eq 0) {
        if ($UseGum) {
            gum style --foreground 214 "No environment file found."
            gum confirm "Create one now with 'donut init'?" --default=Yes
            if ($LASTEXITCODE -eq 0) {
                & "$RootPath\cli\scripts\init.ps1"
                exit $LASTEXITCODE
            }
        } else {
            Write-Host "No environment file found in $envDir" -ForegroundColor Red
            Write-Host "Create a .env.json file. See working-environments/README.md." -ForegroundColor DarkYellow
        }
        exit 1
    } elseif ($envFiles.Count -eq 1) {
        $EnvFile = $envFiles[0]
        if ($UseGum) {
            gum style --faint "Environment: $EnvFile (auto-selected)"
        } else {
            Write-Host "Environment: $EnvFile (auto-selected)"
        }
    } else {
        if ($UseGum) {
            $EnvFile = $envFiles | gum choose --header "Select environment"
            if (-not $EnvFile) { exit 0 }
        } else {
            Write-Host "Available environments:" -ForegroundColor Magenta
            for ($i = 0; $i -lt $envFiles.Count; $i++) {
                Write-Host "  $($i+1). $($envFiles[$i])"
            }
            $choice = Read-Host "Select [1]"
            $idx = if ($choice) { [int]$choice - 1 } else { 0 }
            $EnvFile = $envFiles[$idx]
        }
    }
    Write-Host
}

# ── Show config summary ──
$envPath = "$RootPath\working-environments\$EnvFile"
if (Test-Path $envPath) {
    $cfg = Get-Content -Raw -Path $envPath | ConvertFrom-Json

    if ($UseGum) {
        $summary = @(
            "Branch:   $($cfg.feature_branch) -> $($cfg.target_branch)",
            "Repo:     $($cfg.azdo.repository)",
            "Packages: $(if ($cfg.packages) { $cfg.packages -join ', ' } else { '(none)' })",
            "Site:     $(Split-Path $cfg.local.site_path -Leaf)",
            "Workitem: $(if ($cfg.workitem_id) { '#' + $cfg.workitem_id } else { '(none)' })"
        )
        gum style --border rounded --border-foreground 240 --padding "0 2" --foreground 252 ($summary -join "`n")
        Write-Host
    } else {
        Write-Host "  Branch:   $($cfg.feature_branch) -> $($cfg.target_branch)" -ForegroundColor Cyan
        Write-Host "  Repo:     $($cfg.azdo.repository)" -ForegroundColor Cyan
        Write-Host "  Packages: $(if ($cfg.packages) { $cfg.packages -join ', ' } else { '(none)' })" -ForegroundColor Cyan
        Write-Host
    }
}

# ── Select script ──
$scripts = [ordered]@{
    "1. Set Master Packages"  = @{ script = "set-master-packages"; desc = "Configure master packages on local site" }
    "2. Pull Force"           = @{ script = "pull-force";          desc = "Download & reset site from repository" }
    "3. Reset"                = @{ script = "pull-force";          desc = "Pull Force from scratch (no history)"; extra = "-ForceStartFromScratch `$true" }
    "4. Pull"                 = @{ script = "pull";                desc = "Incremental update without reset" }
    "5. Commit"               = @{ script = "commit";              desc = "Publish changes & create Pull Requests" }
    "──── Tools ────────────" = @{ script = $null }
    "s. Status"               = @{ script = "status";              desc = "Show site, branch, packages & PR status" }
    "d. Diff"                 = @{ script = "diff";                desc = "Preview local changes before commit" }
    "m. Merge"                = @{ script = "merge";               desc = "Merge feature branch into target" }
    "r. Rollback"             = @{ script = "rollback";            desc = "Undo commits (safe revert)" }
    "h. Health Check"         = @{ script = "health-check";        desc = "Deep diagnostic of site, DB, git, APIs" }
    "l. View Logs"            = @{ script = "log";                 desc = "Browse session logs"; noenv = $true }
    "i. Init new environment" = @{ script = "init";                desc = "Create a new .env.json interactively"; noenv = $true }
}

if (-not $Script) {
    if ($UseGum) {
        $choices = $scripts.Keys | Where-Object { $scripts[$_].script } | ForEach-Object { $_ }
        $selected = $choices | gum choose --header "What do you want to do?"
        if (-not $selected) { exit 0 }
    } else {
        Write-Host "What do you want to do?" -ForegroundColor Magenta
        foreach ($key in $scripts.Keys) {
            $info = $scripts[$key]
            if ($info.script) {
                Write-Host "  $key  -  $($info.desc)"
            }
        }
        Write-Host
        $selected = Read-Host "Select"
        if (-not $selected) { exit 0 }
        # Allow number-only input
        $match = $scripts.Keys | Where-Object { $_ -eq $selected -or $_ -match "^$selected\." }
        if ($match) { $selected = $match }
    }
} else {
    $selected = $scripts.Keys | Where-Object { $scripts[$_].script -eq $Script -or $_ -match $Script } | Select-Object -First 1
    if (-not $selected) {
        Write-Host "Unknown script: $Script" -ForegroundColor Red
        exit 1
    }
}

$scriptInfo = $scripts[$selected]
if (-not $scriptInfo.script) { exit 0 }
Write-Host

# ── Special commands that run their own flow ──
if ($scriptInfo.script -eq "init") {
    & "$RootPath\cli\scripts\init.ps1" -EnvFile $EnvFile
    exit $LASTEXITCODE
}
if ($scriptInfo.script -eq "log") {
    & "$RootPath\cli\scripts\log.ps1"
    exit $LASTEXITCODE
}

# ── Commit message (for commit script only) ──
if ($scriptInfo.script -eq "commit" -and -not $Message) {
    if ($UseGum) {
        $Message = gum input --placeholder "Describe your changes..." --header "Commit message" --width 80
        if (-not $Message) {
            Write-Host "Commit message is required." -ForegroundColor Red
            exit 1
        }
    } else {
        $Message = Read-Host "Commit message"
        if (-not $Message) {
            Write-Host "Commit message is required." -ForegroundColor Red
            exit 1
        }
    }
    Write-Host
}

# ── Build arguments ──
$scriptPath = "$RootPath\cli\scripts\$($scriptInfo.script).ps1"
$scriptParams = @{ EnvFile = $EnvFile }
if ($scriptInfo.extra) {
    $scriptParams.ForceStartFromScratch = $true
}
if ($Message) {
    $scriptParams.Message = $Message
}

# ── Execute ──
if ($UseGum) {
    gum style --foreground 10 --bold "Running: $($selected)..."
} else {
    Write-Host "Running: $($selected)..." -ForegroundColor Green
}
Write-Host

try {
    & $scriptPath @scriptParams
} catch {
    Write-Host
    if ($UseGum) {
        gum style --border rounded --border-foreground 196 --padding "0 2" --foreground 196 --bold "ERROR: $_"
    } else {
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    exit 1
}
