
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "DIFF"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$repoPath = $_c.local.repository

if (-not (Test-Path $repoPath)) {
    throw "Repository not found at '$repoPath'. Run pull-force first."
}

# ── Branch info ──
Print_Title "Current Branch"
$branch = git -C "$repoPath" rev-parse --abbrev-ref HEAD 2>&1
if ($LASTEXITCODE -ne 0) {
    Print_Error "Failed to get current branch: $branch"
    Print_Text "The repository at '$repoPath' may be corrupted. Try running Pull Force."
    throw "git rev-parse failed (exit code $LASTEXITCODE)"
}
Print_Text "Branch: $branch"

# ── Working directory summary ──
Print_Title "Working Directory Changes"
$statusLines = @(git -C "$repoPath" status --porcelain 2>$null)

if ($statusLines.Count -eq 0) {
    Print_Status "Working directory is clean. Nothing to commit."
} else {
    $added    = @($statusLines | Where-Object { $_ -match '^\?\?' -or $_ -match '^A' })
    $modified = @($statusLines | Where-Object { $_ -match '^.M' -or $_ -match '^M' })
    $deleted  = @($statusLines | Where-Object { $_ -match '^.D' -or $_ -match '^D' })

    Print_Text "  $($modified.Count) modified, $($added.Count) added, $($deleted.Count) deleted"
    Write-Host

    foreach ($line in $statusLines) {
        $status = $line.Substring(0, 2).Trim()
        $file = $line.Substring(3)
        switch -Wildcard ($status) {
            'M*' { Print_Warning "  [modified]  $file" }
            'A*' { Print_SubTitle "  [added]     $file" }
            'D*' { Print_Error "  [deleted]   $file" }
            '??' { Print_Text "  [untracked] $file" }
            default { Print_Text "  [$status]     $file" }
        }
    }
}

# ── Commits ahead of target ──
Print_Title "Commits ahead of '$($_c.target_branch)'"
try {
    Print_Text "Fetching latest from remote..."
    $fetchResult = git -C "$repoPath" fetch -q 2>&1
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "Fetch failed (exit code $LASTEXITCODE): $fetchResult"
    }
    $commits = @(git -C "$repoPath" log --oneline "origin/$($_c.target_branch)..HEAD" 2>$null)
    if ($commits.Count -eq 0) {
        Print_Text "No commits ahead."
    } else {
        Print_Text "$($commits.Count) commit(s) ahead:"
        foreach ($c in $commits) {
            Write-Host "  $c"
        }
    }
} catch {
    Print_Warning "Could not compare with target branch '$($_c.target_branch)': $($_.Exception.Message)"
    Print_Text "  -> Does 'origin/$($_c.target_branch)' exist? Try: git fetch --all"
}

# ── Smart diff output function ──
# YAML/metadata: only changed lines + parent key, no noise
# Code (.nabsic etc): full context in a block
function OutputSmartDiff {
    param([string[]] $DiffLines, [string] $FileName)

    if (-not $DiffLines -or $DiffLines.Count -eq 0) {
        Write-Host "  (no diff content)"
        return
    }

    $isYaml = $FileName -match '\.(yaml|yml|json|xml)$'
    $isCode = $FileName -match '\.(nabsic|cs|js|ts|ps1|psm1)$'

    # Parse hunks from raw diff
    $hunks = @()
    $currentHunk = $null
    foreach ($line in $DiffLines) {
        if ($line -match '^diff --git') { continue }
        if ($line -match '^index ') { continue }
        if ($line -match '^\-\-\- ') { continue }
        if ($line -match '^\+\+\+ ') { continue }
        if ($line -match '^@@\s+-(\d+),?\d*\s+\+(\d+),?\d*\s+@@\s*(.*)') {
            if ($currentHunk) { $hunks += ,$currentHunk }
            $currentHunk = @{ oldStart = [int]$Matches[1]; newStart = [int]$Matches[2]; context = $Matches[3].Trim(); lines = @() }
        } elseif ($currentHunk) {
            $currentHunk.lines += $line
        }
    }
    if ($currentHunk) { $hunks += ,$currentHunk }

    foreach ($hunk in $hunks) {
        if ($isYaml) {
            # YAML: only show parent key + changed lines
            $parentKey = ""
            $changes = @()
            foreach ($line in $hunk.lines) {
                if ($line -match '^\+' -or $line -match '^\-') {
                    $changes += $line
                } elseif ($changes.Count -eq 0) {
                    # Track last context line as potential parent key
                    $trimmed = $line.TrimStart(' ')
                    if ($trimmed -match '^[A-Za-z].*:' -and $trimmed -notmatch '[0-9A-F]{16,}') {
                        $parentKey = $trimmed
                    }
                }
            }
            if ($changes.Count -gt 0) {
                if ($parentKey) { Write-Host " $parentKey" }
                foreach ($c in $changes) { Write-Host $c }
            }
        } else {
            # Code: output hunk separator with line numbers + raw diff lines
            Write-Host "@@HUNK $($hunk.oldStart) $($hunk.newStart)"
            foreach ($line in $hunk.lines) {
                Write-Host $line
            }
        }
    }
}

