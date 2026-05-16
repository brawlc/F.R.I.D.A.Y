param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectRoot "start-friday-desktop.ps1"

Set-Location -LiteralPath $ProjectRoot

Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`" -Port $Port" `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden
