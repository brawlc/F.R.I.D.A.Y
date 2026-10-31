$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Uninstaller = Join-Path $ProjectRoot "backend\scripts\uninstall-friday-screensaver.ps1"

& $Uninstaller
