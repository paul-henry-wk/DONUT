$ErrorActionPreference = "Stop"

$script:CredentialTarget = "DONUT_AzDo_PAT"

function Get-StoredPAT {
    [CmdletBinding()]
    param(
        [string] $Organization = ""
    )

    $target = "$($script:CredentialTarget)_$Organization"

    try {
        # Try Windows Credential Manager via cmdkey
        $result = cmdkey /list:$target 2>&1
        if ($result -match "User:") {
            # Try CredentialManager module if available, else parse cmdkey output
            if (Get-Module -ListAvailable -Name CredentialManager -ErrorAction SilentlyContinue) {
                $cred = Get-StoredCredential -Target $target -ErrorAction SilentlyContinue
                if ($cred) {
                    return $cred.GetNetworkCredential().Password
                }
            }
            # cmdkey can store but not easily retrieve passwords — rely on Set-StoredPAT using cmdkey
            # and the env variable fallback below
        }
    } catch {
        Write-Verbose "Credential Manager lookup failed for '$target': $($_.Exception.Message) — falling back to environment variable"
    }

    # Fallback: try reading from environment variable
    $envToken = [System.Environment]::GetEnvironmentVariable("DONUT_AZDO_TOKEN", "User")
    if ($envToken) { return $envToken }

    return $null
}

function Set-StoredPAT {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Token,
        [string] $Organization = ""
    )

    $target = "$($script:CredentialTarget)_$Organization"

    try {
        # Store in Windows Credential Manager via cmdkey
        cmdkey /add:$target /user:donut /pass:$Token | Out-Null
        # Also store in env variable as reliable retrieval fallback (cmdkey cannot easily retrieve passwords)
        [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $Token, "User")
        return $true
    } catch {
        # Fallback: store as user environment variable only
        Write-Verbose "Credential Manager store failed for '$target': $($_.Exception.Message) — falling back to environment variable"
        [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $Token, "User")
        return $true
    }
}

function Remove-StoredPAT {
    [CmdletBinding()]
    param(
        [string] $Organization = ""
    )

    $target = "$($script:CredentialTarget)_$Organization"

    try {
        cmdkey /delete:$target 2>&1 | Out-Null
    } catch {
        Write-Verbose "Credential Manager delete failed for '$target': $($_.Exception.Message)"
    }

    [System.Environment]::SetEnvironmentVariable("DONUT_AZDO_TOKEN", $null, "User")
}

function Resolve-PAT {
    [CmdletBinding()]
    param(
        [string] $ConfigToken,
        [string] $Organization = ""
    )

    # 1. Config file token takes priority if non-empty and not the "STORED" placeholder
    if ($ConfigToken -and $ConfigToken -ne "STORED" -and $ConfigToken.Trim().Length -ge 10) {
        return $ConfigToken.Trim()
    }

    # 2. Try stored credential
    $stored = Get-StoredPAT -Organization $Organization
    if ($stored) { return $stored }

    # 3. Interactive prompt (skip in DONUT GUI — PAT must be in config)
    if ($env:DONUT_GUI -eq "1") {
        throw "PAT not configured. Go to Config tab > azdo.token and paste your Personal Access Token. Create one at: Azure DevOps > User Settings > Personal Access Tokens (scopes: Code Read&Write, Work Items Read)"
    }

    $UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)
    if ($UseGum) {
        $token = gum input --header "Azure DevOps PAT required" --password --placeholder "Paste your Personal Access Token"
    } else {
        $secureToken = Read-Host "Azure DevOps PAT required" -AsSecureString
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken))
    }

    if (-not $token) {
        throw "PAT is required to continue."
    }

    # Offer to store
    if ($UseGum) {
        gum confirm "Save this PAT for future use?" --default=Yes 2>&1
        if ($LASTEXITCODE -eq 0) {
            Set-StoredPAT -Token $token -Organization $Organization
            Write-Host "PAT stored securely." -ForegroundColor Green
        }
    } else {
        $answer = Read-Host "Save this PAT for future use? (Y/N)"
        if ($answer -eq 'Y' -or $answer -eq 'y') {
            Set-StoredPAT -Token $token -Organization $Organization
            Write-Host "PAT stored securely." -ForegroundColor Green
        }
    }

    return $token
}

Export-ModuleMember -Function Get-StoredPAT
Export-ModuleMember -Function Set-StoredPAT
Export-ModuleMember -Function Remove-StoredPAT
Export-ModuleMember -Function Resolve-PAT
