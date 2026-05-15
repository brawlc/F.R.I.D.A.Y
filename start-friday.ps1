$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeModules = Join-Path $ProjectRoot "node_modules"

Set-Location -LiteralPath $ProjectRoot

if (-not (Test-Path -LiteralPath $NodeModules)) {
  Write-Host "Installing FRIDAY dependencies..."
  npm install
}

Write-Host "Starting FRIDAY desktop app..."
npm run desktop
