# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"

function EmptyCommitsFolder {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository
    )

    Print_Title "Clean 'Commit' folder in Local Repository"
    if (Test-Path "$Repository\Commits\*") {
        Remove-Item "$Repository\Commits\*" -Recurse -Force
        git -C "$Repository" add "Commits/*.enzp" --all | Out-Host
    }
}

function CheckoutBranch {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $SourceBranch,
        [Parameter(Mandatory = $true)]
        [string] $Branch,
        [bool] $ExpectedToExist = $false
    )

    Print_Title "Checkout to Branch '$Branch' in Repository '$Repository'"
    $fetchErr = git -C "$Repository" fetch -q 2>&1
    if ($LASTEXITCODE -ne 0) {
        $fetchErrStr = "$fetchErr"
        if ($fetchErrStr -match "Authentication failed|403|401|terminal prompts disabled") {
            Print_Warning "Git authentication failed — resetting credentials and retrying..."
            # Clear stored credentials for the remote host
            $remoteUrl = git -C "$Repository" remote get-url origin 2>$null
            if ($remoteUrl -match "https?://([^/]+)") {
                $host = $Matches[1]
                "protocol=https`nhost=$host`n" | git credential reject 2>$null
                Print_Text "Credentials cleared for $host"
            }
            # Retry fetch (will trigger re-authentication via credential manager)
            git -C "$Repository" fetch -q 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "git fetch failed after credential reset. Check: 1) VPN is connected 2) Re-authenticate when prompted 3) Try 'Reset credentials' in DevOps tab"
            }
            Print_Status "Re-authenticated successfully"
        } else {
            throw "git fetch failed. Check: 1) VPN is connected 2) Git credentials are valid (try 'Reset credentials' in DevOps tab)"
        }
    }

    if ((git -C "$Repository" show-ref "refs/remotes/origin/$Branch") -or (git -C "$Repository" show-ref "refs/heads/$Branch")) {
        git -C "$Repository" checkout "$Branch" | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git checkout '$Branch' failed. Check for uncommitted changes or run 'git stash' first." }

        if (git -C "$Repository" show-ref "refs/remotes/origin/$Branch") {
            git -C "$Repository" pull | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "git pull failed. Possible causes: merge conflicts, or network issue. Try 'Pull Force' to reset." }
            return $true
        } else {
            return $false
        }
    } else {
        if ($ExpectedToExist) {
            throw "Branch '$Branch' not found locally or on origin. Check branch name in Config, or run 'Pull Force' to create it."
        }
        git -C "$Repository" checkout "$SourceBranch" | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git checkout '$SourceBranch' failed. Check for uncommitted changes or run 'git stash' first." }
        git -C "$Repository" pull | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git pull failed. Check VPN connection and git credentials." }
        git -C "$Repository" checkout -b "$Branch" | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git checkout -b '$Branch' failed. Branch may already exist locally — try 'git branch -D $Branch' then retry." }
        git -C "$Repository" push -u origin "$Branch" 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "git push '$Branch' failed. Check permissions on Azure DevOps repository." }
        return $false
    }
}

function Commit {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    Print_Title "Commit in Local Repository"
    git -C "$Repository" commit -m $Message | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git commit failed. Check: no changes to commit, or commit message is empty." }
}

function Push {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $AzDoRepository,
        [Parameter(Mandatory = $true)]
        [string] $Branch
    )

    Print_Title "Push Branch '$Branch' to Repository '$AzDoRepository'"
    $pushErr = git -C "$Repository" push -u origin "$Branch" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $pushErrStr = "$pushErr"
        if ($pushErrStr -match "Authentication failed|403|401|terminal prompts disabled") {
            Print_Warning "Git authentication failed on push — resetting credentials and retrying..."
            $remoteUrl = git -C "$Repository" remote get-url origin 2>$null
            if ($remoteUrl -match "https?://([^/]+)") {
                "protocol=https`nhost=$($Matches[1])`n" | git credential reject 2>$null
            }
            git -C "$Repository" push -u origin "$Branch" 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "git push '$Branch' failed after credential reset. Check: 1) VPN connected 2) Re-authenticate when prompted 3) Write access to '$AzDoRepository'" }
            Print_Status "Re-authenticated and pushed successfully"
        } else {
            throw "git push '$Branch' failed. Check: 1) VPN connected 2) Git credentials valid 3) You have write access to '$AzDoRepository'"
        }
    }
}

Export-ModuleMember -Function EmptyCommitsFolder
Export-ModuleMember -Function CheckoutBranch
Export-ModuleMember -Function Commit
Export-ModuleMember -Function Push
