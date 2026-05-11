
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json",
    [switch] $ForceStartFromScratch
)

$ErrorActionPreference = "Stop"
$RootPath =  Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"
CheckPrerequisites

Print_Script_Title "PULL FORCE$(if (-not $ForceStartFromScratch) {" + PULL"})"
Print_Text "Warming up the oven..."

Print_Title "Loading Configuration"
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile
Print_Status "Environment: $EnvFile"
Print_Text "Site: $($_c.local.site_path)"
Print_Text "Branch: $($_c.feature_branch) -> $($_c.target_branch)"
Print_Text "Repository: $($_c.azdo.repository)"

Print_Title "Checking Prerequisites"
CheckLocalSiteExists -LocalSite $_c.local.site_path
Print_Status "Site path exists"

# ── DNS checks (parallel) ──
$dnsHosts = @()
if ($_c.azdo.base_uri -match "https?://([^/]+)") { $dnsHosts += $Matches[1] }
if ($_c.local.parent_site -match "https?://([^/]+)") { $dnsHosts += $Matches[1] }

if ($dnsHosts.Count -gt 0) {
    Print_Text "Checking connectivity to $($dnsHosts -join ', ')..."
    foreach ($h in $dnsHosts) {
        try {
            $null = [System.Net.Dns]::GetHostAddresses($h)
        } catch {
            Print_Error "Cannot reach $h — is your VPN connected?"
            throw "Network error: cannot resolve $h. Connect your VPN and try again."
        }
    }
    Print_Status "All remote hosts reachable"
}

Print_Text "Checking dependencies (DONUT version, git4inno, Auto Delivery)..."
try {
    CheckDependencies -RootPath $RootPath -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -SiteParams $_c.local.site_api_params
    Print_Status "All dependencies OK"
} catch {
    if ($_.Exception.Message -match "not allowed|unauthorized|access") {
        Print_Error "Site access denied (user: '$($_c.local.user)')"
        Print_Text "  -> Check password in Config tab > local.password"
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
        Print_Text "  -> Try opening the site in a browser to confirm credentials"
    }
    throw
}

# ── Site config + Git setup (parallel) ──
# Start git clone in background if repo doesn't exist yet
$repoCloneUrl = "https://dev.azure.com/$($_c.azdo.organization)/$([uri]::EscapeDataString($_c.azdo.project))/_git/$($_c.azdo.repository)"
$repoPath = $_c.local.repository
$needsClone = -not (Test-Path -Path $repoPath)
$gitCloneProc = $null
$gitCloneErr = "$RootPath\_git_clone_err.tmp"

if ($needsClone) {
    Print_Title "Initialize Git Repository"
    Print_Text "Cloning repository in background..."
    $gitParent = Split-Path $repoPath -Parent
    if (-not (Test-Path $gitParent)) { New-Item -Path $gitParent -ItemType Directory -Force | Out-Null }
    $gitCloneProc = Start-Process -FilePath "git" -ArgumentList "clone", $repoCloneUrl, $repoPath -PassThru -WindowStyle Hidden -RedirectStandardError $gitCloneErr
}

# Meanwhile, configure local site (API calls, ~5s)
Print_Title "Setting Up Local Site"
Print_Text "Configuring parent site & switches..."
EnablonSetParentSite -SiteParams $_c.local.site_api_params -ParentSite $_c.local.parent_site
EnablonSetSwitches -SiteParams $_c.local.site_api_params -Switches $_c.local.switches

