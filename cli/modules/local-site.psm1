# using module "..\modules\http-request.psm1"
# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$script:UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

function CheckLocalSiteExists {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $LocalSite
    )

    Print_Title "Check that provided local site exists"
    if (-not (Test-Path "$LocalSite\db")) {
        throw "No Enablon site found at this location: '$LocalSite'"
    }
}

function CallLocalAPI {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [string] $FunctionName,
        [string] $TableName = "Tools",
        [hashtable] $Params = @{}
    )

    $Uri = "http://localhost/$($SiteParams["SiteId"])/?v=/dlv/$TableName&fct=$FunctionName"
    $Body = @{
        fct_name = $FunctionName
        params = $Params
    }
    $Authentication = @{
        userid = $SiteParams["User"]
        password = $SiteParams["SafePassw0rd"]
        siteid = $SiteParams["SiteId"]
    }

    try {
        $response = SendRestRequestToEnablon -Uri $Uri -Body $Body -Authentication $Authentication -StoredSession $SiteParams["Session"]
        return $response
    } catch {
        $errorDetail = $_.Exception.Message
        if ($errorDetail -match "Unable to connect|No connection|connection was refused") {
            throw "Site unreachable at http://localhost/$($SiteParams["SiteId"]). Check: 1) IIS is running (iisreset /start) 2) Site exists in IIS Manager 3) AppPool is started"
        } elseif ($errorDetail -match "401|unauthorized|not allowed|access denied") {
            throw "Site authentication failed (user: '$($SiteParams["User"])'). Check: 1) Password in Config > local.password 2) User exists on the site 3) 'Force SSL' is unchecked in WizManager"
        } else {
            throw "Site API call '$FunctionName' failed: $errorDetail"
        }
    }
}

function ManageResponseStatus {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $Action,
        [Parameter(Mandatory = $true)]
        [string] $Status,
        [Parameter(Mandatory = $true)]
        [string] $Message,
        [Parameter(Mandatory = $true)]
        [bool] $FailIfNothingToProcess
    )

    switch($Status) {
        -1 { # Nothing to Process
            if ($FailIfNothingToProcess) {
                Print_Error "$Message."
                throw "$Action failed."
            } else {
                Print_Status "$Message."
            }
        }
        0 { # OK
            Print_Status "$Action successful."
        }
        1 { # Warnings
            Print_Warning "WARNING: $Message."
            Print_Warning "These warnings are not blocking the update but they may be things to be looked into."
            Print_Request
            Print_Status "$Action successful."
        }
        2 { # Errors
            Print_Error "ERROR: $Message."
            throw "$Action failed."
        }
        3 { # Conflicts
            Print_Error "CONFLICT: $Message."
            throw "$Action failed."
        }
        4 { # Critical Errors
            Print_Error "CRITICAL ERROR: $Message."
            throw "$Action failed."
        }
        default { throw "Unknown status '$Status'." }
    }
}

function EnablonGetADEVersion {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams
    )

    $Params = @{
        "nVersionType" = 1
        "sObjectTag" = "Autodelivery"
        "nObjectType" = 20
    }

    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "sGetVersion" -TableName "PickAndChoose" -Params $Params
    return $Response.data
}

function EnablonUpdateADE {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams
    )

    Print_Text "Update Auto Delivery"
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "UpdateAutoDelivery" -TableName "PickAndChoose"
    return $Response.data
}

function EnablonSetParentSite {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [string] $ParentSite
    )

    Print_Title "Set Parent Site."
    CallLocalAPI -SiteParams $SiteParams -FunctionName "SetParentSite" -Params @{sParentSite = $ParentSite} | Out-Null
    Print_Status "Parent Site updated."
}

function EnablonSetSwitches {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [hashtable] $Switches
    )

    Print_Title "Initialize Switches."
    CallLocalAPI -SiteParams $SiteParams -FunctionName "SetSwitches" -Params @{odSwitches = $Switches} | Out-Null
    Print_Status "Switches updated."
}
function EnablonCheckSwitches {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [hashtable] $Switches
    )

    Print_Title "Check Switches."
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "GetSwitches"

    $nbErrors = 0
    $Response.data.PSObject.Properties | ForEach-Object {
        if ($_.Value -ne $Switches[$_.Name]) {
            $nbErrors++
            Print_Warning "Switch '$($_.Name)' has not the expected value: '$($_.Value)' instead of '$($Switches[$_.Name])'."
        }
    }

    if ($nbErrors) {
        Print_Warning "WARNING: This may be the indication of you working on the wrong local site. Make sure you know what you are doing."
        Print_Request
    }
}

