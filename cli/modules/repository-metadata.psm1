# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$SaveToGitConfigFile = $Paths.Git4InnoConfig
$SaveToGitErrorFile = $Paths.Git4InnoError

function Metadata_WriteSaveToGitConfigFile {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [PSCustomObject] $PackagesMapping,
        [Parameter(Mandatory = $true)]
        [string] $RootPath,
        [string []] $Packages = @(),
        [bool] $IgnoreConfiguration = $false
    )

    Print_Text "Updating file '$SaveToGitConfigFile'..."
    $LocalSettings = @{
        "PackageToRepositoryMapping" = [ordered]@{
            "Mapping" = if ($IgnoreConfiguration) { @{ "EHS" = [ordered]@{} } } else { [ordered]@{} }
            "Excluded" = $PackagesMapping.Excluded
        }
    }

    if ($Packages.Count -gt 0) {
        foreach ($Package in $PackagesMapping.Mapping.psobject.properties.name)
        {
            if ($IgnoreConfiguration) {
                $PackagesMapping.Mapping.$Package.PSObject.Properties | ForEach-Object {
                    $LocalSettings['PackageToRepositoryMapping']['Mapping']['EHS'][$_.Name] = $_.Value
                }
            } elseif ($Packages -contains $Package) {
                $LocalSettings['PackageToRepositoryMapping']['Mapping'][$Package] = $PackagesMapping.Mapping.$Package
            } else {
                $LocalSettings['PackageToRepositoryMapping']['Excluded'] += $PackagesMapping.Mapping.$Package.psobject.properties.name
            }
        }
    } else {
        $LocalSettings['PackageToRepositoryMapping']['Mapping'] = $PackagesMapping.Mapping
    }

    $Json = $LocalSettings | ConvertTo-Json -Depth 10
    New-Item -Path "$RootPath\$SaveToGitConfigFile" -ItemType "file" -Value $Json -Force | Out-Null
    Print_Text "File '$SaveToGitConfigFile' updated."
}

function Metadata_SaveToGit {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $RootPath,
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $SitePath,
        [Parameter(Mandatory = $true)]
        [string] $SiteId,
        [Parameter(Mandatory = $true)]
        [string] $Branch,
        [Parameter(Mandatory = $true)]
        [string] $Message,
        [string] $DBUser = "sa",
        [string] $DBSafePassw0rd = ""
    )

    Print_Title "Create/Update Metadata Local Repository."
    $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    # Escape single quotes in all parameters to prevent command injection
    $SafeMessage = $Message -replace "'", "''"
    $SafeSitePath = $SitePath -replace "'", "''"
    $SafeRepository = $Repository -replace "'", "''"
    $SafeBranch = $Branch -replace "'", "''"
    $SafePassword = $DBSafePassw0rd -replace "'", "''"
    $SafeSiteId = $SiteId -replace "'", "''"
    $SafeDBUser = $DBUser -replace "'", "''"

    $ArgumentList = @(
        "git4inno databaseToRepository",
        "--configurationPath '$RootPath\$SaveToGitConfigFile'",
        "--sitePath '$SafeSitePath'",
        "--connectionString 'Server=(local);Database=$SafeSiteId;User Id=$SafeDBUser;Password=$SafePassword;'",
        "--repositoryPath '$SafeRepository'",
        "--message '$SafeMessage'",
        "--branch '$SafeBranch'"
    )

    $ErrorFile = "$RootPath\$SaveToGitErrorFile"
    $OutputFile = "$RootPath\$($SaveToGitErrorFile.Replace('error', 'output'))"
    New-Item -Path $ErrorFile -ItemType "file" -Force | Out-Null
    New-Item -Path $OutputFile -ItemType "file" -Force | Out-Null

    # Ensure dotnet global tools are in PATH (git4inno is a dotnet global tool)
    $dotnetToolsPath = [System.IO.Path]::Combine($env:USERPROFILE, ".dotnet", "tools")
    if ($dotnetToolsPath -and (Test-Path $dotnetToolsPath) -and -not ($env:PATH -split ';' | Where-Object { $_ -eq $dotnetToolsPath })) {
        $env:PATH = "$dotnetToolsPath;$env:PATH"
    }

    $Command = $ArgumentList  -join " "
    Print_Text $Command
    $proc = Start-Process -FilePath pwsh.exe -ArgumentList "-NoProfile -Command $Command" -RedirectStandardError $ErrorFile -RedirectStandardOutput $OutputFile -PassThru -WindowStyle Hidden
    $finished = $proc.WaitForExit(300000) # 5 minute timeout
    if (-not $finished) {
        $proc.Kill()
        throw "Metadata SaveToGit timed out after 5 minutes."
    }

    # Show stdout in terminal for visibility
    $OutputMsg = Get-Content -Path $OutputFile -ErrorAction SilentlyContinue
    if ($OutputMsg) {
        $OutputMsg | ForEach-Object { Print_Text $_ }
    }

    # Check exit code (critical: git4inno may fail without writing to stderr)
    if ($proc.ExitCode -ne 0) {
        $ErrorMsg = Get-Content -Path $ErrorFile -ErrorAction SilentlyContinue
        $errText = if ($ErrorMsg) { $ErrorMsg -join "`n" } else { "Process exited with code $($proc.ExitCode)" }
        throw "Metadata SaveToGit failed (exit code $($proc.ExitCode)): $errText"
    }

    $ErrorMsg = Get-Content -Path $ErrorFile -ErrorAction SilentlyContinue
    if ($ErrorMsg -and ($ErrorMsg | Where-Object { $_.Trim() }).Count -gt 0) {
        throw ($ErrorMsg -join "`n")
    }

    $Stopwatch.Stop()
    Print_Text "Metadata repository updated in $($Stopwatch.Elapsed)."
}

