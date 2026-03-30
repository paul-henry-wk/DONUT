
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "ROLLBACK"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$repoPath = $_c.local.repository

if (-not (Test-Path $repoPath)) {
    throw "Repository not found at '$repoPath'. Run pull-force first."
}

# ── Show recent commits ──
Print_Title "Recent commits on current branch"
$branch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>$null
Print_Text "Branch: $branch"
Write-Host

$commits = @(git -C "$repoPath" log --oneline -10 2>$null)
if ($commits.Count -eq 0) {
    Print_Warning "No commits found."
    exit 0
}

foreach ($c in $commits) {
    Write-Host "  $c"
}
Write-Host

# ── Select rollback target ──
if ($env:DONUT_GUI -eq "1") {
    # In DONUT GUI: rollback to the previous commit (1 commit back)
    if ($commits.Count -lt 2) {
        Print_Warning "Not enough commits to rollback."
        exit 0
    }
    Print_Text "DONUT GUI: rolling back to previous commit"
    $commitHash = ($commits[1] -split ' ')[0]
} elseif ($UseGum) {
    $selected = $commits | gum choose --header "Select commit to rollback to (will undo everything after)"
    if (-not $selected) {
        Print_Warning "Rollback cancelled."
        exit 0
    }
    $commitHash = ($selected -split ' ')[0]
} else {
    for ($i = 0; $i -lt $commits.Count; $i++) {
        Write-Host "  $($i+1). $($commits[$i])"
    }
    $choice = Read-Host "Rollback to which commit? [number]"
    if (-not $choice) {
        Print_Warning "Rollback cancelled."
        exit 0
    }
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $commits.Count) {
        throw "Invalid choice."
    }
    $commitHash = ($commits[$idx] -split ' ')[0]
}

Print_Text "Selected: $commitHash"

# ── Confirm ──
$commitsBetween = @(git -C "$repoPath" log --oneline "$commitHash..HEAD" 2>$null)
Print_Warning "This will undo $($commitsBetween.Count) commit(s):"
foreach ($c in $commitsBetween) {
    Print_Error "  - $c"
}
Write-Host

if ($env:DONUT_GUI -eq "1") {
    Print_Text "Auto-confirmed rollback (DONUT GUI)"
} elseif ($UseGum) {
    gum confirm "Are you sure? This creates a revert commit (safe, non-destructive)." --default=No
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "Rollback cancelled."
        exit 0
    }
} else {
    $answer = Read-Host "Are you sure? (Y/N)"
    if ($answer -ne 'Y' -and $answer -ne 'y') {
        Print_Warning "Rollback cancelled."
        exit 0
    }
}

# ── Create a revert (safe approach: new commit that undoes changes) ──
Print_Title "Rolling back to $commitHash"
Print_Text "Calculating diff and applying rollback..."

# Get the diff and apply it reversed
$patchResult = git -C "$repoPath" diff "$commitHash..HEAD" 2>$null
if (-not $patchResult) {
    Print_Status "No differences found. Nothing to rollback."
    exit 0
}

# Reset working directory to the target commit's state, then commit
$checkoutResult = git -C "$repoPath" checkout $commitHash -- . 2>&1
Write-Host $checkoutResult
if ($LASTEXITCODE -ne 0) {
    Print_Error "Failed to checkout files from $commitHash (exit code $LASTEXITCODE): $checkoutResult"
    Print_Text "The commit hash may be invalid or the working directory may have conflicts."
    throw "git checkout $commitHash failed"
}

$addResult = git -C "$repoPath" add -A 2>&1
if ($LASTEXITCODE -ne 0) {
    Print_Error "Failed to stage changes (exit code $LASTEXITCODE): $addResult"
    throw "git add failed"
}

$hasChanges = git -C "$repoPath" diff --cached --quiet 2>$null; $hasChanges = $LASTEXITCODE -ne 0
if ($hasChanges) {
    $commitResult = git -C "$repoPath" commit -m "Rollback to $commitHash (undo $($commitsBetween.Count) commit(s))" 2>&1
    Write-Host $commitResult
    if ($LASTEXITCODE -ne 0) {
        Print_Error "Failed to create rollback commit (exit code $LASTEXITCODE): $commitResult"
        throw "git commit failed during rollback"
    }
    Print_Status "Rollback commit created."
    Print_Text "The rollback is a new commit — previous history is preserved."
    Print_Text "Push when ready: git push"
} else {
    Print_Status "No effective changes after rollback."
}

Write-Host
