# using module "..\modules\print.psm1"
$ErrorActionPreference = "Stop"
$script:UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

function UpdateMasterPackages {
[CmdletBinding()]
param(
    [string] $ServerInstance,
    [string] $SiteId,
    [string[]] $Packages,
    [string] $DBUser = 'sa',
    [string] $DBSafePassw0rd = '',
    [int] $QueryTimeout = 5,
    [int] $ConnectionTimeout = 5
)
    function Invoke-SqlCommand {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory = $true)]
            [string] $ServerInstance,
            [string] $Database = 'master',
            [Parameter(Mandatory = $true)]
            [string] $Query
        )
        Write-Verbose "SQL command: $($Query -replace '\r\n', ' ' -replace '[\r\n]', ' ')"
        if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
            $data = Invoke-Sqlcmd -ServerInstance $ServerInstance -Database $Database -Username $DBUser -Password $DBSafePassw0rd `
            -Query $Query -QueryTimeout $QueryTimeout -ConnectionTimeout $ConnectionTimeout
            $data | ForEach-Object { $_.ItemArray -join ', ' } | Write-Host
        } elseif (Get-Command 'Sqlcmd' -ErrorAction SilentlyContinue) {
            & Sqlcmd -S $ServerInstance -d $Database -U $DBUser -P $DBSafePassw0rd -Q $Query -t $QueryTimeout -l $ConnectionTimeout
        } else {
            throw 'No SQL Server command-line tool.'
        }
    }

    function Invoke-SqlQuery {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory = $true)]
            [string] $ServerInstance,
            [string] $Database = 'master',
            [Parameter(Mandatory = $true)]
            [string] $Query
        )
        if (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue) {
            return Invoke-Sqlcmd -ServerInstance $ServerInstance -Database $Database -Username $DBUser -Password $DBSafePassw0rd `
                -Query $Query -QueryTimeout $QueryTimeout -ConnectionTimeout $ConnectionTimeout
        } else {
            throw 'Invoke-Sqlcmd is required for interactive package selection.'
        }
    }

    # Load SQL Server instances
    $instances = @(Get-Service 'MSSQLSERVER', 'MSSQLSERVER$*', 'MSSQL', 'MSSQL$*' -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -match '\$(?<SqlInstance>.+)$') { '(local)\{0}' -f $Matches.SqlInstance } else { '(local)' }
    } | Sort-Object)
    if (!$instances) {
        throw 'No SQL Server instances.'
    }

    # Select SQL Server instance
    if ($ServerInstance) {
        if ($ServerInstance -notin $instances) {
            throw "Invalid SQL Server instance: '$ServerInstance'."
        }
    } elseif ($instances.Count -eq 1) {
        $ServerInstance = $instances[0]
    } else {
        if ($env:DONUT_GUI -eq "1") {
            $ServerInstance = $instances[0]
        } elseif ($script:UseGum) {
            $ServerInstance = $instances | gum choose --header "Select SQL Server instance"
            if (-not $ServerInstance) { throw "No instance selected." }
        } else {
            Print_Title 'Available SQL Server instances:'
            for ($i = 0; $i -lt $instances.Count; $i++) {
                '{0}. {1}' -f ($i + 1), $instances[$i] | Write-Host
            }
            $choice = Read-Host 'SQL Server instance [1]'
            Write-Host
            $i = if ($choice) { $choice -as [int] } else { 1 }
            if ($i -notin 1..$instances.Count) {
                throw "Invalid choice: '$choice'."
            }
            $ServerInstance = $instances[$i - 1]
        }
    }
    Print_Text "Using SQL Server instance: $ServerInstance"

    # Select Enablon database
    if ($SiteId) {
        $database = $SiteId
    } else {
        if ($env:DONUT_GUI -eq "1") {
            throw "Database (SiteId) must be configured in DONUT settings."
        } elseif ($script:UseGum) {
            $dbRows = Invoke-SqlQuery -ServerInstance $ServerInstance -Query "SELECT name FROM sys.databases WHERE database_id>4 ORDER BY name"
            $dbNames = $dbRows | ForEach-Object { $_.name }
            $database = $dbNames | gum choose --header "Select database"
            if (-not $database) { throw "No database selected." }
        } else {
            Print_Title 'SQL Server databases:'
            Invoke-SqlCommand -ServerInstance $ServerInstance -Query "SELECT FORMATMESSAGE('- [%s]', name) FROM sys.databases WHERE database_id>4 ORDER BY name"
            $choice = Read-Host 'Database'
            Write-Host
            $database = "$choice".Trim()
            if (!$database) {
                throw "Invalid choice: '$choice'."
            }
        }
    }
    Print_Text "Using SQL Server database: $database"

    $mtp_Module = 0
    $mtp_ModulePackage = 2
    $pdFlg_Master = 1
    $pdFlg_System = 2
    $pdFlg_SubMaster = 64

    # Select packages (list all but submaster ones)
    if (!$Packages) {
        if ($env:DONUT_GUI -eq "1") {
            throw "Packages must be configured in DONUT settings."
        } elseif ($script:UseGum) {
            $pkgRows = Invoke-SqlQuery -ServerInstance $ServerInstance -Database $database -Query @"
SELECT XMLInfo, ProductName, IIF((Special&$pdFlg_Master)<>0, 1, 0) as IsMaster
FROM Meta_Products
WHERE MetaType=$mtp_ModulePackage AND (Special&$pdFlg_SubMaster)=0
ORDER BY IIF((Special&$pdFlg_Master)=$pdFlg_Master,0,1), ProductName
"@
            $pkgChoices = $pkgRows | ForEach-Object {
                $marker = if ($_.IsMaster) { "*" } else { " " }
                "$marker $($_.XMLInfo) - $($_.ProductName)"
            }
            $selected = $pkgChoices | gum choose --no-limit --header "Select master package(s)  (* = currently master)"
            $Packages = @($selected | ForEach-Object { ($_ -replace '^\*?\s*' -split ' - ')[0].Trim() } | Where-Object { $_ })
        } else {
            Print_Title 'Packages:'
            Invoke-SqlCommand -ServerInstance $ServerInstance -Database $database -Query @"
SELECT FORMATMESSAGE('%s [%s] %s', IIF((Special&$pdFlg_Master)<>0, '*', '-'), XMLInfo, ProductName)
FROM Meta_Products
WHERE MetaType=$mtp_ModulePackage AND (Special&$pdFlg_SubMaster)=0
ORDER BY IIF((Special&$pdFlg_Master)=$pdFlg_Master,0,1), ProductName
"@
            $choice = Read-Host 'Master package(s)'
            $Packages = @($choice -split '[ ,;|]' | Where-Object { $_ })
        }
    }

    Write-Host
    if ($Packages) {
        Print_Text "Opening package(s): $($Packages -join ', ')..."
        Print_Text 'All other packages will be closed.'
    } else {
        Print_Text 'Closing all packages...'
    }

    # Close all packages and modules but system ones
    Invoke-SqlCommand -ServerInstance $ServerInstance -Database $database -Query "UPDATE Meta_Products SET Special&=~$pdFlg_Master WHERE MetaType IN ($mtp_Module,$mtp_ModulePackage) AND (Special&$pdFlg_System)=0"

    # Make sure sytem modules are master
    Invoke-SqlCommand -ServerInstance $ServerInstance -Database $database -Query "UPDATE Meta_Products SET Special|=$pdFlg_Master WHERE MetaType=$mtp_Module AND (Special&$pdFlg_System)<>0"

    if ($Packages) {
        # Open given packages and their modules (all but submaster ones)
        # Validate package names: only allow alphanumeric, underscore, hyphen, dot
        foreach ($pkg in $Packages) {
            if ($pkg -notmatch '^[a-zA-Z0-9_\-\.]+$') {
                throw "Invalid package name: '$pkg'. Only alphanumeric characters, underscores, hyphens and dots are allowed."
            }
        }
        $SafePackages = ($Packages | ForEach-Object { "'$($_ -replace "'", "''")'" }) -join ","
        Invoke-SqlCommand -ServerInstance $ServerInstance -Database $database -Query @"
UPDATE M SET Special|=$pdFlg_Master
FROM Meta_Products P INNER JOIN Meta_Products M ON P.Encapsulation LIKE '%'+M.ProductId+'%' OR P.ProductId=M.ProductId
WHERE P.MetaType=$mtp_ModulePackage AND M.MetaType IN ($mtp_Module,$mtp_ModulePackage) AND (M.Special&$pdFlg_SubMaster)=0 AND P.XMLInfo IN ($SafePackages)
"@
    }

    Print_Status "Packages updated."
}

function RegenerateMetadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $RootPath,
        [bool] $Interactive = $true
    )

    Print_Title "Regenerate metadata by restarting IIS Webserver"
    Print_Text "You need to regenerate the site metadata in order for the changes to take effect."

    if ($env:DONUT_GUI -eq "1") {
        Print_Text "Auto-confirming IIS restart (DONUT GUI mode)."
        $Answer = "Y"
    } elseif ($Interactive) {
        if ($script:UseGum) {
            $result = gum confirm "Restart IIS Webserver now? (will stop any ongoing process)" --default=Yes 2>&1
            $Answer = if ($LASTEXITCODE -eq 0) { "Y" } else { "N" }
        } else {
            Print_Warning "Restarting IIS Webserver will stop any ongoing process. Do you want to continue (Y\N) ?"
            $Answer = Read-Host "'Y' to restart the server, 'N' to skip"
        }
    } else {
        $Answer = "Y"
    }

    if ($Answer -eq "Y" -or $Answer -eq "y") {
        Print_Text "Restarting IIS to regenerate metadata..."
        try {
            # Try iisreset first (simpler, often works without UAC)
            $result = & iisreset /restart 2>&1
            $exitCode = $LASTEXITCODE
            if ($exitCode -eq 0) {
                Print_Text "IIS restarted successfully via iisreset."
            } else {
                # Fallback: try elevated AppPool restart
                Print_Text "iisreset failed (exit $exitCode), trying elevated AppPool restart..."
                $proc = Start-Process Powershell -Verb RunAs -ArgumentList "-NoProfile -Command `"Import-Module WebAdministration; Get-ChildItem IIS:\AppPools\ | Restart-WebAppPool`"" -PassThru
                $finished = $proc.WaitForExit(60000)
                if (-not $finished) {
                    Print_Warning "IIS restart timed out after 60s"
                    $proc.Kill()
                } else {
                    Print_Text "IIS AppPools restarted via elevation."
                }
            }
        } catch {
            Print_Warning "IIS restart failed: $($_.Exception.Message)"
            Print_Text "You may need to restart IIS manually (run 'iisreset' as administrator)"
            return $false
        }
        Print_Text "Metadata regenerated. The site will reload on next access."
        return $true
    } else {
        if ($env:DONUT_GUI -ne "1" -and $script:UseGum) {
            gum style --foreground 214 --bold --border rounded --border-foreground 214 --padding "0 1" "IMPORTANT: Regenerate the site metadata BEFORE executing another command (like a pull-force)."
        } else {
            Print_Warning "    ^                                                     ^    "
            Print_Warning "   /|\                    IMPORTANT !                    /|\   "
            Print_Warning "  / | \  Regenerate the site metadata BEFORE executing  / | \  "
            Print_Warning " /  |  \     another command (like a pull-force).      /  |  \ "
            Print_Warning "/___.___\                                             /___.___\"
        }
        return $false
    }
}

Export-ModuleMember -Function UpdateMasterPackages
Export-ModuleMember -Function RegenerateMetadata