function EnablonStatus {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [string] $Action,
        [string[]] $Packages = @()
    )

    Print_Title "Retrieve Local Site Status."
    $Params = @{sAction = $Action}
    if ($Packages.Count -gt 0) {
        $Params["asPackages"] = $Packages
    }
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "Status" -Params $Params

    switch($Action) {
        "pullforce" {
            Print_SubTitle "Pull Force"
            Print_Text ($Response.data.pullforce | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, version, pull_force_version, is_modified, name -AutoSize | Out-String)

            if ($Response.data.pullforce.Count -eq 0) {
                throw "No master package was found on this site."
            }

            if ($Packages.Count -gt 0) {
                $WorkingPackagesNotMaster = (Compare-Object $Packages $Response.data.pullforce.xmltag | Where-Object {$_.sideindicator -eq "<="}).InputObject
                if ($WorkingPackagesNotMaster.Count -gt 0) {
                    throw "The packages $($WorkingPackagesNotMaster -join ", ") are declared as working packages in the configuration but are not master on this site."
                }
            }
        }
        "commit" {
            Print_SubTitle "Commit"
            Print_Text ($Response.data.commit | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, version, commit_version, name -AutoSize | Out-String)
        }
        default { throw "Unknown action '$Action'." }
    }

    if ($Response.data.not_master_modified.Count -gt 0) {
        Print_Warning "WARNING : List of Modified Packages not Master"
        Print_Warning "This should not happen in a 'normal' setup, use another ENA or make sure this won't impact your work."
        Print_Text ($Response.data.not_master_modified | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, version, name -AutoSize | Out-String)
    }

    if ($Response.data.master_not_master_on_parent_site.Count -gt 0) {
        Print_Warning "WARNING: List of Master Packages not Master on Parent Site"
        Print_Warning "This may be the indication that the parent site is wrong, make sure you know what you are doing."
        Print_Text ($Response.data.master_not_master_on_parent_site | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, version, name -AutoSize | Out-String)
    }

    Print_Request "Please review the Status report."
}

