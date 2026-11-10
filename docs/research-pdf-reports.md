# Research PDF reports

Reports are generated from saved structured research, preserving evidence limitations, errors, citations, hypotheses, proposed experiments and usage. No experiments or model calls are performed by export.

## Password-free delivery

At the user's request, PDFs no longer require a password. Set `FRIDAY_REPORT_NTFY_ENABLED=true` in ignored `backend/.env.local` alongside the existing ntfy configuration. No PDF password setting is needed. This has been enabled locally; the running server has not been restarted.

**Public ntfy attachments are readable by anyone who obtains the link. Only nonsensitive reports should be sent.** Known configured credentials and credential patterns are scrubbed, but this is not a classifier for arbitrary private prose. Disable report delivery for confidential research. Telegram remains dedicated to security alerts.

The upload uses a separate staging topic, validates the same-server attachment URL, and sends one final notification with a native attachment, click URL and Open PDF action. No local endpoint or private file directory is exposed. Private ntfy servers need publish permission for the derived staging topic as well as the regular topic. There is no new cloud account or model cost.

Maximum two HTTP attempts: upload with 15-second timeout, notification with 5-second timeout; no automatic retry. Pending delivery is persisted before network work. Unknown acknowledgement outcomes are not automatically resent. Server acceptance does not confirm iPhone receipt. Attachment lifetime follows server policy; see https://docs.ntfy.sh/publish/#attachments.

## Storage and export

The default private directory is ignored `.friday-reports`. `FRIDAY_REPORTS_DIR` can override it; choose a private directory outside web assets and preferably outside the repository. Windows permissions inherit the directory ACL. Report files are unencrypted. Junction/symlink paths and known frontend/protected directories are refused.

Limits: 1,500,000 PDF bytes, 500 KB structured content, 100 pages. Retention defaults to 30 days / 100 reports, configurable with `FRIDAY_REPORT_RETENTION_DAYS` (1–365) and `FRIDAY_REPORT_MAX_COUNT` (1–100). Cleanup occurs on store access and touches only matching report files. Filenames use validated UUIDs; writes are atomic.

Research responses expose Download PDF and history export controls. Ask `research history` for older records. Local guarded endpoints are `GET /api/research/v1/:id/pdf` and `GET /api/research/v1/:id/pdf-status`. Manual download does not upload. Generation/delivery errors do not invalidate saved research. Expired links require a new export; there is no automatic re-upload loop.

Dependencies: PDFKit and OFL-licensed Noto Sans. The Latin font subset does not guarantee full multilingual typesetting.

## Manual trial

Run only when a real notification is wanted:

```powershell
node backend/research/manual-pdf-test.mjs
```

This sends a synthetic nonsensitive report through the configured ntfy channel, never Telegram. It prints only a sanitized status and research ID. It does not create fake research findings in research memory.

## Validation

```powershell
node --test backend/research/test/pdf.test.mjs backend/communications/test/*.test.mjs
npm run lint
npm run build
```

PDF tests cover password-free documents, branded attachment tokens, credential filtering, limits, storage/retention, junction refusal, attachment click delivery, restart deduplication, hostile URL acknowledgements, opt-out, failure records and local API restrictions.

Before the password-removal update, 110 research/communications/briefing/core/reverse-engineering tests and studio fallback checks passed. Type checking and production build passed, with the Vite bundle-size warning. A synthetic two-page PDF was parsed and visually inspected. The stock server smoke test timed out twice; an isolated diagnostic with a longer startup allowance passed all assertions. That timing limitation remains; the stock test was not changed.

Password-removal validation: all 23 PDF and communications tests passed. A live synthetic trial was attempted: the sandbox denied network access; a permitted attempt returned an unknown upload/acknowledgement outcome after one HTTP attempt. No final notification acceptance was confirmed. A separate permitted ntfy health check returned HTTP 200. Do not interpret this as a successful phone delivery.
