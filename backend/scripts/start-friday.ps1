param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$NodeModules = Join-Path $ProjectRoot "node_modules"

Set-Location -LiteralPath $ProjectRoot

if (-not (Test-Path -LiteralPath $NodeModules)) {
  Write-Host "Installing FRIDAY dependencies..."
  npm install
}

Write-Host "Starting FRIDAY desktop app..."
$env:PORT = [string]$Port
npm run desktop
