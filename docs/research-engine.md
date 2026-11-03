# FRIDAY Phase III-A adaptive research planner

## Architecture and dependencies

The Express server mounts `backend/research/router.mjs` at `/api/research/v1` and routes explicit research requests from `/api/chat` through the same orchestrator. The existing React terminal renders reports as plain text. Existing voice transcription and speech output share this chat path. No separate UI, database, API credentials store, model SDK, or runtime dependency was added.

Modules:

- `retrieval.mjs`: Crossref, Semantic Scholar, arXiv, and optional Google web/documentation discovery. Only fixed API endpoints are fetched; result links are never followed. Documentation discovery searches MDN, Python docs and Microsoft Learn and retrieves snippets, not full pages.
- `citations.mjs`: stable source IDs, DOI deduplication, publication and retrieval timestamps, authors, citation counts, provenance and metadata conflicts. Missing fields remain unknown.
- `memory.mjs`: atomic private JSON files in `.friday-research/`, consistent with FRIDAY's existing file-based memory design. Objectives, conditions, questions, findings, sources, hypotheses, uncertainties, critiques, proposed experiments and parent research IDs survive restart. Corrupt files fail visibly rather than silently disappearing. Back up this directory for durable retention; ephemeral hosting does not provide persistence.
- `orchestrator.mjs`: obtains a validated plan or deterministic fallback, searches baseline evidence and counterevidence, verifies analyst output, and runs a critic in a fresh context. At most one material evidence gap can trigger a targeted investigation under the same run budget.
- `planner.mjs`: strict plan schema, deterministic decomposition, sanitized search text, and source-grounded gap selection. Model stopping criteria are recorded suggestions; application rules control termination.
- `budget.mjs`: shared HTTP/model/token reservations, cumulative retrieval time, overall deadlines, and bounded waits.
- `verification.mjs`: exact evidence passage matching, source-ID validation, supported contradiction pairs and deterministic critique. Citation matching does not prove entailment or scientific truth. All accepted findings remain source-reported and unvalidated.
- `report.mjs`: readable report plus the structured JSON record returned by the API.

The analyst and critic reuse the first configured provider in `FRIDAY_MODEL_ORDER` (Venice, Gemini, Ollama, or OpenAI). They use separate contexts but may share a model; independence is procedural, not a guarantee against correlated model errors. No tool access is given to either. Invalid JSON or unavailable providers result in an explicit evidence gap, not fabricated findings.

## Use

Say or type: `FRIDAY, investigate whether a new wing geometry could improve aerodynamic efficiency`.

FRIDAY proceeds with labeled exploratory assumptions when conditions are missing; unspecified values remain unknown. It does not require a clarification round. To supply specific conditions in one turn:

`research wing geometry aerodynamic efficiency conditions: Mach 0.2, fixed span and payload, compare lift-to-drag ratio against a rectangular baseline`

Use `research history` to list saved objectives and `research report <UUID>` to reopen a report. A clarification response includes a parent ID, linking the resulting research record to the initial objective. New investigations can use `parentId` through the API; prior conclusions are not automatically treated as evidence.

API:

- `POST /api/research/v1` with `{ "objective": "...", "conditions": "...", "parentId": "optional UUID" }`. Omit conditions to use exploratory defaults. Explicit `requestClarification: true` retains opt-in clarification for API callers. Returns `{ ok, research, text }`.
- `GET /api/research/v1`: up to 100 recent record summaries.
- `GET /api/research/v1/:id`: structured record and readable text.
- `GET /api/research/v1/:id?format=markdown`: plain Markdown export.

FRIDAY currently has no account authentication. These routes and research chat commands reuse its loopback/Host guard and global same-origin policy, so research is local-only. Do not expose them remotely without authenticated per-user storage and authorization. Existing hosted chat remains available outside the research command path.

## Configuration and limits

Scholarly APIs need no new credentials for basic access; Semantic Scholar can use `SEMANTIC_SCHOLAR_API_KEY` for authorized access. Its public endpoint may return 429. Existing `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` enable web and documentation discovery; their absence is recorded. Existing provider keys remain in backend environment files, never in reports.

Per research run: one active run per process and a ten-second cooldown. The approved Phase III-A budgets are:

