import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const MAX_PDF_BYTES = 1500000;
export const validResearchId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const attachments = new WeakMap();
export const reportAttachment = token => attachments.get(token);

export function reportSanitizer(env = process.env, password = '') {
  const secrets = [password, ...Object.entries(env).filter(([k]) => /KEY|TOKEN|PASSWORD|SECRET|FRIDAY_NTFY_TOPIC/i.test(k)).map(([, v]) => v)].filter(s => typeof s === 'string' && s.length >= 4).sort((a, b) => b.length - a.length);
  return value => {
    let text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
    for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
    return text.replace(/\b(?:sk-|ghp_|github_pat_)[\w-]+/g, '[redacted]').replace(/\b(?:password|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+/gi, '[redacted]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  };
}
function publicCitationUrl(value, scrub) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || scrub(value) !== value) return '';
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return '';
    for (const key of [...u.searchParams.keys()]) if (/key|token|secret|password|signature|credential/i.test(key)) u.searchParams.delete(key);
    u.hash = ''; return u.href;
  } catch { return ''; }
}

// Select structured fields explicitly; never render chat text, arbitrary HTML, or environment objects.
export function reportSections(record, scrub) {
  const list = value => Array.isArray(value) ? value : [];
  const rows = (items, fn) => list(items).map(fn).filter(Boolean);
  const sections = [
    ['Research questions', rows(record.questions, q => `${scrub(q.question)}\nVerification: ${scrub(q.verification)}${q.priority ? `\nPriority: ${q.priority}` : ''}`)],
    ['Findings - provenance checked, not scientific truth', rows(record.findings, f => `${scrub(f.claim)} [${list(f.sourceIds).map(scrub).join(', ')}]\nSupporting passage: ${scrub(f.quote)}\nStatus: ${scrub(f.status) || 'source-reported; unvalidated'}`)],
    ['Hypotheses - speculation', rows(record.hypotheses, h => `${scrub(h.idea)}\nPrediction: ${scrub(h.prediction)}\nTest: ${scrub(h.test)}\nFalsification: ${scrub(h.falsification)}\nSources: ${list(h.sourceIds).map(scrub).join(', ')}`)],
    ['Contradictory evidence', rows(record.contradictions, c => `${scrub(c.description)}\n${rows(c.evidence, e => `[${scrub(e.sourceId)}] ${scrub(e.quote)}`).join('\n')}`)],
    ['Limitations, uncertainties and errors', [...rows(record.critic?.issues, scrub), ...rows(record.critic?.independentReview?.issues, scrub), ...rows(record.uncertainties, scrub), ...rows(record.rejected, scrub), ...rows(record.retrievalErrors, e => `${scrub(e.provider)}: ${scrub(e.error)}`), ...rows(record.clarifications, scrub)]],
    ['Proposed experiments - not executed', rows(record.experiments, e => `${scrub(e.description)}\nStatus: ${scrub(e.status)}. Approval required; no execution or outcome is asserted by this export.`)],
    ['Planning and stopping', record.plan ? [scrub(record.plan.rationale), `Stopping reason: ${scrub(record.stoppingReason) || 'in progress'}`, ...rows(record.investigationDecisions, d => `${scrub(d.action)}: ${scrub(d.reason)}${d.gap ? `\nGap: ${scrub(d.gap.reason)}` : ''}`)] : []],
    ['Resource usage - reservations, not billing', Object.entries(record.usage || {}).filter(([k, v]) => typeof v === 'number' && /^(requests|httpAttempts|modelCalls|inputTokensReserved|outputTokensReserved|retrievalMsUsed|followUps|elapsedMs|runtimeMs|max\w+)$/.test(k)).map(([k, v]) => `${k}: ${v}`)],
  ];
  return sections;
}

