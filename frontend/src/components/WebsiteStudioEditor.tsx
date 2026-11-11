import { apiFetch, apiUrl } from '../services/apiClient';
import { useEffect, useState } from 'react';

const ROOT = '/api/reverse-engineering/v1/website-studio/projects';
type FileData = { content: string; hash: string };
type Project = { id: string; projectName: string; projectPath: string; files: Record<string, FileData>; previewUrl: string; generation: string; warning?: string; history: { id: string; label: string; createdAt: string; revision: number }[] };
async function api(path: string, options?: RequestInit) {
  const response = await apiFetch(ROOT + path, { ...options, headers: { 'Content-Type': 'application/json' } });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Website Studio request failed.');
  return result;
}
export function WebsiteStudioEditor({ createdId }: { createdId?: string }) {
  const [projects, setProjects] = useState<{ id: string; projectName: string }[]>([]);
  const [id, setId] = useState(createdId || '');
  const [project, setProject] = useState<Project | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [file, setFile] = useState('index.html');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [reload, setReload] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [consent, setConsent] = useState(false);
  const [proposal, setProposal] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  useEffect(() => { let active = true; void api('').then(data => { if (active) setProjects(data.projects); }).catch(error => { if (active) setMessage(error.message); }); if (createdId) setId(createdId); return () => { active = false; }; }, [createdId]);
  useEffect(() => {
    if (!id) { setProject(null); setDrafts({}); return; }
    let active = true; setBusy(true); setProject(null); setProposal(false); setConsent(false); setSnapshot(''); setMessage('Loading project…');
    void api(`/${id}`).then(data => {
      if (!active) return;
      setProject(data.project); setDrafts(Object.fromEntries(Object.entries(data.project.files as Record<string, FileData>).map(([name, value]) => [name, value.content]))); setMessage('Project ready. Edit a file, save, then inspect the refreshed preview.');
    }).catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [id, reload]);
  const dirty = project && Object.keys(drafts).some(name => drafts[name] !== project.files[name]?.content);
  const hashes = () => Object.fromEntries(Object.entries(project?.files || {} as Record<string, FileData>).map(([name, value]: [string, FileData]) => [name, value.hash]));
  async function propose() {
    if (!project || dirty || !consent) return;
    setBusy(true); setMessage('Preparing an AI draft. Saved files stay unchanged until you apply it.');
    try {
      const result = await api(`/${project.id}/propose-edit`, { method: 'POST', body: JSON.stringify({ instruction, expectedHashes: hashes(), confirmed: consent }) });
      setDrafts(result.files); setProposal(true);
      setMessage(`Draft ready. Changed: ${result.changedFiles.join(', ') || 'no files'}. Review the draft preview and source before applying.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI edit failed; saved files unchanged.'); }
    finally { setBusy(false); }
  }
  async function apply(restoreId?: string) {
    if (!project) return;
    if (restoreId && !window.confirm('Restore this snapshot? Your current saved sources will be backed up first.')) return;
    setBusy(true);
    try {
      await api(`/${project.id}/sources`, { method: 'PUT', body: JSON.stringify({ expectedHashes: hashes(), ...(restoreId ? { restoreId } : { files: drafts }) }) });
      setProposal(false); setVersion(value => value + 1); setReload(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not apply changes.'); }
    finally { setBusy(false); }
  }
  // Inline local assets only for the isolated draft preview. Saved preview stays untouched.
  const draftPreview = proposal ? (drafts['index.html'] || '')
    .replace(/<link\b[^>]*href\s*=\s*["'](?:\.\/)?styles\.css["'][^>]*>/gi, () => `<style>${(drafts['styles.css'] || '').replace(/<\/style/gi, '<\\/style')}</style>`)
    .replace(/<script\b[^>]*src\s*=\s*["'](?:\.\/)?app\.js["'][^>]*>\s*<\/script>/gi, () => `<script>${(drafts['app.js'] || '').replace(/<\/script/gi, '<\\/script')}</script>`) : '';
  async function save() {
    if (!project) return;
    setBusy(true); setMessage('Saving…');
    try {
      const result = await api(`/${project.id}/file`, { method: 'PUT', body: JSON.stringify({ name: file, content: drafts[file], expectedHash: project.files[file].hash }) });
      const refreshed = await api(`/${project.id}`);
      setProject(refreshed.project);
      setVersion(v => v + 1); setMessage('Saved. Previous version backed up; preview refreshed. Refresh Opera GX to see the change there.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  async function open() {
    if (!project) return;
    try {
      if (window.fridayDesktop?.openStudioProject) { const result = await window.fridayDesktop.openStudioProject(project.id, false); setMessage(`Opened in ${result.browser}.`); }
      else window.open(project.previewUrl, '_blank', 'noopener,noreferrer');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Preview could not open.'); }
  }
  async function openInCode() {
    if (!project) return;
    if (dirty) { setMessage('Save your edited files before opening this project in VS Code.'); return; }
    if (!window.fridayDesktop?.openStudioInCode) { setMessage(`Open this folder in VS Code: ${project.projectPath}. Restart the updated FRIDAY desktop app to enable the button.`); return; }
    setBusy(true);
    try {
      await window.fridayDesktop.openStudioInCode(project.id);
      setMessage('Opened the finished project and handoff brief in VS Code. Open the Codex sidebar to request further changes. After saving there, use Reload saved files here.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not open VS Code.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 rounded border border-cyan-300/25 bg-slate-950/80 p-4">
    <h3 className="text-cyan-200">Your websites · edit inside FRIDAY</h3>
    <label className="mt-3 grid gap-2">Saved project<select value={id} disabled={busy} className="rounded border border-cyan-300/25 bg-slate-950 p-2" onChange={event => { if (dirty && !window.confirm('Discard unsaved source edits and switch projects?')) return; setId(event.target.value); }}><option value="">Choose a project</option>{projects.map(item => <option key={item.id} value={item.id}>{item.projectName}</option>)}</select></label>
    {project && <>
      <p className="mt-3 break-all text-cyan-100/60">{project.projectPath} · {project.generation}</p>
      {project.warning && <p className="mt-2 text-amber-100">{project.warning}</p>}
      <div className="mt-3 rounded border border-emerald-300/25 bg-emerald-300/5 p-3"><strong className="text-emerald-100">Your website is ready to review</strong><p className="mt-1 text-cyan-100/70">Review it in Opera GX or the preview below. When you want further changes, open the finished project in VS Code with its Codex handoff brief.</p><button type="button" disabled={busy || Boolean(dirty)} onClick={() => void openInCode()} className="mt-3 rounded border border-emerald-300/35 px-3 py-2 text-emerald-100 disabled:opacity-40">Open in VS Code / Codex</button>{dirty && <p className="mt-2 text-amber-100">Save your edits first so VS Code opens the latest version.</p>}</div>
      <div className="my-3 flex flex-wrap gap-2"><button onClick={() => void open()} className="rounded border border-cyan-300/30 px-3 py-2">Open in Opera GX</button><a href={apiUrl(`${ROOT}/${project.id}/export`)} className="rounded border border-cyan-300/30 px-3 py-2">Download source ZIP</a></div>
      <div className="my-4 grid gap-3 rounded border border-purple-300/30 p-3">
        <h4 className="text-purple-100">Describe a website change</h4>
        <textarea aria-label="Website change request" maxLength={4000} disabled={busy} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Make it a premium coffee shop, add subtle animations, and improve the mobile menu." className="min-h-24 rounded bg-black/60 p-3" />
        <label className="text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> Send these three source files and my request to FRIDAY’s configured AI providers. Provider credits may be used; remove secrets first.</label>
        <button disabled={busy || Boolean(dirty) || !consent || instruction.trim().length < 3} onClick={() => void propose()} className="rounded border border-purple-300/40 p-2 disabled:opacity-40">Generate edit draft</button>
        {proposal && <><p>Draft only — your saved website is unchanged. Preview below, inspect the source, then apply or discard.</p><div className="flex gap-2"><button disabled={busy || !dirty} onClick={() => void apply()} className="rounded border border-emerald-300/40 p-2 disabled:opacity-40">Apply all draft files</button><button disabled={busy} onClick={() => { setDrafts(Object.fromEntries(Object.entries(project.files).map(([name, value]: [string, FileData]) => [name, value.content]))); setProposal(false); }} className="rounded border border-cyan-300/40 p-2">Discard draft</button></div></>}
      </div>
      <div className="my-3 flex flex-wrap gap-2"><select aria-label="Restore point" value={snapshot} disabled={busy || Boolean(dirty)} onChange={event => setSnapshot(event.target.value)} className="rounded bg-slate-950 p-2"><option value="">Choose a restore point</option>{(project.history || []).map(item => <option key={item.id} value={item.id}>Revision {item.revision} · {item.label} · {new Date(item.createdAt).toLocaleString()}</option>)}</select><button disabled={busy || Boolean(dirty) || !snapshot} onClick={() => void apply(snapshot)} className="rounded border border-amber-300/40 p-2 disabled:opacity-40">Restore snapshot</button></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Source file">{Object.keys(project.files).map(name => <button key={name} aria-pressed={name === file} onClick={() => setFile(name)} className={`rounded px-3 py-2 ${file === name ? 'bg-cyan-300/20' : 'bg-black/30'}`}>{name}{drafts[name] !== project.files[name].content ? ' *' : ''}</button>)}</div>
      <label className="mt-3 grid gap-2">Edit {file}<textarea spellCheck={false} value={drafts[file] || ''} onChange={event => setDrafts(previous => ({ ...previous, [file]: event.target.value }))} disabled={busy} className="h-80 w-full rounded border border-cyan-300/25 bg-black/70 p-3 font-mono text-xs leading-5 text-cyan-50" /></label>
      <button disabled={busy || proposal || drafts[file] === project.files[file]?.content} onClick={() => void save()} className="mt-3 rounded border border-emerald-300/30 px-3 py-2 text-emerald-100 disabled:opacity-40">Save file & refresh preview</button>
      <button type="button" disabled={busy} onClick={() => { if (dirty && !window.confirm('Discard unsaved edits and reload the saved files?')) return; setReload(value => value + 1); setVersion(value => value + 1); }} className="ml-2 mt-3 rounded border border-cyan-300/30 px-3 py-2">Reload saved files</button>
      {proposal ? <iframe title="Unsaved AI draft preview" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">${draftPreview}`} sandbox="allow-scripts" referrerPolicy="no-referrer" className="mt-4 h-[540px] w-full rounded border border-purple-300/40 bg-white" /> : <iframe key={`${project.id}-${version}`} title="Your generated website preview" src={`${project.previewUrl}?v=${version}`} sandbox="allow-scripts allow-modals allow-downloads" referrerPolicy="no-referrer" className="mt-4 h-[540px] w-full rounded border border-cyan-300/20 bg-white" />}
    </>}
    <p role="status" className="mt-3 text-cyan-100/70">{message}</p>
  </section>;
}
