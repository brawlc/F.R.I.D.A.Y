import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mergeSources } from '../citations.mjs';
import { createResearchMemory } from '../memory.mjs';
import { createRetrieval, parseArxiv } from '../retrieval.mjs';

test('DOI citations deduplicate and preserve metadata conflicts without inventing dates', () => {
  const result = mergeSources([{ title: 'A', url: 'https://example.org/a', doi: '10.1234/ABC', provider: 'crossref' }, { title: 'B', url: 'https://example.org/b', doi: '10.1234/abc', provider: 'semanticScholar' }]);
  assert.equal(result.length, 1); assert.equal(result[0].published, null); assert.equal(result[0].provenance.length, 2); assert.equal(result[0].metadataConflicts.length, 1);
  assert.deepEqual(mergeSources([{ title: 'Bad', url: 'javascript:alert(1)' }]), []);
});
test('arxiv extracts authors and rejects entity expansion', () => {
  const result = parseArxiv('<feed><entry><id>http://arxiv.org/abs/1234.5678</id><title>A &amp; B</title><author><name>Alice</name></author><summary>Abstract</summary><published>2024-01-02</published></entry></feed>');
  assert.equal(result[0].title, 'A & B'); assert.deepEqual(result[0].authors, ['Alice']);
  assert.throws(() => parseArxiv('<!DOCTYPE x>'));
});
test('retrieval isolates failures, retries 429, and respects request budget', async () => {
  let count = 0;
  const retrieve = createRetrieval({ intervalMs: 0, env: {}, fetchImpl: async url => {
    count++;
    if (count === 1) return new Response('', { status: 429 });
    if (String(url).includes('crossref')) return Response.json({ message: { items: [{ title: ['Fixture paper'], URL: 'https://doi.org/10.1234/test', DOI: '10.1234/test' }] } });
    throw new Error('offline');
  } });
  const budget = { requests: 0, maxRequests: 3 };
  const result = await retrieve('test', { budget, signal: AbortSignal.timeout(5000) });
  assert.equal(count, 3); assert.equal(result.sources.length, 1); assert.equal(budget.requests, 3); assert.ok(result.errors.length >= 2);
});
test('memory survives reload and preserves corrupt files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-research-'));
  try {
    const store = createResearchMemory(dir), id = randomUUID();
    await store.save({ id, objective: 'fixture', createdAt: '2026-01-01', findings: [] });
    assert.equal((await createResearchMemory(dir).get(id)).objective, 'fixture');
    assert.equal((await store.list()).length, 1); await assert.rejects(store.get('../secret'));
    await writeFile(join(dir, `${id}.json`), 'broken'); await assert.rejects(store.get(id));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('oversized responses are rejected and cancellation stops provider work', async () => {
  const large = createRetrieval({ intervalMs: 0, env: {}, fetchImpl: async () => new Response('x'.repeat(1000001)) });
  const result = await large('test', { budget: { requests: 0, maxRequests: 1 }, signal: AbortSignal.timeout(3000) });
  assert.equal(result.sources.length, 0); assert.ok(result.errors.some(e => e.error.includes('1 MB')));
  let calls = 0;
  const controller = new AbortController();
  const blocked = createRetrieval({ env: {}, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); controller.abort(new Error('fixture cancellation')); });
  } });
  const cancelled = await blocked('test', { budget: { requests: 0, maxRequests: 10 }, signal: controller.signal });
  assert.equal(calls, 1); assert.equal(cancelled.sources.length, 0);
});
