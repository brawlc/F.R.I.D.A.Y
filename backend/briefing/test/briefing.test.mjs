import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOURCES, parseFeed, validateItem, createNewsRetriever, canonicalUrl } from '../sources.mjs';
import { createBriefingStore, createIntelligenceBriefing, selectNew, istDay, isDue } from '../service.mjs';
import { makePublicBriefing, isPublicBriefing } from '../public-report.mjs';
import { createCommunicationsHub } from '../../communications/hub.mjs';
import { startBriefingScheduler } from '../../communications/scheduler.mjs';

const now = Date.parse('2026-10-31T03:45:00Z');
const raw = { title: 'Ferrari announces Formula 1 wing upgrade', url: 'https://www.formula1.com/en/latest/article/fixture', published: '2026-10-30T10:00:00Z', excerpt: 'Ferrari reports a revised wing for evaluation under representative track conditions.' };
const item = validateItem(raw, SOURCES[0], now);
test('RSS and Atom publication dates parse; undated, stale, future and foreign-host entries fail closed', () => {
  const xml = '<rss><channel><item><title><![CDATA[Ferrari &amp; Hamilton]]></title><link>https://www.formula1.com/a</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate><description>F1 technical upgrades</description></item></channel></rss>';
  assert.equal(parseFeed(xml)[0].title, 'Ferrari & Hamilton');
  assert.equal(parseFeed('<feed><entry><title>A</title><link href="https://www.nasa.gov/a"/><published>2026-10-30T00:00:00Z</published></entry></feed>')[0].url, 'https://www.nasa.gov/a');
  for (const published of [undefined, 'invalid', '2026-01-01', '2027-01-01']) assert.equal(validateItem({ ...raw, published }, SOURCES[0], now), null);
  assert.equal(canonicalUrl('https://formula1.com.attacker.test/x', 'formula1.com'), null);
  assert.equal(canonicalUrl('http://127.0.0.1/x', 'formula1.com'), null);
  assert.throws(() => parseFeed('<!DOCTYPE foo><rss/>'));
  assert.equal(parseFeed('<feed><entry><title>x</title><updated>2026-10-30</updated></entry></feed>')[0].published, '');
});
test('retrieval records errors, validates URLs and rejects HTML instead of scraping', async () => {
  const retrieve = createNewsRetriever({ now: () => now, env: {}, sources: [SOURCES[0], SOURCES[1], SOURCES.at(-1)], fetchImpl: async (url, opts) => {
    if (url.includes('fia.com')) return new Response('denied', { status: 403 });
    if (opts.method === 'HEAD') return new Response(null, { status: 200 });
    return new Response(`<rss><channel><item><title>${raw.title}</title><link>${raw.url}</link><pubDate>${raw.published}</pubDate></item></channel></rss>`);
  } });
  const result = await retrieve(); assert.equal(result.items.length, 1); assert.equal(result.health[1].error, 'HTTP_403'); assert.equal(result.health[2].status, 'unavailable');
  assert.match(result.items[0].urlVerification, /HEAD/); assert.throws(() => parseFeed('<html>not a feed</html>'));
});
test('selection deduplicates URL/title and reserves both F1 and aerospace coverage', () => {
  const space = validateItem({ title: 'NASA rocket launch test announced', url: 'https://www.nasa.gov/test/', published: raw.published }, SOURCES[2], now);
  assert.equal(selectNew([item, { ...item, id: 'duplicate' }], []).length, 1);
  assert.equal(selectNew([item], [item]).length, 0);
  assert.equal(selectNew([item, space], []).length, 2);
});
test('public briefing accepts only constructed tokens and stays within ntfy size limit', () => {
  const report = { day: '2026-10-31', items: [item], health: [] };
  const token = makePublicBriefing(report); assert.ok(isPublicBriefing(token)); assert.equal(isPublicBriefing({ text: 'private secret' }), false);
  assert.match(token.text, /Analysis \(not confirmed\)/); assert.ok(Buffer.byteLength(token.text) < 4096);
});
test('persistent scheduler catchup date is IST and restart does not send twice', async () => {
  assert.equal(istDay(Date.parse('2026-10-30T20:00:00Z')), '2026-10-31'); assert.equal(isDue(now), true); assert.equal(isDue(Date.parse('2026-10-31T03:44:59Z')), false);
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-')); let sends = 0;
  try {
    const opts = { store: createBriefingStore(dir), now: () => now, retrieve: async () => ({ items: [item], health: [] }), hub: { notify: async () => { sends++; return { status: 'sent' }; } } };
    const a = createIntelligenceBriefing(opts); await a.run(); await createIntelligenceBriefing(opts).run(); assert.equal(sends, 1);
    const nextDay = createIntelligenceBriefing({ ...opts, now: () => now + 86400000 });
    const next = await nextDay.run(); assert.equal(next.report.items.length, 0); assert.match(next.report.text, /No new, dated/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('crash during dispatch persists unknown result and never automatically resends', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-')); let sends = 0;
  try {
    const opts = { store: createBriefingStore(dir), now: () => now, retrieve: async () => ({ items: [item], health: [] }), hub: { notify: async () => { sends++; throw Error('crash'); } } };
    await assert.rejects(createIntelligenceBriefing(opts).run());
    assert.equal((await createIntelligenceBriefing(opts).run()).status, 'delivery_unknown_no_resend'); assert.equal(sends, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('preview never sends or consumes novelty and model output must cite a retrieved passage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-')); let calls = 0;
  try {
    const service = createIntelligenceBriefing({ store: createBriefingStore(dir), now: () => now, retrieve: async () => ({ items: [item], health: [] }), hub: { notify: () => { throw Error('unexpected send'); } }, generate: async ({ role }) => {
      calls++; return JSON.stringify(role === 'briefing-critic' ? { issues: ['No measured lap-time evidence.'] } : { findings: [{ sourceId: item.id, quote: item.excerpt, claim: 'Compare drag and downforce at matched operating conditions.' }, { sourceId: 'fake', quote: 'Invented paper quote here', claim: 'Impossible result' }] });
    } });
    const result = await service.run({ preview: true }); assert.equal(calls, 2); assert.match(result.report.items[0].analysis, /Compare drag/); assert.equal((await service.status()).today, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('actual hub delivers public intelligence only to ntfy and never retries ambiguous sends', async () => {
  let calls = 0;
  const hub = createCommunicationsHub({ config: { ntfy: { enabled: true, token: 'fixture-token', accessControlled: true, url: 'https://ntfy.sh', topic: 'fixture' }, telegram: { enabled: true, token: '1:test', chatId: '2' }, device: 'test' }, fetchImpl: async (url, opts) => {
    calls++; assert.equal(url, 'https://ntfy.sh/'); assert.match(JSON.parse(opts.body).message, /FRIDAY intelligence/); throw Error('ambiguous timeout');
  } });
  const result = await hub.notify({ type: 'daily_briefing', publicBriefing: makePublicBriefing({ day: '2026-10-31', items: [item], health: [] }) });
  assert.equal(result.status, 'delivery_unknown_no_resend'); assert.equal(calls, 1);
});

test('all unavailable sources produce an honest no-news briefing, not model inventions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-'));
  try {
    const service = createIntelligenceBriefing({ store: createBriefingStore(dir), now: () => now, retrieve: async () => ({ items: [], health: [{ name: 'NASA', status: 'failed', error: 'HTTP_503' }] }), generate: () => { throw Error('must not generate without sources'); } });
    const result = await service.run({ preview: true }); assert.equal(result.report.items.length, 0); assert.match(result.report.text, /No new, dated/); assert.match(result.report.text, /Unavailable: NASA/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('separate service instances cannot overlap and corrupt state is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-')); const store = createBriefingStore(dir);
  try {
    const unlock = await store.lock(); assert.equal(await createBriefingStore(dir).lock(), null); await unlock();
    await writeFile(join(dir, 'state.json'), 'corrupt');
    const service = createIntelligenceBriefing({ store, now: () => now, retrieve: () => { throw Error('must not retrieve'); } });
    await assert.rejects(service.run(), /unreadable/); assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), 'corrupt');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('scheduler catches up after 09:15 IST once per process and consults persistent runner', async () => {
  let tick, runs = 0;
  startBriefingScheduler({}, { enabled: true, now: () => now, runner: { run: async () => { runs++; } }, setIntervalImpl: callback => { tick = callback; return {}; } });
  tick(); tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(runs, 1);
});

test('model quota failure is reported precisely without exposing provider error details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-'));
  try {
    const service = createIntelligenceBriefing({ store: createBriefingStore(dir), now: () => now, retrieve: async () => ({ items: [item], health: [] }), generate: async () => { throw Error('Insufficient credits secret-account-detail'); } });
    const { report } = await service.run({ preview: true });
    assert.equal(report.analysisError, 'Configured AI provider quota or credit unavailable');
    assert.doesNotMatch(report.text, /secret-account-detail/); assert.equal(report.items[0].analysisKind, 'rule-based-informed-analysis');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('busy scheduler retries later and transient failures use backoff', async () => {
  let tick, time = now, runs = 0;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  startBriefingScheduler({}, { enabled: true, now: () => time, runner: { run: async () => {
    runs++; if (runs === 1) return { status: 'busy' }; if (runs === 2) throw Error('retrieval interrupted'); return { status: 'sent' };
  } }, setIntervalImpl: cb => { tick = cb; return {}; } });
  await settle(); tick(); await settle(); assert.equal(runs, 1);
  time += 15000; tick(); await settle(); assert.equal(runs, 2);
  tick(); await settle(); assert.equal(runs, 2);
  time += 60000; tick(); await settle(); assert.equal(runs, 3);
  time += 60000; tick(); await settle(); assert.equal(runs, 3);
});

test('valid JSON with invalid durable state fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-'));
  try {
    for (const state of ['null', '{}', '{"days":[],"seen":[]}', '{"days":{},"seen":[null]}']) {
      await writeFile(join(dir, 'state.json'), state);
      await assert.rejects(createBriefingStore(dir).load(), /unreadable/);
      assert.equal(await readFile(join(dir, 'state.json'), 'utf8'), state);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('critic failure does not misreport successful model analysis', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-brief-'));
  try {
    const service = createIntelligenceBriefing({ store: createBriefingStore(dir), now: () => now,
      retrieve: async () => ({ items: [item], health: [] }), generate: async ({ role }) => {
        if (role === 'briefing-critic') throw Error('quota exhausted');
        return JSON.stringify({ findings: [{ sourceId: item.id, quote: item.excerpt, claim: 'Compare drag under matched conditions.' }] });
      } });
    const { report } = await service.run({ preview: true });
    assert.equal(report.analystStatus, 'completed'); assert.equal(report.criticStatus, 'unavailable');
    assert.equal(report.analysisError, undefined); assert.match(report.text, /Independent model critic unavailable/);
    assert.doesNotMatch(report.text, /Model analysis unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('seen stories do not consume the bounded URL verification budget', async () => {
  let heads = 0;
  const retrieve = createNewsRetriever({ now: () => now, env: {}, sources: [SOURCES[0]], fetchImpl: async (url, opts) => {
    if (opts.method === 'HEAD') { heads++; return new Response(null); }
    return new Response(`<rss><channel><item><title>${raw.title}</title><link>${raw.url}</link><pubDate>${raw.published}</pubDate></item></channel></rss>`);
  } });
  const result = await retrieve({ seen: [item] });
  assert.equal(result.items.length, 0); assert.equal(heads, 0);
});

test('multibyte summaries remain within delivery limit with intact included citations', () => {
  const token = makePublicBriefing({ day: '2026-11-03', items: Array.from({ length: 4 }, (_, n) => ({ ...item, id: String(n), title: '?'.repeat(150), analysis: '?'.repeat(240) })),
    health: SOURCES.map(s => ({ name: s.name, status: 'failed' })), criticIssues: ['?'.repeat(200)], analysisError: 'unavailable', criticStatus: 'not_run' });
  assert.ok(Buffer.byteLength(token.text) <= 4096);
  assert.equal((token.text.match(/Published /g) || []).length, token.includedIds.length);
});
