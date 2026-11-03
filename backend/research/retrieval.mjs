import { setTimeout as delay } from 'node:timers/promises';
import { mergeSources, clean } from './citations.mjs';

const decode = s => clean(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
export function parseArxiv(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsafe XML');
  const field = (s, tag) => decode(s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] || '');
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].slice(0, 4).map(([, s]) => ({
    provider: 'arxiv', title: field(s, 'title'), url: field(s, 'id'), published: field(s, 'published'),
    authors: [...s.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)].map(([, a]) => field(a, 'name')),
    excerpt: field(s, 'summary'), kind: 'abstract', doi: field(s, 'arxiv:doi'),
  })).filter(s => !s.url.includes('/api/errors'));
}
export function createRetrieval({ fetchImpl = fetch, env = process.env, intervalMs = 3100 } = {}) {
  const last = new Map();
  async function request(url, budget, signal, headers = {}, requestLimit = budget.maxRequests) {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      if (budget.requests >= Math.min(budget.maxRequests, requestLimit) || (budget.httpAttempts ?? 0) >= (budget.maxHttpAttempts ?? Infinity)) throw new Error('Retrieval request budget reached');
      const host = new URL(url).hostname;
      await delay(Math.max(0, (last.get(host) || 0) + intervalMs - Date.now()), undefined, { signal });
      signal.throwIfAborted();
      if (budget.requests >= Math.min(budget.maxRequests, requestLimit) || (budget.httpAttempts ?? 0) >= (budget.maxHttpAttempts ?? Infinity)) throw new Error('Retrieval request budget reached');
      last.set(host, Date.now()); budget.requests++; budget.httpAttempts = (budget.httpAttempts ?? 0) + 1;
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]), headers: { Accept: 'application/json, application/atom+xml', ...headers } });
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await response.body?.cancel();
        const wait = Number(response.headers.get('retry-after') || 1);
        if (!Number.isFinite(wait) || wait > 5) throw new Error(`Provider temporarily unavailable (${response.status})`);
        await delay(Math.max(1000, wait * 1000), undefined, { signal }); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider HTTP ${response.status}`); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1000000) throw new Error('Source response exceeds 1 MB'); chunks.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks).toString('utf8');
    }
  }
  return async function retrieve(query, { signal, budget, requestLimit = budget.maxRequests }) {
    const fetchSource = (url, headers) => request(url, budget, signal, headers, requestLimit);
    const records = [], errors = [];
    const adapters = {
      crossref: async () => {
        const p = new URLSearchParams({ 'query.bibliographic': query, rows: '4' });
        const json = JSON.parse(await fetchSource(`https://api.crossref.org/works?${p}`));
        return (json.message?.items || []).map(x => ({ provider: 'crossref', title: x.title?.[0], url: x.URL, doi: x.DOI,
          published: x.published?.['date-parts']?.[0]?.map((n, i) => i ? String(n).padStart(2, '0') : n).join('-'),
          authors: (x.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')), citationCount: x['is-referenced-by-count'], excerpt: x.abstract, kind: x.abstract ? 'abstract' : 'metadata' }));
      },
      semanticScholar: async () => {
        const p = new URLSearchParams({ query, limit: '4', fields: 'title,url,authors,publicationDate,year,citationCount,abstract,externalIds' });
        const json = JSON.parse(await fetchSource(`https://api.semanticscholar.org/graph/v1/paper/search?${p}`, env.SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': env.SEMANTIC_SCHOLAR_API_KEY } : {}));
        return (json.data || []).map(x => ({ provider: 'semanticScholar', title: x.title, url: x.url, doi: x.externalIds?.DOI,
          authors: (x.authors || []).map(a => a.name), published: x.publicationDate || String(x.year || ''), citationCount: x.citationCount, excerpt: x.abstract, kind: x.abstract ? 'abstract' : 'metadata' }));
      },
      arxiv: async () => {
        const terms = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(the|and|could|whether|would|should|new|for|with|that|improve)$/i.test(w)).slice(0, 8);
        const p = new URLSearchParams({ search_query: terms.map(w => `all:"${w}"`).join(' AND '), start: '0', max_results: '4' });
        return parseArxiv(await fetchSource(`https://export.arxiv.org/api/query?${p}`));
      },
    };
    if (env.GOOGLE_SEARCH_API_KEY && env.GOOGLE_SEARCH_ENGINE_ID) {
      for (const [name, q] of [['web', query], ['documentation', `${query} (site:developer.mozilla.org OR site:docs.python.org OR site:learn.microsoft.com)`]]) adapters[name] = async () => {
        const p = new URLSearchParams({ key: env.GOOGLE_SEARCH_API_KEY, cx: env.GOOGLE_SEARCH_ENGINE_ID, q, num: '4' });
        const json = JSON.parse(await fetchSource(`https://www.googleapis.com/customsearch/v1?${p}`));
        return (json.items || []).map(x => ({ provider: name, title: x.title, url: x.link, excerpt: x.snippet, kind: 'snippet' }));
      };
    } else errors.push({ provider: 'web/documentation', error: 'Google Search credentials are not configured; scholarly retrieval remains available.' });
    for (const [provider, run] of Object.entries(adapters)) {
      try { records.push(...await run()); } catch (e) { errors.push({ provider, error: e.name === 'TimeoutError' ? 'Provider timeout' : clean(e.message, 180) }); }
      if (signal.aborted) break;
    }
    return { sources: mergeSources(records), errors };
  };
}
