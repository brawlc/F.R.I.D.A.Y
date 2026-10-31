param(
  [int]$IdleMinutes = 5,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$Launcher = Join-Path $ScriptDir "show-friday-screensaver.ps1"
$TaskName = "FRIDAY AI Screensaver"

if ($IdleMinutes -lt 1) {
  throw "IdleMinutes must be 1 or greater."
}

if (-not (Test-Path -LiteralPath $Launcher)) {
  throw "Could not find $Launcher"
}

$TaskAction = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`" -Port $Port"

schtasks.exe /Create `
  /TN $TaskName `
  /TR $TaskAction `
  /SC ONIDLE `
  /I $IdleMinutes `
  /F | Out-Host

Write-Host "FRIDAY screensaver mode installed."
Write-Host "When Windows is idle for $IdleMinutes minute(s), FRIDAY will open and maximize."
Write-Host "Task: $TaskName"
