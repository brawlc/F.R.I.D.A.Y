# FRIDAY project layout

| Location | Purpose |
| --- | --- |
| `frontend/src/` | React interface, components, styles and browser services |
| `frontend/public/` | Static browser assets |
| `frontend/index.html` | Vite browser entry point |
| `backend/server.mjs` | API server, AI providers and local integrations |
| `backend/reverse-engineering/` | Analysis, reports, Website Studio and its tests |
| `backend/electron/` | Desktop host, preload bridge, scanner and Windows helpers |
| `backend/scripts/` | Windows launch, startup and screensaver implementation |
| `backend/test/` | Offline provider and editor-handoff checks |
| `backend/test/manual/` | Explicitly run live scanner and preview checks |
| `backend/.env.local` | Private local settings and keys; ignored by Git |
| `docs/visuals/` | Browser-readable system diagrams and walkthroughs |
| `work/` | Ignored local scan results, screenshots and test browser caches |
| `.friday-re/` | Persistent analysis records and project registry; do not delete |
| `friday-memory.json` | Persistent user memory; do not delete |
| `dist/`, `node_modules/` | Generated production build and installed dependencies |

Root `package.json`, lockfile, Vite/TypeScript config and deployment config coordinate both halves. Root PowerShell files are compatibility shortcuts to `backend/scripts/`, retained for existing shortcuts and commands.

## Validation

Run from the repository root:

```powershell
npm run lint
npm run build
npm run test:reverse-engineering
npm run test:studio-fallback
npm run test:website-reliability
npm run test:system
npm run test:server-smoke
npm run test:code-handoff
```

The code-handoff check requires VS Code installed on Windows; it mocks launching the editor. The provider check uses fake responses and spends no API credit.

`node backend/test/manual/run-probe-fixture.cjs` runs an offline hidden Chromium page to check layout and motion measurements, including exclusion of the scanner overlay from animation counts. It does not access remote websites or paid providers.

## Optional live checks

`backend/test/manual/` contains development helpers, not application startup code. They require a running FRIDAY backend and/or Electron, access live websites, and may create Downloads projects, open Opera GX or spend configured provider credit. Run only when intentionally checking those integrations:

1. `node backend/test/manual/run-scanner-test.cjs` writes a scan to `work/`.
2. `node backend/test/manual/test-studio-live.mjs` builds a demo from that scan.
3. `node backend/test/manual/run-studio-preview-test.cjs` opens and validates the demo.

`edit-studio-demo.mjs` modifies that generated demo. These helpers keep their output in `work/`, separate from source files.

## Cleanup performed

Moved reusable checks out of `work/` into `backend/test/`, and visual guides into `docs/visuals/`. Removed four leftover test-run directories and two disposable Electron test profiles. Retained screenshots and scan metadata in ignored `work/`, along with live logs, persistent memory, registered projects and private config. TypeScript now checks frontend source and Vite config only, instead of traversing generated test projects and runtime output.