function Metadata_CheckBranchExistsLocaly {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Branch,
        [string] $Message = ""
    )

    if (Test-Path -Path $Repository) {
        if (-not (git -C "$Repository" show-ref "refs/heads/$Branch")) {
            throw "Branch '$Branch' was not found. $Message"
        }
    } else {
        throw "Metadata Repository '$Repository' doesn't exist. $Message"
    }
}

function Metadata_CreateBranch {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Branch,
        [Parameter(Mandatory = $true)]
        [string[]] $SourceBranches
    )

    Print_Title "Create Branch '$Branch' in Metadata Repository '$Repository'"
    git -C "$Repository" fetch origin -q | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed in metadata repository (exit code $LASTEXITCODE)" }

    if (-not (git -C "$Repository" show-ref "refs/heads/$Branch")) {
        $BranchCreated = $false
        foreach ($SourceBranch in $SourceBranches) {
            if ((git -C "$Repository" show-ref "refs/remotes/origin/$SourceBranch") -or (git -C "$Repository" show-ref "refs/heads/$SourceBranch")) {
                git -C "$Repository" branch "$Branch" "$SourceBranch" | Out-Host
                if ($LASTEXITCODE -ne 0) { throw "git branch '$Branch' from '$SourceBranch' failed (exit code $LASTEXITCODE)" }
                Print_Text "Selected Source branch: '$SourceBranch'."
                $BranchCreated = $true
                break
            }
        }
        if (-not $BranchCreated) {
            throw "None of the provided Source Branches were found in the origin: $SourceBranches"
        }
    } else {
        Print_Text "Branch already created."
    }
}

function Metadata_Push {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [Parameter(Mandatory = $true)]
        [string] $Branch,
        [Parameter(Mandatory = $true)]
        [string] $AzDoRepository,
        [Parameter(Mandatory = $true)]
        [string] $AzDoBranch
    )

    Print_Title "Push Metadata status from local Branch '$Branch' to '$AzDoRepository' in Branch '$AzDoBranch'"
    git -C "$Repository" push -u origin "${Branch}:$AzDoBranch" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "git push metadata to '$AzDoBranch' failed (exit code $LASTEXITCODE)" }
}

Export-ModuleMember -Function Metadata_WriteSaveToGitConfigFile
Export-ModuleMember -Function Metadata_SaveToGit
Export-ModuleMember -Function Metadata_CheckBranchExistsLocaly
Export-ModuleMember -Function Metadata_CreateBranch
Export-ModuleMember -Function Metadata_Push
