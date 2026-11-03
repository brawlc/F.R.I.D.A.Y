# Communications Hub

Routine events go to **ntfy**. Security events go to the **authorized private Telegram chat**. There is no fallback from one channel to the other. Both are disabled by default and independently configurable in `backend/.env.local`; no credentials belong in source control.

This checkout previously had neither adapter nor a communications test suite. The local implementation adds the following environment settings (examples are in `backend/.env.example`):

| Setting | Meaning |
|---|---|
| `FRIDAY_NTFY_ENABLED=true` | Enable routine notifications |
| `FRIDAY_NTFY_URL=https://ntfy.sh` | HTTPS origin of the ntfy server; no URL credentials, query or path |
| `FRIDAY_NTFY_SERVER=https://ntfy.sh` | Preferred server setting; overrides the legacy `FRIDAY_NTFY_URL` if present |
| `FRIDAY_NTFY_TOPIC` | Topic name |
| `FRIDAY_NTFY_TOKEN` | Optional Bearer token for an authenticated topic |
| `FRIDAY_TELEGRAM_ENABLED=true` | Enable security notifications |
| `FRIDAY_TELEGRAM_BOT_TOKEN` | Bot token |
| `FRIDAY_TELEGRAM_CHAT_ID` | Authorized positive numeric private-chat ID; usernames and group IDs rejected |
| `FRIDAY_NOTIFICATION_DEVICE` | Non-sensitive device alias; default `FRIDAY device` |
| `FRIDAY_DAILY_BRIEFING_ENABLED=true` | Enable the 09:15 IST daily schedule |

The Telegram user must have initiated the bot conversation. Before each send, `getChat` must return the configured ID and type `private`. The application never calls `getUpdates`, registers a webhook, or accepts Telegram commands. Outbound `sendMessage` uses only that configured ID and requests content protection. That flag cannot prevent screenshots or promise confidentiality on a recipient device.

## Events and integration

`createCommunicationsHub().notify(event)` is the internal producer interface. Its allowlist determines the destination; callers cannot supply a destination or chat ID. Unknown events are rejected.

| Destination | Event types |
|---|---|
| ntfy | `daily_briefing`, `f1_update`, `spacex_update`, `aerospace_research`, `robotics_research`, `ai_update`, `software_update`, `project_progress`, `research_completed`, `research_discovery`, `task_completed`, `reminder`, `general_notification` |
| Telegram | `suspicious_activity`, `malware_detection`, `ransomware_detection`, `unauthorized_login`, `unusual_network_activity`, `critical_security_incident`, `security_recovery_report`, `sentinel_report` |

Research completion is emitted only after its report has been saved. Existing system-protection scans emit suspicious-activity events for failed posture checks; unknown checks and cached reports are ignored. High/critical project-audit findings also emit security notifications. These findings are not relabeled as malware. Existing scans, monitoring intervals and approval requirements are preserved. The hub cannot change Windows settings, terminate processes or disable protection.

The scheduled daily event now comes from the [persistent intelligence briefing](daily-intelligence.md), using public F1/aerospace feeds and explicitly reporting unavailable sources. It catches up today's missed briefing after 09:15 IST on startup and persists delivery state. The legacy manual `--briefing` test still uses activity counts. No reminder scheduler, malware detector or new SENTINEL detector is added. Other event types remain available for producers through the internal interface.

## Privacy and containment

ntfy priorities are 2 (low) or 3 (normal). Ordinary events use fixed category labels or aggregate counts; caller free text is discarded. The intelligence module additionally supplies a validated in-process public briefing containing public news, source links and labeled analysis. It never receives private research objectives, device details or forensic data. Public subscribers can still see topics and timing; choose an authenticated/private topic when that metadata is sensitive.

Telegram includes severity, detector timestamp (or an explicit unknown), configured device alias, an allowlisted behavior description, actual containment status and a recommended review action. Raw findings, forensic details, evidence IDs, model prose and credentials are not sent. Detailed findings remain local. A successful containment/recovery label requires a trusted local producer to supply all of `containment.status` (`contained`/`recovered`), `confirmed: true`, a valid `confirmedAt` and a nonempty `evidenceId`. The hub trusts that producer assertion; it cannot independently verify OS containment. Existing monitor integrations always report `not_performed`. A clean follow-up posture scan is never treated as confirmed recovery.

## Reliability and observability

Each event starts delivery immediately, without intentional batching. A critical alert does not wait for routine deliveries. Network calls have five-second deadlines and reject redirects; Telegram private-chat validation still precedes its send. A maximum of three delivery attempts handles network failures, HTTP 429 and 5xx. Retry waits are bounded (250/500 ms backoff, or a provider-requested delay up to five seconds); longer rate limits end the attempt as failed. Permanent errors and invalid acknowledgements are not retried. A Telegram attempt may make two HTTP calls: validation then sending.

Only explicit provider acknowledgements count as sent. Status means provider accepted the message, not that the user read it. A timeout after provider acceptance can still cause duplicate delivery on retry; neither channel provides exactly-once delivery here.

Concurrent identical events share one request. Successful deliveries deduplicate for 24 hours using event type, producer ID, severity, behavior category and containment state. Severity escalation and changed containment state create new notifications. Producers should use stable IDs for repeated detections and new IDs for separate incidents. Success metadata persists across restarts in ignored `.friday-communications/deliveries.json`; it retains at most 1,000 entries. Once evicted, an old event may be sent again. A corrupt/unwritable journal fails closed for subsequent sends and is reported rather than overwritten. Delivery failures remain retryable by the producer and are never marked successful.

`GET /api/communications/status` is local-only, reuses FRIDAY's same-origin/loopback guard, and reports channel configuration problems, journal health and the most recent 100 delivery records. Records contain hashed dedup keys, event categories, severity, attempt counts and safe error codes, never tokens, topic names, private chat IDs or message bodies. Configuration changes take effect after restarting FRIDAY.

## Tests and API references

Run `npm run test:communications`, `npm run test:research`, `npm run test:defense` and `npm run test:server-smoke`. Communications tests mock all network requests; no test sends a real message. Live credentials and destination access must be configured before real delivery can be validated.

Adapters follow [ntfy publishing](https://docs.ntfy.sh/publish/) and the [Telegram Bot API](https://core.telegram.org/bots/api). No new runtime dependencies are required.

Run `npm run notify:test:ntfy` only when you want to send a real harmless notification. It reads the backend environment, uses the same hub and public-safe payload path, never sends to Telegram, and makes exactly one delivery attempt with no retries. It prints the acceptance status and ntfy message ID (or a safe error code), and stores its audit record separately in ignored `.friday-communications/manual-tests.json`. Server acceptance does not confirm that iOS displayed the notification. Subscribe to the configured server/topic in the iPhone ntfy app and enable its notifications.

For an on-demand activity briefing test, use `npm run notify:test:ntfy -- --briefing`. It includes today's IST date and recorded activity from the live and manual delivery journals, labels itself as a manual test, and never writes to the running server's journal.