# ── Full diff (per-file, with content) ──
Print_Title "DETAILED DIFF"

# Unstaged changes
$unstagedFiles = @(git -C "$repoPath" diff --name-only 2>$null)
# Staged changes
$stagedFiles = @(git -C "$repoPath" diff --cached --name-only 2>$null)
# Untracked files
$untrackedFiles = @(git -C "$repoPath" ls-files --others --exclude-standard 2>$null)

$totalFiles = ($unstagedFiles + $stagedFiles + $untrackedFiles) | Sort-Object -Unique

if ($totalFiles.Count -eq 0) {
    Print_Status "No differences found."
} else {
    Print_Text "$($totalFiles.Count) file(s) with changes"
    Write-Host

    foreach ($file in $totalFiles) {
        $isStaged = $stagedFiles -contains $file
        $isUnstaged = $unstagedFiles -contains $file
        $isUntracked = $untrackedFiles -contains $file

        $tag = if ($isStaged -and $isUnstaged) { "staged+modified" }
               elseif ($isStaged) { "staged" }
               elseif ($isUntracked) { "untracked" }
               else { "modified" }

        Write-Host "DIFF  [$tag]  $file"

        if ($isUntracked) {
            $filePath = Join-Path $repoPath $file
            if (Test-Path $filePath) {
                $content = Get-Content $filePath -TotalCount 50 -ErrorAction SilentlyContinue
                if ($content) {
                    foreach ($ln in $content) { Write-Host "+$ln" }
                    $totalLines = (Get-Content $filePath -ErrorAction SilentlyContinue).Count
                    if ($totalLines -gt 50) { Write-Host "  ... ($($totalLines - 50) more lines)" }
                }
            }
        } else {
            $diffOutput = @()
            if ($isStaged) { $diffOutput += @(git -C "$repoPath" diff --cached -- $file 2>$null) }
            if ($isUnstaged) { $diffOutput += @(git -C "$repoPath" diff -- $file 2>$null) }
            OutputSmartDiff $diffOutput $file
        }
        Write-Host
    }
}

# ── Stats summary ──
Print_Title "Diff Stats"
$diffStat = git -C "$repoPath" diff --stat HEAD 2>$null
if ($diffStat) {
    $diffStat | ForEach-Object { Write-Host "  $_" }
} else {
    Print_Text "No diff."
}

