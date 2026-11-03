# Daily intelligence briefing

The daily briefing now gathers public news rather than counting activity notifications. It reuses FRIDAY's model provider selection, citation normalization and exact-passage evidence checks, and delivers through the existing ntfy hub. Telegram remains exclusively security-related.

## Sources and verification

The source registry is `backend/briefing/sources.mjs`. Formula 1, FIA, NASA, FAA, Spaceflight Now and SpaceNews use public RSS feeds. No article body scraping is performed. Ferrari, McLaren, Mercedes, Red Bull and SpaceX official-domain discovery use the existing Google Custom Search API only when its credentials are configured. The third-party r/SpaceX API is not treated as official SpaceX news. Unsupported sources are explicitly unavailable, not silently substituted with invented results.

RSS publication fields and API publication metadata are required. Missing/invalid dates, future dates, items older than 72 hours and off-domain links are excluded. `updated`/last-modified timestamps and retrieval timestamps are not passed off as publication dates. Article URLs must use HTTPS and match the registered publisher domain, and candidates receive bounded HEAD checks. HEAD failure excludes the candidate even if the article may be readable in a browser. Metadata verification is not independent confirmation of a source's claims.

Fetches use six-second deadlines, at most two same-domain redirects, one-megabyte response limits, and up to 60 feed entries. No retry loop, crawl or paywall bypass is used. Up to six candidate article URLs per category are checked. Free RSS is preferred; optional Google Search and configured AI providers may use account quota or incur cost. Existing provider deadlines are reused. Analyst and critic each get one call, with output limits of 1,400 and 700 tokens respectively.

## Novelty, analysis and delivery

Ferrari, Hamilton, SpaceX, technical upgrades, strategy and regulation terms raise ranking. Both F1 and aerospace receive a reserved slot when available; at most four items are included. Canonical URLs, normalized headline hashes and near-identical headline token overlap suppress repeat stories, including across restarts. This is conservative duplicate detection, not proof that differently worded stories describe distinct developments. Material updates at the same URL may be missed; there is no claim of perfect semantic novelty detection.

The analyst receives only retrieved public source records, no local memory, credentials or forensic data. Its technical analysis must reference a known source and reproduce an exact supporting passage. A separate critic call challenges assumptions and evidence. Neither step proves entailment or truth; all analysis stays explicitly unconfirmed. If model output fails, conservative rule-based implications discuss comparisons and missing evidence rather than inventing numerical benefits. Speculation is not promoted to a fact. Raw source reports, analysis and limitations have separate labels.

The hub accepts news content only through an in-process public-briefing token constructed from the verified report. Arbitrary notification text still cannot be sent to a public topic. The final message includes source links and publication dates, coverage failures, analysis and a critique; it is bounded below ntfy's 4 KB message limit. Only items actually included in the sent briefing enter the novelty history.

## Persistent 09:15 Asia/Kolkata schedule

Existing `FRIDAY_DAILY_BRIEFING_ENABLED=true` and `FRIDAY_NTFY_ENABLED=true` activate the schedule. Dates and schedule calculations explicitly use IST, independent of the host timezone. The scheduler checks every 15 seconds; starting FRIDAY after 09:15 catches up today's missed briefing once. FRIDAY must be running and online. This is not a new OS wake task or a guarantee of delivery while the computer is shut down.

State is stored atomically in ignored `.friday-communications/intelligence/state.json`. A process lock prevents overlapping runs; abandoned locks are reclaimed only when the recorded process no longer exists. Up to 90 daily records and 1,000 seen headlines are retained. Corrupt state fails closed and is preserved.

The complete report and `dispatching` marker are persisted before ntfy is called. Successful delivery becomes `sent`. Failure is recorded with safe error codes. If FRIDAY crashes in the send/acknowledgement window, the restart reports `delivery_unknown_no_resend`, and does not replay that day. Briefings use one send attempt, with no automatic retry after an ambiguous network failure. This favors preventing duplicate deliveries over guaranteed delivery: a crash before the actual send can omit that day's briefing. It is not an exactly-once distributed-delivery guarantee. Uncertain items remain in novelty history so the next day does not quietly repeat them.

## Inspection and validation

- `GET /api/communications/briefing/status`: local-only persisted report, delivery outcome and source health.
- `POST /api/communications/briefing/preview`: local-only retrieval and synthesis preview; no notification and no consumption of novelty history. It can use configured model/search quota.
- `npm run briefing:probe`: read-only live feed/API and URL test. No model calls and no notification. Writes [source validation](briefing-source-validation.md) and ignored JSON in `work/briefing-probe/`.
- `npm run test:briefing`: deterministic automated tests for date/URL validation, unavailable sources, novelty, evidence checks, preview behavior, time zones and crash/restart behavior.

The legacy `notify:test:ntfy -- --briefing` remains an activity-count transport test; use the preview endpoint for the new intelligence content. No GitHub push is part of this update.

Feed discovery references: [NASA RSS](https://www.nasa.gov/rss-feeds/), [FIA RSS directory](https://www.fia.com/media-center/rss-feed), [Formula 1 RSS](https://www.formula1.com/rss/news/latest.rss), [FAA press releases RSS](https://www.faa.gov/newsroom/press_releases/rss), [Spaceflight Now RSS](https://spaceflightnow.com/feed/), [SpaceNews RSS](https://spacenews.com/feed/).

## Continuation verification � 2026-11-03

- Fixed scheduler contention: a busy preview no longer consumes the day's scheduled run. Pre-dispatch failures retry with exponential backoff capped at one hour; persisted dispatch outcomes still prevent automatic replay.
- Durable state now validates its structure and preserves malformed data. Status reports ambiguous dispatch as `delivery_unknown_no_resend`.
- Previously seen URL/title records are filtered before bounded article verification. Public payloads have an enforced 4,096-byte ceiling.
- Analyst and critic outcomes are recorded separately. A critic failure no longer incorrectly labels successful analyst output as unavailable.
- Live local status on November 3 reported `sent` through ntfy, acknowledgement `b8tiWeZb8a8W`. This verifies provider acceptance, not iPhone receipt. The model analyst reported unavailable; the independent critic did not run. Rule-based implications were used transparently.
- No GitHub push was performed. FRIDAY must remain running and online for the 09:15 IST schedule.
