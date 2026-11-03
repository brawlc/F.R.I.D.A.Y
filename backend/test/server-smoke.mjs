import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { get } from 'node:http';

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['backend/server.mjs'], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', FRIDAY_AUTO_MONITOR: 'false', FRIDAY_NTFY_ENABLED: 'false', FRIDAY_TELEGRAM_ENABLED: 'false', FRIDAY_DAILY_BRIEFING_ENABLED: 'false' },
  stdio: 'ignore', windowsHide: true,
});
const exited = once(child, 'exit');
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw Error('Smoke-test server exited early.');
    try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Isolated server must start');
  assert.equal((await (await fetch(`${base}/api/health`)).json()).service, 'friday');
  const communications = await (await fetch(`${base}/api/communications/status`)).json();
  assert.equal(communications.channels.ntfy.enabled, false);
  assert.equal(communications.channels.telegram.outboundOnly, true);
  assert.match(await (await fetch(base)).text(), /<div id="root">/);
  assert.equal((await fetch(`${base}/gesture-control.html`)).status, 200);
  const missing = await fetch(`${base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).ok, false);
  const invalid = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /invalid JSON/);
  assert.equal((await fetch(`${base}/api/desktop/status`, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: base } })).status, 200);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = get(`${base}/api/desktop/status`, { headers: { Host: 'unrelated.example:3000' }, timeout: 3000 }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Host guard test timed out')));
  });
  assert.equal(rebindingStatus, 403);
  console.log('PASS: isolated startup, health, UI, gesture page, JSON 404/400, cross-origin rejection. No AI requests or user data changes.');
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
}
