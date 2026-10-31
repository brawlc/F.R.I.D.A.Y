param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$Launcher = Join-Path $ScriptDir "start-friday.ps1"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "FRIDAY AI.lnk"
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`" -Port $Port"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = $Arguments
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.IconLocation = "powershell.exe,0"
$Shortcut.Save()

Write-Host "FRIDAY will launch at Windows sign-in."
Write-Host $ShortcutPath
