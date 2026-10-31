# White-Hat Workbench

Open Security Console after restarting FRIDAY. Enter the full approved public page URL, describe the scope, confirm permission, then run the assessment. Retest after making changes and export the evidence report for review.

The workbench combines the bounded public HTML observer with transport, HSTS, CSP, MIME-sniffing, framing and referrer-policy reviews. Additional checks inspect HSTS lifetime, selected CSP script permissions, broad framing origins, individual cookie attributes and insecure form declarations (HTTP actions and password fields with GET). Cookie names and values are discarded before reporting. Each finding contains evidence, severity, confidence, remediation and retest instructions. These are selected declaration checks, not full browser policy validation or proof of exploitability. Combined CSP policies require manual review.

The UI compares finding IDs only for the same final URL and requested page list, with no collection failures in either assessment. 'No longer observed' means the sampled response changed; it is not proof that a vulnerability has been fixed across every route.

Collection supports a primary page and up to two additional explicitly approved same-origin URLs, with bounded same-site redirects. It does not discover and crawl new routes. Partial failures are reported as unassessed, not clean. It requires operator-asserted authorization, rejects private targets through the existing observer, limits concurrent assessments to two, and makes no paid model requests. It does not submit forms, attempt logins, run exploit payloads or fuzz endpoints. Reports include manual follow-up tasks for access control, sessions, source review, dependencies and restoration testing.

Accuracy has not been benchmarked against a representative vulnerability dataset. Local positive/negative fixtures check policy handling, cookie redaction, form declarations, scope enforcement, concurrency and partial failure reporting. Passing tests is not a security certification. JavaScript-generated forms, authenticated sessions, backend logic and full browser enforcement remain outside this collector's coverage.

Existing capabilities remain available: Project Bug Finder for local source review, System Protection for Windows posture, Reverse Engineering for static artifacts and rendered observations, and the existing Kali tools. This workbench does not imply those external tools are installed or that a penetration test has been completed.

Verification: `npm run test:whitehat`, `npm run test:defense`, `npm run test:website-reliability`, `npm run test:server-smoke`, `npm run lint`, and `npm run build`.

Reference: [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html).

Policy references: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) and [MDN CSP script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src).

Useful next additions: a separately isolated training lab, source-linked vulnerability triage, persistent engagement history with scoped permissions, and dependency advisory tracking. These are suggestions, not implemented features.
