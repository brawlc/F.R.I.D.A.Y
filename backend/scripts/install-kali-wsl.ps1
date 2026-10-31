# Installs WSL and Kali Linux on Windows.
# Run from PowerShell. The script self-elevates because WSL feature installation requires admin rights.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    "`"$PSCommandPath`""
  ) -Verb RunAs
  exit
}

Write-Host 'Enabling Windows Subsystem for Linux...' -ForegroundColor Cyan
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

Write-Host 'Enabling Virtual Machine Platform...' -ForegroundColor Cyan
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host 'Installing or updating WSL...' -ForegroundColor Cyan
wsl.exe --install
wsl.exe --update
wsl.exe --set-default-version 2

Write-Host 'Installing Kali Linux...' -ForegroundColor Cyan
wsl.exe --install -d kali-linux

Write-Host ''
Write-Host 'Kali install command finished.' -ForegroundColor Green
Write-Host 'If Windows asks for a restart, restart the PC, then run: wsl -d kali-linux'
Read-Host 'Press Enter to close'
