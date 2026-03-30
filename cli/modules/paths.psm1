$ErrorActionPreference = "Stop"

# Centralized .bin/ paths — all runtime state files in one place
$script:Paths = @{
    BinDir                  = ".bin"
    LogsDir                 = ".bin\logs"
    ConfigHash              = ".bin\env_hash_source.json"
    SessionCookies          = ".bin\local_site_*_session.json"
    SessionLogs             = ".bin\logs\session_*.log"
    Git4InnoConfig          = ".bin\git4inno_db2repo_config.json"
    Git4InnoError           = ".bin\git4inno_db2repo_error.txt"
    PoolState               = ".bin\pool_state.tmp"
    PoolError               = ".bin\pool_err.tmp"
    IISAppPoolOutput        = ".bin\iis_apppool_output.tmp"
    IISAppPoolError         = ".bin\iis_apppool_error.tmp"
}

function Get-DonutPath {
    [CmdletBinding()]
    param([string] $Name)
    return $script:Paths[$Name]
}

Export-ModuleMember -Function Get-DonutPath
Export-ModuleMember -Variable Paths