function EnablonCreateRepository {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [Parameter(Mandatory = $true)]
        [string] $Repository,
        [string] $CloneUrl
    )

    if (-Not (Test-Path -Path $Repository)) {
        Print_Title "Create local repository."
        Print_Text "Creating local repository... this may take a few minutes."

        $gitParent = Split-Path $Repository -Parent
        if (-not (Test-Path $gitParent)) { New-Item -Path $gitParent -ItemType Directory -Force | Out-Null }

        $cloned = $false
        # Try git CLI clone first (uses current user's git credentials — always works)
        if ($CloneUrl) {
            Print_Text "Cloning via git CLI: $CloneUrl"
            $cloneResult = git clone $CloneUrl $Repository 2>&1
            if ($LASTEXITCODE -eq 0) {
                Print_Status "Repository cloned via git CLI."
                $cloned = $true
            } else {
                Print_Warning "Git CLI clone failed: $cloneResult"
                Print_Text "Falling back to Enablon API..."
            }
        }

        # Fallback to Enablon API
        if (-not $cloned) {
            try {
                CallLocalAPI -SiteParams $SiteParams -FunctionName "CreateRepository" | Out-Null
                Print_Status "Repository created via Enablon API."
            } catch {
                Print_Error "Repository creation failed: $($_.Exception.Message)"
                Print_Text "Try: 1) Check VPN  2) Reset git credentials in DevOps tab  3) Verify PAT scope"
                throw
            }
        }

        git config --global --add safe.directory $Repository.Replace("\", "/") 2>$null | Out-Null
        git config --system --add safe.directory $Repository.Replace("\", "/") 2>$null | Out-Null

        # Fix ownership for IIS AppPool (LibGit2Sharp checks file owner, not git safe.directory)
        # Detect the actual IIS AppPool running the site
        $siteId = $SiteParams["SiteId"]
        $iisUser = "IIS APPPOOL\DefaultAppPool"
        try {
            $poolDetect = & "$env:SystemRoot\System32\inetsrv\appcmd.exe" list app "/site.name:$siteId" /text:APPPOOL.NAME 2>$null
            if ($poolDetect) { $iisUser = "IIS APPPOOL\$($poolDetect.Trim())" }
        } catch {}
        Print_Text "Transferring repository ownership to $iisUser (requires elevation)..."
        try {
            $cmd = "takeown /F `"$Repository`" /R /A /D Y > nul 2>&1 & icacls `"$Repository`" /setowner `"$iisUser`" /T /C /Q > nul 2>&1 & icacls `"$Repository`" /grant `"BUILTIN\IIS_IUSRS:(OI)(CI)F`" /T /C /Q > nul 2>&1"
            $proc = Start-Process cmd -ArgumentList "/C $cmd" -Verb RunAs -PassThru -WindowStyle Hidden
            $finished = $proc.WaitForExit(30000)
            if ($finished) {
                Print_Status "Ownership transferred to $iisUser"
            } else {
                Print_Warning "Ownership transfer timed out"
            }
        } catch {
            Print_Warning "Could not elevate to change ownership: $($_.Exception.Message)"
            Print_Text "Run as administrator: icacls `"$Repository`" /setowner `"$iisUser`" /T /C /Q"
        }
    } else {
        Print_Text "Repository already exists at $Repository"
    }
}

function EnablonPullForce {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams
    )

    Print_Title "Pull Force on local site."
    if ($env:DONUT_GUI -eq "1") {
        Print_Text "Pull Force in progress... this may take a few minutes."
    } elseif ($script:UseGum) {
        gum style --foreground 212 "This may take a few minutes..."
    } else {
        Print_Text "It may take a few minutes..."
    }
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "PullForce"
    ManageResponseStatus -Action "Pull Force" -Status $Response.data.status -Message ($Response.data.msg -replace '<[^>]+>', ' ') -FailIfNothingToProcess $true
}

function EnablonPull {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams
    )

    Print_Title "Pull Branch Content on local site."
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "Pull"
    ManageResponseStatus -Action "Pull" -Status $Response.data.status -Message ($Response.data.msg -replace '<[^>]+>', ' ') -FailIfNothingToProcess $false
}

function EnablonCommit {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [string[]] $Packages = @()
    )

    Print_Title "Commit changes on Master Packages on local site."
    $Params = if ($Packages.Count -eq 0) {@{}} Else {@{asPackages = $Packages}}
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "Commit" -Params $Params
    Print_Status "Commit successful."
    Print_Text ($Response.data | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, version, name -AutoSize | Out-String)

    return $Response.data
}

function EnablonPush {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [hashtable] $SiteParams,
        [string[]] $Packages = @()
    )

    Print_Title "Push changes to the Local Repository."
    $Params = if ($Packages.Count -eq 0) {@{}} Else {@{asPackages = $Packages}}
    $Response = CallLocalAPI -SiteParams $SiteParams -FunctionName "PushCommit" -Params $Params
    Print_Status "Push successful."
    Print_Text ($Response.data | ForEach-Object {[PSCustomObject]$_} | Format-Table -Property xmltag, from_version, to_version, name -AutoSize | Out-String)
}

Export-ModuleMember -Function CheckLocalSiteExists
Export-ModuleMember -Function EnablonGetADEVersion
Export-ModuleMember -Function EnablonUpdateADE
Export-ModuleMember -Function EnablonSetParentSite
Export-ModuleMember -Function EnablonSetSwitches
Export-ModuleMember -Function EnablonCheckSwitches
Export-ModuleMember -Function EnablonStatus
Export-ModuleMember -Function EnablonCreateRepository
Export-ModuleMember -Function EnablonPullForce
Export-ModuleMember -Function EnablonPull
Export-ModuleMember -Function EnablonCommit
Export-ModuleMember -Function EnablonPush
