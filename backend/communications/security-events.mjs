export function defenseEvents(report) {
  if (!report?.ok || report.cached) return [];
  return (report.checks || []).filter(c => c.status === 'review').map(c => ({
    type: 'suspicious_activity', id: `posture:${c.id}`, behaviorCode: 'posture_check',
    severity: c.severity === 'critical' ? 'critical' : c.severity === 'high' ? 'high' : 'medium',
    detectedAt: report.scannedAt, containment: { status: 'not_performed' },
  }));
}
