$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectRoot "start-friday-desktop.ps1"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "FRIDAY Desktop Listener.lnk"
$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = $Arguments
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.IconLocation = "powershell.exe,0"
$Shortcut.Save()

Write-Host "FRIDAY desktop listener will launch at Windows sign-in."
Write-Host $ShortcutPath
