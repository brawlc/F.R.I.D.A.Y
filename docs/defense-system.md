# Defence system upgrade

Open Security Console and select Protect System after fully restarting FRIDAY.

The read-only collector now checks Defender tamper protection, PUA blocking, controlled folder access, visible exclusions, Secure Boot, system-drive encryption, UAC, legacy SMB1 server configuration and active Defender threat records, alongside the existing firewall/startup/hosts/download/process checks.

Unreadable checks are unknown, not passed or automatically labelled infected. The measured posture score weights critical controls more heavily and is capped when a critical control fails. Coverage and scan time remain visible. Scores are not probabilities of safety or malware verdicts. Paths and startup scripts can be legitimate even when flagged for review.

The console displays status changes from the previous scan in the current server session and exports a JSON report. Reports can contain local paths and process names; review before sharing. Restarting the server clears the comparison baseline. Repeated requests share one scan; results are reused for 15 seconds. Collection has a 60-second limit, and hashing is skipped for downloads larger than 50 MB.

Desktop, Kali, and system-protection endpoints require a loopback connection and a loopback Host header in addition to the existing same-origin browser check. This reduces remote access and DNS-rebinding exposure; it does not authenticate or protect against malicious software already running as the same local user.

No Windows settings were changed, threats removed, processes terminated, or firmware modified. FRIDAY remains a companion to Windows Security, not a replacement antivirus or EDR. Checks needing administrator rights report unknown instead of elevating automatically.

Verification: `npm run test:defense`, `npm run test:server-smoke`, `npm run lint`, and `npm run build`. A local read-only collector run completed with unavailable checks correctly reported as unknown; that restricted test is not a complete assessment of the machine's security.

Collector references: [Microsoft Defender status](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpcomputerstatus?view=windowsserver2025-ps), [Secure Boot status and permission requirements](https://learn.microsoft.com/en-us/powershell/module/secureboot/confirm-securebootuefi?view=windowsserver2025-ps).
