# Private iPhone cloud preparation — 2026-11-11

Phase V implementation and current validation supersede the scaffold-only status below. See [phase-v-secure-execution.md](phase-v-secure-execution.md). Deployment and enrollment remain disabled.

## Status and boundaries

Development only. No deployment, account creation, remote migration, secrets upload, notification, live model call, commit or push. No new package dependencies. Existing uncommitted Phase IV work predates this change and is retained.

The actual private mobile application remains `frontend/src/mobile/main.tsx`, built into `mobile-dist`. The Windows terminal remains in `dist` and is not the Cloudflare asset source. Root Wrangler now selects the private build and the new minimal Worker. All requests run through that Worker; assets, previews and workers.dev are disabled. There is no public demo. Run `npm run build:mobile` before any future Wrangler validation.

The Worker exports a deliberately denying authentication implementation. Setting `FRONTEND_ENABLED=true` does NOT make authentication work or publish assets. Test-only injected verifiers exercise guard behavior; they are not production authentication. API mutations return unavailable even with a test session. No backend proxy, research executor, desktop imports or notification transport is connected.

## Frontend API inventory

Inventory covers `frontend/src`, `frontend/public`, and `frontend/mobile`, including download links and Electron bridges. Paths below are relative to the application origin unless noted. Repeated call sites are grouped, not omitted. There are no application WebSocket, EventSource, XMLHttpRequest or sendBeacon clients; website analysis uses fetch response streaming.

| Caller | API routes / methods | Placement |
| --- | --- | --- |
| services/ai.ts | POST `/api/chat`, `/api/transcribe`, `/api/transcribe-wav`; GET `/api/diagnostics/full`; POST `/api/kali/run` | Existing Windows backend; chat/research may be offered through reviewed mobile tasks; diagnostics/Kali remain laptop-only |
| services/onlineVoice.ts | POST `/api/voice/synthesize` | Provider-backed capability potentially portable, not connected in cloud |
| Terminal.tsx | GET `/api/markets` | Portable public data, not yet a cloud route |
| Terminal.tsx | GET `/api/desktop/voices`; POST `/api/desktop/speak` (two callers) | Windows voice, laptop-only |
| Terminal.tsx | GET `/api/network/doctor`, `/api/hardware/devices` | Laptop diagnostics |
| Terminal.tsx | POST `/api/vision/inspect-object`, `/api/vision/search-object` | Camera/provider capability; needs separate cloud consent and payload policy |
| Terminal.tsx | POST `/api/security/web-audit`; GET `/api/security/project-audit`, `/api/security/project-audit.pdf`, `/api/security/system-protection` | Local authorization/security boundary; unavailable in Worker |
| Terminal.tsx | POST `/api/desktop/open`, `/close`, `/action`, `/task` | Laptop-only; historical explicit `http://127.0.0.1:3000` retry targets now rejected outside a local page |
| ResearchReports.tsx | GET `/api/research/v1`, `/api/research/v1/:id/pdf` | Local history/PDF; no automatic memory upload; mobile only exposes explicitly shared task reports |
| WhitehatWorkbench.tsx | POST `/api/security/whitehat/assess` | Local scoped assessment, no cloud route |
| ReverseEngineeringWorkspace.tsx | Under `/api/reverse-engineering/v1`: GET `/capabilities?refresh=true`, `/jobs/:id`, `/jobs/:id/report?format=markdown|json`; POST `/artifacts`, `/jobs`, `/jobs/:id/cancel`, `/websites/analyze/stream`, `/website-studio/projects`; GET `/website-studio/projects/:id/export` | Laptop tools/files/automation; never proxied from Worker |
| WebsiteStudioEditor.tsx | Under `/api/reverse-engineering/v1/website-studio/projects`: GET collection, `/:id`, `/:id/export`; POST `/:id/propose-edit`; PUT `/:id/sources`, `/:id/file` | Laptop-only |
| mobile/main.tsx | Under `/api/mobile`: GET `/status`, `/tasks/:id/pdf`; POST `/auth/options`, `/auth/verify`, `/tasks`, `/tasks/:id/approve`, `/tasks/:id/cancel`, `/settings`, `/sessions/revoke`, `/logout`, `/workers/:id/revoke` | Existing private Node core API; Worker scaffold is NOT yet API-compatible |
| public/gesture-control.html | POST `/api/desktop/cursor`; GET `/api/desktop/status` | Standalone Windows page with explicit loopback-origin guard; absent from mobile build |
| mobile/public/sw.js | Same-origin `/mobile/` shell/assets only | No API/session/report caching; no background research |

