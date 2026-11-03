import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createNewsRetriever } from './sources.mjs';
import { createBriefingStore, createIntelligenceBriefing } from './service.mjs';
dotenv.config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
const service = createIntelligenceBriefing({ store: createBriefingStore('work/briefing-probe-state'), retrieve: createNewsRetriever(), hub: { notify: () => { throw Error('Probe must never send'); } } });
const { report } = await service.run({ preview: true });
await mkdir('work/briefing-probe', { recursive: true });
await writeFile('work/briefing-probe/report.json', JSON.stringify(report, null, 2));
const text = ['# Daily intelligence source validation', '', `Observed: ${report.createdAt}. Read-only live probe; no notification sent and no AI model called.`, '',
  '| Source | Method | Retrieval | Parsed | Recent eligible | Verified article URLs | Error |', '|---|---|---|---:|---:|---:|---|',
  ...report.health.map(h => `| ${h.name} | ${h.method} | ${h.status} | ${h.received ?? 0} | ${h.accepted ?? 0} | ${h.verifiedUrls ?? 0} | ${h.error || (h.missingPublicationDate ? `${h.missingPublicationDate} missing publication dates` : h.urlFailures ? `${h.urlFailures} URL checks failed` : '—')} |`), '',
  '## Preview', '', report.text, '', '## What this establishes', '',
  '- Retrieval availability and parser output are live observations. Zero recent items is not proof that there is no news.',
  '- Source dates come from publication fields, never retrieval time or an updated field. URLs are domain-checked and eligible article URLs receive bounded HEAD checks.',
  '- Deterministic analysis, ranking, deduplication and rendering ran. Configured AI synthesis and independent model criticism are not exercised by this free source probe.',
  '- Delivery/crash handling is tested using mocks; this probe sends no ntfy or Telegram messages.',
].join('\n');
await writeFile('docs/briefing-source-validation.md', text);
console.log(JSON.stringify({ checkedAt: report.createdAt, sources: report.health, previewItems: report.items.length, report: 'docs/briefing-source-validation.md' }, null, 2));
