
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json",
    [bool] $NoEnv = $false
)

$ErrorActionPreference = "Stop"
$RootPath =  Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"
CheckPrerequisites

Print_Script_Title "SET MASTER PACKAGES"
Print_Text "Rolling the dough... preparing ingredients"

if ($NoEnv) {
    Print_Text "No-env mode: interactive package selection"
    UpdateMasterPackages -ServerInstance "(local)"
    RegenerateMetadata -RootPath $RootPath
    return;
}

Print_Title "Loading Configuration"
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile
Print_Status "Environment: $EnvFile"
Print_Text "Site: $($_c.local.site_path)"
Print_Text "Database: $($_c.local.site_id)"

Print_Title "Checking Prerequisites"
CheckLocalSiteExists -LocalSite $_c.local.site_path
Print_Status "Site path exists"

# Check Azure DevOps connectivity (informational only).
# Set Master Packages works entirely against the LOCAL SQL database and IIS; it
# never pulls from Azure DevOps. Connectivity is only used by the optional remote
# version/git4inno checks in CheckDependencies, which are themselves non-blocking.
# So a missing VPN must not stop this script — just warn.
if ($_c.azdo.base_uri -match "https?://([^/]+)") {
    $remoteHost = $Matches[1]
    Print_Text "Checking connectivity to $remoteHost..."
    try {
        $null = [System.Net.Dns]::GetHostAddresses($remoteHost)
    } catch {
        Print_Warning "Cannot reach $remoteHost (VPN disconnected?) - skipping remote version checks and continuing with local SQL/IIS work."
    }
}

Print_Text "Checking dependencies (DONUT version, git4inno, Auto Delivery)..."
try {
    CheckDependencies -RootPath $RootPath -AzDoBaseURI $_c.azdo.base_uri -AzDoToken $_c.azdo.token -SiteParams $_c.local.site_api_params
    Print_Status "Dependencies OK"
} catch {
    if ($_.Exception.Message -match "not allowed|unauthorized|access|Cannot convert") {
        Print_Error "Site access denied (user: '$($_c.local.user)')"
        Print_Text "  -> Check password in Config tab > local.password"
        Print_Text "  -> Verify the site is running: http://localhost/$($_c.local.site_id)"
        Print_Text "  -> Try opening the site in a browser to confirm credentials"
    } else {
        Print_Error "$($_.Exception.Message)"
    }
    throw
}

# Update Packages
if ($_c.packages.Count -gt 0) {
    Print_Title "Set Master Packages"
    Print_Text "Glazing $($_c.packages.Count) donut(s): $($_c.packages -join ', ')"
    Print_Text "Updating SQL database to open/close packages..."
    Print_Text "SQL Server: (local) | Database: $($_c.local.site_id) | User: $($_c.local.db_user)"
    try {
        UpdateMasterPackages -ServerInstance "(local)" -SiteId $_c.local.site_id -Packages $_c.packages -DBUser $_c.local.db_user -DBSafePassw0rd $_c.local.db_password
        Print_Status "Packages updated in database"
    } catch {
        Print_Error "Failed to update packages: $($_.Exception.Message)"
        Print_Text "Possible causes: SQL Server not running, wrong credentials, or wrong database name"
        throw
    }

    Print_Title "Regenerate Metadata"
    Print_Text "Sprinkling the final touches..."
    $Regenerated = RegenerateMetadata -RootPath $RootPath
    if ($Regenerated) { Print_Status "Metadata regenerated successfully" }
    else { Print_Warning "Metadata not regenerated - you may need to do this manually" }

    $Links = @("Local Site Link : http://localhost/$($_c.local.site_id)/go.aspx?u=/adm/builder")
    Print_Script_End "Donuts are ready! You can now make a pull-force$(if($Regenerated) {''} else {" AFTER regenerating the site metadata"})." -Links $Links
} else {
    Print_Warning "No packages defined in configuration"
    Print_Script_End "Nothing baked today. Add packages in config first."
}
