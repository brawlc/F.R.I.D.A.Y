$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $ProjectRoot "backend\scripts\install-friday-desktop-startup.ps1"

& $Installer
