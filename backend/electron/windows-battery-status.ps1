Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FridayPowerStatus {
  [StructLayout(LayoutKind.Sequential)]
  public struct SYSTEM_POWER_STATUS {
    public byte ACLineStatus;
    public byte BatteryFlag;
    public byte BatteryLifePercent;
    public byte SystemStatusFlag;
    public int BatteryLifeTime;
    public int BatteryFullLifeTime;
  }

  [DllImport("kernel32.dll")]
  public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
}
'@

$status = New-Object FridayPowerStatus+SYSTEM_POWER_STATUS
$ok = [FridayPowerStatus]::GetSystemPowerStatus([ref]$status)

if (-not $ok) {
  Write-Output 'Battery status is unavailable right now.'
  exit 0
}

if ($status.BatteryLifePercent -eq 255) {
  Write-Output 'No battery percentage is being reported by Windows right now.'
  exit 0
}

$power = switch ($status.ACLineStatus) {
  0 { 'on battery' }
  1 { 'plugged in' }
  default { 'power state unknown' }
}

$batteryState = if (($status.BatteryFlag -band 8) -eq 8) {
  'charging'
} elseif (($status.BatteryFlag -band 128) -eq 128) {
  'no system battery detected'
} elseif (($status.BatteryFlag -band 4) -eq 4) {
  'critical'
} elseif (($status.BatteryFlag -band 2) -eq 2) {
  'low'
} elseif (($status.BatteryFlag -band 1) -eq 1) {
  'high'
} else {
  'normal'
}

Write-Output "Battery: $($status.BatteryLifePercent)% - $power, $batteryState."
