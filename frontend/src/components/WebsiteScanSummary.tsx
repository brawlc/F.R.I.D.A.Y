type Sample = { device?: string; animations?: number; blocks: unknown[]; fonts: string[]; technology: string[] };
type Scan = { ok: boolean; cancelled?: boolean; snapshots: Sample[] };

export function WebsiteScanSummary({ url, scan, analysis }: { url: string; scan: Scan | null; analysis: unknown }) {
  const samples = scan?.snapshots || [];
  const limitations = [
    'One page sampled. Other routes and interactive states have not been exhaustively tested.',
    'Measured regions and styles are observations, not recovered component source.',
    'Animation counts cover DOM animations at sample time, not canvas/WebGL internals.',
    'Server code, databases, authentication, payments and private APIs remain unknown.',
  ];
  const coverage = {
    renderedScan: scan ? scan.ok ? 'completed' : 'partial' : 'not collected',
    desktopSamples: samples.filter(sample => sample.device === 'desktop').length,
    mobileSamples: samples.filter(sample => sample.device === 'mobile').length,
    maximumObservedAnimations: Math.max(0, ...samples.map(sample => sample.animations || 0)),
    visibleRegionsDetected: samples.some(sample => sample.blocks.length > 0),
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), requestedUrl: url, coverage, htmlObservation: analysis, renderedObservation: scan, limitations }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl; link.download = 'friday-website-observations.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <section className="rounded border border-cyan-300/25 bg-slate-950 p-4" aria-label="Scan coverage">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-cyan-200">What FRIDAY actually observed</h3><button type="button" onClick={download} className="rounded border border-cyan-300/30 px-3 py-2">Download scan report</button></div>
    <div className="my-3 grid gap-3 sm:grid-cols-3">
      <p>Desktop samples: <strong>{coverage.desktopSamples}</strong></p>
      <p>Mobile samples: <strong>{coverage.mobileSamples}</strong></p>
      <p>DOM animations: <strong>{coverage.maximumObservedAnimations}</strong> (peak)</p>
    </div>
    <p className="text-cyan-100/70">HTML report: {analysis ? 'available' : 'unavailable'} · Rendered scan: {coverage.renderedScan}</p>
    {samples.length > 0 && !coverage.visibleRegionsDetected && <p className="mt-2 text-amber-100">Few structural regions were detected. The site may still be loading or use a canvas-based interface.</p>}
    <ul className="mt-3 list-disc space-y-1 pl-5 text-cyan-100/60">{limitations.map(item => <li key={item}>{item}</li>)}</ul>
  </section>;
}
