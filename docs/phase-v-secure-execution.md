# Phase V — secure authentication and durable execution

Local implementation report, 11 November 2026 (Asia/Kolkata). No deployment, commit, push, account/resource provisioning, live model request or test notification was performed. Existing research, memory, desktop security collectors, Node authentication, briefing state, communications routing and Windows worker entry point remain intact.

## Readiness and architecture decision

**Local implementation validated; not approved or ready for production activation.** Root Wrangler still has seven switches set to false: frontend, scheduling, enrollment, executor API, device-policy verification, schedule-cutover verification, and ntfy. There are no database bindings, routes, account IDs, Cron triggers, credentials or paid services configured. workers.dev and previews remain disabled; every asset request passes through the Worker.

For the currently described unmanaged personal iPhone, use the existing **private Tailscale Node core + passkey** architecture as the practical device-restricted path. Require device approval, an explicit grant for the enrolled phone's node/address to the core HTTPS port, and remove broader allow rules. Restrict executors independently. This is enforceable node-identity restriction, not immutable physical-device attestation. A compromised node key, unlocked phone or administrator account remains a risk. Passkeys may sync through iCloud and are not physical-device exclusivity.

The Cloudflare implementation is a separate prepared path. Access identity verification alone is insufficient for the iPhone-only condition. Cloudflare's documented iOS UUID posture check requires an MDM-managed configuration; it cannot be assigned manually. No no-card, unmanaged-iPhone-only Cloudflare Access policy was established here. `DEVICE_POLICY_VERIFIED` is a fail-closed operator gate, **not evidence** that a policy exists. Leave it false until the actual hostname, alternate-host restrictions and second-device rejection are tested. A public Worker does not join a tailnet merely because the phone uses Tailscale. Do not replace this requirement with email-only Access or public hosting.

Tailscale Personal permits six users on the free personal plan. Existing hardware can host the private core without new hosting spend, but it must stay powered and online. An always-on, no-card free VM was not established. Cloudflare Workers cannot host the unmodified filesystem/SQLite/PDF research core. Its CPU budget is not a substitute for a private Node host.

