
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json",
    [string] $Message
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "MERGE"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$repoPath = $_c.local.repository

if (-not (Test-Path $repoPath)) {
    throw "Repository not found at '$repoPath'. Run pull-force first."
}

$sourceBranch = $_c.feature_branch
$targetBranch = $_c.target_branch

if (-not $sourceBranch -or -not $targetBranch) {
    throw "Both feature_branch and target_branch must be configured."
}

# ── Fetch latest ──
Print_Title "Fetch latest from remote"
Print_Text "Fetching latest changes from remote..."
$fetchOutput = git -C "$repoPath" fetch 2>&1
if ($LASTEXITCODE -ne 0) {
    Print_Error "Git fetch failed: $fetchOutput"
    Print_Text "Check your network connection and git credentials."
    throw "git fetch failed (exit code $LASTEXITCODE): $fetchOutput"
}
Print_Status "Fetched."

# ── Show what will be merged ──
Print_Title "Preview: merge '$sourceBranch' into '$targetBranch'"

$currentBranch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>$null
Print_Text "Current branch: $currentBranch"

$commits = @(git -C "$repoPath" log --oneline "origin/$targetBranch..origin/$sourceBranch" 2>$null)
if ($commits.Count -eq 0) {
    Print_Status "Nothing to merge. '$sourceBranch' is up to date with '$targetBranch'."
    exit 0
}

Print_Text "$($commits.Count) commit(s) to merge:"
foreach ($c in $commits) {
    Write-Host "  $c"
}
Write-Host

# ── Confirm ──
if ($env:DONUT_GUI -eq "1") {
    Print_Text "Auto-confirmed merge (DONUT GUI)"
} elseif ($UseGum) {
    gum confirm "Merge '$sourceBranch' into '$targetBranch'?" --default=No
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "Merge cancelled."
        exit 0
    }
} else {
    $answer = Read-Host "Merge '$sourceBranch' into '$targetBranch'? (Y/N)"
    if ($answer -ne 'Y' -and $answer -ne 'y') {
        Print_Warning "Merge cancelled."
        exit 0
    }
}

# ── Checkout target, merge source ──
Print_Title "Checkout '$targetBranch'"
$checkoutResult = git -C "$repoPath" checkout "$targetBranch" 2>&1
Write-Host $checkoutResult
if ($LASTEXITCODE -ne 0) {
    Print_Error "Failed to checkout '$targetBranch': $checkoutResult"
    Print_Text "Possible causes: uncommitted changes blocking checkout, or branch does not exist locally."
    throw "git checkout '$targetBranch' failed (exit code $LASTEXITCODE)"
}
$pullResult = git -C "$repoPath" pull 2>&1
Write-Host $pullResult
if ($LASTEXITCODE -ne 0) {
    Print_Error "Failed to pull '$targetBranch': $pullResult"
    Print_Text "Check your network connection and that the remote branch exists."
    throw "git pull failed on '$targetBranch' (exit code $LASTEXITCODE)"
}

Print_Title "Merge '$sourceBranch' into '$targetBranch'"
$mergeMsg = if ($Message) { $Message } else { "Merge '$sourceBranch' into '$targetBranch'" }
$mergeResult = git -C "$repoPath" merge "origin/$sourceBranch" --no-ff -m "$mergeMsg" 2>&1

if ($LASTEXITCODE -ne 0) {
    Print_Error "Merge failed (exit code $LASTEXITCODE)"
    Write-Host $mergeResult
    # Detect conflicts vs other errors
    $conflictFiles = git -C "$repoPath" diff --name-only --diff-filter=U 2>$null
    if ($conflictFiles) {
        Print_Error "Conflicting files:"
        foreach ($f in $conflictFiles) { Print_Text "  - $f" }
        Print_Text "Resolve conflicts manually, then commit. Or use Pull Force to reset."
    } else {
        Print_Text "This may be a network or permission issue. Check the output above."
    }
    # Go back to original branch
    git -C "$repoPath" merge --abort 2>$null
    git -C "$repoPath" checkout "$currentBranch" 2>$null
    throw "Merge '$sourceBranch' into '$targetBranch' failed (exit code $LASTEXITCODE)"
}

Write-Host $mergeResult

# ── Push ──
Print_Title "Push '$targetBranch' to remote"
Print_Text "Pushing merge result to remote..."
$pushResult = git -C "$repoPath" push 2>&1
Write-Host $pushResult
if ($LASTEXITCODE -ne 0) {
    Print_Error "Push failed (exit code $LASTEXITCODE): $pushResult"
    Print_Text "The merge was done locally. Try 'git push' manually, or check remote permissions."
    throw "git push failed on '$targetBranch' (exit code $LASTEXITCODE)"
}
Print_Status "Push completed."

# ── Return to original branch ──
if ($currentBranch -ne $targetBranch) {
    Print_Title "Return to '$currentBranch'"
    git -C "$repoPath" checkout "$currentBranch" 2>&1 | Out-Host
}

Print_Status "Merge complete. '$sourceBranch' has been merged into '$targetBranch'."
