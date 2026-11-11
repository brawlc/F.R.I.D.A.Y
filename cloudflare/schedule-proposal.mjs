export async function proposeDailyBriefing(db, scheduledTime) {
  if (!Number.isFinite(scheduledTime)) throw Error('invalid_schedule_time');
  const ist = new Date(scheduledTime + 330 * 60000);
  if (ist.getUTCHours() !== 9 || ist.getUTCMinutes() !== 15) return;
  const day = ist.toISOString().slice(0, 10);
  // Unique key provides restart/retry deduplication. Durable owner opt-in required.
  return db.prepare(`INSERT OR IGNORE INTO tasks
    (id, kind, state, created_at, idempotency_key)
    SELECT ?, 'daily_briefing', 'waiting_for_approval', ?, ?
    WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'daily_briefing_enabled' AND value = 'true')
    AND (SELECT COUNT(*) FROM tasks) < 500`).bind(`briefing:${day}`, scheduledTime, `briefing:${day}`).run();
}
