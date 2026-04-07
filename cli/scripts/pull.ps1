
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath =  Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"
CheckPrerequisites

Print_Script_Title "PULL"

Print_Warning "Pull Mode only processes the feature branch content without resetting the site."
Print_Warning "Pull Force is preferred when possible and mandatory at least once before commit."
Print_Warning "Use Pull to get updates without losing data created on new objects."
Print_Request

Print_Title "Loading Configuration"
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile
Print_Status "Environment: $EnvFile"
Print_Text "Branch: $($_c.feature_branch)"

Print_Title "Checking Prerequisites"
CheckLocalSiteExists -LocalSite $_c.local.site_path
Print_Status "Site exists"

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

try {
    CheckDependencies -RootPath $RootPath -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -SiteParams $_c.local.site_api_params
    Print_Status "Dependencies OK"
} catch {
    if ($_.Exception.Message -match "not allowed|unauthorized|access") {
        Print_Error "Site access denied (user: '$($_c.local.user)')"
        Print_Text "  -> Check password in Config tab > local.password"
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
        Print_Text "  -> Try opening the site in a browser to confirm credentials"
    }
    throw
}

Print_Title "Pull Updates"
Print_Text "Checking site switches..."
EnablonCheckSwitches -SiteParams $_c.local.site_api_params -Switches $_c.local.switches
Print_Text "Checking out $($_c.feature_branch)..."
CheckoutBranch -Repository $_c.local.repository -SourceBranch $_c.target_branch -Branch $_c.feature_branch -ExpectedToExist $true | Out-Null
Print_Text "Pulling incremental changes... adding toppings to the donut"
try {
    EnablonPull -SiteParams $_c.local.site_api_params
    Print_Status "Pull completed"
} catch {
    $errMsg = $_.Exception.Message
    Print_Error "Pull failed: $errMsg"
    if ($errMsg -match "Parent site configuration is invalid|WsdlLocation") {
        Print_Text "  -> The parent site path '$($_c.local.parent_site)' seems incorrect or unreachable."
        Print_Text "  -> Go to Config tab > 'local.parent_site' and update it."
        Print_Text "  -> The parent site must be accessible at: http://localhost$($_c.local.parent_site)/"
    } elseif ($errMsg -match "not allowed|unauthorized|access|401") {
        Print_Text "  -> Check your credentials in Config tab > 'local.user' and 'local.password'."
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
    } else {
        Print_Text "  -> Check that the local site is running and accessible."
        Print_Text "  -> Verify: http://localhost/$($_c.local.site_id)"
    }
    throw
}

$Links = @("Local Site Link : http://localhost/$($_c.local.site_id)/go.aspx?u=/adm/builder")
Print_Script_End "Donut updated! You can continue working on your local site." -Links $Links
