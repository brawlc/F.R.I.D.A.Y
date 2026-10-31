import { createHash } from 'node:crypto';

export const clean = (value, limit = 4000) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function normalizeSource(raw) {
  const title = clean(raw.title, 500), url = safeUrl(raw.url);
  if (!title || !url) return null;
  const doi = /^10\.\d{4,9}\/\S+$/i.test(raw.doi || '') ? raw.doi.toLowerCase() : null;
  const key = doi || url.replace(/^http:/, 'https:').replace(/\/$/, '');
  return { id: `S${createHash('sha256').update(key).digest('hex').slice(0, 16)}`, title, url, doi,
    authors: (raw.authors || []).slice(0, 30).map(x => clean(x, 150)),
    published: /^\d{4}(-\d{2})?(-\d{2})?/.test(raw.published || '') ? raw.published : null,
    citationCount: Number.isInteger(raw.citationCount) && raw.citationCount >= 0 ? raw.citationCount : null,
    excerpt: clean(raw.excerpt), kind: raw.kind || 'metadata', provider: raw.provider,
    retrievedAt: new Date().toISOString(), provenance: [raw.provider],
    reliability: { level: raw.provider === 'arxiv' ? 'preprint' : raw.kind === 'snippet' ? 'discovery-only' : 'indexed-metadata',
      explanation: 'Indexing, publication dates and citation counts do not validate a scientific claim. Full text and methods have not been reviewed.' } };
}
export function mergeSources(records) {
  const map = new Map();
  for (const raw of records) {
    const s = normalizeSource(raw); if (!s) continue;
    const previous = map.get(s.id);
    if (previous) {
      previous.provenance = [...new Set([...previous.provenance, ...s.provenance])];
      previous.metadataConflicts ||= [];
      for (const key of ['title', 'published']) if (previous[key] && s[key] && previous[key] !== s[key]) previous.metadataConflicts.push({ field: key, values: [previous[key], s[key]] });
      if (!previous.excerpt) previous.excerpt = s.excerpt;
    } else map.set(s.id, s);
  }
  return [...map.values()];
}