Non-HTTP surfaces: Electron `window.fridayDesktop` handles Windows app launch, studio preview/export/code editor, rendered website scanning and related desktop integrations. These remain in the Windows build only. Studio preview URLs returned by the local backend open in the browser; source links in reports are normal external navigation, not API calls. Gesture media libraries load from existing external CDNs in the desktop page only. Browser microphone/camera and speech APIs remain device-local, not cloud privileges.

## Shared client

`frontend/src/services/apiClient.ts` centralizes React API requests and API downloads. Public Vite settings:

- `VITE_FRIDAY_API_BASE`: optional origin, e.g. `http://127.0.0.1:3000` for localhost development. No embedded credentials, paths or tokens.
- `VITE_FRIDAY_API_MODE`: `desktop` or `private-mobile`. Defaults to desktop only on a loopback page. Mobile build forces private-mobile.

Default Windows same-origin behavior and local explicit backend retries are preserved. Cross-origin configuration is accepted only between loopback origins in desktop mode. Remote pages require HTTPS and same-origin `/api/mobile/` paths, even if configured as desktop. Requests preserve caller bodies, signals and headers; no retries are added. Cookies remain same-origin, redirects fail, and responses are not cached. This is defense in depth, NOT authentication: the backend must independently authorize every operation. LAN-hosted desktop pages intentionally no longer access laptop capabilities; use local Windows URLs.

## Proposed runtime architecture

1. Private iPhone PWA → identity/device gate → application passkey/session gate → control API.
2. Cloudflare Worker handles bounded control requests only. D1 is the proposed durable task/approval/schedule/outbox store. Cron creates a daily proposal; it does not run the Node engine.
3. Existing Node research core stays on a separately approved private host with its own memory, citation verification, provider controls and PDF generation. A future authenticated outbound polling adapter claims only specifically approved research/chat tasks. No arbitrary URL dispatch, shell, desktop-control forwarding or automatic local-memory migration.
4. ntfy delivery continues through the existing communications hub using authenticated, ACL-verified ordinary/security topics. No Telegram route or public-topic fallback is introduced. Worker has no ntfy token or send path.

The Node filesystem/SQLite/PDF pipeline is not ported into Workers. Its research budgets stay 15 HTTP attempts including model calls, 5 model calls with no retries, 5,400 output tokens, 8,000 input/call and 24,000 input total, 100 seconds overall, one follow-up. Experiments stay proposal-only. Hosting the Node core is a separate availability/cost decision; Cloudflare Free does not supply that VM or make model APIs free.

## Queue and scheduler design

`cloudflare/schema.sql` is a local migration design; no D1 binding or remote database exists. `proposeDailyBriefing()` implements only a bounded proposal insert. SQLite tests exercise the actual SQL; they are not live D1 validation.

- Proposed Cron: `45 3 * * *` UTC = 09:15 Asia/Kolkata. No trigger is configured yet. Cron is not a hard real-time guarantee.
- Both the runtime schedule switch and durable owner opt-in must be enabled. Insert an idempotent `briefing:YYYY-MM-DD` proposal only at the scheduled minute. Duplicate callbacks/restarts cannot duplicate the row. Stop accepting proposals at 500 stored tasks; retention is required before unattended activation.
- Full queue adapter, still to implement: submit with owner-scoped idempotency key and immutable payload hash; validate bounded task schema; bind approval to hash and expire in 15 minutes. Atomic conditional UPDATE claims a queued row with a 120-second lease, one task per executor. Verify approval/revocation again before execution and result acceptance. Never trust a browser-supplied state or approval.
- After an ambiguous execution or expired running lease, mark `outcome_unknown`; no automatic replay. A human may approve a new task. Polling/reconnect is not authorization. Existing queue behavior is retained until the D1 adapter passes equivalent tests.
- Use a transaction/batch to commit completion plus a unique outbox entry. Notification retries: at most three only for definite retryable failures; persist sending before network I/O; unknown delivery becomes outcome_unknown, not sent or automatically replayed. Reuse existing hub redaction and confirmed-status semantics.
- Proposed application caps: 500 retained tasks, 30-day completed-metadata retention, 256 KB explicit shared result, 8 MB aggregate state, 60-second idle executor poll, at most 100 task submissions/day, one dispatch at a time. Implement durable quota counters and retention before activation; these are design values, not claimed enforced by the incomplete adapter.
- D1 remains authoritative across restart. Queues is optional later for wake-ups only, never sole approval/history storage; duplicate delivery still requires conditional claims. Do not introduce KV-based non-atomic locks.

