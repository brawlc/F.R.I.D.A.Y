import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker, { createWorker, proposeDailyBriefing } from '../worker.mjs';
const origin = 'https://friday.example';
const env = { FRONTEND_ENABLED: 'true', APP_ORIGIN: origin };
const req = (path = '/api/mobile/status', options) => new Request(origin + path, options);
test('default deployment disables APIs and private assets', async () => {
  for (const path of ['/api/mobile/status', '/', '/mobile/', '/mobile/assets/main.js']) assert.equal((await worker.fetch(req(path), {})).status, 503);
});
test('scheduler disabled by default; missing storage fails explicitly', async () => {
  await worker.scheduled({}, {});
  await assert.rejects(worker.scheduled({}, { SCHEDULER_ENABLED: 'true' }), /database_unavailable/);
});
test('daily proposals require opt-in, survive restart and deduplicate; never execute', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'friday-cloud-'));
  let db;
  const adapter = () => ({ prepare: sql => ({ bind: (...args) => ({ run: () => db.prepare(sql).run(...args) }) }) });
  try {
    const path = join(directory, 'queue.sqlite'); db = new DatabaseSync(path);
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    const at = Date.parse('2026-11-11T03:45:00Z');
    await proposeDailyBriefing(adapter(), at);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0);
    db.exec("INSERT INTO settings VALUES ('daily_briefing_enabled','true')");
    await proposeDailyBriefing(adapter(), at); db.close(); db = new DatabaseSync(path);
    await proposeDailyBriefing(adapter(), at);
    await proposeDailyBriefing(adapter(), at + 60000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
    assert.equal(db.prepare('SELECT state FROM tasks').get().state, 'waiting_for_approval');
    assert.throws(() => db.exec("UPDATE tasks SET kind='shell'"));
    assert.throws(() => db.exec('UPDATE tasks SET attempts=4'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 0);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('full task storage rejects further scheduled proposals', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO settings VALUES ('daily_briefing_enabled','true')");
    const insert = db.prepare("INSERT INTO tasks (id,kind,state,created_at,idempotency_key) VALUES (?,'research','waiting_for_approval',0,?)");
    for (let i = 0; i < 500; i++) insert.run(String(i), String(i));
    await proposeDailyBriefing({ prepare: sql => ({ bind: (...args) => ({ run: () => db.prepare(sql).run(...args) }) }) }, Date.parse('2026-11-11T03:45:00Z'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 500);
  } finally { db.close(); }
});
