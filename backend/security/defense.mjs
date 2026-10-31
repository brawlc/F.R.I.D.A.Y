const weights = { critical: 10, high: 5, medium: 2, info: 1 };
export function assessDefense(report, previous) {
  const checks = (report.checks || []).map(check => ({ ...check, status: check.pass === true ? 'pass' : check.pass === false ? 'review' : 'unknown' }));
  const known = checks.filter(check => check.status !== 'unknown');
  const weight = check => weights[check.severity] || 1;
  const total = known.reduce((sum, check) => sum + weight(check), 0);
  let score = total ? Math.round(100 * known.filter(check => check.pass).reduce((sum, check) => sum + weight(check), 0) / total) : null;
  const critical = checks.filter(check => check.status === 'review' && check.severity === 'critical');
  if (critical.length && score !== null) score = Math.min(score, 40);
  const unknown = checks.filter(check => check.status === 'unknown').length;
  const prior = new Map((previous?.checks || []).map(check => [check.id, check]));
  const changes = checks.filter(check => prior.has(check.id) && prior.get(check.id).status !== check.status).map(check => ({ id: check.id, label: check.label, before: prior.get(check.id).status, after: check.status }));
  return { ...report, checks, score, coverage: { known: known.length, unknown, total: checks.length },
    status: critical.length ? 'critical-review' : checks.some(check => check.status === 'review') ? 'review-needed' : unknown || !checks.length ? 'incomplete' : 'checks-passed',
    findings: (report.findings || []).filter(finding => !checks.some(check => check.id === finding.id && check.status === 'unknown')),
    changes, baseline: previous ? previous.scannedAt : null,
    note: 'Read-only posture checks, not a malware-free guarantee. Unknown means unavailable or insufficient permission. Startup, download and process-location flags require review; they are not malware verdicts. No files were removed or Windows protections changed.' };
}

export function createDefenseService(collect, now = Date.now) {
  let pending;
  let previous;
  let completedAt = 0;
  return async () => {
    if (pending) return pending;
    if (previous && now() - completedAt < 15000) return { ...previous, cached: true };
    pending = (async () => {
      const raw = await collect();
      if (!raw?.ok || !Array.isArray(raw.checks) || !raw.checks.length) throw new Error('Protection collector returned an incomplete report.');
      const report = assessDefense(raw, previous);
      previous = report;
      completedAt = now();
      return report;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

export function requireLocalDefense(req, res, next) {
  const remote = req.socket?.remoteAddress;
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  let hostname;
  try { hostname = new URL(`http://${req.get('host')}`).hostname; } catch {}
  if (!local || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return res.status(403).json({ ok: false, error: 'This capability is available only through FRIDAY on this computer.' });
  next();
}
