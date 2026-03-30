# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$ConfigHashFile = $Paths.ConfigHash
$LocalSiteSession = @{
    Cookies = $Paths.SessionCookies
    Logs = $Paths.SessionLogs
}

$ExpectedConfig = [ordered]@{
    "workitem_id" = "";
    "feature_branch" = $null;
    "target_branch" = $null;
    "packages" = @();

    "local.site_path" = $null;
    "local.parent_site" = $null;
    "local.user" = "admin";
    "local.password" = $null;
    "local.db_user" = "sa";
    "local.db_password" = "enablon";

    "azdo.organization" = "enablon";
    "azdo.project" = "Vision%20Platform";
    "azdo.token" = $null;
    "azdo.repository" = $null;
    "azdo.repository_metadata" = "Test.Package.Metadata.GitObjectDB";

    "git.username" = git config --global user.name;
    "git.email" = git config --global user.email;

    "deactivate_metadata_conversion" = $false
}

function GetValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.OrderedHashtable] $Config,
        [Parameter(Mandatory = $true)]
        [string] $Key
    )

    $KeyParts = $Key.Split(".")
    
    if ($KeyParts.Count -eq 1) { 
        return $Config.$Key
    } else {
        $Key1 = $KeyParts[0]
        $Key2 = $KeyParts[1]
        return $Config.$Key1.$Key2
    }
}

function SetValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.OrderedHashtable] $Config,
        [Parameter(Mandatory = $true)]
        [string] $Key,
        [Parameter(Mandatory = $true)]
        [object] $Value
    )

    $KeyParts = $Key.Split(".")
    
    if ($KeyParts.Count -eq 1) { 
        $Config.$Key = $Value
    } else {
        $Key1 = $KeyParts[0]
        if (!$Config.$Key1) { $Config.$Key1 = @{} }

        $Key2 = $KeyParts[1]
        $Config.$Key1.$Key2 = $Value
    }
}

function LoadConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RootPath,
        [Parameter(Mandatory = $true)]
        [string] $EnvFile,
        [bool] $Interactive = $true
    )

    $FullEnvFile = If($EnvFile -match "^\.env(-.+)?\.json$") { $EnvFile } else { ".env-$EnvFile.json" }

    $Path = "$RootPath\working-environments\$FullEnvFile"
    if (-not (Test-Path -Path $Path)) {
        throw "You provided the -EnvFile parameter '$EnvFile'. Env file '$Path' does not exist."
    }
    
    Print_Title "Load Config from file '$Path'"
    $Config = Get-Content -Raw -Path $Path | ConvertFrom-Json -AsHashtable

    # Validate Config File & Provide Default Values
    $ExpectedConfig.GetEnumerator() | ForEach-Object {
        $Key = $_.Key
        $Value = GetValue -Config $Config -Key $Key

        if ($null -ne $Value) {
            $DisplayValue = if ($Key -match 'token|password|secret') { ($Value.ToString().Substring(0, [Math]::Min(4, $Value.ToString().Length)) + '****') } else { $Value }
            Print_Text "$Key = $DisplayValue"
        } else {
            if ($null -eq $_.Value) {
                $suffix = if ($Key.StartsWith("git.")) {" (alternatively you can set git config --global)"} else {""}
                throw "$Key NOT PROVIDED$suffix."
            } else {
                SetValue -Config $Config -Key $Key -Value $_.Value
                    $suffix = if ($Key.StartsWith("git.")) {"(from git config --global)"} else {"(default)"}
                    $DefaultDisplay = if ($Key -match 'token|password|secret') { ($_.Value.ToString().Substring(0, [Math]::Min(4, $_.Value.ToString().Length)) + '****') } else { $_.Value }
                    Print_Text "$Key = $DefaultDisplay $suffix"
            }
        }
    }
    
    # Resolve PAT (credential store or config file)
    $Config.azdo.token = Resolve-PAT -ConfigToken $Config.azdo.token -Organization $Config.azdo.organization

    # Extend Config
    $Config.local.site_id = Split-Path $Config.local.site_path -Leaf
    $Config.local.repository = "$($Config.local.site_path)\Git\$($Config.azdo.repository)"
    $Config.local.repository_metadata = "$($Config.local.site_path)\Git\VersionManager_Metadata"
    $Config.azdo.base_uri = "https://dev.azure.com/$($Config.azdo.organization)/$([uri]::EscapeDataString($Config.azdo.project))"
    $Config.convert_md = -not ($Config.deactivate_metadata_conversion)

    ExtendConfig_Enablon_Site -Config $Config -RootPath $RootPath
    ExtendConfig_Hash -Config $Config -RootPath $RootPath
    ExtendConfig_Metadata_Branches -Config $Config

    if ($Config.packages.Count -eq 0) {
        Print_Warning "WARNING: No view-diff will be generated because no working package has been declared in the config."
    }

    # Review
    if ($Interactive) {
        Print_Request "Please review the Configuration."
    }
    
    CleanUp -RootPath $RootPath
    return $Config
}

