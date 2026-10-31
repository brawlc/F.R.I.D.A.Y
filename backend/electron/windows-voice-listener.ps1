$ErrorActionPreference = "Stop"

function Write-VoiceEvent {
  param(
    [string]$Type,
    [string]$Text = "",
    [double]$Confidence = 0
  )

  @{
    type = $Type
    text = $Text
    confidence = [Math]::Round($Confidence, 3)
  } | ConvertTo-Json -Compress | ForEach-Object {
    [Console]::Out.WriteLine($_)
    [Console]::Out.Flush()
  }
}

try {
  Add-Type -AssemblyName System.Speech

  $InstalledRecognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $PreferredCultures = @("en-IN", [System.Globalization.CultureInfo]::CurrentUICulture.Name, "en-GB", "en-US") | Select-Object -Unique
  $RecognizerInfo = $null

  foreach ($PreferredCulture in $PreferredCultures) {
    $RecognizerInfo = $InstalledRecognizers | Where-Object {
      $_.Culture.Name -eq $PreferredCulture -and $_.Enabled -ne $false
    } | Select-Object -First 1

    if ($RecognizerInfo) {
      break
    }
  }

  if (-not $RecognizerInfo) {
    $RecognizerInfo = $InstalledRecognizers | Where-Object { $_.Enabled -ne $false } | Select-Object -First 1
  }

  if (-not $RecognizerInfo) {
    throw "No enabled Windows speech recognizer is installed."
  }

  try {
    $Recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $RecognizerInfo = $Recognizer.RecognizerInfo
  } catch {
    try {
      $Recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($RecognizerInfo.Id)
    } catch {
      $Recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($RecognizerInfo.Culture)
    }
  }

  $Recognizer.SetInputToDefaultAudioDevice()
  $Recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $Recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(0)
  $Recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(0)
  $Recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(700)
  $Recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1000)
  $script:LastAudioLevelAt = [DateTime]::UtcNow.AddSeconds(-5)

  $Recognizer.add_AudioLevelUpdated({
    param($Sender, $EventArgs)
    $Now = [DateTime]::UtcNow
    if (($Now - $script:LastAudioLevelAt).TotalMilliseconds -ge 350) {
      $script:LastAudioLevelAt = $Now
      Write-VoiceEvent -Type "status" -Text "Windows mic level: $($EventArgs.AudioLevel)"
    }
  })

  $Recognizer.add_AudioStateChanged({
    param($Sender, $EventArgs)
    Write-VoiceEvent -Type "status" -Text "Audio $($EventArgs.AudioState)"
  })

  $Recognizer.add_AudioSignalProblemOccurred({
    param($Sender, $EventArgs)
    Write-VoiceEvent -Type "status" -Text "Audio issue: $($EventArgs.AudioSignalProblem)"
  })

  $Recognizer.add_SpeechHypothesized({
    param($Sender, $EventArgs)
    if ($EventArgs.Result -and $EventArgs.Result.Text) {
      Write-VoiceEvent -Type "hypothesis" -Text $EventArgs.Result.Text -Confidence $EventArgs.Result.Confidence
    }
  })

  $Recognizer.add_SpeechRecognized({
    param($Sender, $EventArgs)
    if ($EventArgs.Result -and $EventArgs.Result.Text) {
      Write-VoiceEvent -Type "recognized" -Text $EventArgs.Result.Text -Confidence $EventArgs.Result.Confidence
    }
  })

  $Recognizer.add_SpeechRecognitionRejected({
    param($Sender, $EventArgs)
    $RejectedText = ""
    if ($EventArgs.Result -and $EventArgs.Result.Text) {
      $RejectedText = $EventArgs.Result.Text
    }
    Write-VoiceEvent -Type "rejected" -Text $RejectedText
  })

  Write-VoiceEvent -Type "status" -Text "Windows voice online: $($RecognizerInfo.Culture.Name) / $($RecognizerInfo.Description)"
  $Recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

  while ($true) {
    Start-Sleep -Seconds 1
  }
} catch {
  Write-VoiceEvent -Type "error" -Text $_.Exception.Message
  Start-Sleep -Seconds 3
  exit 1
}
