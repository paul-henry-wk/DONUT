
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

# Check Azure DevOps connectivity
if ($_c.azdo.base_uri -match "https?://([^/]+)") {
    $remoteHost = $Matches[1]
    Print_Text "Checking connectivity to $remoteHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($remoteHost)
    } catch {
        Print_Error "Cannot reach $remoteHost - is your VPN connected?"
        throw "Network error: cannot resolve $remoteHost. Connect your VPN and try again."
    }
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

# Check VPN connectivity if parent site is remote
if ($_c.local.parent_site -match "https?://([^/]+)") {
    $parentHost = $Matches[1]
    Print_Text "Checking connectivity to $parentHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($parentHost)
        Print_Status "Remote site $parentHost is reachable"
    } catch {
        Print_Error "Cannot reach $parentHost — is your VPN connected?"
        Print_Text "The parent site '$($_c.local.parent_site)' requires VPN access."
        throw "VPN not connected: cannot resolve $parentHost"
    }
}

# Initialization
Print_Title "Setting Up Local Site"
Print_Text "Configuring parent site & switches..."
EnablonSetParentSite -SiteParams $_c.local.site_api_params -ParentSite $_c.local.parent_site
EnablonSetSwitches -SiteParams $_c.local.site_api_params -Switches $_c.local.switches

Print_Title "Initialize Git Repository"
Print_Text "Preparing the donut mold..."
$repoCloneUrl = "https://dev.azure.com/$($_c.azdo.organization)/$([uri]::EscapeDataString($_c.azdo.project))/_git/$($_c.azdo.repository)"
try {
    EnablonCreateRepository -SiteParams $_c.local.site_api_params -Repository $_c.local.repository -CloneUrl $repoCloneUrl
} catch {
    Print_Error "Failed to create repository: $($_.Exception.Message)"
    Print_Text "Check: 1) VPN connected  2) Git credentials valid  3) Site running at http://localhost/$($_c.local.site_id)"
    throw
}
SetLocalGitUser -Repository $_c.local.repository -Username $_c.git.username -Email $_c.git.email
Print_Text "Checking out branch: $($_c.feature_branch) from $($_c.target_branch)"
$alreadyPushed = CheckoutBranch -Repository $_c.local.repository -SourceBranch $_c.target_branch -Branch $_c.feature_branch
if ($alreadyPushed) { Print_Status "Branch exists on remote - will pull changes" }
else { Print_Status "New branch created locally" }

# Pull Force on Local Site
Print_Title "Pull Force"
Print_Text "Downloading fresh dough from the bakery... this may take a while"
try {
    EnablonStatus -SiteParams $_c.local.site_api_params -Action "pullforce" -Packages $_c.packages
    EnablonPullForce -SiteParams $_c.local.site_api_params
    Print_Status "Pull Force completed"
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
    Metadata_WriteSaveToGitConfigFile -PackagesMapping $PackagesMapping -RootPath $RootPath -Packages $_c.packages

    # Create & Update Metadata Repositories with Local Site State
    Print_Text "Cloning metadata repositories and creating branches..."
    foreach ($package in $_c.packages) {
        $repository = "$($_c.local.repository_metadata)\$package"
        CloneRepository -AzDoBaseURI $_c.azdo.base_uri -AzDoRepository $_c.azdo.repository_metadata -Repository $repository -Username $_c.git.username -Email $_c.git.email -IsBare $true
        Metadata_CreateBranch -Repository $repository -Branch $_c.md_branches.start.local -SourceBranches ($_c.md_branches.start.$package, "main")
    }
    Print_Text "Saving metadata to git... this may take a while."
    Metadata_SaveToGit -RootPath $RootPath -Repository $_c.local.repository_metadata -SitePath $_c.local.site_path -SiteId $_c.local.site_id -Branch $_c.md_branches.start.local -Message "Pull Force" -DBUser $_c.local.db_user -DBSafePassw0rd $_c.local.db_password
    Print_Status "Metadata conversion completed."
}

# Manage Commits
Print_Title "Finalize"
if ((-not $ForceStartFromScratch) -and $alreadyPushed) {
    Print_Text "Pulling latest commits (adding frosting)..."
    try {
        EnablonPull -SiteParams $_c.local.site_api_params
        Print_Status "Commits pulled"
    } catch {
        $errMsg = $_.Exception.Message
        Print_Warning "Pull failed after Pull Force: $errMsg"
        Print_Text "  -> Pull Force succeeded — your site has the latest master packages."
        Print_Text "  -> The Pull step (applying feature branch commits) failed."
        if ($errMsg -match "An error has occurred|contact the system administrator") {
            Print_Text "  -> This is an internal Enablon error. Try:"
            Print_Text "     1) Recycle the app pool: iisreset"
            Print_Text "     2) Run Pull Force again"
            Print_Text "     3) Check the Enablon logs at: $($_c.local.site_path)\Logs\"
        }
        Print_Text "  -> If the problem persists, try 'Pull Force (start from scratch)' to skip this step."
        throw
    }
} else {
    Print_Text "Starting fresh (clean donut, no toppings)"
    EmptyCommitsFolder -Repository $_c.local.repository
    Print_Status "Commits folder cleaned"
}

$Links = @("Local Site Link : http://localhost/$($_c.local.site_id)/go.aspx?u=/adm/builder")
Print_Script_End "Fresh donuts are served! You can now start working on your local site." -Links $Links
