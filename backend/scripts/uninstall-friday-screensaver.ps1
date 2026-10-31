$ErrorActionPreference = "Stop"
$TaskName = "FRIDAY AI Screensaver"

schtasks.exe /Delete /TN $TaskName /F | Out-Host

Write-Host "FRIDAY screensaver mode removed."
