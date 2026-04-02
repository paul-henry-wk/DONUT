[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent)
& "$RootPath\cli\modules\_import-all-modules.ps1"

# ── Load Config ──
$_c = LoadConfig -RootPath $RootPath -EnvFile $EnvFile -Interactive $false

$Database   = $_c.local.site_id
$DbUser     = $_c.local.db_user
$DbPassword = $_c.local.db_password

# ── Load git4inno mapping ──
$configPath = "$RootPath\.bin\git4inno_db2repo_config.json"
if (-not (Test-Path $configPath)) {
    Print_Error "git4inno config not found: $configPath"
    throw "Missing git4inno_db2repo_config.json. Run a git4inno sync first."
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$mapped = @("E87279EB689DF64DA7DD297850D700D8","5718E8352ABA6C4C83AE7903D3497015")
$excluded = @($config.PackageToRepositoryMapping.Excluded)
$known = ($mapped + $excluded) | ForEach-Object { $_.ToLower().Trim() }
Print_Text "Config: $($known.Count) packages (mapped + excluded)"

# ── Query database ──
$query = "SELECT ProductId, ProductName FROM Meta_Products WHERE LEN(ProductId) > 10 ORDER BY ProductName"
$results = Sqlcmd -S "(local)" -d $Database -U $DbUser -P $DbPassword -Q $query -W -s "|" -h -1 -t 5 -l 5

if ($LASTEXITCODE -ne 0) {
    Print_Error "Sqlcmd failed (exit code $LASTEXITCODE)"
    throw "Could not query database '$Database'."
}

$missing = @()
foreach ($line in $results) {
    if (-not $line -or $line.StartsWith('-') -or $line.Trim() -eq '') { continue }
    $parts = $line.Split('|')
    if ($parts.Count -lt 2) { continue }
    $id = $parts[0].Trim()
    $name = $parts[1].Trim()
    if ($id.ToLower() -notin $known) {
        $missing += [PSCustomObject]@{ Id = $id; Name = $name }
    }
}

if ($missing.Count -gt 0) {
    Print_Warning "Unmapped packages ($($missing.Count)):"
    $missing | Format-Table -AutoSize
} else {
    Print_Status "All database packages are covered by the mapping."
}
