param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeModules = Join-Path $ProjectRoot "node_modules"
$AppUrl = "http://localhost:$Port"
$OperaGxCandidates = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\launcher.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\opera.exe"),
  (Join-Path $env:ProgramFiles "Opera GX\launcher.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Opera GX\launcher.exe")
)
$OperaGx = $OperaGxCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

Set-Location -LiteralPath $ProjectRoot

if (-not (Test-Path -LiteralPath $NodeModules)) {
  Write-Host "Installing FRIDAY dependencies..."
  npm install
}

Write-Host "Starting FRIDAY on $AppUrl ..."
if ($OperaGx) {
  Start-Process -FilePath $OperaGx -ArgumentList $AppUrl
} else {
  Start-Process -FilePath $AppUrl
}
npm run dev
