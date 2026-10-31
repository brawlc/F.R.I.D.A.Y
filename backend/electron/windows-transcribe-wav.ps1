param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

try {
  Add-Type -AssemblyName System.Speech

  $Recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $Recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $Recognizer.SetInputToWaveFile($Path)

  $Results = New-Object System.Collections.Generic.List[string]
  $Deadline = [DateTime]::UtcNow.AddSeconds(12)

  while ([DateTime]::UtcNow -lt $Deadline) {
    $Result = $Recognizer.Recognize([TimeSpan]::FromSeconds(4))
    if ($null -eq $Result) {
      break
    }

    if ($Result.Text) {
      $Results.Add($Result.Text)
    }
  }

  $Recognizer.Dispose()

  @{
    ok = $true
    text = ($Results -join " ").Trim()
  } | ConvertTo-Json -Compress
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}
