import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openState(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  const initial = { version: 1, tasks: [], workers: {}, credentials: [], sessions: [], challenges: [], audit: [], outbox: [], settings: { daily: false }, enrollmentUsed: false };
  db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(JSON.stringify(initial));
  function read() { const s = JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get().value); if (s.version !== 1 || !Array.isArray(s.tasks) || !Array.isArray(s.audit)) throw Error('Invalid state; preserved'); return s; }
  return { read, change(fn) { db.exec('BEGIN IMMEDIATE'); try { const s = read(); const result = fn(s); if (result?.then) throw Error('Async transaction forbidden'); db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(s)); db.exec('COMMIT'); return structuredClone(result); } catch(e) { db.exec('ROLLBACK'); throw e; } }, close: () => db.close() };
}
export function audit(s, event, id = '', now = Date.now()) { s.audit.push({ at: now, event, id }); s.audit = s.audit.slice(-1000); }
export function outbox(s, type, id, severity = 'medium', now = Date.now()) {
  if(s.outbox.some(n=>n.id===id&&n.type===type))return;
  if(s.outbox.length>=500){const finished=s.outbox.findIndex(n=>['sent','failed','unknown','muted'].includes(n.state));if(finished>=0)s.outbox.splice(finished,1);else{audit(s,'notification_capacity_exceeded',id,now);return;}}
  s.outbox.push({ id, type, severity, state: 'queued', tries: 0, nextAt: now });

}
