export type ScanEvent = { stage: string; message: string; url?: string; embeddingRestricted?: boolean };

export function WebsiteScanView({ events, busy, failed }: { events: ScanEvent[]; busy: boolean; failed: boolean }) {
  const page = events.find(event => event.stage === 'page');
  return <section className="mt-4 overflow-hidden rounded border border-cyan-300/30 bg-slate-950" aria-label="Live website scan">
    <style>{`@keyframes fridayScanSweep { from { top: 0; } to { top: 100%; } } .friday-scan-sweep { animation: fridayScanSweep 2.8s linear infinite; } @media (prefers-reduced-motion: reduce) { .friday-scan-sweep { animation: none; top: 50%; } }`}</style>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-300/20 p-3">
      <strong className="text-cyan-200">{busy ? 'SCANNING' : failed ? 'SCAN STOPPED' : 'SCAN COMPLETE'}</strong>
      {page?.url && <a className="text-cyan-100 underline" href={page.url} target="_blank" rel="noopener noreferrer">Open exact website ↗</a>}
    </div>
    <div className="relative min-h-48 overflow-hidden bg-cyan-950/20">
      {page?.url && !page.embeddingRestricted
        ? <iframe title="Reference website live preview" src={page.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-96 w-full border-0 bg-white" />
        : <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center text-cyan-100/75">
          <span className="text-4xl" aria-hidden="true">◎</span>
          <span>{page?.embeddingRestricted ? 'This website blocks embedded previews. Use “Open exact website” to view it in your browser.' : 'Connecting to the reference website…'}</span>
        </div>}
      {busy && <div aria-hidden="true" className="friday-scan-sweep pointer-events-none absolute left-0 right-0 h-10 border-t border-cyan-200 bg-gradient-to-b from-cyan-300/30 to-transparent" />}
    </div>
    <p className="border-t border-cyan-300/20 px-3 pt-3 text-cyan-100/60">This preview shows activity, not analysis progress. HTML findings and separate desktop/mobile measurements appear below. Some sites may not work in the restricted preview.</p>
    <ol aria-live="polite" aria-relevant="additions" className="space-y-2 p-3 text-cyan-100/85">
      {events.map((event, index) => <li key={index} className="flex gap-3"><span className="text-cyan-300/50">{String(index + 1).padStart(2, '0')}</span><span>{event.message}</span></li>)}
    </ol>
  </section>;
}
