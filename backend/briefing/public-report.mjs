import { canonicalUrl, SOURCES } from './sources.mjs';
const approved = new WeakSet();
export function makePublicBriefing(report) {
  const lines = [`FRIDAY intelligence — ${report.day} (IST)`], included = [];
  for (const item of report.items) {
    const source = SOURCES.find(s => s.id === item.provider);
    if (!source || !canonicalUrl(item.url, source.domain)) continue;
    const block = `\n${item.category} | ${item.official ? 'Official source reports' : 'Publication reports'}: ${item.title.slice(0, 150)}\nPublished ${item.published.slice(0, 10)}\n${item.url}\nAnalysis (not confirmed): ${(item.analysis || 'Insufficient evidence for a specific technical conclusion.').slice(0, 240)}`;
    if (Buffer.byteLength(lines.join('\n') + block) > 2900) break;
    lines.push(block); included.push(item);
  }
  if (!included.length) lines.push('No new, dated developments could be verified in the available sources.');
  for (const category of ['F1', 'Aerospace']) if (!included.some(i => i.category === category)) lines.push(`${category}: no new verified item available.`);
  const missing = report.health.filter(h => h.status !== 'available' || (h.urlFailures && !h.verifiedUrls)).map(h => h.name);
  if (missing.length) lines.push(`Unavailable: ${missing.join(', ')}.`);
  const undated = report.health.filter(h => h.missingPublicationDate > 0 && !h.accepted).map(h => h.name);
  if (undated.length) lines.push(`Excluded undated feed items: ${undated.join(', ')}.`);
  lines.push('Facts above are attributed reports, not independent validation. Speculation: none presented as fact. Dates are publisher/index metadata; coverage may be incomplete.');
  if (report.analysisError) lines.push('Model analysis unavailable; conservative technical review used.');
  if (report.criticStatus && report.criticStatus !== 'completed') lines.push('Independent model critic unavailable; only baseline evidence checks completed.');
  if (report.criticIssues?.length) lines.push(`Critic: ${report.criticIssues.at(-1).slice(0, 200)}`);
  // Keep full source blocks and URLs intact, even with multibyte titles or long health summaries.
  while (Buffer.byteLength(lines.join('\n')) > 4096 && included.length) {
    lines.splice(included.length, 1); included.pop();
  }
  while (Buffer.byteLength(lines.join('\n')) > 4096) lines.pop();
  const token = Object.freeze({ text: lines.join('\n'), includedIds: Object.freeze(included.map(i => i.id)) }); approved.add(token); return token;
}
export const isPublicBriefing = token => Boolean(token && approved.has(token));
