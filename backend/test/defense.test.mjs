import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDefense, createDefenseService, requireLocalDefense } from '../security/defense.mjs';

test('unknowns are not findings or passes and critical failures cap the posture score', () => {
  const unknown = assessDefense({ checks: [{ id: 'secure-boot', pass: null }], findings: [{ id: 'secure-boot' }] });
  assert.equal(unknown.score, null);
  assert.equal(unknown.coverage.unknown, 1);
  assert.equal(unknown.findings.length, 0);
  assert.equal(unknown.status, 'incomplete');
  const report = assessDefense({ checks: [{ id: 'defender', severity: 'critical', pass: false }, ...Array.from({ length: 100 }, (_, id) => ({ id, pass: true, severity: 'info' }))] });
  assert.ok(report.score <= 40);
  assert.equal(report.status, 'critical-review');
});

test('scan comparisons retain uncertainty instead of interpreting it as recovery', () => {
  const previous = assessDefense({ scannedAt: 'before', checks: [{ id: 'firewall', pass: false }] });
  const report = assessDefense({ checks: [{ id: 'firewall', pass: null }] }, previous);
  assert.equal(report.changes[0].before, 'review');
  assert.equal(report.changes[0].after, 'unknown');
});

test('concurrent scans share one collector; short cooldown and failure retry work', async () => {
  let calls = 0;
  let clock = 100;
  const scan = createDefenseService(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { ok: true, checks: [{ id: 'test', pass: true }] }; }, () => clock);
  await Promise.all([scan(), scan(), scan()]);
  assert.equal(calls, 1);
  assert.equal((await scan()).cached, true);
  clock += 16000;
  await scan();
  assert.equal(calls, 2);
  let fail = true;
  const retry = createDefenseService(async () => { if (fail) throw Error('timeout'); return { ok: true, checks: [{ id: 'test', pass: true }] }; });
  await assert.rejects(retry(), /timeout/);
  fail = false;
  assert.equal((await retry()).ok, true);
  await assert.rejects(createDefenseService(async () => ({ ok: true, checks: [] }))(), /incomplete/);
});

test('sensitive endpoints reject remote sockets and rebinding hosts', () => {
  for (const [remoteAddress, host, allowed] of [['127.0.0.1', '127.0.0.1:3000', true], ['::1', '[::1]:3000', true], ['127.0.0.1', 'attacker.example:3000', false], ['192.168.1.10', 'localhost:3000', false]]) {
    let next = false; let status;
    requireLocalDefense({ socket: { remoteAddress }, get: () => host }, { status(value) { status = value; return this; }, json() {} }, () => { next = true; });
    assert.equal(next, allowed);
    if (!allowed) assert.equal(status, 403);
  }
});