# Wait for git clone if it was started
if ($gitCloneProc) {
    $finished = $gitCloneProc.WaitForExit(300000) # 5 min timeout
    if (-not $finished) {
        $gitCloneProc.Kill()
        Remove-Item $gitCloneErr -ErrorAction SilentlyContinue
        throw "Git clone timed out after 5 minutes."
    }
    if ($gitCloneProc.ExitCode -ne 0) {
        $cloneErrMsg = if (Test-Path $gitCloneErr) { Get-Content $gitCloneErr -Raw } else { "exit code $($gitCloneProc.ExitCode)" }
        Remove-Item $gitCloneErr -ErrorAction SilentlyContinue
        # Fallback to Enablon API
        Print_Warning "Git CLI clone failed: $cloneErrMsg"
        Print_Text "Falling back to Enablon API..."
        try {
            EnablonCreateRepository -SiteParams $_c.local.site_api_params -Repository $repoPath -CloneUrl $null
        } catch {
            Print_Error "Repository creation failed: $($_.Exception.Message)"
            Print_Text "Check: 1) VPN connected  2) Git credentials valid  3) Site running at http://localhost/$($_c.local.site_id)"
            throw
        }
    } else {
        Remove-Item $gitCloneErr -ErrorAction SilentlyContinue
        Print_Status "Repository cloned"
        # Set safe.directory and ownership (same as EnablonCreateRepository)
        git config --global --add safe.directory $repoPath.Replace("\", "/") 2>$null | Out-Null
        git config --system --add safe.directory $repoPath.Replace("\", "/") 2>$null | Out-Null
        $siteId = $_c.local.site_api_params["SiteId"]
        $iisUser = "IIS APPPOOL\DefaultAppPool"
        try {
            $poolDetect = & "$env:SystemRoot\System32\inetsrv\appcmd.exe" list app "/site.name:$siteId" /text:APPPOOL.NAME 2>$null
            if ($poolDetect) { $iisUser = "IIS APPPOOL\$($poolDetect.Trim())" }
        } catch {}
        Print_Text "Transferring repository ownership to $iisUser..."
        try {
            $cmd = "takeown /F `"$repoPath`" /R /A /D Y > nul 2>&1 & icacls `"$repoPath`" /setowner `"$iisUser`" /T /C /Q > nul 2>&1 & icacls `"$repoPath`" /grant `"BUILTIN\IIS_IUSRS:(OI)(CI)F`" /T /C /Q > nul 2>&1"
            $proc = Start-Process cmd -ArgumentList "/C $cmd" -Verb RunAs -PassThru -WindowStyle Hidden
            $finished = $proc.WaitForExit(30000)
            if ($finished) { Print_Status "Ownership transferred to $iisUser" }
            else { Print_Warning "Ownership transfer timed out" }
        } catch {
            Print_Warning "Could not elevate to change ownership: $($_.Exception.Message)"
        }
    }
} elseif (-not $needsClone) {
    Print_Title "Initialize Git Repository"
    Print_Text "Repository already exists at $repoPath"
}

SetLocalGitUser -Repository $repoPath -Username $_c.git.username -Email $_c.git.email
Print_Text "Checking out branch: $($_c.feature_branch) from $($_c.target_branch)"
$alreadyPushed = CheckoutBranch -Repository $repoPath -SourceBranch $_c.target_branch -Branch $_c.feature_branch
if ($alreadyPushed) { Print_Status "Branch exists on remote - will pull changes" }
else { Print_Status "New branch created locally" }

# ── Pull Force on Local Site ──
Print_Title "Pull Force"
Print_Text "Downloading fresh dough from the bakery... this may take a while"
try {
    # Skip pre-pullforce status in ForceStartFromScratch (saves ~10-30s)
    if (-not $ForceStartFromScratch) {
        EnablonStatus -SiteParams $_c.local.site_api_params -Action "pullforce" -Packages $_c.packages
    }
    EnablonPullForce -SiteParams $_c.local.site_api_params
    Print_Status "Pull Force completed"

    # Verify site state after pull force
    Print_Text "Verifying site state..."
    $VerifyParams = @{sAction = "pullforce"}
    if ($_c.packages.Count -gt 0) { $VerifyParams["asPackages"] = $_c.packages }
    $VerifyResponse = CallLocalAPI -SiteParams $_c.local.site_api_params -FunctionName "Status" -Params $VerifyParams

    $issues = @()
    foreach ($pkg in $VerifyResponse.data.pullforce) {
        if ($pkg.is_modified -eq $true) {
            $issues += "  - $($pkg.xmltag) ($($pkg.name)) is still modified"
        }
        if ($pkg.version -ne $pkg.pull_force_version) {
            $issues += "  - $($pkg.xmltag) ($($pkg.name)): version $($pkg.version) != expected $($pkg.pull_force_version)"
        }
    }
    if ($VerifyResponse.data.not_master_modified.Count -gt 0) {
        foreach ($pkg in $VerifyResponse.data.not_master_modified) {
            $issues += "  - $($pkg.xmltag) ($($pkg.name)) is modified but not master"
        }
    }

    if ($issues.Count -gt 0) {
        Print_Warning "Site is not fully clean after Pull Force:"
        foreach ($issue in $issues) { Print_Warning $issue }

        # Retry verification once after a short wait (site may still be processing)
        Print_Text "Waiting 5 seconds and retrying verification..."
        Start-Sleep -Seconds 5
        $RetryResponse = CallLocalAPI -SiteParams $_c.local.site_api_params -FunctionName "Status" -Params $VerifyParams

        $retryIssues = @()
        foreach ($pkg in $RetryResponse.data.pullforce) {
            if ($pkg.is_modified -eq $true) {
                $retryIssues += "  - $($pkg.xmltag) ($($pkg.name)) is still modified"
            }
            if ($pkg.version -ne $pkg.pull_force_version) {
                $retryIssues += "  - $($pkg.xmltag) ($($pkg.name)): version $($pkg.version) != expected $($pkg.pull_force_version)"
            }
        }
        if ($RetryResponse.data.not_master_modified.Count -gt 0) {
            foreach ($pkg in $RetryResponse.data.not_master_modified) {
                $retryIssues += "  - $($pkg.xmltag) ($($pkg.name)) is modified but not master"
            }
        }

        if ($retryIssues.Count -gt 0) {
            Print_Error "Site is still not clean after retry:"
            foreach ($issue in $retryIssues) { Print_Error $issue }
            Print_Error "The site is in an unreliable state. Recommended actions:"
            Print_Text "  1) Run Pull Force again"
            Print_Text "  2) Try 'Full Reset' (start from scratch)"
            Print_Text "  3) Check that the parent site is healthy"
            throw "Pull Force verification failed: $($retryIssues.Count) issue(s) remain after retry."
        } else {
            Print_Status "Site is now clean after retry — all packages at expected version"
        }
    } else {
        Print_Status "Site is clean — all packages at expected version, no modifications"
    }
} catch {
    $errMsg = $_.Exception.Message
    Print_Error "Pull Force failed: $errMsg"
    if ($errMsg -match "Parent site configuration is invalid|WsdlLocation") {
        Print_Text "  -> The parent site path '$($_c.local.parent_site)' seems incorrect or unreachable."
        Print_Text "  -> Go to Config tab > 'local.parent_site' and update it."
        Print_Text "  -> The parent site must be accessible at: http://localhost$($_c.local.parent_site)/"
        Print_Text "  -> Try opening that URL in a browser to verify."
    } else {
        Print_Text "Check that the local site is running and packages are correctly configured."
    }
    throw
}

if ($_c.convert_md) {
    # Metadata Config
    Print_Title "Metadata Conversion"
    Print_Text "Setting up metadata repositories configuration..."
    $localPkgPath = "$RootPath\cli\config\packages.json"
    if (Test-Path $localPkgPath) {
        $PackagesMapping = Get-Content -Raw -Path $localPkgPath | ConvertFrom-Json
        Print_Text "Using local packages.json"
    } else {
        $PackagesMapping = GetConfigFile -FilePath "cli\config\packages.json" -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token
    }
    # Query DB for all package GUIDs so unknown ones can be auto-excluded by git4inno
    $dbGuids = @()
    $dbName  = Split-Path $_c.local.site_path -Leaf
    # Normalise to lowercase-no-hyphens to match packages.json format
    $guidQuery = "SET NOCOUNT ON; SELECT REPLACE(LOWER(CONVERT(varchar(36), ProductId)), '-', '') FROM Meta_Products WHERE MetaType=2 AND (Special&64)=0"
    try {
        if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
            $dbGuids = (Invoke-Sqlcmd -ServerInstance "(local)" -Database $dbName -Username $_c.local.db_user -Password $_c.local.db_password -Query $guidQuery -QueryTimeout 15 -ConnectionTimeout 5 -ErrorAction Stop).Column1
        } elseif (Get-Command 'Sqlcmd' -ErrorAction SilentlyContinue) {
            $env:SQLCMDPASSWORD = $_c.local.db_password
            $dbGuids = & Sqlcmd -S "(local)" -d $dbName -U $_c.local.db_user -Q $guidQuery -h -1 -W -t 15 -l 5 2>&1 |
                       Where-Object { $_ -match '^[0-9a-f]{32}$' } |
                       ForEach-Object { $_.Trim() }
        }
        if ($dbGuids.Count -gt 0) { Print_Text "  Found $($dbGuids.Count) package GUID(s) in DB." }
    } catch {
        Print_Text "  Could not query DB package GUIDs (non-critical): $($_.Exception.Message)"
    } finally {
        $env:SQLCMDPASSWORD = $null
    }
    Metadata_WriteSaveToGitConfigFile -PackagesMapping $PackagesMapping -RootPath $RootPath -Packages $_c.packages -DbGuids $dbGuids

    # ── Clone metadata repos in parallel ──
    Print_Text "Cloning metadata repositories and creating branches..."
    $mdBaseUri = $_c.azdo.base_uri
    $mdAzDoRepo = $_c.azdo.repository_metadata
    $mdRepoRoot = $_c.local.repository_metadata
    $mdUsername = $_c.git.username
    $mdEmail = $_c.git.email
    $mdBranch = $_c.md_branches.start.local
    $modulePath = "$RootPath\cli\modules"

    # Pre-compute source branches per package (can't access $_c inside -Parallel)
    $packageBranches = @{}
    foreach ($package in $_c.packages) {
        $packageBranches[$package] = @($_c.md_branches.start.$package, "main")
    }

    if ($_c.packages.Count -gt 1) {
        $_c.packages | ForEach-Object -Parallel {
            $package = $_
            $repository = "$($using:mdRepoRoot)\$package"
            $branches = ($using:packageBranches)[$package]
            # Import modules in each parallel runspace
            & "$($using:modulePath)\_import-all-modules.ps1"
            CloneRepository -AzDoBaseURI $using:mdBaseUri -AzDoRepository $using:mdAzDoRepo -Repository $repository -Username $using:mdUsername -Email $using:mdEmail -IsBare $true
            Metadata_CreateBranch -Repository $repository -Branch $using:mdBranch -SourceBranches $branches
        } -ThrottleLimit 4
    } else {
        # Single package — no parallelism overhead needed
        foreach ($package in $_c.packages) {
            $repository = "$($mdRepoRoot)\$package"
            CloneRepository -AzDoBaseURI $mdBaseUri -AzDoRepository $mdAzDoRepo -Repository $repository -Username $mdUsername -Email $mdEmail -IsBare $true
            Metadata_CreateBranch -Repository $repository -Branch $mdBranch -SourceBranches $packageBranches[$package]
        }
    }

    Print_Text "Saving metadata to git... this may take a while."
    Metadata_SaveToGit -RootPath $RootPath -Repository $_c.local.repository_metadata -SitePath $_c.local.site_path -SiteId $_c.local.site_id -Branch $_c.md_branches.start.local -Message "Pull Force" -DBUser $_c.local.db_user -DBSafePassw0rd $_c.local.db_password
    Print_Status "Metadata conversion completed."
}

# Manage Commits
Print_Title "Finalize"
if ((-not $ForceStartFromScratch) -and $alreadyPushed) {
    Print_Text "Pulling latest commits (adding frosting)..."

    # Filter commits to working packages only — prevent non-working packages (e.g. ENXP) from being re-modified by Pull
    $CommitsPath = "$($_c.local.repository)\Commits"
    $movedFiles = @()
    if ($_c.packages.Count -gt 0 -and (Test-Path "$CommitsPath\*.enzp")) {
        Get-ChildItem "$CommitsPath\*.enzp" -File | ForEach-Object {
            if ($_.BaseName -notin $_c.packages) {
                $tempPath = "$env:TEMP\donut_enzp_$($_.Name)"
                Move-Item $_.FullName $tempPath
                $movedFiles += @{ Original = $_.FullName; Temp = $tempPath }
                Print_Text "Excluded non-working package commit: $($_.BaseName)"
            }
        }
    }

    try {
        EnablonPull -SiteParams $_c.local.site_api_params
        Print_Status "Commits pulled"
    } catch {
        $errMsg = $_.Exception.Message

        # Auto-retry on internal Enablon errors: recycle app pool then retry
        if ($errMsg -match "An error has occurred|contact the system administrator") {
            Print_Warning "Pull failed with internal Enablon error — recycling app pool and retrying..."

            # Recycle app pool
            $recycled = $false
            try {
                $recycled = RecycleAppPool -SiteId $_c.local.site_api_params["SiteId"]
            } catch {
                Print_Warning "Could not recycle app pool: $($_.Exception.Message)"
            }

            if ($recycled) {
                Print_Text "Waiting 5 seconds for app pool to warm up..."
                Start-Sleep -Seconds 5

                try {
                    EnablonPull -SiteParams $_c.local.site_api_params
                    Print_Status "Commits pulled (after app pool recycle)"
                } catch {
                    $retryMsg = $_.Exception.Message
                    Print_Warning "Pull still failed after retry: $retryMsg"
                    Print_Text "  -> Pull Force succeeded — your site has the latest master packages."
                    Print_Text "  -> The Pull step (applying feature branch commits) failed twice."
                    Print_Text "  -> Check the Enablon logs at: $($_c.local.site_path)\Logs\"
                    Print_Text "  -> If the problem persists, try 'Full Reset' to skip this step."
                    throw
                }
            } else {
                Print_Warning "Pull failed after Pull Force: $errMsg"
                Print_Text "  -> Could not auto-recycle app pool. Try manually: iisreset"
                Print_Text "  -> Then run Pull Force again."
                throw
            }
        } else {
            Print_Warning "Pull failed after Pull Force: $errMsg"
            Print_Text "  -> Pull Force succeeded — your site has the latest master packages."
            Print_Text "  -> The Pull step (applying feature branch commits) failed."
            Print_Text "  -> If the problem persists, try 'Full Reset' to skip this step."
            throw
        }
    } finally {
        # Restore excluded .enzp files to preserve git state
        foreach ($moved in $movedFiles) {
            Move-Item $moved.Temp $moved.Original -ErrorAction SilentlyContinue
        }
    }
} else {
    Print_Text "Starting fresh (clean donut, no toppings)"
    EmptyCommitsFolder -Repository $_c.local.repository
    Print_Status "Commits folder cleaned"
}

$Links = @("Local Site Link : http://localhost/$($_c.local.site_id)/go.aspx?u=/adm/builder")
Print_Script_End "Fresh donuts are served! You can now start working on your local site." -Links $Links
