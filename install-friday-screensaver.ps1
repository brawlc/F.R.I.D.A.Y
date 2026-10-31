param(
  [int]$IdleMinutes = 5,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $ProjectRoot "backend\scripts\install-friday-screensaver.ps1"

& $Installer -IdleMinutes $IdleMinutes -Port $Port
