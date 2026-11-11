-- Local design migration only. No database is provisioned by this file.
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('chat', 'research', 'daily_briefing')),
  state TEXT NOT NULL CHECK(state IN ('waiting_for_approval','queued','running','completed','failed','cancelled','outcome_unknown')),
  created_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT,
  approval_expires_at INTEGER,
  lease_hash TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS tasks_state_created ON tasks(state, created_at);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','outcome_unknown')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_attempt_at INTEGER,
  UNIQUE(task_id)
);
