param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$Launcher = Join-Path $ScriptDir "start-friday-desktop.ps1"

Set-Location -LiteralPath $ProjectRoot

Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`" -Port $Port" `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden
