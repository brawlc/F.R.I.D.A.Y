import { createHash } from 'node:crypto';
import { clean, normalizeSource } from '../research/citations.mjs';

export const SOURCES = [
  { id: 'formula1', name: 'Formula 1', category: 'F1', official: true, url: 'https://www.formula1.com/rss/news/latest.rss', domain: 'formula1.com' },
  { id: 'fia', name: 'FIA', category: 'F1', official: true, url: 'https://www.fia.com/rss/news', domain: 'fia.com' },
  { id: 'nasa', name: 'NASA', category: 'Aerospace', official: true, url: 'https://www.nasa.gov/news-release/feed/', domain: 'nasa.gov' },
  { id: 'faa', name: 'FAA', category: 'Aerospace', official: true, url: 'https://www.faa.gov/newsroom/press_releases/rss', domain: 'faa.gov' },
  { id: 'spaceflightnow', name: 'Spaceflight Now', category: 'Aerospace', official: false, url: 'https://spaceflightnow.com/feed/', domain: 'spaceflightnow.com' },
  { id: 'spacenews', name: 'SpaceNews', category: 'Aerospace', official: false, url: 'https://spacenews.com/feed/', domain: 'spacenews.com' },
  ...[['ferrari', 'Ferrari', 'ferrari.com'], ['mclaren', 'McLaren', 'mclaren.com'], ['mercedes', 'Mercedes', 'mercedesamgf1.com'], ['redbull', 'Red Bull', 'redbullracing.com'], ['spacex', 'SpaceX', 'spacex.com']].map(([id, name, domain]) => ({ id, name, domain, category: id === 'spacex' ? 'Aerospace' : 'F1', official: true, searchOnly: true })),
];
export const fingerprint = s => createHash('sha256').update(s).digest('hex');
export function canonicalUrl(value, domain) {
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.port || !(u.hostname === domain || u.hostname.endsWith(`.${domain}`))) return null;
    u.hash = ''; for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key); return u.href;
  } catch { return null; }
}
function decode(s) {
  return clean(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"), 1800);
}
export function parseFeed(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw Error('invalid_or_unsafe_feed');
  const field = (s, name) => decode(s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '');
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 60).map(([, , s]) => ({
    title: field(s, 'title'), url: field(s, 'link') || s.match(/<link\b(?=[^>]*(?:rel=["']alternate["']|href=))[^>]*href=["']([^"']+)["']/i)?.[1],
    published: field(s, 'pubDate') || field(s, 'published') || field(s, 'dc:date'), excerpt: field(s, 'description') || field(s, 'summary'),
  }));
}
export function validateItem(raw, source, now = Date.now()) {
  const url = canonicalUrl(raw.url, source.domain), date = Date.parse(raw.published);
  if (!url || !raw.title || !Number.isFinite(date) || date > now || now - date > 72 * 3600000) return null;
  const text = `${raw.title} ${raw.excerpt || ''}`;
  if (source.category === 'F1' && !/formula\s*(?:1|one)|\bf1\b|ferrari|hamilton|grand prix|scuderia/i.test(text)) return null;
  if (source.category === 'Aerospace' && !/space|rocket|launch|orbit|nasa|artemis|aero|aviation|aircraft|starship|falcon/i.test(text)) return null;
  const record = normalizeSource({ ...raw, url, published: new Date(date).toISOString(), provider: source.id, kind: source.searchOnly ? 'snippet' : 'feed-summary' });
  return { ...record, official: source.official, category: source.category, publisher: source.name,
    dateVerification: source.searchOnly ? 'search-index-publication-metadata' : 'publisher-feed-publication-date', urlVerification: 'allowlisted-publisher-domain',
    titleKey: fingerprint(clean(raw.title).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')),
    priority: (source.official ? 5 : 0) + (/\b(ferrari|hamilton|spacex|starship|falcon)\b/i.test(text) ? 8 : 0) + (/technical|upgrade|strategy|regulat/i.test(text) ? 4 : 0) - (/\b(advice|podcast|interview)\b/i.test(raw.title) ? 10 : 0),
  };
}
export function createNewsRetriever({ fetchImpl = fetch, env = process.env, sources = SOURCES, now = Date.now } = {}) {
  async function request(url, source, method = 'GET') {
    let target = url;
    for (let redirect = 0; redirect <= 2; redirect++) {
      const response = await fetchImpl(target, { method, redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml', 'User-Agent': 'FRIDAY-PersonalBriefing/1.0' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel(); const next = canonicalUrl(new URL(response.headers.get('location'), target).href, source.domain);
        if (!next) throw Error('redirect_outside_source'); target = next; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP_${response.status}`); }
      if (method === 'HEAD') return target;
      const reader = response.body.getReader(); let length = 0; const parts = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1000000) throw Error('response_too_large'); parts.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(parts).toString('utf8');
    }
    throw Error('too_many_redirects');
  }
  return async ({ seen = [] } = {}) => {
    const items = [], health = [];
    // Sequential per-source requests bound concurrency and avoid scraping/crawling.
    for (const source of sources) {
      const status = { id: source.id, name: source.name, endpoint: source.url || null, method: source.searchOnly ? 'Google Custom Search API' : 'RSS', checkedAt: new Date(now()).toISOString() };
      try {
        let raw;
        if (source.searchOnly) {
          if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_ENGINE_ID) { health.push({ ...status, status: 'unavailable', error: 'No supported feed configured; Google Search credentials missing', accepted: 0 }); continue; }
          const query = new URLSearchParams({ key: env.GOOGLE_SEARCH_API_KEY, cx: env.GOOGLE_SEARCH_ENGINE_ID, q: `site:${source.domain} ${source.category === 'F1' ? 'Formula 1 Ferrari Hamilton technical strategy' : 'SpaceX launch Starship Falcon'}`, dateRestrict: 'd3', num: '5' });
          const json = JSON.parse(await request(`https://www.googleapis.com/customsearch/v1?${query}`, { domain: 'googleapis.com' }));
          raw = (json.items || []).map(x => { const meta = x.pagemap?.metatags?.[0] || {}; return { title: x.title, url: x.link, excerpt: x.snippet, published: meta['article:published_time'] || meta.datepublished || x.pagemap?.newsarticle?.[0]?.datepublished }; });
        } else raw = parseFeed(await request(source.url, source));
        const accepted = raw.map(r => validateItem(r, source, now())).filter(Boolean);
        items.push(...accepted); health.push({ ...status, status: 'available', received: raw.length, accepted: accepted.length, rejected: raw.length - accepted.length, missingPublicationDate: raw.filter(r => !Number.isFinite(Date.parse(r.published))).length });
      } catch (e) { health.push({ ...status, status: 'failed', error: /^HTTP_|^invalid_|^response_|^redirect_|^too_many/.test(e.message) ? e.message : 'network_timeout_or_parse_error', accepted: 0 }); }
    }
    const candidates = ['F1', 'Aerospace'].flatMap(category => {
      const ranked = items.filter(i => i.category === category && !seen.some(s => s.id === i.id || s.titleKey === i.titleKey)).sort((a, b) => b.priority - a.priority || b.published.localeCompare(a.published));
      const representatives = [...new Set(ranked.map(i => i.provider))].map(p => ranked.find(i => i.provider === p));
      return [...representatives, ...ranked.filter(i => !representatives.includes(i))].slice(0, 6);
    });
    const verified = [];
    for (const item of candidates) {
      const source = sources.find(s => s.id === item.provider);
      try { item.url = await request(item.url, source, 'HEAD'); item.urlVerification = 'publisher-domain-and-HTTP-HEAD-success'; verified.push(item); }
      catch { const row = health.find(h => h.id === source.id); row.urlFailures = (row.urlFailures || 0) + 1; }
    }
    for (const row of health) row.verifiedUrls = verified.filter(i => i.provider === row.id).length;
    return { items: verified, health };
  };
}