Current provider limits checked against official documentation on 2026-11-11:

| Service | Free allowance relevant to this design |
| --- | --- |
| Workers | 100,000 requests/day, 10 ms CPU/invocation, 128 MB memory, 50 subrequests, 5 Cron triggers/account |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage, 10 databases |
| Queues (optional, not bound) | 10,000 operations/day, 24-hour retention; retries/reads/writes/deletes consume operations |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/). These are account-wide allowances, not reserved capacity. Polling every 60 seconds is 1,440 requests/day; indexed single-row operations and low-rate daily scheduling fit this design at personal scale, but CPU and actual account quotas require measurement. Stop on quota errors; do not upgrade or enable paid overages automatically. No R2, Workers AI or paid bindings are configured.

## Authentication and device restriction design

Reuse the semantics of `backend/distributed/auth.mjs`: one-time enrollment secret stored only as a server-side hash, short-lived single-use challenges, exact RP ID and HTTPS origin, required user verification, bounded login attempts, Secure/HttpOnly/SameSite cookies, CSRF, expiry and revocation. Do not copy its Tailscale proxy-header trust assumptions into a public Worker. A Worker verifier must validate Access JWT signatures against issuer-owned keys and exact issuer/audience/expiry, then require the app session; never accept an email/header as proof. Persist enrollment consumption, challenges, credentials, sessions and rate counters atomically in D1. Auth bootstrap routes need the outer device/identity gate but not an existing app session. Recovery must revoke old sessions/credentials and require a separately authorized administrative process.

Passkeys may sync through iCloud and do not establish one physical iPhone. Platform authenticator and Face ID prompts are not hardware allowlisting. No homegrown WebAuthn verification is added here; port the existing maintained verifier only after checking Worker compatibility and Free CPU use.

| Approach | Enforceable restriction and limitation |
| --- | --- |
| Cloudflare Access | Identity allowlist plus supported device posture can protect a hostname. An email allowlist or WARP enrollment alone does not pin one phone. Current iOS device UUID posture requires managed deployment/MDM; manual UUID assignment is unsupported. iOS serial-number and client-certificate posture checks in the cited client table are unsupported. Do not promise a free unmanaged-iPhone-only policy. Access Free eligibility and specific device-policy entitlements still require account verification; MDM may add cost. Protect every hostname including preview/direct routes and validate JWTs at origin. |
| Tailscale | A default-deny tailnet policy can allow the specific enrolled iPhone node/address to the private core's HTTPS port, plus a separately scoped executor node. Remove broader allow rules, require device approval, test other same-user devices, and revoke lost nodes. Personal plan supports six users free for eligible personal use. Restriction binds the enrolled node identity, not immutable physical hardware; account/admin compromise and node-key compromise remain risks. A standard public Worker is not made tailnet-private merely by connecting the phone to Tailscale. Use the existing private Node core/Serve path for this option; do not invent a public-to-tailnet proxy. |

