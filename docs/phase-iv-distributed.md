# Phase IV � private distributed FRIDAY

## Status and inspected boundaries

Local implementation only. Nothing provisioned, enrolled, deployed, committed or pushed for Phase IV. No existing local memory or credentials uploaded. The earlier PDF branch remains the current branch; Phase IV changes are uncommitted on it.

Inspection found a React/Vite terminal and a large Express desktop server, research modules with atomic JSON memory, external provider adapters, persistent news briefing state, a 09:15 IST scheduler, ntfy/Telegram routing, Windows security collectors, desktop automation, and loopback/Host/origin research guards. There was no account/session authentication. No applicable AGENTS.md or additional file locks were found; existing desktop guards and modules remain in place.

New boundaries:

| Component | Responsibilities | Excluded |
| --- | --- | --- |
| Cloud entry point `backend/distributed/server.mjs` | Private API, passkeys, durable queue, approval/session management, provider-specific research/chat, news scheduling, ntfy outbox | Desktop server, local user memory, Windows automation, models, arbitrary commands |
| Windows `backend/distributed/worker.mjs` | Explicitly approved research/chat with public retrieval or loopback Ollama, separate local journal | Shell, arbitrary files, automatic experiments, external model fallback |
| iPhone `/mobile/` | Dashboard, chat/history, research/citations/PDFs, approval/cancellation, daily scheduling, events, worker/session revocation | Background execution requirement, token storage in localStorage, private API response caching |

Existing laptop functionality is preserved. It is not all remotely exposed: file processing, development actions and experiments require separately reviewed adapters and remain local/proposal-only. Chat reuses provider protocols through the portable provider interface, but does not import desktop tools or private conversational memory. Research reuses the existing orchestrator, retrieval, verification, memory, report and PDF modules. Existing research budgets remain unchanged. The mobile conversation history is the submitted chat task history, not a synchronized copy of desktop conversations.

## State, budgets and execution

Use Node 24 LTS for the new services. Node's built-in SQLite is currently marked experimental; it avoids a native addon or message broker. WAL, FULL synchronous writes and short IMMEDIATE transactions persist tasks, credentials, sessions, audit and outbox. The existing research and briefing JSON stores remain separate.

Cloud data consists of objectives/conditions explicitly submitted from the PWA, generated results, worker results only with task-level sync consent, public-source research records, news briefing history, passkey public keys/counters, hashed session/worker tokens, approval records, connection timestamps and bounded audit/outbox metadata. No local memory synchronization, local file upload or public report URL is implemented.

Limits: 500 task records; completed records expire after 30 days on queue submission; 1,000 audit entries; 500 outbox entries; five sessions; 30-minute absolute sessions; two-minute single-use challenges; 10 authentication attempts/minute; 240 API requests/minute per capability class; 15-minute task-bound approvals; one running task per execution environment; 90-second offline threshold; 120-second leases; 15-second polling. Research: 15 combined HTTP attempts, five model calls, 5,400 output tokens, 24,000 total reserved input tokens, 8,000 input tokens/call, one follow-up, 100 seconds. Chat: one model call, 1,200 output tokens, 25 seconds, at most 2,000 user characters. Billing is not measured or guaranteed by these reservations.

Task retries default to zero: a lost lease is failed with unknown outcome and is never automatically replayed. Resubmission needs a new idempotency key and fresh approval. Claims are atomic. Reconnection never grants approval. Cancellation/revocation prevents acceptance of late results; workers poll authorization during execution and cancel network work on failure. Already accepted provider requests cannot be recalled. Local completed worker results are retained if reporting fails; there is no automatic upload replay. Worker journal capacity is 500, then requires operator review.

Cloud research JSON files are pruned to 100 records / 30 days on research execution; they are independent of task rows. Results are capped at 256 KB each and aggregate task storage at 8 MB; excess results fail explicitly. Briefing histories retain their existing module behavior and require operator retention review. Storage snapshots are transactional; full history/state is serialized for this deliberately small, single-owner service. It is not a high-volume broker.

## Authentication and private connectivity

Tailscale Serve (v1.92+ for capability forwarding) injects an application-capability header and strips client-supplied copies. The core binds only to loopback and validates exact Host, HTTPS origin, capability, then passkey/session/CSRF. Owner and worker APIs are separated. A user-agent or caller-supplied IP does not authenticate the application. The reviewed policy restricts the phone's cryptographically authenticated Tailscale node/address; changing devices requires a new approval. Passkey synchronization does not give another tailnet device the application capability.

Use `deploy/phase-iv/tailscale-policy.template.json` as a review template, not a complete replacement policy. Supply actual device addresses and assign the worker/core tags only to approved nodes. Existing grants are additive: a preexisting allow-all policy must be reviewed before applying this restriction. No administrative SSH permission is added. Request explicit owner approval for any admin rule, tag assignment, device enrollment, or network-wide change.

