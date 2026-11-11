import { apiFetch } from '../services/apiClient';
import React, { useState } from 'react';
type Entry = { id: string; objective: string; status: string };
export function ResearchReports({ researchId }: { researchId?: string }) {
  const [history, setHistory] = useState<Entry[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  async function download(id: string) {
    if (!valid(id) || busy) return;
    setBusy(true); setMessage('Preparing private PDF…');
    try {
      const response = await apiFetch(`/api/research/v1/${id}/pdf`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw Error();
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = url; a.download = `research-${id}.pdf`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage('PDF downloaded locally. This action does not upload it.');
    } catch { setMessage('PDF export failed. The saved research record is unchanged.'); }
    finally { setBusy(false); }
  }
  async function loadHistory() {
    setMessage('');
    try { const response = await apiFetch('/api/research/v1'); const data = await response.json(); if (!response.ok || !data.ok || !Array.isArray(data.research)) throw Error(); setHistory(data.research.filter((r: Entry) => typeof r.id === 'string' && valid(r.id))); }
    catch { setMessage('Research history is unavailable.'); }
  }
  return <div className="mt-3 border border-cyan-900 p-3 text-xs text-cyan-100">
    <div className="flex gap-4">{researchId && valid(researchId) && <button disabled={busy} onClick={() => download(researchId)}>Download PDF</button>}<button onClick={loadHistory}>Research history / PDF exports</button></div>
    {history && <ul className="mt-3 space-y-3">{history.length === 0 && <li>No saved research.</li>}{history.map(r => <li key={r.id}><span>{r.objective} — {r.status}</span><button className="ml-3 underline" disabled={busy} onClick={() => download(r.id)}>Download PDF</button></li>)}</ul>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </div>;
}