function ExtendConfig_Enablon_Site {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.OrderedHashtable] $Config,
        [Parameter(Mandatory = $true)]
        [string] $RootPath
    )

    $Config.local.switches = @{
        bEnableGit = $true
        sGitUrl = "$($Config.azdo.base_uri)/_git/$($Config.azdo.repository)/"
        sGitToken = $Config.azdo.token
        sGitUserName = $Config.git.username
        sGitEmail = $Config.git.email
        sGitRepository = $Config.azdo.repository
        sGitRemoteBranch = $Config.target_branch
        sGitCurrentBranch = $Config.feature_branch
    }

    $Config.local.site_api_params = @{
        SiteId = $Config.local.site_id
        User = $Config.local.user
        SafePassw0rd = $Config.local.password
        Session = @{
            Cookies = "$RootPath\$($LocalSiteSession.Cookies)".replace("*", $Config.local.site_id)
            Logs = "$RootPath\$($LocalSiteSession.Logs)".replace("*", "$($Config.local.site_id)_$(Get-Date -Format "yyyy-MM-dd")")
        }
    }
}

function ExtendConfig_Hash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.OrderedHashtable] $Config,
        [Parameter(Mandatory = $true)]
        [string] $RootPath
    )

    $HashConfig = [ordered]@{
        "feature_branch" = $Config.feature_branch;
        "target_branch" = $Config.target_branch;
        "packages" = $Config.packages;
    
        "local.computer_name" = $env:computername;
        "local.site_path" = $Config.local.site_path;
    
        "azdo.organization" = $Config.azdo.organization;
        "azdo.project" = $Config.azdo.project;
        "azdo.repository" = $Config.azdo.repository;
        "azdo.repository_metadata" = $Config.azdo.repository_metadata;
    }
    $Json = $HashConfig | ConvertTo-Json -Depth 10

    $Path = "$RootPath\$ConfigHashFile"
    New-Item -Path $Path -ItemType "file" -Value $Json -Force | Out-Null
    $Config.hash = (Get-FileHash $Path).Hash
}

function ExtendConfig_Metadata_Branches {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.OrderedHashtable] $Config
    )

    $Config.md_branches = @{
        start = @{
            local = "$($Config.feature_branch)_start__$($Config.hash)"
        }
        end= @{
            local = "$($Config.feature_branch)_end__$($Config.hash)"
        }
    }
    foreach ($package in $Config.packages) {
        $Config.md_branches.start.$package = "$($Config.feature_branch)_$($package)_start__$($Config.hash)"
        $Config.md_branches.end.$package = "$($Config.feature_branch)_$($package)_end__$($Config.hash)"
    }
}

function CleanUp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RootPath
    )
    
    # Delete outdated cookies session files
    $Path = "$RootPath\$(Split-Path $LocalSiteSession.Cookies -Parent)"
    $File = Split-Path $LocalSiteSession.Cookies -Leaf
    Get-ChildItem -Path $Path -Recurse -Filter $File -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt (Get-Date).AddHours(-24)} | ForEach-Object {Remove-Item -Path "$Path\$($_.Name)" -ErrorAction SilentlyContinue}

    # Delete outdated logs session files
    $Path = "$RootPath\$(Split-Path $LocalSiteSession.Logs -Parent)"
    $File = Split-Path $LocalSiteSession.Logs -Leaf
    Get-ChildItem -Path $Path -Recurse -Filter $File -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt (Get-Date).AddMonths(-1)} | ForEach-Object {Remove-Item -Path "$Path\$($_.Name)" -ErrorAction SilentlyContinue}
}

function ValidateCommitMessage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if ($Message -match '["¤¦|§]') {
        throw "Commit message cannot contain the following characters `"¤¦|§ because the Enablon Version Manager do not support them."
    }
}

Export-ModuleMember -Function LoadConfig
Export-ModuleMember -Function ValidateCommitMessage
