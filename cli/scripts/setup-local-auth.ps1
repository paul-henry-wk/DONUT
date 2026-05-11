[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Print_Warning "WARNING: This script is not running as Administrator. IIS operations may fail."
}

Print_Script_Title "SETUP LOCAL AUTH"

$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

# Parameters from Config (same fields as health-check.ps1)
$ServerInstance = "(local)"
$Database       = $_c.local.site_id
$SqlUsername    = $_c.local.db_user
$SqlPassword    = $_c.local.db_password
$AdminUsername      = $_c.local.user
$AdminPassword      = $_c.local.password
$DeveloperPassword  = if ($_c.local.developer_password) { $_c.local.developer_password } else { $_c.local.password }

# Hardcoded defaults for password hash/salt
$PwdHash = '6A7481E0CA89D1DAB1B8CED04C473F4D74D1B0D2'
$PwdSalt = 'thisissalt'

$QueryTimeout = 5
$ConnectionTimeout = 5

function Invoke-SqlCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Query
    )
    Print_Text "SQL> $($Query -replace '\r\n', ' ' -replace '[\r\n]', ' ')"
    if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
        Invoke-Sqlcmd -ServerInstance $ServerInstance -Database $Database `
                      -Username $SqlUsername -Password $SqlPassword `
                      -Query $Query -QueryTimeout $QueryTimeout -ConnectionTimeout $ConnectionTimeout
    } elseif (Get-Command 'Sqlcmd' -ErrorAction SilentlyContinue) {
        & 'Sqlcmd' -S $ServerInstance -d $Database -U $SqlUsername -P $SqlPassword `
                   -Q $Query -t $QueryTimeout -l $ConnectionTimeout
    } else {
        throw "No SQL Server command-line tool found. Install sqlcmd or the SqlServer PowerShell module."
    }
}

Print_SubTitle "Using SQL Server instance: $ServerInstance"
Print_SubTitle "Using SQL Server database: $Database"

# ── 1. Reset external migrate auth ──
$siteDirectory = $_c.local.site_path
$installDir = Split-Path (Split-Path $siteDirectory -Parent) -Parent
$wizManager = "$installDir\Binary\WizManager.exe"

if (Test-Path $wizManager) {
    Print_Text "Resetting external migrate auth for site at $siteDirectory"
    & $wizManager /resetexternalmigrateauth $Database /nostop
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "WizManager exited with code $LASTEXITCODE"
    }
} else {
    Print_Warning "WizManager not found at '$wizManager' — skipping resetexternalmigrateauth"
}

# ── 2. Update user account ──
if ($AdminUsername -notmatch '^[a-zA-Z0-9_\-\.@]+$') {
    throw "Invalid admin username: '$AdminUsername'"
}
Print_Title "Updating user account '$AdminUsername'"
Invoke-SqlCommand -Query @"
UPDATE S_Adm_Users
SET Pwd        = '$PwdHash',
    PwdSalt    = '$PwdSalt',
    AccountStatus = 3,
    Ac_dl      = '<Administrator>'
WHERE UserId   = '$AdminUsername';
"@
Print_Status "User '$AdminUsername' updated."

# ── 3. Set developer password ──
$appServerConfig = "$installDir\Binary\appserverconfig.exe"
if (Test-Path $appServerConfig) {
    Print_Title "Setting developer password for site '$Database'"
    & $appServerConfig site modify $Database --builder.developerPassword $DeveloperPassword
    if ($LASTEXITCODE -ne 0) {
        Print_Warning "appserverconfig exited with code $LASTEXITCODE"
    } else {
        Print_Status "Developer password set."
    }
} else {
    Print_Warning "appserverconfig not found at '$appServerConfig' — skipping developer password"
}

# ── 4. Regenerate metadata & restart IIS ──
$Regenerated = RegenerateMetadata -RootPath $RootPath -Interactive $false
if ($Regenerated) {
    Print_Status "Metadata regenerated successfully"
} else {
    Print_Warning "Metadata not regenerated — you may need to run 'iisreset' as administrator"
}

# ── 5. Wait for site to be back online before handing off to next setup step ──
if ($Regenerated) {
    $SiteId  = $_c.local.site_id
    $siteUrl = "http://localhost/$SiteId/"
    Print_Title "Waiting for site to come back online"
    Print_Text "Polling $siteUrl ..."

    $maxWaitSec  = 90
    $pollSec     = 3
    $elapsed     = 0
    $siteOnline  = $false

    while ($elapsed -lt $maxWaitSec) {
        try {
            $resp = Invoke-WebRequest -Uri $siteUrl -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -lt 500) {
                $siteOnline = $true
                break
            }
        } catch {
            # Site not ready yet — keep waiting
        }
        Start-Sleep -Seconds $pollSec
        $elapsed += $pollSec
        Write-Host "`r  Still waiting... ($elapsed s)" -NoNewline
    }
    Write-Host ""

    if ($siteOnline) {
        Print_Status "Site is online after ~$elapsed s — ready for next step."
    } else {
        Print_Warning "Site did not respond within $maxWaitSec s. Set Packages may need a manual IIS restart if it fails."
    }
}

Print_Script_End "Local authentication setup complete."
