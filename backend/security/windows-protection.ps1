
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $checks = New-Object System.Collections.Generic.List[object]
    $findings = New-Object System.Collections.Generic.List[object]
    $recommendations = New-Object System.Collections.Generic.List[object]
    function Add-Check($id, $label, $pass, $detail, $severity = 'info') {
      $checks.Add([ordered]@{ id = $id; label = $label; pass = $pass; detail = [string]$detail; severity = $severity }) | Out-Null
      if ($pass -eq $false) { $findings.Add([ordered]@{ id = $id; label = $label; severity = $severity; detail = [string]$detail }) | Out-Null }
    }
    function Add-Recommendation($id, $priority, $title, $action, $impact) {
      $recommendations.Add([ordered]@{ id = $id; priority = $priority; title = $title; action = $action; impact = $impact }) | Out-Null
    }

    try {
      $mp = Get-MpComputerStatus -ErrorAction Stop
      Add-Check 'defender-service' 'Microsoft Defender service' ([bool]$mp.AMServiceEnabled) "AM service enabled: $($mp.AMServiceEnabled)" 'critical'
      Add-Check 'defender-antivirus' 'Defender antivirus' ([bool]$mp.AntivirusEnabled) "Antivirus enabled: $($mp.AntivirusEnabled)" 'critical'
      Add-Check 'real-time-protection' 'Real-time protection' ([bool]$mp.RealTimeProtectionEnabled) "Real-time protection enabled: $($mp.RealTimeProtectionEnabled)" 'critical'
      Add-Check 'behavior-monitor' 'Behavior monitor' ([bool]$mp.BehaviorMonitorEnabled) "Behavior monitor enabled: $($mp.BehaviorMonitorEnabled)" 'high'
      Add-Check 'ioav-protection' 'Downloaded file scanning' ([bool]$mp.IoavProtectionEnabled) "IOAV protection enabled: $($mp.IoavProtectionEnabled)" 'high'
      $sigAge = [long]($mp.AntivirusSignatureAge)
      Add-Check 'signature-age' 'Defender signatures' ($sigAge -le 2) "Signature age: $sigAge day(s)" 'high'
      $quickAge = [long]($mp.QuickScanAge)
      Add-Check 'quick-scan-age' 'Recent quick scan' ($quickAge -le 7) "Quick scan age: $quickAge day(s)" 'medium'
      if (-not $mp.AntivirusEnabled -or -not $mp.RealTimeProtectionEnabled) {
        Add-Recommendation 'enable-defender' 'critical' 'Enable Defender protection' 'Open Windows Security and turn on Virus & threat protection plus Real-time protection.' 'This is the main real-time malware shield Friday should rely on.'
      }
      if ($sigAge -gt 2) {
        Add-Recommendation 'update-signatures' 'high' 'Update malware signatures' 'Run Windows Security updates or Windows Update before opening unknown files.' 'Old signatures miss newer malware families and phishing payloads.'
      }
      if ($quickAge -gt 7) {
        Add-Recommendation 'run-quick-scan' 'medium' 'Run a quick scan' 'Run a Microsoft Defender quick scan today.' 'A recent scan gives a stronger baseline for system health.'
      }
    } catch {
      Add-Check 'defender-status' 'Microsoft Defender status' $null "Could not read Defender status: $($_.Exception.Message)" 'high'
      Add-Recommendation 'check-defender' 'high' 'Open Windows Security manually' 'Check Virus & threat protection because Defender status was not readable.' 'Some Windows editions or permissions can block command-line status reads.'
    }

    try {
      $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
      foreach ($profile in $profiles) {
        Add-Check "firewall-$($profile.Name.ToLower())" "Firewall $($profile.Name)" ([bool]$profile.Enabled) "Enabled: $($profile.Enabled)" 'high'
        if (-not $profile.Enabled) {
          Add-Recommendation "enable-firewall-$($profile.Name.ToLower())" 'high' "Enable $($profile.Name) firewall" "Turn on Windows Firewall for the $($profile.Name) profile." 'Firewall profiles reduce exposure on public and shared networks.'
        }
      }
    } catch {
      Add-Check 'firewall-status' 'Windows Firewall status' $null "Could not read firewall profiles: $($_.Exception.Message)" 'high'
    }

    try {
      $policy = Get-ExecutionPolicy
      $safePolicy = @('Restricted','RemoteSigned','AllSigned') -contains [string]$policy
      Add-Check 'execution-policy' 'PowerShell execution policy' $safePolicy "Effective policy: $policy. This is an execution convenience, not a security boundary." 'info'
      if (-not $safePolicy) {
        Add-Recommendation 'tighten-execution-policy' 'medium' 'Tighten PowerShell script policy' 'Use RemoteSigned or AllSigned for CurrentUser unless you intentionally need looser script execution.' 'Reduces accidental execution of downloaded scripts.'
      }
    } catch {
      Add-Check 'execution-policy' 'PowerShell execution policy' $null "Could not read execution policy: $($_.Exception.Message)" 'medium'
    }

    $startupEntries = New-Object System.Collections.Generic.List[object]
    $startupSources = @(
      @{ Source='HKCU Run'; Path='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' },
      @{ Source='HKLM Run'; Path='HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' },
      @{ Source='HKCU RunOnce'; Path='HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' },
      @{ Source='HKLM RunOnce'; Path='HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce' }
    )
    foreach ($source in $startupSources) {
      try {
        $item = Get-ItemProperty -Path $source.Path -ErrorAction SilentlyContinue
        if ($item) {
          $item.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
            $value = [string]$_.Value
            $suspicious = $value -match '(?i)\.(js|vbs|ps1|bat|cmd|scr)(\s|$|")' -or $value -match '(?i)\\temp\\|\\downloads\\|appdata\\local\\temp'
            $entry = [ordered]@{ source=$source.Source; name=$_.Name; command=$value; suspicious=$suspicious }
            $startupEntries.Add($entry) | Out-Null
            if ($suspicious) { $findings.Add([ordered]@{ id='suspicious-startup'; label='Suspicious startup entry'; severity='high'; detail="$($source.Source) / $($_.Name): $value" }) | Out-Null }
          }
        }
      } catch {}
    }
    $startupFolders = @(
      [Environment]::GetFolderPath('Startup'),
      "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
    )
    foreach ($folder in $startupFolders) {
      if (Test-Path $folder) {
        Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | ForEach-Object {
          $suspicious = $_.Extension -match '(?i)^\.(js|vbs|ps1|bat|cmd|scr)$'
          $entry = [ordered]@{ source='Startup Folder'; name=$_.Name; command=$_.FullName; suspicious=$suspicious }
          $startupEntries.Add($entry) | Out-Null
          if ($suspicious) { $findings.Add([ordered]@{ id='suspicious-startup-file'; label='Suspicious startup file'; severity='high'; detail=$_.FullName }) | Out-Null }
        }
      }
    }
    Add-Check 'startup-review' 'Startup persistence review' (($startupEntries | Where-Object { $_.suspicious }).Count -eq 0) "$($startupEntries.Count) startup item(s), $(($startupEntries | Where-Object { $_.suspicious }).Count) suspicious" 'high'
    if (($startupEntries | Where-Object { $_.suspicious }).Count -gt 0) {
      Add-Recommendation 'review-startup' 'high' 'Review suspicious startup entries' 'Disable unknown startup entries only after confirming the file and publisher.' 'Startup persistence is a common malware foothold.'
    }

    $hostsEntries = @()
    try {
      $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
      if (Test-Path $hostsPath) {
        $hostsEntries = Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue |
          Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*#' -and $_ -notmatch '(?i)localhost' } |
          Select-Object -First 20
      }
      Add-Check 'hosts-file' 'Hosts file redirects' ($hostsEntries.Count -eq 0) "$($hostsEntries.Count) non-localhost active hosts redirect(s)" 'medium'
      if ($hostsEntries.Count -gt 0) {
        Add-Recommendation 'review-hosts' 'medium' 'Review hosts-file redirects' 'Check active hosts-file mappings for banking, mail, social, update, or security domains.' 'Malware can redirect trusted domains to malicious infrastructure.'
      }
    } catch {
      Add-Check 'hosts-file' 'Hosts file redirects' $null "Could not inspect hosts file: $($_.Exception.Message)" 'medium'
    }

    $downloadItems = @()
    try {
      $downloads = Join-Path $env:USERPROFILE 'Downloads'
      if (Test-Path $downloads) {
        $downloadItems = Get-ChildItem -LiteralPath $downloads -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Extension -match '(?i)^\.(exe|msi|ps1|js|vbs|bat|cmd|scr|iso|zip|rar|7z)$' -and $_.LastWriteTime -gt (Get-Date).AddDays(-14) } |
          Sort-Object LastWriteTime -Descending |
          Select-Object -First 15 |
          ForEach-Object {
            $hash = ''
            if ($_.Length -le 50MB) { try { $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName -ErrorAction Stop).Hash } catch {} }
            [ordered]@{ name=$_.Name; path=$_.FullName; extension=$_.Extension; sizeBytes=$_.Length; modified=$_.LastWriteTime.ToString('o'); sha256=$hash }
          }
      }
      Add-Check 'recent-downloads' 'Recent risky Downloads' ($downloadItems.Count -eq 0) "$($downloadItems.Count) executable/archive/script download(s) from the last 14 days" 'medium'
      if ($downloadItems.Count -gt 0) {
        Add-Recommendation 'review-downloads' 'medium' 'Review recent executable downloads' 'Verify source and signature before running downloaded installers, scripts, archives, or disk images.' 'Most consumer infections start from downloaded files or fake installers.'
      }
    } catch {
      Add-Check 'recent-downloads' 'Recent risky Downloads' $null "Could not inspect Downloads: $($_.Exception.Message)" 'medium'
    }

    $processFindings = @()
    try {
      $processFindings = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and ($_.Path -match '(?i)\\downloads\\|\\temp\\') } |
        Select-Object -First 20 |
        ForEach-Object { [ordered]@{ name=$_.ProcessName; id=$_.Id; path=$_.Path } }
      Add-Check 'process-location' 'Running process locations' ($processFindings.Count -eq 0) "$($processFindings.Count) process(es) running from Downloads or Temp" 'high'
      if ($processFindings.Count -gt 0) {
        Add-Recommendation 'review-processes' 'high' 'Review unusual running processes' 'Investigate processes running from Downloads or Temp before ending or deleting them.' 'Legitimate apps rarely need to keep running from temporary download locations.'
      }
    } catch {
      Add-Check 'process-location' 'Running process locations' $null "Could not inspect process paths: $($_.Exception.Message)" 'medium'
    }

    # Additional read-only controls. Unsupported or denied checks remain unknown.
    try {
      $status = Get-MpComputerStatus -ErrorAction Stop
      $tamper = if ($null -eq $status.IsTamperProtected) { $null } else { [bool]$status.IsTamperProtected }
      Add-Check 'tamper-protection' 'Defender tamper protection' $tamper "Tamper protection: $($status.IsTamperProtected)" 'high'
    } catch { Add-Check 'tamper-protection' 'Defender tamper protection' $null 'Could not read tamper protection. Review Windows Security.' 'high' }
    try {
      $preferences = Get-MpPreference -ErrorAction Stop
      $pua = if ($null -eq $preferences.PUAProtection) { $null } else { [int]$preferences.PUAProtection -eq 1 }
      Add-Check 'pua-protection' 'Potentially unwanted app blocking' $pua "Mode: $($preferences.PUAProtection); 1 means blocking, 2 audit only." 'medium'
      $cfa = if ($null -eq $preferences.EnableControlledFolderAccess) { $null } else { [int]$preferences.EnableControlledFolderAccess -eq 1 }
      Add-Check 'controlled-folders' 'Controlled folder access' $cfa "Mode: $($preferences.EnableControlledFolderAccess). Review app compatibility before enabling." 'medium'
      $exclusions = @($preferences.ExclusionPath) + @($preferences.ExclusionExtension) + @($preferences.ExclusionProcess)
      $exclusions = @($exclusions | Where-Object { $_ })
      Add-Check 'defender-exclusions' 'Defender exclusions review' ($exclusions.Count -eq 0) "$($exclusions.Count) visible exclusion(s). Hidden administrator exclusions may not be readable; review intentional exceptions in Windows Security." 'medium'
    } catch { Add-Check 'defender-preferences' 'Defender protection preferences' $null 'Preferences unavailable. Review Windows Security.' 'medium' }
    try {
      $secureBoot = Confirm-SecureBootUEFI -ErrorAction Stop
      Add-Check 'secure-boot' 'Secure Boot' ([bool]$secureBoot) "Secure Boot enabled: $secureBoot" 'high'
    } catch { Add-Check 'secure-boot' 'Secure Boot' $null 'Unavailable: may require administrator rights or UEFI support. No firmware settings changed.' 'high' }
    try {
      $disk = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
      $protected = if ($null -eq $disk.ProtectionStatus) { $null } else { [int]$disk.ProtectionStatus -eq 1 }
      Add-Check 'disk-encryption' 'System drive encryption protection' $protected "Protection status: $($disk.ProtectionStatus). Recovery keys are not collected." 'high'
    } catch { Add-Check 'disk-encryption' 'System drive encryption protection' $null 'Drive encryption status unavailable. Check Device encryption or BitLocker settings.' 'high' }
    try {
      $uac = Get-ItemProperty -LiteralPath 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction Stop
      Add-Check 'uac' 'User Account Control' ($uac.EnableLUA -eq 1) "UAC enabled: $($uac.EnableLUA -eq 1)" 'high'
    } catch { Add-Check 'uac' 'User Account Control' $null 'Could not read UAC policy.' 'high' }
    try {
      $smb = Get-SmbServerConfiguration -ErrorAction Stop
      Add-Check 'smb1' 'Legacy SMB1 server disabled' (-not [bool]$smb.EnableSMB1Protocol) "SMB1 server enabled: $($smb.EnableSMB1Protocol)" 'high'
    } catch { Add-Check 'smb1' 'Legacy SMB1 server disabled' $null 'SMB configuration unavailable.' 'high' }
    try {
      $threats = @(Get-MpThreat -ErrorAction Stop | Where-Object { $_.IsActive })
      Add-Check 'active-threats' 'Defender active threat records' ($threats.Count -eq 0) "$($threats.Count) active threat record(s) reported by Defender. This does not prove the system is malware-free." 'critical'
      if ($threats.Count -gt 0) { Add-Recommendation 'review-active-threats' 'critical' 'Review Defender threats immediately' 'Open Windows Security > Virus & threat protection > Protection history.' 'Let Defender guide remediation; FRIDAY will not delete files automatically.' }
    } catch { Add-Check 'active-threats' 'Defender active threat records' $null 'Could not query active threat records. Review Protection history.' 'critical' }

    $passed = @($checks | Where-Object { $_.pass }).Count
    $totalChecks = [Math]::Max(1, [int]$checks.Count)
    $score = [int][Math]::Round(([double]$passed / [double]$totalChecks) * 100)
    $checksOut = @($checks.ToArray())
    $findingsOut = @($findings.ToArray() | Select-Object -First 40)
    $recommendationsOut = @($recommendations.ToArray() | Select-Object -First 20)
    $startupOut = @($startupEntries.ToArray() | Select-Object -First 25)
    [ordered]@{
      ok = $true
      scannedAt = (Get-Date).ToString('o')
      score = $score
      checks = $checksOut
      findings = $findingsOut
      recommendations = $recommendationsOut
      startupEntries = $startupOut
      hostsEntries = @($hostsEntries)
      recentDownloads = @($downloadItems)
      processFindings = @($processFindings)
      note = 'Read-only Windows protection snapshot. Friday does not replace Microsoft Defender, firewall, backups, or EDR.'
    } | ConvertTo-Json -Depth 8 -Compress
  