| Resource | Hard admission limit |
|---|---|
| Retrieval HTTP attempts, including retries | 10 total; at most 7 initial and 3 targeted follow-up |
| Combined HTTP attempts | 15, including up to 5 reserved model attempts |
| Model calls | 5, increased from Phase II's 2; no model retries or redirects |
| Output-token reservations | 5,400 total, increased from 3,600; planner 600, analyst 1,800, critic 600, follow-up analyst 1,800, final critic 600 |
| Input-token reservations | 8,000 per call; 24,000 aggregate, including system text and framing |
| Runtime | 100 seconds shared across all stages; shorter injected deadlines allowed, larger ones clamped |
| Retrieval time | 45 seconds cumulatively across both investigation phases |
| Individual deadlines | HTTP 7 seconds; model 25 seconds; each also bounded by remaining run time |
| Additional targeted investigations | At most 1 |

Four results per provider per query, a 1 MB retrieval response limit, 3.1-second host spacing, and one retry for 429/5xx remain unchanged. A follow-up gets at most three additional HTTP attempts even if initial searches use fewer than seven. No unused output allowance transfers between stages. Missing providers, failures and malformed responses still consume their model reservations. HTTP counts include conservatively reserved model requests even when an unavailable provider makes no actual network request.

Input accounting reserves one token per UTF-8 byte of system and prompt text plus 1,024 tokens for message framing and the provider role instruction. It is a conservative admission allowance, not measured usage or an exact tokenizer count. Sources are removed as whole records to fit valid JSON, with omissions reported. Outputs are capped through each provider's request settings. Actual billing, hidden provider internals and tokenizer behavior are not independently measured; these controls are not a guaranteed currency budget. No billing claims are inferred from reservations.

All network/model work stops at the deadline; a final local persistence operation records the partial report and can add filesystem latency. Cancellation cannot undo a request already accepted or billed by a provider. There are no paid background retries. Planner failure falls back; an exhausted admission budget stops further work. A targeted search returning no new evidence ends without spending the final two model calls.

The existing provider selection interface remains in use. A research-only strict flag disables redirects for the existing HTTP adapters and uses a single REST request for Gemini with the same configured key/model, bypassing SDK transport retry/redirect behavior. Other callers, including daily briefings and ordinary chat, retain their previous adapter behavior.

External content is untrusted data. The research API has no arbitrary URL fetch, full-text/PDF parser, shell execution, development agent or experiment execution endpoint. The prompt never grants source content authority. Model output is restricted to known fields and retrieved citations; injected tool calls and purported experiment outcomes are discarded. This limits consequences but cannot guarantee that a model will interpret every source correctly.

A separate, deterministic local analytical model is available at `backend/research/experiments/aero-sensitivity.mjs`. It was executed at the user's explicit request. Run `node backend/research/experiments/aero-sensitivity.mjs` to reproduce 108 illustrative aerodynamic/cooling cases and write JSON/Markdown into `work/aero-sensitivity/`. It uses assumed coefficients, not Ferrari geometry or telemetry, and cannot predict lap time or team rankings. It is not automatically invoked by chat or model output. The normal research report's experiment proposals remain unexecuted; the separate sensitivity report contains the actual analytical run results.

## Future interfaces

Reports retain `version: 1`, stable source IDs and question IDs. New optional fields are `plan`, `planRevisions`, `investigationDecisions`, `stoppingReason`, and expanded `usage`. Existing records and API/chat/voice shapes remain readable. Atomic checkpoints preserve plans and decisions before investigation and the final report afterward. An interrupted `in-progress` record remains inspectable after restart; it is never automatically resumed or treated as completed. Model-suggested gaps are unvalidated and must reference known questions and retrieved sources. Deterministic gaps cover missing verified findings and conflicting passages. Persistent uncertainties are not evidence of a successful resolution. Experiment proposals contain `id`, `description`, `hypothesis` where available, `kind`, `status: approval-required`, `approval: null`, `outcome: null`, and `validation: not-performed`. Future development/simulation adapters can consume these records, but must implement authenticated approval bound to an exact plan, cost estimate, runner isolation, cancellation, provenance and outcome persistence before execution. A model-produced approval field must never authorize an operation. Simulated and measured outcomes must be distinct record types. This phase intentionally records no invented prior experiments or outcomes.

## Validation

Run `npm run test:research`. Fixtures are explicitly synthetic, and tests never call paid models or research services. They cover citation fabrication, metadata conflicts, missing evidence, malformed output, prompt-injection-shaped output, retry/request budgets, memory reload/corruption, concurrent runs, aerodynamic clarification, speculative hypotheses, proposal-only experiments, HTTP routes and conversational continuation. Fixture evaluation checks structure and provenance; scientific answer quality still requires expert review with real sources. Provider availability and live model quality are not guaranteed by offline tests.

API references used for adapters: [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api), [Semantic Scholar Academic Graph](https://api.semanticscholar.org/api-docs/), [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html).
