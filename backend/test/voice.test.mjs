import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { voiceInput, createVoiceRouter } from '../voice/router.mjs';
import { requireLocalDefense } from '../security/defense.mjs';

test('voice input rejects empty/oversize text and bounds prosody', () => {
  for (const text of ['', '  ', 'x'.repeat(4001), 123]) assert.throws(() => voiceInput({ text }));
  assert.deepEqual(voiceInput({ text: ' Hello ', rate: 9, pitch: -5 }), { text: 'Hello', rate: '20%', pitch: '-40%' });
  assert.deepEqual(voiceInput({ text: 'Hello' }), { text: 'Hello', rate: '-4%', pitch: '0%' });
});

test('voice API serves uncached audio and handles provider failure without leaking text', async () => {
  let calls = 0;
  const app = express(); app.use(express.json());
  app.use(requireLocalDefense, createVoiceRouter(async input => {
    calls++;
    if (input.text === 'fail') throw new Error('Sensitive provider details');
    return Buffer.from('fixture-audio');
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const post = text => fetch(`http://127.0.0.1:${server.address().port}/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  try {
    assert.equal((await post('')).status, 400); assert.equal(calls, 0);
    const response = await post('Hello');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /audio\/mpeg/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'fixture-audio');
    const failed = await post('fail'); assert.equal(failed.status, 503);
    assert.doesNotMatch(await failed.text(), /Sensitive/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
