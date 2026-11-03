# Phase III-A completion and validation

Branch: `feat/adaptive-research-planner`. At validation time, changes were local and uncommitted; no push, merge, backend restart or deployment was performed as part of validation.

## Implemented behavior

- Schema-validated plans contain up to three prioritized questions, evidence gaps, rationale and proposed stopping criteria. Unknown keys, invalid types and invalid priorities fail closed to deterministic decomposition.
- Baseline and counterevidence searches share the existing retrieval adapters. After analyst verification and independent-context criticism, one material gap can trigger one targeted search. Gap decisions retain question IDs, cited source IDs, priorities and rationale.
- Follow-up claims pass the same exact-passage checks as initial claims. Earlier verified findings survive invalid follow-up output. Duplicate sources retain provenance and metadata conflicts.
- No-new-evidence follow-ups skip further model calls. Remaining gaps are explicit; no gap or hypothesis is promoted to a validated result.
- Atomic checkpoints save plans, revisions, decisions and reserved usage. Interrupted records remain inspectable without automatic replay. Record version 1 and existing API/chat/voice shapes are retained.
- Experiments remain proposals with null approval and outcome. Model-generated URLs and tool fields cannot invoke tools, filesystem access, shell execution or arbitrary fetches. Queries go only to existing fixed adapters.

## Approved limits enforced

10 retrieval HTTP attempts, at most 7 initial and 3 follow-up; 15 combined HTTP/model attempts; 5 model calls with no retries/redirects; one follow-up. Output allocations are 600 / 1800 / 600 / 1800 / 600, totaling 5400. Input reservations are at most 8000 per call and 24000 total. Overall work is capped at 100 seconds, cumulative retrieval at 45 seconds, model calls at 25 seconds and individual retrieval requests at 7 seconds, always subject to the remaining deadline.

Input reservations use UTF-8 bytes plus 1024 framing tokens, not provider-measured billing. Model attempts are conservatively charged even when no provider is configured. No output allocation transfers between stages.

## Changed files

| File | Change |
|---|---|
| backend/research/planner.mjs | New strict plan validation, deterministic fallback and bounded gap/query selection |
| backend/research/budget.mjs | New shared reservations, limits and abort-aware bounded waits |
| backend/research/orchestrator.mjs | Planning, bounded follow-up, checkpoints, provenance merging and stopping decisions |
| backend/research/retrieval.mjs | Initial/follow-up request ceilings and combined HTTP accounting |
| backend/research/report.mjs | Optional plan, unresolved gaps, stopping reason and usage summary; legacy support |
| backend/research/test/adaptive.test.mjs | 15 new offline tests |
| backend/research/test/engine.test.mjs | Updated planner-stage counts and asynchronous partial-failure expectations |
| backend/server.mjs | Research-only strict transport flag: no redirects; single Gemini REST attempt using existing key/model; other callers retain existing behavior |
| docs/research-engine.md | Architecture, approved budgets, persistence and limitations |
| docs/research-phase-iiia-validation.md | This completion report |

Memory, router, citation and verification modules were reused without edits. No package, lockfile, credentials, frontend or voice changes were needed. No protected file or lock was overridden.

## Exact validation results

| Check | Result |
|---|---|
| `npm run test:research` | 31 passed, 0 failed |
| Combined existing regression suite | 70 passed, 0 failed |
| `npm run test:studio-fallback` | Passed; mocked providers, no paid requests |
| `npm run test:code-handoff` | Passed; no editor launched |
| `npm run test:server-smoke` | Passed; isolated server, notifications disabled |
| `npm run lint` | Passed (`tsc --noEmit`) |
| `npm run build` | Passed after sandbox escalation; 2086 modules transformed |
| `git diff --check` | Passed; Git emitted only CRLF normalization notices |

The 70 regression cases cover briefing (17), communications (14), reverse engineering (12), command routing (6), defense (4), system reliability (4), voice (2), website reliability (5), and whitehat (6). Total Node test cases: 101 passed, with the three standalone checks above additionally passing.

Regression command:

```powershell
node --import tsx --test --test-concurrency=1 backend/briefing/test/*.test.mjs backend/communications/test/*.test.mjs backend/test/command-routing.test.mjs backend/test/system-reliability.test.mjs backend/test/defense.test.mjs backend/test/whitehat.test.mjs backend/test/website-reliability.test.mjs backend/test/voice.test.mjs backend/reverse-engineering/test/reverse-engineering.test.mjs
```

During implementation, existing call-count/timing expectations were updated for the new planner and partial-report behavior. A multibyte fixture initially failed because PowerShell converted a literal character to `?`; the fixture now uses a Unicode escape and passes. The first build attempt failed on sandbox parent-directory reads; an authorized elevated build passed without changing file permissions or locks.

## Remaining limitations

- Tests are offline with synthetic sources and mocked models. Live provider availability, model quality, credentials and billing were not tested, and no simulations or experiments were executed.
- Input accounting is conservative, not an exact tokenizer. Output limits rely on provider request contracts. Cancellation cannot undo accepted/billed provider work. Final local persistence can add filesystem latency after the work deadline.
- The original 100-second deadline may leave insufficient time for the follow-up. This is intentional: budgets take precedence over completeness.
- Retrieval remains metadata/abstract/snippet based. Exact quotes establish provenance, not entailment, truth, novelty or scientific validity. Gap relevance proposed by a model remains unvalidated.
- Model stopping criteria are suggestions only; deterministic application rules control continuation. Plans cannot increase their own budgets.
- Process-local concurrency behavior is preserved. Interrupted runs are saved but are never automatically resumed.
- The production build warns that a 551.48 kB JavaScript chunk exceeds Vite's 500 kB recommendation (174.00 kB gzip). Build exit status is zero; bundle splitting is outside this research change.
