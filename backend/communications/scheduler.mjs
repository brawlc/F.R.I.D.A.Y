export function istBriefingSlot(time = Date.now()) {
  const ist = new Date(time + 330 * 60000);
  return ist.getUTCHours() === 9 && ist.getUTCMinutes() === 15 ? ist.toISOString().slice(0, 10) : null;
}
export function startBriefingScheduler(hub, { enabled = false, now = Date.now, setIntervalImpl = setInterval, runner, onError = () => {} } = {}) {
  if (!enabled) return null;
  let attempted, active = false, retryAt = 0, failures = 0;
  const tick = () => {
    const local = new Date(now() + 330 * 60000);
    const day = runner ? (local.getUTCHours() * 60 + local.getUTCMinutes() >= 555 ? local.toISOString().slice(0, 10) : null) : istBriefingSlot(now());
    if (!day || day === attempted || active || now() < retryAt) return;
    active = true;
    void Promise.resolve().then(() => runner ? runner.run() : hub.notify({ type: 'daily_briefing', id: day, priority: 'normal' })).then(result => {
      if (result?.status === 'busy') { retryAt = now() + 15000; return; }
      attempted = day; failures = 0;
    }).catch(() => {
      // The runner's durable dispatch record prevents replay after an uncertain send.
      retryAt = now() + Math.min(3600000, 60000 * 2 ** Math.min(failures++, 6));
      onError('Briefing failed; check persistent state and source availability.');
    }).finally(() => { active = false; });
  };
  tick(); const timer = setIntervalImpl(tick, 15000); timer.unref?.(); return timer;
}
