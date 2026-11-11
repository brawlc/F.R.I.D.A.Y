import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../../frontend/src/services/apiClient.ts';
test('Windows same-origin and explicit loopback development preserved', async () => {
  const c = createApiClient({ origin: 'http://localhost:5173', base: 'http://127.0.0.1:3000' });
  assert.equal(c.url('/api/chat'), 'http://127.0.0.1:3000/api/chat');
  assert.equal(c.url('http://127.0.0.1:3000/api/desktop/open'), 'http://127.0.0.1:3000/api/desktop/open');
});
test('remote pages cannot opt into laptop APIs or loopback fallbacks', () => {
  for (const mode of ['desktop', 'private-mobile']) {
    const c = createApiClient({ origin: 'https://friday.example', mode });
    for (const path of ['/api/chat', '/api/desktop/open', '/api/security/web-audit', 'http://127.0.0.1:3000/api/mobile/status']) assert.throws(() => c.url(path));
  }
  assert.throws(() => createApiClient({ origin: 'https://friday.example', base: 'http://localhost:3000' }));
});
test('private mobile allows only its same-origin API', () => {
  const c = createApiClient({ origin: 'https://friday.example' });
  assert.equal(c.url('/api/mobile/status'), 'https://friday.example/api/mobile/status');
  for (const path of ['https://evil.example/api/mobile/status', '/api/mobile/../desktop/open', '/api/mobile/%2e%2e/desktop/open', '//evil.example/api/mobile/status', '/api/mobile/\\desktop', 'https://user:pass@friday.example/api/mobile/status']) assert.throws(() => c.url(path));
});
test('query downloads and caller cancellation preserved, redirects refused', async () => {
  let observed;
  const c = createApiClient({ origin: 'http://localhost:3000' }, async (...args) => { observed = args; return new Response('{}'); });
  const signal = new AbortController().signal;
  await c.fetch('/api/reverse-engineering/v1/jobs/id/report?format=json', { method: 'POST', body: '{}', signal, redirect: 'follow' });
  assert.match(observed[0], /format=json$/); assert.equal(observed[1].signal, signal); assert.equal(observed[1].redirect, 'error'); assert.equal(observed[1].body, '{}');
});
