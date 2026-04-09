
[CmdletBinding()]
param(
    [string] $EnvFile = ".env.json"
)

$ErrorActionPreference = "Stop"
$RootPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& "$RootPath\cli\modules\_import-all-modules.ps1"

$UseGum = $null -ne (Get-Command 'gum' -ErrorAction SilentlyContinue)

Print_Script_Title "COMPARE ENVIRONMENTS"

# ── Load all environment files ──
$envDir = "$RootPath\working-environments"
$envFiles = @(Get-ChildItem "$envDir\*.json" -Name | Sort-Object)

if ($envFiles.Count -lt 2) {
    throw "Need at least 2 environment files to compare. Found $($envFiles.Count) in $envDir."
}

# ── Select environments to compare ──
if ($env:DONUT_GUI -eq "1") {
    $envA = $EnvFile
    $otherEnvs = @($envFiles | Where-Object { $_ -ne $envA })
} elseif ($UseGum) {
    $envA = $envFiles | gum filter --header "First environment"
    if (-not $envA) { exit 0 }
    $remaining = @($envFiles | Where-Object { $_ -ne $envA })
    $envB = $remaining | gum filter --header "Second environment"
    if (-not $envB) { exit 0 }
    $otherEnvs = @($envB)
} else {
    $envA = $EnvFile
    $otherEnvs = @($envFiles | Where-Object { $_ -ne $envA })
}

Print_Text "Loading $($otherEnvs.Count + 1) environment(s)..."

# ── Load configs silently (lightweight JSON read — skips LoadConfig's verbose per-field output
#    and mandatory field validation, which isn't needed for comparison) ──
function LoadConfigSilent([string]$envFile) {
    $fullEnvFile = if ($envFile -match "^\.env(-.+)?\.json$") { $envFile } else { ".env-$envFile.json" }
    $path = "$RootPath\working-environments\$fullEnvFile"
    if (-not (Test-Path $path)) { throw "Environment file '$path' not found." }
    $config = Get-Content -Raw -Path $path | ConvertFrom-Json -AsHashtable
    $config["_convert_md"] = -not $config.deactivate_metadata_conversion
    return $config
}

$configA = LoadConfigSilent $envA
Print_Status "Loaded: $envA"

# ── Helper: truncate long values ──
function Truncate([string]$val, [int]$max) {
    if ($val.Length -le $max) { return $val }
    return $val.Substring(0, $max - 3) + "..."
}

$totalDiffs = 0
$totalCompared = 0

foreach ($envName in $otherEnvs) {
    Print_Title "$envA  vs  $envName"

    try {
        $configB = LoadConfigSilent $envName
    } catch {
        Print_Warning "Could not load '$envName': $($_.Exception.Message)"
        continue
    }
    $totalCompared++

    # Build comparison rows
    $fields = @(
        @{ Name = "Feature Branch"; A = $configA.feature_branch; B = $configB.feature_branch },
        @{ Name = "Target Branch";  A = $configA.target_branch;  B = $configB.target_branch },
        @{ Name = "Repository";     A = $configA.azdo.repository; B = $configB.azdo.repository },
        @{ Name = "Organization";   A = $configA.azdo.organization; B = $configB.azdo.organization },
        @{ Name = "Project";        A = $configA.azdo.project;   B = $configB.azdo.project },
        @{ Name = "Site Path";      A = $configA.local.site_path; B = $configB.local.site_path },
        @{ Name = "Parent Site";    A = $configA.local.parent_site; B = $configB.local.parent_site },
        @{ Name = "Site User";      A = $configA.local.user;     B = $configB.local.user },
        @{ Name = "Work Item";      A = $configA.workitem_id;    B = $configB.workitem_id },
        @{ Name = "Packages";       A = ($configA.packages -join ", "); B = ($configB.packages -join ", ") },
        @{ Name = "Metadata";       A = $(if ($configA._convert_md) { "enabled" } else { "disabled" }); B = $(if ($configB._convert_md) { "enabled" } else { "disabled" }) }
    )

    # ── Draw comparison table ──
    $fieldW = 18
    $valMax = 38
    $hField = "Field".PadRight($fieldW)
    $hA     = (Truncate $envA $valMax).PadRight($valMax)
    $hB     = (Truncate $envName $valMax).PadRight($valMax)

    $diffCount = 0

    # Header
    Print_SubTitle "  $hField | $hA | $hB"

    # Data rows
    foreach ($row in $fields) {
        $field = $row.Name.PadRight($fieldW)
        $aVal = if ($row.A) { "$($row.A)" } else { "-" }
        $bVal = if ($row.B) { "$($row.B)" } else { "-" }
        $valA  = (Truncate $aVal $valMax).PadRight($valMax)
        $valB  = (Truncate $bVal $valMax).PadRight($valMax)
        $same  = $aVal -eq $bVal

        if ($same) {
            Print_Text "  $field | $valA | $valB"
        } else {
            $diffCount++
            Print_Warning "* $field | $valA | $valB"
        }
    }

    $totalDiffs += $diffCount

    Write-Host
    if ($diffCount -eq 0) {
        Print_Status "Identical - no differences found."
    } else {
        Print_Warning "$diffCount difference(s) found (marked with *)."
    }
}

# ── Summary ──
Write-Host
if ($totalCompared -gt 1) {
    Print_Text "Compared '$envA' against $totalCompared other environment(s)."
}
if ($totalDiffs -eq 0) {
    Print_Status "All environments are identical."
} else {
    Print_Status "Total: $totalDiffs difference(s) across $totalCompared comparison(s)."
}
