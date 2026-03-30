#!/usr/bin/env pwsh
# ── DONUT Packager — Creates a distributable zip ──

$ErrorActionPreference = "Stop"
$RootPath = Split-Path $PSScriptRoot -Parent
$Version = (Get-Content -Raw "$RootPath\cli\config\version.json" | ConvertFrom-Json).version
$OutputName = "DONUT-v$Version"
$TempDir = "$env:TEMP\$OutputName"
$ZipPath = "$RootPath\$OutputName.zip"

Write-Host "Packaging DONUT v$Version..." -ForegroundColor Cyan

# Clean
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir | Out-Null

# Copy required files
Write-Host "  Copying files..."
Copy-Item "$RootPath\DONUT.exe" "$TempDir\DONUT.exe"
Copy-Item "$RootPath\README.md" "$TempDir\README.md"
Copy-Item "$RootPath\cli" "$TempDir\cli" -Recurse
Copy-Item "$RootPath\templates" "$TempDir\templates" -Recurse
Copy-Item "$RootPath\working-environments" "$TempDir\working-environments" -Recurse

# Remove env config files (contain credentials)
Get-ChildItem "$TempDir\working-environments\.env*.json" -ErrorAction SilentlyContinue | Remove-Item

# Create zip
Write-Host "  Creating zip..."
if (Test-Path $ZipPath) { Remove-Item $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal

# Clean temp
Remove-Item $TempDir -Recurse -Force

$size = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host "Done! $ZipPath ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Distribution contents:" -ForegroundColor Cyan
Write-Host "  DONUT.exe          - Application (installs prerequisites automatically)"
Write-Host "  README.md          - Documentation"
Write-Host "  cli/               - Scripts PowerShell"
Write-Host "  templates/         - Modeles d'environnement"
Write-Host "  working-environments/ - Dossier pour les configs"