Sources: [Cloudflare iOS posture support](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/), [UUID MDM requirement](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/client-checks/device-uuid/), [Cloudflare plans](https://www.cloudflare.com/plans/zero-trust-services/), [Tailscale pricing](https://tailscale.com/pricing), [Tailscale access controls](https://tailscale.com/docs/features/access-control). For an unmanaged personal iPhone with no paid device-management dependency, the existing private Tailscale + passkey path is the more concrete candidate. It still needs a private core host and real-device tests.

## Exact remaining acceptance steps

1. Choose Access/managed-device or private Tailscale topology. Verify actual Free account entitlements and private core hosting availability/cost; approve any provisioning separately.
2. Implement and test the production verifier, enrollment/recovery flow, session persistence, CSRF and rate limiting. Test wrong origin/RP, replay, expired sessions, spoofed headers and account/device revocation. Keep Worker flags false until successful.
3. Implement D1 queue adapter/atomic leases, counters, retention and explicit data-sharing model; test concurrent claims, expired approvals, crashes, cancellation and ambiguous outcomes. Add private executor authentication without exposing the desktop server. No engine budget changes.
4. Add only reviewed mobile API routes and private asset serving, preserving the existing mobile response schema. Test API errors never fall through to HTML. Verify all alternative Cloudflare hostnames blocked and no static-asset bypass. Complete local Worker-runtime/D1 integration tests and Free CPU measurement.
5. Audit rebuilt mobile artifacts for credentials and private data; configure only server-side secrets. Test ntfy ACLs with unauthorized publishers/subscribers; verify locked-iPhone delivery over the selected network. Never fall back to a public topic.
6. Obtain explicit deployment approval; provision only verified free resources and apply reviewed migrations. Configure exact origin, DNS, device policy and identity gate before enabling anything. This document is not that approval.
7. Enroll the authorized iPhone through HTTPS and add the PWA to its home screen. Reject a second same-account device, unauthenticated browser, lost/revoked node, expired session, desktop API and alternate hostname. Test reconnect, laptop offline, restarts and PDF privacy.
8. Enable the scheduler only after explicit owner opt-in and acceptance testing. Confirm 09:15 IST proposal/delivery semantics and duplicate suppression; no guarantee of exact-minute external delivery.

## Files changed in this stage

New: `frontend/src/services/apiClient.ts`; `cloudflare/worker.mjs`; `cloudflare/schema.sql`; `cloudflare/test/api-client.test.mjs`; `cloudflare/test/worker.test.mjs`; this document.

Updated: `wrangler.jsonc`; `vite.mobile.config.ts`; `frontend/src/mobile/main.tsx`; `frontend/src/services/ai.ts`, `onlineVoice.ts`; `frontend/src/components/Terminal.tsx`, `ResearchReports.tsx`, `ReverseEngineeringWorkspace.tsx`, `WebsiteStudioEditor.tsx`, `WhitehatWorkbench.tsx`; `frontend/public/gesture-control.html`.

No research, auth-core, memory, communications transport, package manifest/lock or credential files changed in this stage. Prior uncommitted changes remain separate in the working tree.

## Validation

- `node --import tsx --test cloudflare/test/*.test.mjs`: 13 passed, zero failed (including the 500-task cap).
- Combined research/communications/briefing/distributed/core tests: 93 passed, zero failed.
- `npm run test:command-routing`: 6 passed, zero failed.
- `npm run test:reverse-engineering`: 12 passed, zero failed.
- `npm run lint`: passed (TypeScript noEmit).
- `npm run build`: passed, 2,088 modules; existing >500 KB desktop chunk warning.
- `npm run build:mobile`: passed, 49 modules; JS 215.05 KB (gzip 67.64 KB).
- Initial build attempts failed because the sandbox denied esbuild access to parent directories; authorized local retries passed. No build settings were weakened.
- Wrangler 4.160.0 `deploy --dry-run --config wrangler.jsonc --name friday-private-validation`: passed after the same sandbox escalation; bundled 3.38 KiB Worker, only ASSETS and two false switches. The placeholder validation name created no resource. No upload occurred.
- `node --check cloudflare/worker.mjs` and `git diff --check`: passed (Git emitted existing line-ending warnings).
- Mobile bundle inspection: no `/api/desktop/`, `fridayDesktop`, or hardcoded `http://127.0.0.1:3000`; private-mobile mode present. This is a targeted capability check, not a complete secret audit.

These are offline/local results. No production Access/passkey flow, real D1 concurrency, phone, billing account, notification delivery or cloud research execution has been validated by this stage.
