# using module "..\modules\azure.psm1"
# using module "..\modules\local-site.psm1"
# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$VersionFilePath = "cli\config\version.json"

function CheckPrerequisites {
    [CmdletBinding()]
    param()

    # Powershell
    $PowershellInstallCmd = "To update/install try running 'winget install --id Microsoft.Powershell --source winget' command or download installer."
    if(-not ($PSVersionTable.PSEdition -eq "Core")) {
        throw "This script needs to run on Powershell Core. Open a 'Powershell 7' console if already installed. $PowershellInstallCmd"
    }

    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw "You need your Powershell version to be at least 7.0.0 (current: $($PSVersionTable.PSVersion)). $PowershellInstallCmd"
    }

    # .Net Core
    $DotNetVersion = 8
    $DotnetDownloadLink = "You can install .Net SDK $DotNetVersion from here: https://dotnet.microsoft.com/en-us/download/dotnet/$DotNetVersion.0."
    if (Get-Command dotnet -errorAction SilentlyContinue) {
        if (-not ($DotNetVersion -in (dotnet --list-runtimes | ForEach-Object {$_.split(" ")[1].split(".")[0]}))) {
            throw ".Net $DotNetVersion not found. $DotnetDownloadLink"
        }
    } else {
        throw "'dotnet' command not found. $DotnetDownloadLink"
    }

    # git4inno Nuget Package
    if (-not (dotnet --list-sdks)) {
        throw ".Net SDK not found. It is needed to run 'dotnet nuget' command. $DotnetDownloadLink"
    }
}

