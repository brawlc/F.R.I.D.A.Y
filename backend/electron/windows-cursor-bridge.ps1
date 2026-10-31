Add-Type -AssemblyName System.Windows.Forms

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class FridayCursor {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

Add-Type -TypeDefinition $signature

$leftDown = 0x0002
$leftUp = 0x0004
$rightDown = 0x0008
$rightUp = 0x0010

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) {
    Start-Sleep -Milliseconds 20
    continue
  }

  try {
    $payload = $line | ConvertFrom-Json
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $x = [Math]::Max(0.0, [Math]::Min(1.0, [double]$payload.x))
    $y = [Math]::Max(0.0, [Math]::Min(1.0, [double]$payload.y))
    $pixelX = [int][Math]::Round($screen.Left + ($x * ($screen.Width - 1)))
    $pixelY = [int][Math]::Round($screen.Top + ($y * ($screen.Height - 1)))

    [FridayCursor]::SetCursorPos($pixelX, $pixelY) | Out-Null

    switch ([string]$payload.action) {
      'click' {
        [FridayCursor]::mouse_event($leftDown, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 20
        [FridayCursor]::mouse_event($leftUp, 0, 0, 0, [UIntPtr]::Zero)
      }
      'rightclick' {
        [FridayCursor]::mouse_event($rightDown, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 20
        [FridayCursor]::mouse_event($rightUp, 0, 0, 0, [UIntPtr]::Zero)
      }
    }
    [Console]::Out.WriteLine((@{ ok = $true; pixelX = $pixelX; pixelY = $pixelY; x = $x; y = $y } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
}
