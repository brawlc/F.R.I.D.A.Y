# FRIDAY application reliability audit

Scope: frontend, backend entry points, local desktop startup, bridge permissions, memory persistence, provider error handling, launch scripts and existing Website Studio regression checks. This is an application audit, not a claim that Windows or every external integration has been fully tested.

## Fixed

- Desktop startup now checks a bounded local `/api/health` response with FRIDAY identity instead of depending on a news request. Spawn errors and readiness failures show an actionable startup message.
- Gesture control follows the configured port instead of always using port 3000.
- Memory updates are queued and committed through a temporary file and rename. Concurrent remember requests preserve each other; corrupt JSON is preserved and reported instead of silently treated as empty memory.
- Browser storage exceptions no longer crash the terminal. Session-only fallback data triggers a visible persistence warning.
- A rendering error shows a recovery screen; reloading does not clear stored memory or projects.
- Chat failure text identifies the provider generically instead of incorrectly blaming Ollama for every failure. Transcription requests have a timeout.
- Unknown API routes return JSON 404 responses, and malformed/oversized JSON receives useful 400/413 responses rather than HTML.
- Browser API requests from unrelated origins are rejected. Desktop microphone/location permissions and privileged external-open/location/gesture IPC calls are limited to FRIDAY's context, and desktop windows cannot navigate to unrelated origins.

## Verification

- TypeScript and production build.
- Existing reverse-engineering, website reliability, AI fallback and editor-handoff tests.
- System tests for concurrent memory writes, corruption preservation, blocked storage, desktop health identity, and bridge sender validation.
- An isolated local backend smoke test covering health, UI, gesture page, JSON errors and cross-origin rejection. It disables scheduled monitoring and makes no paid AI calls.

Commands: `npm run test:system`, `npm run test:server-smoke`, plus the checks in [project-layout.md](project-layout.md).

## Remaining limits

Microphone recognition, camera/gesture accuracy, provider credit, external news/weather services, Windows location, Kali integrations and real calls/messages were not exercised. The production frontend still has Vite's advisory for a bundle larger than 500 kB. No blanket dependency upgrades, user-data resets, account changes or Windows configuration changes were performed.

Fully quit and relaunch FRIDAY to load backend and Electron changes. If a separately launched old backend occupies the configured port, stop that instance before relaunching.