Sources checked for this decision: [Tailscale pricing](https://tailscale.com/pricing), [device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval), [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart), [Cloudflare iOS UUID requirement](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/device-uuid/). Provider-account eligibility, card requirements during an actual signup, and device-policy entitlements remain manual checks, not tested account facts.

## Authentication implemented

- Reuses installed `@simplewebauthn/server` 14.1.0; no new dependency or handwritten WebAuthn signature verification. Registration allows ES256 platform credentials, requires user verification, and pins RP ID and HTTPS origin. Tests construct an actual ES256 credential and signed assertion and run the real verifier.
- Initial registration needs BOTH `ENROLLMENT_ENABLED=true` and an unexpired, unused D1 bootstrap row containing the exact Access subject and SHA-256 hash of a random code of at least 32 bytes. No bootstrap row or real code was generated. Registration cannot replace an existing owner credential.
- Two-minute challenges are bound to the owner subject and flow and atomically consumed before signature verification. Failed verifications consume the challenge. Concurrent enrollment is constrained by one owner credential; assertion counter/version changes and session insertion use a D1 transaction.
- Random session tokens are stored only as hashes. Sessions require the matching credential to remain unrevoked, the exact authenticated Access subject, and an unexpired server-side row. Cookies use `__Host-`, Secure, HttpOnly, SameSite=Strict, Path=/, 30-minute expiry. Maximum five active sessions. Revocation deletes the server-side row.
- CSRF tokens are required for authenticated mutations. Host/HTTPS and same-origin checks reject cross-origin requests. Auth bootstrap routes require the verified outer identity/device gate and exact Origin, but not an existing app session.
- D1-backed fixed-window limits: 10 auth operations/minute (options and verification both count), 120 owner API requests/minute, 120 executor requests/minute, 100 new task submissions/day. Expired rate/challenge/session records are cleaned during maintenance. Limits are not an account-level DDoS guarantee; Access must reject unauthorized traffic at the edge too.
- Access JWT validation requires RS256, signature verification, exact configured issuer/audience/subject, expiry, issuance and optional not-before checks. Keys are fetched only from the configured `*.cloudflareaccess.com` issuer, with redirects forbidden, five-second timeout, bounded body/key count and five-minute cache. Forged email/identity headers are ignored. Unknown rotated key IDs fail closed until refresh; no token-supplied URL fetch.

Reference: [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server).

## D1 queue and execution

Apply existing `cloudflare/schema.sql`, then `cloudflare/migrations/0002_phase_v.sql` once through reviewed migration tooling. The migration is tested locally but never auto-applied by requests. Back up any existing database before future migration; do not point tests at private state.

Queue submissions accept only research/chat, fixed provider choices, bounded objective/conditions and explicit consent to store results. Core and Windows targets are separate. There is no arbitrary tool, URL, shell, file-access or desktop-control task type. Task payload hash and idempotency key prevent changed-payload replays. Task capacity is 500; retained result capacity is under 8 MB, with a 256 KB result limit. Finished records older than 30 days are removed in bounded batches; unresolved/unknown outcomes are retained for review and can eventually exhaust capacity intentionally.

Approval binds the exact payload hash for 15 minutes. Each task expires after 24 hours. Claiming uses a single conditional SQL UPDATE plus a partial unique index permitting one running task per target. It verifies executor authorization, heartbeat recency, sufficient approval lifetime and retry count. Each claim receives a random lease, stored only as a hash, valid for 120 seconds.

An executor must obtain execution authorization before starting and revalidate during work. Completion verifies lease, expiry, executor revocation, payload approval and the execution marker. Completion plus a unique outbox entry commit in one D1 batch transaction. Executor results remain **executor-reported, unvalidated claims**, not proof of simulation or physical validation.

At most three claims are allowed, and retry release is permitted only before the first execution authorization. Once execution may have started, disconnection/expired lease becomes `outcome_unknown` and is never automatically replayed. Revoked approvals prevent further authorization and completion. A cooperative executor aborts on its next guard check; this does not undo work already performed or guarantee instant cancellation of an in-flight external request.

`backend/distributed/d1-executor.mjs` adds an opt-in `createD1Executor(...).runOnce()` adapter. It creates no background runner by import and requires an explicit private directory, independently provisioned bearer credential, target and durable journal. It uses the existing research executor and budgets, validates capabilities, journals task IDs before execution, and refuses restart replays. Existing Windows worker startup remains unchanged. An operator must later choose and approve a host/runner; none was started here.

Only cloud-compatible control operations, D1 metadata/leases and bounded ntfy HTTP dispatch execute in the Worker. Research, chat, PDF generation and news retrieval stay in the existing Node core/worker. Research limits remain 15 HTTP attempts including models, five model calls without retries, 5,400 output tokens, 8,000 input tokens/call, 24,000 input tokens total, 100 seconds and one follow-up. No experiments execute.

## 09:15 IST integration and notification privacy

Proposed trigger remains `45 3 * * *` UTC, exactly 09:15 Asia/Kolkata. No trigger is provisioned. Scheduling requires the runtime switch, `SCHEDULE_CUTOVER_VERIFIED`, durable `schedule_authority=cloudflare`, and owner-enabled daily setting. Cron creates a unique `briefing:YYYY-MM-DD` no-model task for the core; this standing schedule approval does not approve arbitrary research. Daily tasks expire after 23 hours.

The bridge calls the existing briefing service with the **same persistent briefing directory** as the old scheduler. Its day locks, seen-source history and pre-delivery marker suppress duplicate briefing deliveries across restarts and old/new scheduler overlap. A fixture verifies an already-delivered day performs no new retrieval or notification. Disabling daily settings cancels outstanding D1 daily work. The old scheduler must still be disabled during cutover, and differing directories/independent hosts would defeat shared-state deduplication. Do not enable cutover until that is verified. Exact-minute Cron and external push delivery are not hard real-time guarantees.

D1 completion does not emit a second daily notification; the existing briefing hub owns the full sourced briefing. Other D1 task updates use the new Worker ntfy outbox. The Worker sender requires explicit HTTPS server, token, distinct general/security topics and ACL verification attestation. It has no default public topic or Telegram path. Security messages are generic, high priority, and never assert containment. Existing SENTINEL detection/routing continues through the existing Node hub; no new detector was added.

Dispatch persists `sending` before HTTP I/O, records provider acknowledgement before `sent`, retries only explicit 429/5xx failures up to three attempts with bounded backoff, and never replays ambiguous network/interrupted deliveries. Queue selection prioritizes critical security events; dispatch processes one event per invocation and can be triggered by completion, heartbeat or scheduled tick. General/security notification preferences remain independent. Muted records have a no-delivery error; no success is fabricated. No provider response text or secrets are logged.

Tests verify authenticated request construction, topic separation, 403 rejection, missing token/ACL rejection, preference handling, retries and unknown delivery using mock providers. **No real server ACLs or iPhone notifications were verified.** An authentication token and an attestation flag do not independently prove topic privacy. Manual acceptance must reject anonymous publish AND subscribe on both topics and verify least-privilege authorized access.

Hosted ntfy free public topics do not satisfy the requirement. Reserved/private hosted topics may require a paid plan; self-hosting supports ACLs but needs an approved reachable host. A Tailscale-only ntfy host is reachable by the private Node core, not directly by a standard public Worker. Keep Worker dispatch disabled unless an approved authenticated HTTPS server is reachable. No public-topic fallback is permitted. [ntfy configuration](https://docs.ntfy.sh/config/), [hosted pricing](https://ntfy.sh/).

## Exact dependencies and cost boundaries

| Component | Required for Cloudflare path | Current documented Free boundary / caveat |
| --- | --- | --- |
| Workers + static assets | One Worker, private mobile assets | 100,000 requests/day, 10 ms CPU/invocation, 128 MB memory, 50 subrequests. No paid plan enabled. |
| D1 | One database | 5 million rows read/day, 100,000 rows written/day, 500 MB per database, 5 GB/account, 10 databases, 50 queries/invocation. No database provisioned. |
| Cron | One daily trigger; optional additional approved maintenance tick | Five triggers/account on Free. Current configuration has none. Heartbeats also drive outbox retries. |
| Access | Identity plus real device restriction | No account policy or enrollment was created. iOS UUID requires MDM; its availability/cost must be checked. Email-only Access is insufficient. |
| Tailscale alternative | Approved phone/core nodes, private HTTPS | Personal free eligibility applies to personal use; node restrictions still need policy and real-device testing. It does not supply a VM. |
| ntfy | Two ACL-protected topics | Public free topics forbidden; private hosted reservations or a self-hosted server may add cost. |
| Private Node host | Existing engine/PDF/news retrieval | Existing hardware possible, but no guaranteed always-on, no-card free VM established. |
| Model providers | Only explicitly selected/approved tasks | Independent provider charges may apply; Cloudflare Free does not cover them. |

Cloudflare advertises a no-credit-card Free entry plan, but this is not proof of the user's account state or of free MDM, domain registration, private ntfy hosting, or VM capacity. No R2, Queues, KV, Durable Objects, Workers AI, paid upgrade or billing binding was added. High usage must fail/stop rather than trigger an automatic upgrade. Authentication cold-start/crypto CPU and real D1 query usage must be measured before activation; local passing tests do not prove compliance with the 10 ms production CPU allowance. [Cloudflare Free entry](https://www.cloudflare.com/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Bootstrap and remaining manual steps — NOT performed

1. Select and approve the real topology. For unmanaged iPhone/no-paid-device-management, prefer private Tailscale/core; leave the Cloudflare route disabled. If choosing Access, obtain a demonstrably enforceable device policy without assuming Free MDM.
2. Verify real account/free-plan limits, exact hostnames and host availability. Obtain separate resource/deployment approval. Configure deny-by-default network rules; never expose the desktop server or use Funnel as a shortcut.
3. Review backups/migration, then provision and migrate D1 only if approved. Configure `APP_ORIGIN`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, `ACCESS_OWNER_SUBJECT`, and explicit allowed core providers on the server. Protect all routes, assets, alternate hostnames and executor paths; service-auth policy must not grant browser access to machine APIs. Keep workers.dev/previews off.
4. Approve a one-time bootstrap window separately. Using a trusted administrative session, generate a random 32-byte code, store only its SHA-256 digest in bootstrap row 1 with exact subject and a ten-minute expiry, and transfer the code privately. Do not put it in source, CLI history, logs or ntfy. Enable enrollment only for that window. Verify iPhone registration, then turn it off and remove the bootstrap secret. Recovery requires separately approved credential/session revocation and re-enrollment; it is not an unauthenticated HTTP route.
5. Provision separate random 32-byte executor credentials; store hashes and exact core/worker target in D1, raw secrets only in private process environments. Supply a dedicated persistent execution journal. Start the opt-in adapter only after approval; do not run duplicate core services or copy desktop memory into cloud storage.
6. Review result-sharing consent, CPU/row usage, malformed input, JWT expiry/key rotation, auth replay, session/credential revocation, concurrent queue claims, unknown outcomes, wrong executor target, and post-revocation completion on the actual platform. Test another device signed into the same identity and a stolen/revoked session. Test iPhone passkey sync behavior explicitly.
7. Configure and independently verify ntfy ACLs and hosting reachability. Use only harmless approved real delivery probes. Verify iOS background delivery with the screen locked; APNS relay/VPN behavior is not proven locally.
8. Stop the old scheduler and identify the canonical briefing state directory. Verify same-day deduplication, then approve cutover and enable the 09:15 schedule. No automatic scheduled model calls.
9. Audit the final mobile build again, obtain deployment approval, deploy only the reviewed private application, verify no direct-host bypass, and enable features individually. No flag should be enabled merely because a local unit test passed.

PDF generation remains available on the existing private Node core. The Worker returns an explicit 501 for PDF rather than exposing a local endpoint or public file; the mobile UI hides that unsupported button for the Worker response. No public PDF storage was introduced. The existing Node response remains compatible and retains its PDF download behavior.

## Changed files in this stage

New cloud modules: `cloudflare/access.mjs`, `auth.mjs`, `common.mjs`, `queue.mjs`, `notifications.mjs`, `schedule-proposal.mjs`; migration `cloudflare/migrations/0002_phase_v.sql`; tools `cloudflare/audit-mobile.mjs`, `runtime-smoke.mjs`; tests `cloudflare/test/d1.mjs`, `phase-v.test.mjs`, `executor.test.mjs`.

Updated: `cloudflare/worker.mjs`, `cloudflare/test/worker.test.mjs` (superseded scaffold-only checks replaced by real auth/queue tests), `wrangler.jsonc`, `frontend/src/mobile/main.tsx`. New Node adapter: `backend/distributed/d1-executor.mjs`. Documentation: this report and a cross-reference in `docs/secure-cloud-architecture.md`.

No package or lockfile changes were needed in Phase V. Earlier uncommitted Phase IV changes remain in the workspace; they are not newly attributed to this stage. No existing research/memory/provider/communications implementation was rewritten.

## Validation results

- All discovered `*.test.mjs` under backend and cloudflare, with `node --import tsx --test --test-concurrency=1`: **153 passed, 0 failed, 0 skipped**. Includes real signed WebAuthn fixtures, JWT validation, replay, expiry, CSRF, revocation, D1 SQL, concurrent claims, restart, outbox, topic/privacy and existing regression suites.
- `npm run test:studio-fallback`: passed, mocked provider calls.
- `npm run test:code-handoff`: passed, editor/shell launch mocked.
- `npm run test:cloud-smoke`: passed, independent loopback Node core with simulated Serve headers.
- `npm run test:server-smoke`: passed, isolated desktop startup, health/UI and local-origin guards.
- `npm run lint`: passed, TypeScript noEmit.
- `npm run build`: passed, 2,088 modules, desktop JS 554.73 KB; existing >500 KB chunk warning remains.
- `npm run build:mobile`: passed, 49 modules, JS 215.18 KB / gzip 67.67 KB.
- Wrangler 4.160.0 `deploy --dry-run --config wrangler.jsonc --name friday-private-validation --outdir work/phase-v-worker`: passed, Worker 742.43 KiB / gzip 138.96 KiB. The validation name created no resource. The only bindings shown were assets and disabled flags.
- `cloudflare/runtime-smoke.mjs`: passed in bundled workerd with actual local Miniflare D1, including migration, concurrent claims and completion/outbox transaction. Two initial harness configurations failed because installed Miniflare 5 beta changed its constructor; using its documented exported V4 compatibility adapter resolved this. No production restriction was changed.
- Mobile artifact audit: seven physical files; no configured-secret matches, private-key/token patterns, localhost backend URLs, desktop API/bridge code or unexpected private artifact extensions. The audit never outputs secret matches. It is not a mathematical proof against unknown or deliberately disguised secrets.

Manual/live scanner, browser preview, PDF notification and research probe scripts were not invoked: they perform real external requests, notifications or interactive operations. No iPhone, remote ACL, live Access/MDM or production D1 integration is claimed. Local emulator tests do not demonstrate internet-facing deployment security or Free CPU performance.