After approval, on the core host with Tailscale installed, HTTPS enabled and the reviewed policy applied:

```sh
tailscale serve --bg --https=443 --accept-app-caps=friday.local/role http://127.0.0.1:3210
tailscale serve status
```

Use the actual private HTTPS origin reported by Serve as `FRIDAY_CLOUD_ORIGIN` (no trailing slash). Never enable Funnel or public port forwarding. Block public inbound FRIDAY ports in the VM firewall/security group. Only Serve may proxy the loopback port. Other local processes are in the host trust boundary and could forge proxy headers if the host is compromised. Tailscale HTTPS certificate names are visible in certificate-transparency systems; choose names without private information.

[Serve capability forwarding](https://tailscale.com/docs/features/tailscale-serve) and [Tailscale pricing](https://tailscale.com/pricing) were checked on 10 November 2026. The personal plan currently permits this small personal topology; verify account eligibility and current limits before deployment. No tailnet policy was applied or tested against real devices here.

## Owner enrollment and recovery

Create a random 32-byte enrollment code using a local cryptographic generator in a trusted administrative session. Put only its SHA-256 hash in `FRIDAY_ENROLLMENT_SHA256`; deliver the raw code to the owner through a separate secure route. Never put it in chat, URLs, Git or an ntfy notification. The PWA's first-time enrollment requires that code and the owner device capability. WebAuthn verifies challenge, origin, RP ID, signature and user verification. Platform authenticators may offer Face ID or a device passcode; Face ID specifically cannot be guaranteed by the server. Successful enrollment is persisted and cannot be repeated just by reusing the code. Remove the enrollment hash from runtime config after enrollment.

Sessions use Secure, HttpOnly, SameSite=Strict `__Host-friday` cookies and server-side revocation. CSRF tokens remain in memory. Security events contain no passkeys, secrets or command text. Credential fields are hashed or public-key material, not usable plaintext tokens.

Lost phone: first revoke its Tailscale node, then revoke sessions via an authorized owner session or an explicitly approved host administration session:

```sh
node backend/distributed/admin.mjs revoke-sessions
node backend/distributed/admin.mjs recover-owner
```

`recover-owner` additionally clears passkeys and challenges. Only use after reviewing the incident; configure a NEW enrollment code/hash and explicitly approve the replacement device. Possession of cloud host administration is a recovery authority, not a remote bypass endpoint.

## Worker enrollment and operation

Generate a distinct random 32-byte worker token. Supply it through a protected process environment or restricted local credential store, never command arguments, source code or logs. On the core, under explicit administrative approval, with the intended data directory and token environment set:

```sh
node backend/distributed/admin.mjs register-worker <approved-worker-id>
node backend/distributed/admin.mjs rotate-worker <approved-worker-id>
node backend/distributed/admin.mjs revoke-worker <approved-worker-id>
```

These commands store only the token hash. Rotation invalidates the previous token. On Windows, configure `FRIDAY_CLOUD_ORIGIN`, `FRIDAY_WORKER_TOKEN`, optional `FRIDAY_WORKER_DATA` and `OLLAMA_MODEL` in a restricted process environment, then:

```powershell
npm run start:worker
```

The worker initiates outbound private HTTPS; no worker inbound endpoint is opened. It does not load `backend/.env.local`, copy existing memory, or run on boot automatically. Task Scheduler/service installation requires separate approval. Keep Windows awake for local execution; sleep marks it offline and leaves approved pending work queued. Wake restores availability after token validation, not authorization for expired/revoked tasks. Research proposals are never interpreted as executable commands.

## ntfy-only migration

All FRIDAY event routes now select ntfy, including SENTINEL. Telegram transport code is retained for compatibility but no FRIDAY route can invoke it. Routine and security topics must differ. Owner-authenticated settings can mute routine and security cloud outbox notifications independently; muted entries remain visible in the audit/history. All sends require an authentication token and `FRIDAY_NTFY_ACL_VERIFIED=true`; this flag is operator attestation after actual ACL checks, not proof that a remote server is configured correctly. A random public topic name is insufficient. Existing unprotected settings now fail closed, intentionally; configure private topics before activating the updated server. `.env.local` has not been changed for Phase IV.

Use `deploy/phase-iv/ntfy-server.template.yml` as a self-hosted starting point: anonymous access denied, separate least-privilege publisher and subscriber users, exact per-topic ACLs. Follow the [official ntfy configuration](https://docs.ntfy.sh/config/) for user/token creation. Do not make the publisher an admin. Configure both topic names, server URL, and publisher token in the cloud environment. Verify anonymous reads/writes fail, subscriber can read only intended topics, publisher can write only intended topics, then set the ACL verification flag.

For a private self-hosted instance, expose ntfy through a separate reviewed Tailscale Serve HTTPS listener/hostname. Its grant must allow the phone to read and core to publish, in addition to ntfy authentication; do not reuse the FRIDAY owner app capability as topic authentication. No server, account or listener was configured here.

The stock iOS ntfy app requires an upstream APNS/Firebase-connected relay for timely notifications. `upstream-base-url: https://ntfy.sh` forwards poll metadata, not full notification content. The phone must then reach the private ntfy origin over Tailscale. VPN-on-demand and background fetch behavior must be tested with the screen locked and the laptop off. This configuration is not a guarantee of reliable instant push. No Apple Developer membership is required for the PWA/stock ntfy app.

Security notification previews are generic, severity-aware, and never claim successful containment. Details stay private. Critical outbox dispatch is independent of normal delivery. Three attempts maximum for explicit 429/5xx responses with backoff; transport ambiguity and interrupted dispatch are recorded unknown with no automatic resend. The daily briefing runner retains its own restart-safe dispatch record. Cloud research notifications open no public PDF attachment; authenticated downloads are available in the PWA. Previous desktop PDF upload support remains, but now requires private ntfy configuration too.

## Hosting decision (not provisioned)

Oracle Always Free is a candidate, not an approved deployment. Current documentation specifies two AMD micro instances (1 GB each) or an ARM allocation of 1,500 OCPU-hours and 9,000 GB-hours monthly (2 OCPUs/12 GB equivalent), 200 GB combined block storage and home-region restrictions. Capacity can be unavailable; idle instances can be reclaimed after low use over seven days. Registration requires account verification; inspect the real signup/card requirements and eligible region before proceeding. Prefer a small Ubuntu ARM VM only if tenancy quota and package compatibility are confirmed. Avoid artificial load to defeat reclamation. [Oracle limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Google's free Compute Engine alternative is one eligible e2-micro in specified US regions, 30 GB-month standard persistent disk and 1 GB outbound transfer. Billing-account requirements, public IPv4 and other networking charges make it unsuitable to promise as entirely free without an account-specific estimate. [Google free-tier conditions](https://docs.cloud.google.com/free/docs/free-cloud-features)

Neither candidate guarantees perpetual free uptime. Services that intentionally sleep are unsuitable for this scheduler. If no eligible capacity is available, stop provisioning and keep the local version; paid hosting remains optional and needs approval. AI provider usage is separate from hosting: retrieval-only is the default and scheduled briefings make no model calls. ARM execution, memory footprint and iOS push have not been measured on a real VM.

## Reviewed deployment sequence � approval required

1. Owner approves provider/region, exact eligible resources and any account verification. Do not enable billing upgrades or paid resources implicitly.
2. Build locally: `npm run build:mobile`, then `node deploy/phase-iv/prepare.mjs`. This creates ignored `cloud-package` containing allowlisted backend modules, mobile assets and a minimal package manifest. It excludes the desktop server, local data, keys, model runtimes and experiment scripts. Review the package and generate/review its dependency lock before transfer. Do not upload the entire repository or `.env.local`.
3. After approval, transfer only the reviewed package to `/opt/friday` on a compatible Linux VM; install Node 24 LTS using official distribution instructions. Install the minimal runtime dependencies with the reviewed lock. Create a dedicated unprivileged `friday` user/group and private `/var/lib/friday` directory. Install `/etc/friday/cloud.env` from the template, owned by the service administrator and restricted to mode 600.
4. Review/install `deploy/phase-iv/friday-cloud.service`, adjusting `/usr/bin/node` if required. It sets process/resource bounds and grants writes only to its private data directory. Verify `systemd-analyze verify` on the actual host; this was not run on Windows.
5. Approve/apply Tailscale device policies and private Serve; configure authenticated ntfy and verify anonymous access denial. Review all firewall rules. The core binds 127.0.0.1:3210; no public FRIDAY listener.
6. Start the service only after approvals: `sudo systemctl daemon-reload`, `sudo systemctl enable --now friday-cloud`. Verify private access, rejection from an unrelated tailnet node, passkey enrollment, expired session/CSRF rejection, worker revocation, and a locked-iPhone notification. These are deployment acceptance tests, not claimed results.
7. Open the actual private URL in iPhone Safari, select Share ? Add to Home Screen, enroll with the approved code. Grant ntfy notification permissions in the stock app. The PWA caches only its UI shell, never API/report/session data, and refreshes on visibility return.
8. Enable daily scheduling in the Automation section after reviewing notification configuration. Only ONE installation should own the daily news schedule; explicitly disable the laptop's daily scheduler during migration to prevent cross-installation duplicates. Do not silently copy the laptop's briefing history to cloud. The new cloud starts with its own public-news novelty history.

## Backup, retention, incident response and recovery

Backups require an approved encrypted destination. Stop the core for a consistent filesystem backup of its data directory, or use SQLite's supported online backup API and coordinate the separate research/briefing files. Never copy only a live SQLite main file while ignoring WAL. Preserve ownership/permissions and encrypt at rest. Test a restore into an isolated private environment before relying on it. Do not restore old session or worker credentials after compromise; revoke sessions, rotate worker/publisher tokens and re-enroll explicitly. Review the existing briefing-store retention and backup sizes; queue, audit and cloud research retention are bounded separately.

If a task is stuck: inspect state and worker connection; never edit leases to force replay. Unknown outcomes need review and a new approved task. If storage is full/corrupt, stop writes and preserve evidence/backups; do not delete the database to make startup pass. Unknown ntfy outcomes must not be marked sent. If access fails, check private URL, Serve app-cap forwarding, device grant, origin, session expiry and CSRF. If push fails, check topic ACLs, relay config, phone VPN reachability and ntfy iOS permissions. The cloud cannot report its own total outage; independent owner-approved external monitoring is a future operational addition.

## Validation and known limitations

Automated fixtures test application enforcement with simulated Serve headers. They DO NOT validate WireGuard identity, actual Tailscale policies, Face ID enrollment, cloud free-tier eligibility, actual iOS installation/background delivery, or ARM runtime behavior. Those remain deployment gates.

Experiments, development agents, arbitrary automation schedules, local-file transfers and full desktop command parity are intentionally not exposed. The cloud is a restricted extension; the laptop installation remains the place for those existing features. The initial PWA does not provide microphone/voice recording. Annual summaries are not scheduled by this phase. No complete-security claim is made.

## Exact local validation results � 10 November 2026

| Check | Result |
| --- | --- |
| Combined research, communications, briefing, core and distributed Node test command | 120 passed, 0 failed, 0 skipped |
| `npm run test:distributed` (included in the combined count) | 23 passed, 0 failed |
| `npm run test:reverse-engineering` | 12 passed, 0 failed |
| `npm run test:server-smoke` | Passed; isolated desktop startup and API/security assertions |
| `npm run test:cloud-smoke` | Passed; actual cloud entry point, no worker/providers/notifications, simulated Serve headers |
| `npm run test:studio-fallback` | Passed; mocked providers, no paid requests |
| `npm run test:code-handoff` | Passed; no editor or shell launched |
| `npm run lint` | Passed |
| `npm run build:mobile` | Passed; 213.61 KB JS, 67.05 KB gzip |
| `npm run build` | Passed; existing greater-than-500-KB bundle warning |
| `git diff --check` | Passed; LF/CRLF informational warnings only |
| New dependency install/audit | 0 reported vulnerabilities at install time |

The initial mobile build failed because sandboxed esbuild could not read its config path; the permitted build then passed. Initial integration fixtures used a fetch implementation that ignored a custom Host override; switching the test transport to Node HTTP preserved the actual Host boundary and those tests passed. A previous briefing assertion expected a timeout to mean failed; the implementation/test now records it as delivery unknown and prevents replay. No currently failing automated check remains. SQLite/WebCrypto emit experimental-feature warnings on the local Node runtime.

Reproduce the combined run:

```powershell
node --import tsx --test backend/research/test/*.test.mjs backend/communications/test/*.test.mjs backend/briefing/test/*.test.mjs backend/test/*.test.mjs backend/distributed/test/*.test.mjs
```

No live research, simulations, ntfy sends, cloud provisioning, account enrollment, network policy modifications, commits, pushes or deployments were performed for this phase. Running desktop services were not restarted. Test-only cloud/desktop processes were stopped.

## Changed-file inventory

New runtime modules: `backend/distributed/state.mjs`, `queue.mjs`, `auth.mjs`, `app.mjs`, `server.mjs`, `executor.mjs`, `worker.mjs`, `admin.mjs`, `outbox.mjs`; `backend/research/portable-model.mjs`.

New validation: `backend/distributed/test/distributed.test.mjs`, `backend/distributed/smoke.mjs`.

New mobile assets: `frontend/mobile/index.html`, `frontend/mobile/public/manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`; `frontend/src/mobile/main.tsx`, `mobile.css`; `vite.mobile.config.ts`.

New deployment artifacts: `deploy/phase-iv/cloud.env.example`, `friday-cloud.service`, `ntfy-server.template.yml`, `tailscale-policy.template.json`, `prepare.mjs`; this document. The generated `cloud-package/` and `mobile-dist/` are ignored local artifacts.

Updated existing files: `.gitignore`, `backend/.env.example`, `backend/communications/hub.mjs`, its communications tests, briefing delivery tests, PDF delivery fixture configuration, `package.json`, `package-lock.json`. The original desktop server, research planner/verification/budget files, local memory, chat/voice components, security collectors and protected configuration were not rewritten.
