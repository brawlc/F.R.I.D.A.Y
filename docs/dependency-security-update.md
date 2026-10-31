# Dependency security update — 2026-10-28

The initial npm audit reported 20 vulnerable dependency entries (including two critical). Compatible updates reduced this to nine. Targeted upgrades then replaced Electron 39 with Electron 45.1.0 and the legacy `@xenova/transformers` dependency with `@huggingface/transformers` 4.3.2. TSX was upgraded and a patched QS range is enforced through an override. The final full and production-only npm audits reported zero known vulnerabilities.

This is the advisory database's result at verification time, not a guarantee of application security. Repeat `npm audit` periodically. Node 22.12.0 or newer is required. The lockfile records the actual installed versions.

Whisper still uses the public `Xenova/whisper-tiny.en` model, with explicit q8 weights. Its pipeline was tested on synthetic silence after migration. Failed initialization can be retried instead of leaving a rejected promise cached forever.

Validation includes TypeScript checks, production build, system/defense/website/voice regression suites, isolated server startup and code-handoff tests. Conversational-edit tests use an injected generator, not paid providers. Desktop runtime validation uses a separate hidden sandboxed window, not the user's FRIDAY session.

The production build still reports a large JavaScript chunk warning. This is a performance warning, not a dependency audit finding.
