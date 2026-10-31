param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectRoot "backend\scripts\start-friday.ps1"

& $Launcher -Port $Port
