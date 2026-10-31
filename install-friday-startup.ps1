param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $ProjectRoot "backend\scripts\install-friday-startup.ps1"

& $Installer -Port $Port
