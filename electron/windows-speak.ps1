param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadBase64
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$Json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
$Payload = $Json | ConvertFrom-Json
$Text = [string]$Payload.text
$Voice = [string]$Payload.voice
$Rate = [int]$Payload.rate
$Volume = [int]$Payload.volume

if (-not $Text.Trim()) {
  exit 0
}

$Synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$Synth.SetOutputToDefaultAudioDevice()
$Synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
$Synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

if ($Voice.Trim()) {
  try {
    $Synth.SelectVoice($Voice)
  } catch {
    Write-Warning "Requested voice '$Voice' is unavailable. Using default voice."
  }
}

$Synth.Speak($Text)
$Synth.Dispose()
Write-Output "spoken"
