import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommunicationsHub, createDeliveryStore, readConfig, ROUTES } from '../hub.mjs';
import { defenseEvents } from '../security-events.mjs';
import { startBriefingScheduler, istBriefingSlot } from '../scheduler.mjs';

const config = () => ({ ntfy: { enabled: true, url: 'https://ntfy.sh', topic: 'fixture', token: 'fixture-secret' }, telegram: { enabled: true, token: '123:fixture-secret', chatId: '1234' }, device: 'test device' });
test('SERVER setting takes precedence and legacy URL remains supported', () => {
  assert.equal(readConfig({ FRIDAY_NTFY_SERVER: 'https://ntfy.sh', FRIDAY_NTFY_URL: 'https://example.org' }).ntfy.url, 'https://ntfy.sh');
  assert.equal(readConfig({ FRIDAY_NTFY_URL: 'https://example.org' }).ntfy.url, 'https://example.org');
});
test('manual notification has harmless fixed content and only one attempt', async () => {
  const { hub, calls } = harness();
  const result = await hub.notify({ type: 'notification_test', message: 'private content' });
  assert.equal(result.providerMessageId, 'fixture-id'); assert.match(calls[0].body.message, /harmless test/); assert.doesNotMatch(calls[0].body.message, /private content/);
  let attempts = 0;
  const failure = harness({ maxAttempts: 1, fetchImpl: async () => { attempts++; throw Error('offline'); } });
  assert.equal((await failure.hub.notify({ type: 'notification_test' })).status, 'failed'); assert.equal(attempts, 1);
});
function harness(options = {}) {
  const calls = [], sleeps = [];
  const fetchImpl = async (url, args) => {
    const body = JSON.parse(args.body); calls.push({ url, body });
    if (url.endsWith('/getChat')) return Response.json({ ok: true, result: { type: 'private', id: 1234 } });
    if (url.endsWith('/sendMessage')) return Response.json({ ok: true, result: { message_id: 1, chat: { id: 1234 } } });
    return Response.json({ id: 'fixture-id', topic: 'fixture' });
  };
  return { hub: createCommunicationsHub({ config: config(), fetchImpl, sleep: async ms => sleeps.push(ms), ...options }), calls, sleeps };
}
test('all routine categories route only to ntfy and all security categories only to Telegram', async () => {
  const { hub, calls } = harness();
  for (const [type, channel] of Object.entries(ROUTES)) {
    const before = calls.length;
    const r = await hub.notify({ type, id: type }); assert.equal(r.status, 'sent'); assert.equal(r.channel, channel);
    assert.ok(calls.slice(before).every(c => channel === 'ntfy' ? c.url === 'https://ntfy.sh/' : c.url.startsWith('https://api.telegram.org/')));
  }
});
test('public ntfy payload discards caller text, secrets, forensic fields and high priority', async () => {
  const { hub, calls } = harness();
  await hub.notify({ type: 'project_progress', id: 'a', title: 'secret password', message: 'private forensic dump', priority: 'critical', device: 'private-host' });
  const body = JSON.stringify(calls[0].body);
  assert.doesNotMatch(body, /secret|forensic|private-host/); assert.equal(calls[0].body.priority, 3);
  await hub.notify({ type: 'reminder', priority: 'low' }); assert.equal(calls[1].body.priority, 2);
});
test('critical security alert starts immediately with no batching and all required safe fields', async () => {
  const { hub, calls, sleeps } = harness();
  await hub.notify({ type: 'critical_security_incident', detectedAt: '2026-10-31T01:00:00Z', message: 'password=secret', containment: { status: 'contained', confirmed: false } });
  assert.deepEqual(sleeps, []);
  const text = calls.find(c => c.url.endsWith('/sendMessage')).body.text;
  for (const field of ['Threat severity: critical', 'Detection timestamp: 2026-10-31T01:00:00.000Z', 'Affected device:', 'Observed behavior:', 'Actual containment status: Unknown', 'Recommended next action:']) assert.ok(text.includes(field), field);
  assert.doesNotMatch(text, /password=secret|contained \(confirmed/);
});
test('routine delivery cannot block a different critical alert', async () => {
  let release;
  const calls = [];
  const { hub } = harness({ fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes('ntfy')) return new Promise(resolve => { release = () => resolve(Response.json({ id: 'x', topic: 'fixture' })); });
    return url.endsWith('/getChat') ? Response.json({ ok: true, result: { type: 'private', id: 1234 } }) : Response.json({ ok: true, result: { message_id: 1, chat: { id: 1234 } } });
  } });
  const routine = hub.notify({ type: 'reminder' });
  await Promise.resolve();
  const security = await hub.notify({ type: 'critical_security_incident' });
  assert.equal(security.status, 'sent'); assert.ok(calls.some(c => c.endsWith('/sendMessage'))); release(); await routine;
});
test('Telegram rejects nonprivate, mismatched and unconfigured chat destinations', async () => {
  for (const result of [{ type: 'group', id: 1234 }, { type: 'private', id: 5678 }]) {
    const calls = [];
    const { hub } = harness({ fetchImpl: async url => { calls.push(url); return Response.json({ ok: true, result }); } });
    assert.equal((await hub.notify({ type: 'malware_detection' })).error, 'unauthorized_chat'); assert.equal(calls.length, 1);
  }
  const c = config(); c.telegram.chatId = '-123';
  const { hub, calls } = harness({ config: c }); assert.equal((await hub.notify({ type: 'malware_detection' })).status, 'failed'); assert.equal(calls.length, 0);
});
test('channels are independently disabled and missing credentials are recorded without crashing', async () => {
  for (const channel of ['ntfy', 'telegram']) {
    const c = config(); c[channel].enabled = false;
    const { hub } = harness({ config: c });
    assert.equal((await hub.notify({ type: channel === 'ntfy' ? 'reminder' : 'malware_detection' })).status, 'disabled');
    assert.equal((await hub.notify({ type: channel === 'ntfy' ? 'malware_detection' : 'reminder' })).status, 'sent');
  }
  const c = readConfig({ FRIDAY_TELEGRAM_ENABLED: 'true', FRIDAY_NTFY_ENABLED: 'true' });
  const { hub, calls } = harness({ config: c });
  assert.equal((await hub.notify({ type: 'reminder' })).error, 'missing_or_invalid_credentials');
  assert.equal((await hub.notify({ type: 'malware_detection' })).error, 'missing_or_invalid_credentials'); assert.equal(calls.length, 0);
});
test('retries are bounded, provider errors never leak secrets, and failures are not deduplicated', async () => {
  const { hub } = harness({ fetchImpl: async () => { throw new Error('https://api.telegram.org/botSECRET leaked'); } });
  const result = await hub.notify({ type: 'malware_detection' });
  assert.equal(result.status, 'failed'); assert.equal(result.attempts, 3);
  assert.equal((await hub.notify({ type: 'malware_detection' })).attempts, 3);
  assert.doesNotMatch(JSON.stringify(await hub.status()), /SECRET|fixture-secret/);
  const malformed = harness({ fetchImpl: async () => Response.json({ ok: false, error_code: 400, description: 'sensitive payload' }) });
  assert.equal((await malformed.hub.notify({ type: 'malware_detection' })).attempts, 1);
  const limited = harness({ fetchImpl: async () => new Response('{}', { status: 429, headers: { 'retry-after': '100' } }) });
  assert.equal((await limited.hub.notify({ type: 'reminder' })).attempts, 1); assert.deepEqual(limited.sleeps, []);
});
test('success requires acknowledgement; dedup survives restart and severity escalation is new', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friday-comms-'));
  try {
    const store = createDeliveryStore(join(directory, 'deliveries.json'));
    const { hub, calls } = harness({ store });
    await Promise.all([hub.notify({ type: 'suspicious_activity', id: 'same', severity: 'medium' }), hub.notify({ type: 'suspicious_activity', id: 'same', severity: 'medium' })]);
    assert.equal(calls.length, 2);
    const next = harness({ store });
    assert.equal((await next.hub.notify({ type: 'suspicious_activity', id: 'same', severity: 'medium' })).status, 'deduplicated');
    assert.equal((await next.hub.notify({ type: 'suspicious_activity', id: 'same', severity: 'critical' })).status, 'sent');
    const malformed = harness({ fetchImpl: async () => Response.json({}) });
    assert.equal((await malformed.hub.notify({ type: 'reminder' })).status, 'failed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('recovery requires explicit evidence-backed confirmation and detector integrations never claim containment', async () => {
  const { hub, calls } = harness();
  await hub.notify({ type: 'security_recovery_report', containment: { status: 'recovered', confirmed: true } });
  assert.match(calls[1].body.text, /Unknown \/ unconfirmed/);
  await hub.notify({ type: 'security_recovery_report', containment: { status: 'recovered', confirmed: true, evidenceId: 'local-secret-record', confirmedAt: '2026-10-31T01:00:00Z' } });
  assert.match(calls[3].body.text, /recovered \(confirmed/); assert.doesNotMatch(calls[3].body.text, /local-secret-record/);
  const events = defenseEvents({ ok: true, scannedAt: '2026-10-31', checks: [{ id: 'firewall', status: 'review', severity: 'critical' }, { id: 'unknown', status: 'unknown' }] });
  assert.equal(events.length, 1); assert.equal(events[0].type, 'suspicious_activity'); assert.equal(events[0].containment.status, 'not_performed');
  assert.deepEqual(defenseEvents({ ok: false }), []);
});
test('daily briefing uses 09:15 IST independent of host timezone and fires once per slot', async () => {
  const { hub, calls: deliveries } = harness({ now: () => Date.parse('2026-10-31T09:30:00Z') });
  await hub.notify({ type: 'daily_briefing', manualTest: true });
  assert.match(deliveries[0].body.message, /Manual test daily activity briefing/);
  assert.match(deliveries[0].body.message, /31 October 2026/);
  assert.equal(istBriefingSlot(Date.parse('2026-10-31T03:45:00Z')), '2026-10-31');
  assert.equal(istBriefingSlot(Date.parse('2026-10-31T09:15:00Z')), null);
  let tick, calls = [];
  startBriefingScheduler({ notify: async e => calls.push(e) }, { enabled: true, now: () => Date.parse('2026-10-31T03:45:10Z'), setIntervalImpl: fn => { tick = fn; return {}; } });
  tick(); tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1); assert.equal(calls[0].type, 'daily_briefing');
  assert.equal(startBriefingScheduler({}, { enabled: false }), null);
});

test('storage failures fail closed and preserve unreadable journal data', async () => {
  let writes = 0;
  const { hub, calls } = harness({ store: { load: async () => { throw Error('corrupt'); }, save: async () => { writes++; } } });
  assert.equal((await hub.notify({ type: 'reminder' })).error, 'delivery_store_unavailable');
  assert.equal(calls.length, 0); assert.equal(writes, 0); assert.equal((await hub.status()).storageError, true);
  assert.equal((await hub.notify({ type: '__proto__' })).status, 'rejected');
});

test('timed-out requests terminate with an accurately recorded bounded failure', async () => {
  const keepAlive = setInterval(() => {}, 100);
  try {
    const { hub } = harness({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    const result = await hub.notify({ type: 'reminder' });
    assert.equal(result.status, 'failed'); assert.equal(result.attempts, 3); assert.equal(result.error, 'network_or_timeout');
  } finally { clearInterval(keepAlive); }
});