# ── Metadata view-diff (if enabled) ──
if ($_c.convert_md) {
    Print_Title "METADATA VIEW-DIFF"
    $mdRepoPath = $_c.local.repository_metadata

    if (-not (Test-Path $mdRepoPath)) {
        Print_Warning "Metadata repository not found at '$mdRepoPath'"
        Print_Text "  -> Run Pull Force with metadata conversion enabled first"
    } else {
        # Check start branch exists in at least one package repo
        $hasStart = $false
        foreach ($package in $_c.packages) {
            $pkgRepoPath = "$mdRepoPath\$package"
            if (-not (Test-Path "$pkgRepoPath\.git") -and -not (Test-Path "$pkgRepoPath\HEAD")) { continue }
            $null = git -C "$pkgRepoPath" rev-parse --verify $_c.md_branches.start.local 2>$null
            if ($LASTEXITCODE -eq 0) { $hasStart = $true; break }
        }

        if (-not $hasStart) {
            Print_Warning "No metadata start branch found. Run Pull Force first."
        } else {
            # Snapshot current DB state to a preview branch
            $previewBranch = "_diff_preview"
            Print_Text "Snapshotting current database state for comparison..."
            Print_Text "This may take a moment..."

            # Create preview branch from start
            foreach ($package in $_c.packages) {
                $pkgRepoPath = "$mdRepoPath\$package"
                if (-not (Test-Path "$pkgRepoPath\.git") -and -not (Test-Path "$pkgRepoPath\HEAD")) { continue }
                # Create preview branch from start (or reset it if exists)
                $null = git -C "$pkgRepoPath" branch -D $previewBranch 2>$null
                git -C "$pkgRepoPath" branch $previewBranch $_c.md_branches.start.local 2>$null | Out-Null
            }

            # Run git4inno to save current DB state to preview branch
            try {
                Metadata_SaveToGit -RootPath $RootPath -Repository $mdRepoPath -SitePath $_c.local.site_path -SiteId $_c.local.site_id -Branch $previewBranch -Message "diff preview" -DBUser $_c.local.db_user -DBSafePassw0rd $_c.local.db_password

                # Now diff preview (current state) vs start (pull force state)
                foreach ($package in $_c.packages) {
                    $pkgRepoPath = "$mdRepoPath\$package"
                    if (-not (Test-Path "$pkgRepoPath\.git") -and -not (Test-Path "$pkgRepoPath\HEAD")) { continue }

                    Print_SubTitle "Package: $package"

                    $startBranch = $_c.md_branches.start.local
                    Print_Text "Comparing current DB state vs pull force snapshot"

                    $mdFiles = @(git -C "$pkgRepoPath" diff --name-only "$startBranch..$previewBranch" 2>$null)
                    if ($mdFiles.Count -eq 0) {
                        Print_Status "No metadata changes for $package."
                    } else {
                        Print_Text "$($mdFiles.Count) metadata file(s) changed since last Pull Force"
                        Write-Host

                        # Stats
                        $mdStat = git -C "$pkgRepoPath" diff --stat "$startBranch..$previewBranch" 2>$null
                        if ($mdStat) {
                            $mdStat | ForEach-Object { Write-Host "  $_" }
                            Write-Host
                        }

                        # Per-file diff (sorted: Pages > Functions > Constants > Permissions > Modules > Packages, yaml first within each object)
                        $typePriority = @{ 'Pages'=0; 'PageSections'=1; 'FunctionSections'=2; 'Functions'=2; 'ConstantSections'=3; 'Constants'=3; 'NabsicTypes'=4; 'Permissions'=5; 'Modules'=6; 'Packages'=7 }
                        $mdFiles = $mdFiles | Sort-Object {
                            $segments = $_ -split '/'
                            $typeKey = ($segments | Where-Object { $typePriority.ContainsKey($_) } | Select-Object -First 1)
                            if ($typeKey) { $typePriority[$typeKey] } else { 99 }
                        }, { ($_ -split '\.')[0] }, { if ($_ -match '\.yaml$') { 0 } else { 1 } }
                        foreach ($mdFile in $mdFiles) {
                            Write-Host "DIFF  [metadata]  $package/$mdFile"
                            $mdDiff = @(git -C "$pkgRepoPath" diff "$startBranch..$previewBranch" -- $mdFile 2>$null)
                            OutputSmartDiff $mdDiff $mdFile
                            Write-Host
                        }
                    }

                    # Cleanup preview branch
                    git -C "$pkgRepoPath" branch -D $previewBranch 2>$null | Out-Null
                }
            } catch {
                Print_Warning "Could not generate metadata preview: $($_.Exception.Message)"
                Print_Text "  -> The view-diff will be available after Commit"
                # Cleanup preview branches on error
                foreach ($package in $_c.packages) {
                    $pkgRepoPath = "$mdRepoPath\$package"
                    git -C "$pkgRepoPath" branch -D $previewBranch 2>$null | Out-Null
                }
            }
        }
    }
} else {
    Print_Text "Metadata conversion is disabled. No view-diff available."
}

Write-Host
Print_Status "Diff complete."
