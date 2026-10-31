import { useRef, useState } from 'react';

type Report = {
  target: string; assessedAt: string; summary: string; method: string;
  coverage: { requested: string[]; assessed: number; failed: number; failures: { url: string; error: string }[] };
  findings: { id: string; page?: string; title: string; severity: string; confidence: string; evidence: string; remediation: string; retest: string }[];
  manualReview: string[]; limitations: string[];
};
export function WhitehatWorkbench() {
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState('');
  const [additionalUrls, setAdditionalUrls] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [comparison, setComparison] = useState('');
  const previous = useRef<Report | null>(null);
  const assess = async () => {
    setBusy(true); setError(''); setReport(null); setComparison('');
    try {
      const response = await fetch('/api/security/whitehat/assess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(150000), body: JSON.stringify({ url, additionalUrls: additionalUrls.split('\n').map(value => value.trim()).filter(Boolean), authorization: { confirmed: authorized, scope, purpose: 'Bounded public-page white-hat assessment' } }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Assessment failed.');
      const next: Report = body.report;
      if (previous.current?.target === next.target && !previous.current.coverage.failed && !next.coverage.failed && JSON.stringify(previous.current.coverage.requested) === JSON.stringify(next.coverage.requested)) {
        const before = new Set<string>(previous.current.findings.map(item => item.id));
        const after = new Set<string>(next.findings.map(item => item.id));
        setComparison(`${[...after].filter(id => !before.has(id)).length} newly observed; ${[...before].filter(id => !after.has(id)).length} no longer observed. Manual verification is still required.`);
      }
      previous.current = next; setReport(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Assessment failed.'); }
    finally { setBusy(false); }
  };
  const download = () => {
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = objectUrl; link.download = 'friday-whitehat-assessment.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <section className="my-4 rounded border border-cyan-300/30 bg-slate-950/80 p-4 text-cyan-50">
    <h3 className="text-lg text-cyan-200">White-Hat Workbench</h3>
    <label className="my-3 grid gap-2">Additional approved pages (optional; at most two, same origin, one URL per line)<textarea value={additionalUrls} disabled={busy} onChange={event => { setAdditionalUrls(event.target.value); setAuthorized(false); setReport(null); }} className="rounded border border-cyan-300/30 bg-black p-2" /></label>
    <p className="my-2 text-sm text-cyan-100/70">Assess up to three approved public pages. Review response policies, cookie attributes and form declarations with evidence and retest steps. No AI credits required.</p>
    <label className="my-3 grid gap-2">Approved page URL<input value={url} onChange={event => { setUrl(event.target.value); setReport(null); setAuthorized(false); }} disabled={busy} placeholder="https://your-site.example" className="rounded border border-cyan-300/30 bg-black p-2" /></label>
    <label className="my-3 grid gap-2">Approved scope<textarea value={scope} onChange={event => { setScope(event.target.value); setAuthorized(false); }} disabled={busy} maxLength={500} placeholder="Owned landing page; review public headers and HTML only." className="rounded border border-cyan-300/30 bg-black p-2" /></label>
    <label className="my-3 flex gap-2"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} />I own this target or have permission for this assessment.</label>
    <button type="button" disabled={busy || !authorized || scope.trim().length < 8 || !url.trim()} onClick={() => void assess()} className="rounded border border-cyan-300/40 px-3 py-2 disabled:opacity-40">{busy ? 'Assessing approved page…' : 'Run assessment / retest'}</button>
    {error && <p role="alert" className="mt-3 text-amber-200">{error}</p>}
    {report && <div className="mt-4 space-y-3">
      <p>{report.target} · {report.assessedAt}</p><p>{report.summary}</p><p>{report.method}</p>
      {report.coverage.failures.map(failure => <p key={failure.url} className="text-amber-200">Not assessed: {failure.url} — {failure.error}</p>)}
      {comparison && <p className="text-cyan-200">{comparison}</p>}
      <button type="button" onClick={download} className="rounded border border-cyan-300/40 px-3 py-2">Export evidence report</button>
      {report.findings.map(finding => <article key={finding.id} className="rounded border border-cyan-300/20 p-3">
        <h4>{finding.severity.toUpperCase()} · {finding.title}</h4>
        <p className="break-all text-cyan-100/60">Page: {finding.page}</p>
        <p className="mt-2">Evidence: {finding.evidence}</p><p>Confidence: {finding.confidence}</p>
        <p className="mt-2">Remediation: {finding.remediation}</p><p>Retest: {finding.retest}</p>
      </article>)}
      <details><summary>Manual follow-up and assessment limits</summary><ul className="my-3 list-disc space-y-2 pl-5">{[...report.manualReview, ...report.limitations].map((item, index) => <li key={index}>{item}</li>)}</ul></details>
      <a href="https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html" target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline">OWASP header guidance</a>
    </div>}
  </section>;
}