function CheckDependencies {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RootPath,
        [Parameter(Mandatory = $true)]
        [string] $AzDoBaseURI,
        [Parameter(Mandatory = $true)]
        [string] $AzDoToken,
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams
    )

    Print_Title "Look for outdated dependencies."

    # Try fetching remote version (non-blocking: PAT errors are warnings, not fatal)
    $LastVersion = $null
    try {
        $LastVersion = GetConfigFile -FilePath $VersionFilePath -AzDoBaseURI $AzDoBaseURI -AzDoToken $AzDoToken
    } catch {
        if ($_.Exception.Message -match "401|403|unauthorized|expired") {
            Print_Warning "Azure DevOps PAT expired or unauthorized - skipping remote version check"
            Print_Text "  -> Update your PAT: Azure DevOps > User Settings > Personal Access Tokens"
            Print_Text "  -> Then paste the new token in DONUT Config tab > azdo.token"
        } else {
            Print_Warning "Cannot reach Azure DevOps - skipping remote version check: $($_.Exception.Message)"
        }
    }

    # DONUT
    Print_Text "Check DONUT"
    $Version = Get-Content -Raw -Path "$Rootpath\$VersionFilePath" | ConvertFrom-Json -AsHashtable

    if ($LastVersion -and (IsVersionOutdated -Actual ([string]$Version.version) -Expected ([string]$LastVersion.version))) {
        Print_Text "Update DONUT to the last available version (current: v$($Version.version), last: v$($LastVersion.version))."
        $currentBranch = git -C "$RootPath" symbolic-ref --short HEAD
        $mainBranch = "main"
        if ($currentBranch -eq $mainBranch) {
            git -C "$RootPath" pull | Out-Host
            Print_Warning "DONUT successfully updated please run your script again."
            throw "Script interrupted."
        } else {
            Print_Warning "Current branch '$currentBranch' is not '$mainBranch', automatic update ignored."
        }
    }

    # git4inno Nuget Package
    $Git4Inno = "enablon.git4inno"
    Print_Text "Check $Git4Inno"
    $Git4InnoVersion = [string]((dotnet tool list --global | ForEach-Object { $nuget = $_ -split '\s+'; if($nuget[0] -eq $Git4Inno) {$nuget[1]} }) | Select-Object -First 1)
    Print_Text "$Git4Inno version: $(if($Git4InnoVersion){"v$Git4InnoVersion"}else{'not installed'})"

    if ($LastVersion -and ((-not $Git4InnoVersion) -or (IsVersionOutDated -Actual $Git4InnoVersion -Expected ([string]$LastVersion.dependencies.git4inno)))) {
        $ArtifactoryUrl = "https://evisionsoftware.jfrog.io/artifactory/api/nuget/v3/dev-nuget/index.json"
        $NbOfArtifactoryFeed = (dotnet nuget list source --format=Short | ForEach-Object { if(($_ -split ' ')[1] -eq $ArtifactoryUrl) {1} else {0} } | Measure-Object -Sum).Sum
        if($NbOfArtifactoryFeed -eq 0) {
            throw "'Artifactory' nuget feed was not found. It needs to be added in order to get '$Git4Inno' nuget package, please see prerequisites in README file for more information."
        }

        Print_Text "Update '$Git4Inno' to the last version."
        $updateResult = dotnet tool update $Git4Inno --global
        if ($null -eq $updateResult) {
            throw "'$Git4Inno' update failed. This is most likely due to the 'Artifactory' nuget feed token being expired. You need to update it, see the 'Getting Started' section in README file."
        } else {
            Write-Host $updateResult
        }

        $NewGit4InnoVersion = [string]((dotnet tool list --global | ForEach-Object { $nuget = $_ -split '\s+'; if($nuget[0] -eq $Git4Inno) {$nuget[1]} }) | Select-Object -First 1)
        if (IsVersionOutDated -Actual $NewGit4InnoVersion -Expected ([string]$LastVersion.dependencies.git4inno)) {
            throw "'$Git4Inno' update has failed (actual: v$NewGit4InnoVersion, expected: v$($LastVersion.dependencies.git4inno))."
        }
    }

    if (-not (Get-Command git4inno -errorAction SilentlyContinue)) {
        throw "'git4inno' command not found. This can happen when the nuget package has just been installed. In that case you need to restart your terminal and/or IDE"
    }

    # Auto Delivery
    Print_Text "Check Auto Delivery"
    try {
        $VersionADE = [string](EnablonGetADEVersion -SiteParams $SiteParams)
        if (-not $VersionADE) { $VersionADE = "0.0.0" }
        Print_Text "Auto Delivery version: v$VersionADE"
        if ($LastVersion -and (IsVersionOutdated -Actual $VersionADE -Expected ([string]$LastVersion.dependencies.auto_delivery))) {
            Print_Text "Updating Auto Delivery..."
            EnablonUpdateADE -SiteParams $SiteParams

            $NewVersionADE = [string](EnablonGetADEVersion -SiteParams $SiteParams)
            if (-not $NewVersionADE) { $NewVersionADE = "0.0.0" }
            if ($LastVersion -and (IsVersionOutdated -Actual $NewVersionADE -Expected ([string]$LastVersion.dependencies.auto_delivery))) {
                throw "Auto Delivery package needs to be updated (actual: v$NewVersionADE, expected: v$($LastVersion.dependencies.auto_delivery))."
            }
        }
    } catch {
        if ($_.Exception.Message -match "not allowed|unauthorized|access|Cannot convert") {
            Print_Warning "Auto Delivery check skipped: $($_.Exception.Message)"
            Print_Text "This usually means the site is not accessible or credentials are wrong"
        } else {
            throw
        }
    }
}

function IsVersionOutDated {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Actual,
        [Parameter(Mandatory = $true)]
        [string] $Expected
    )

    $Actual_Version = $Actual -split "\."
    $Expected_Version = $Expected -split "\."

    for ($i=0; $i -lt $Expected_Version.Count; $i++) {
        $Actual_Nb = [int]$Actual_Version[$i]
        $Expected_Nb = [int]$Expected_Version[$i]

        if (-not ($Actual_Nb -eq $Expected_Nb)) {
            if($Actual_Nb -lt $Expected_Nb) {
                return $true
            } else {
                return $false
            }
        }
    }

    return $false
}

Export-ModuleMember -Function CheckPrerequisites
Export-ModuleMember -Function CheckDependencies