export async function generateResearchPdf(record, { env = process.env } = {}) {
  if (!validResearchId(record?.id)) throw Error('invalid_research_id');
  const scrub = reportSanitizer(env);
  const sections = reportSections(record, scrub);
  const sources = (record.sources || []).map(s => ({ id: scrub(s.id), title: scrub(s.title), authors: (s.authors || []).map(scrub).join(', ') || 'Unknown', published: scrub(s.published) || 'Unknown', citations: Number.isFinite(s.citationCount) ? s.citationCount : 'Unknown', excerpt: scrub(s.excerpt), url: publicCitationUrl(s.url, scrub), provenance: (s.provenance || []).map(scrub).join(', '), reliability: scrub(s.reliability?.level) }));
  if (Buffer.byteLength(JSON.stringify({ sections, sources, title: record.objective })) > 500000) throw Error('report_content_limit');
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, pdfVersion: '1.7ext3', info: { Title: 'FRIDAY Research Report', Author: 'PROJECT FRIDAY', Subject: 'Evidence review; not independently validated' } });
  doc.registerFont('Body', require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
  doc.registerFont('Heading', require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'));
  let bytes = 0, pages = 1;
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_PDF_BYTES) doc.destroy(Error('report_size_limit')); else chunks.push(chunk); });
    doc.once('error', reject); doc.once('end', () => resolve(Buffer.concat(chunks)));
  });
  doc.on('pageAdded', () => { if (++pages > 100) throw Error('report_page_limit'); });
  const body = (text, options = {}) => doc.font('Body').fontSize(10).fillColor('#253348').text(text, { lineGap: 3, ...options });
  const heading = title => { if (doc.y > 705) doc.addPage(); doc.moveDown(0.8); doc.font('Heading').fontSize(14).fillColor('#164e63').text(title); doc.moveDown(0.4); };
  try {
    doc.font('Heading').fontSize(10).fillColor('#164e63').text('PROJECT FRIDAY / RESEARCH');
    doc.moveDown(); doc.fontSize(23).fillColor('#102139').text(scrub(record.objective) || 'Research report'); doc.moveDown(0.5);
    body(`Research ID: ${record.id}\nRecord timestamp: ${scrub(record.completedAt || record.createdAt) || 'Unknown'}\nStatus: ${scrub(record.status) || 'Unknown'}`);
    heading('Evidence notice'); body('Exact supporting passages establish source provenance, not entailment or scientific truth. Hypotheses remain speculation. No experiments or simulations are executed by PDF export.');
    heading('Operating conditions'); body(scrub(record.conditions) || 'Not specified');
    for (const [title, entries] of sections) { heading(title); if (!entries.length) body(title.startsWith('Findings') ? 'No finding passed evidence checks.' : 'None recorded; this does not establish absence or consensus.'); else for (const entry of entries) { body(entry); doc.moveDown(0.5); } }
    heading('Source citations');
    if (!sources.length) body('No sources were retrieved. No citations have been invented.');
    for (const s of sources) { body(`[${s.id}] ${s.title}\nAuthors: ${s.authors}\nPublished: ${s.published}; citation count: ${s.citations}\nProvenance: ${s.provenance || 'Unknown'}; evidence classification: ${s.reliability || 'Unknown'}`); if (s.url) body(s.url, { link: s.url, underline: true }); else body('URL unavailable or withheld for privacy.'); doc.moveDown(0.8); }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) { doc.switchToPage(i); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0; doc.font('Body').fontSize(8).fillColor('#64748b').text(`FRIDAY | Source-reported, unvalidated                         ${i + 1} / ${range.count}`, 48, doc.page.height - 30, { lineBreak: false }); doc.page.margins.bottom = bottom; }
    doc.end();
  } catch (error) { doc.destroy(error); }
  return output;
}

export async function createReportAttachment(record, options) {
  const bytes = await generateResearchPdf(record, options);
  const token = Object.freeze({ id: record.id });
  attachments.set(token, { bytes, filename: `research-${record.id}.pdf` });
  return token;
}
