import { apiFetch, apiUrl } from '../services/apiClient';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, LoaderCircle, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { WebsiteScanView, type ScanEvent } from './WebsiteScanView';
import { WebsiteStudioEditor } from './WebsiteStudioEditor';
import { WebsiteScanSummary } from './WebsiteScanSummary';

const API_ROOT = '/api/reverse-engineering/v1';
const UI_MAX_FILE_BYTES = 8 * 1024 * 1024;

type Profile = {
  id: string;
  label: string;
  description: string;
  available: boolean;
};

type Capability = {
  id: string;
  label: string;
  domain: string;
  status: string;
  detail: string;
};

type Tool = {
  id: string;
  label: string;
  detected: boolean;
  version: string | null;
  availableForJobs: boolean;
  reason: string;
};

type Capabilities = {
  checkedAt: string;
  profiles: Profile[];
  capabilities: Capability[];
  externalTools: Tool[];
  isolation: {
    workerProcess?: boolean;
    vmOrContainer?: boolean;
  };
  limitations: string[];
};

type Artifact = {
  artifactId: string;
  sha256: string;
  originalFilename: string;
  size: number;
  detectedFormat?: { id?: string; description?: string; confidence?: string };
};

type Finding = {
  findingId: string;
  classification?: string;
  severity?: string;
  confidence?: string;
  domain?: string;
  findingType?: string;
  description?: string;
  evidence?: unknown;
  limitations?: string[];
};

type Job = {
  jobId: string;
  artifactId: string;
  profile: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: { message?: string } | null;
  result?: {
    directFacts?: Finding[];
    toolFindings?: Finding[];
    hypotheses?: Finding[];
    confirmedConclusions?: Finding[];
    unknowns?: Finding[];
    limitations?: string[];
  } | null;
};

type WebsiteAnalysis = {
  analyzedAt: string;
  directlyObservedFacts: {
    requestedUrl: string;
    finalUrl: string;
    status: number;
    title: string | null;
    headers: Record<string, string>;
    domCounts: Record<string, number>;
    forms: { method: string; action: string; inputCount?: number; selectCount?: number; textareaCount?: number }[];
    sameOriginAssets: string[];
    sameOriginLinks: string[];
  };
  toolReportedFindings: {
    frameworkSignals: { name: string; confidence: string; evidence: string }[];
    clientBehaviorSignals: { inlineEventHandlers: number; sourceMapReferences: number; apiLikeReferences: string[] };
  };
  hypotheses: { description: string }[];
  unknownsAndLimitations: string[];
};

type StudioProject = {
  id: string;
  previewUrl: string;
  generation: string;
  warning?: string;
  projectName: string;
  projectPath: string;
  files: string[];
  nextSteps: string[];
  sourcePolicy: string;
};

type ApiResponse<T> = T & { ok?: boolean; error?: string; code?: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function evidencePreview(evidence: unknown) {
  try {
    const text = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
    return text.length > 680 ? `${text.slice(0, 680)}…` : text;
  } catch {
    return 'Evidence is present but could not be formatted in the browser.';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const response = await apiFetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !body?.ok) {
    if (response.status === 404 && !body) {
      throw new Error('This FRIDAY desktop window is connected to an older local server that does not include Website Analysis. Close FRIDAY completely, then launch it again from start-friday-desktop.ps1.');
    }
    throw new Error(body?.error || response.statusText || 'Reverse Engineering API request failed.');
  }
  return body;
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('The selected file could not be encoded safely.'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

type FindingGroupKey = 'directFacts' | 'toolFindings' | 'hypotheses' | 'confirmedConclusions' | 'unknowns';

const findingGroups: { key: FindingGroupKey; label: string; accent: string }[] = [
  { key: 'directFacts', label: 'Directly observed facts', accent: 'text-cyan-200' },
  { key: 'toolFindings', label: 'Tool-reported findings', accent: 'text-emerald-200' },
  { key: 'hypotheses', label: 'Hypotheses', accent: 'text-amber-200' },
  { key: 'confirmedConclusions', label: 'Confirmed conclusions', accent: 'text-violet-200' },
  { key: 'unknowns', label: 'Unknowns / incomplete', accent: 'text-rose-200' },
];

export function ReverseEngineeringWorkspace() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [profile, setProfile] = useState('static-triage');
  const [scope, setScope] = useState('I own or am explicitly authorized to analyze this local artifact.');
  const [purpose, setPurpose] = useState('Authorized offline static analysis');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteAnalysis, setWebsiteAnalysis] = useState<WebsiteAnalysis | null>(null);
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
  const [scanFailed, setScanFailed] = useState(false);
  const [deepScan, setDeepScan] = useState(true);
  const [renderedScan, setRenderedScan] = useState<Awaited<ReturnType<NonNullable<NonNullable<Window['fridayDesktop']>['scanWebsite']>>> | null>(null);
  const [studioProjectName, setStudioProjectName] = useState('my-inspired-site');
  const [studioBrandName, setStudioBrandName] = useState('');
  const [studioBrief, setStudioBrief] = useState('Modern, clear, premium, and easy to navigate.');
  const [originalDesignConfirmed, setOriginalDesignConfirmed] = useState(false);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioProject, setStudioProject] = useState<StudioProject | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState('Capability registry loading…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshCapabilities = useCallback(async (refresh = false) => {
    try {
      const result = await request<{ capabilities: Capabilities }>(`/capabilities${refresh ? '?refresh=true' : ''}`, { method: 'GET' });
      setCapabilities(result.capabilities);
      setStatus('Capability registry ready.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Capability registry failed to load.');
      setStatus('Capability registry unavailable.');
    }
  }, []);

  useEffect(() => { void refreshCapabilities(); }, [refreshCapabilities]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    const interval = window.setInterval(() => {
      void request<{ job: Job }>(`/jobs/${job.jobId}`, { method: 'GET' })
        .then(result => {
          setJob(result.job);
          setStatus(`Job ${result.job.status}.`);
          if (result.job.status === 'completed') setError('');
        })
        .catch(pollError => setError(pollError instanceof Error ? pollError.message : 'Could not refresh job status.'));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [job?.jobId, job?.status]);

  const selectedProfile = useMemo(() => capabilities?.profiles.find(item => item.id === profile), [capabilities, profile]);
  const isActive = Boolean(job && ['queued', 'running'].includes(job.status));

  const runAnalysis = async () => {
    setError('');
    if (!selectedFile) {
      setError('Choose a local file first.');
      return;
    }
    if (selectedFile.size <= 0 || selectedFile.size > UI_MAX_FILE_BYTES) {
      setError(`This first release accepts files from 1 byte through ${formatBytes(UI_MAX_FILE_BYTES)}.`);
      return;
    }
    if (!authorized || scope.trim().length < 8) {
      setError('Confirm your authorization and describe the approved scope before analysis.');
      return;
    }
    setBusy(true);
    setStatus('Encoding local artifact…');
    try {
      const contentBase64 = await toBase64(selectedFile);
      setStatus('Ingesting evidence copy…');
      const authorization = { confirmed: true, scope: scope.trim(), purpose: purpose.trim() };
      const ingestion = await request<{ artifact: Artifact }>('/artifacts', {
        method: 'POST',
        body: JSON.stringify({ fileName: selectedFile.name, contentBase64, authorization }),
      });
      setArtifact(ingestion.artifact);
      setStatus('Queueing bounded static analysis…');
      const submission = await request<{ job: Job }>('/jobs', {
        method: 'POST',
        body: JSON.stringify({ artifactId: ingestion.artifact.artifactId, profile, authorization }),
      });
      setJob(submission.job);
      setStatus('Job queued. FRIDAY will not execute the uploaded artifact.');
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'The analysis request failed.');
      setStatus('Analysis not started.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setError('');
    try {
      const result = await request<{ job: Job }>(`/jobs/${job.jobId}/cancel`, { method: 'POST', body: '{}' });
      setJob(result.job);
      setStatus('Cancellation requested.');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Cancellation request failed.');
    }
  };

  const analyzeWebsite = async () => {
    setError('');
    if (!websiteUrl.trim()) {
      setError('Enter the public website URL you are authorized to analyze.');
      return;
    }
    if (!authorized || scope.trim().length < 8) {
      setError('Confirm your authorization and describe the approved scope before website analysis.');
      return;
    }
    setWebsiteBusy(true);
    setWebsiteAnalysis(null);
    setRenderedScan(null);
    setScanFailed(false);
    setScanEvents([{ stage: 'start', message: 'Analysis requested. Waiting for the server…' }]);
    setStatus('Inspecting the authorized public page…');
    try {
      const authorization = { confirmed: true, scope: scope.trim(), purpose: purpose.trim() || 'Authorized read-only website analysis' };
      if (deepScan && window.fridayDesktop?.scanWebsite) {
        setScanEvents(previous => [...previous, { stage: 'browser', message: 'Live scan window opened. Inspecting desktop and mobile viewports, layout, fonts, and resources…' }]);
        const rendered = await window.fridayDesktop.scanWebsite(websiteUrl.trim());
        setRenderedScan(rendered);
        if (rendered.cancelled) throw new Error('Deep scan stopped. You can start a new scan when ready.');
        setScanEvents(previous => [...previous, { stage: 'browser', message: rendered.ok ? `Rendered scan complete: ${rendered.snapshots.length} viewport samples. Collecting HTML report…` : `Rendered scan could not finish: ${rendered.error}. Trying HTML observation…` }]);
      } else if (deepScan) {
        setScanEvents(previous => [...previous, { stage: 'browser', message: 'Deep scan requires the updated FRIDAY desktop app. This session will use HTML analysis.' }]);
      }
      const response = await apiFetch(`${API_ROOT}/websites/analyze/stream`, {
        method: 'POST',
        signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteUrl.trim(), authorization }),
      });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error || `Live scan unavailable (HTTP ${response.status}). Restart the FRIDAY server to load the updated scanner.`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let completed = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          if (done && pending.trim()) pending += '\n';
          const lines = pending.split('\n');
          pending = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.error || 'Website analysis failed.');
            if (event.type === 'progress') setScanEvents(previous => [...previous, event]);
            if (event.type === 'result') {
              setWebsiteAnalysis(event.analysis);
              setScanEvents(previous => [...previous, { stage: 'complete', message: 'Report ready below. Build an editable starter when you choose.' }]);
              completed = true;
            }
          }
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!completed) throw new Error('The scan connection ended before the report arrived. Please retry.');
      setStatus('Read-only website observation completed.');
    } catch (websiteError) {
      setScanFailed(true);
      setScanEvents(previous => [...previous, { stage: 'error', message: websiteError instanceof Error ? websiteError.message : 'Scan failed.' }]);
      setError(websiteError instanceof Error ? websiteError.message : 'Website analysis failed.');
      setStatus('Website analysis not completed.');
    } finally {
      setWebsiteBusy(false);
    }
  };

  const buildWebsiteStarter = async () => {
    setError('');
    if (!websiteUrl.trim()) {
      setError('Enter a public reference website URL before building a starter project.');
      return;
    }
    if (!authorized || scope.trim().length < 8 || !originalDesignConfirmed) {
      setError('Confirm authorized reference use and original-design generation before building a project.');
      return;
    }
    setStudioBusy(true);
    setStatus('Observing the public reference and generating an original editable starter…');
    try {
      const authorization = { confirmed: true, scope: scope.trim(), purpose: purpose.trim() || 'Authorized public design-reference analysis' };
      let scanForBuild = renderedScan?.requestedUrl === websiteUrl.trim() ? renderedScan : null;
      if (deepScan && !scanForBuild?.ok && window.fridayDesktop?.scanWebsite) {
        setStatus('Scanning desktop and mobile layouts before building…');
        scanForBuild = await window.fridayDesktop.scanWebsite(websiteUrl.trim());
        setRenderedScan(scanForBuild);
        if (!scanForBuild.ok) throw new Error(scanForBuild.error || 'Scan stopped. Website build was not started.');
      }
      setStatus('Generating website files from the reference and your preferences. This can take a few minutes…');
      const result = await request<{ project: StudioProject; referenceObservation: WebsiteAnalysis }>('/website-studio/projects', {
        method: 'POST',
        body: JSON.stringify({
          url: websiteUrl.trim(), authorization, projectName: studioProjectName, brandName: studioBrandName,
          styleBrief: studioBrief, originalDesignConfirmation: true,
          renderedScan: scanForBuild?.ok ? { url: scanForBuild.requestedUrl || websiteUrl.trim(), snapshots: scanForBuild.snapshots.map(sample => ({ ...sample, resources: undefined })) } : undefined,
        }),
      });
      setStudioProject(result.project);
      setWebsiteAnalysis(result.referenceObservation);
      setStatus('Website created. Opening preview and exporting source…');
      try {
        if (window.fridayDesktop?.openStudioProject) {
          const opened = await window.fridayDesktop.openStudioProject(result.project.id, true);
          setStatus(`Opened in ${opened.browser}. Source ZIP saved: ${opened.downloadPath}`);
        } else {
          window.open(result.project.previewUrl, '_blank', 'noopener,noreferrer');
          const download = document.createElement('a'); download.href = apiUrl(`${API_ROOT}/website-studio/projects/${result.project.id}/export`); download.download = ''; download.click();
          setStatus('Project created. Use the editor below to open the preview if your browser blocked the new tab.');
        }
      } catch (openError) { setStatus(`Project created successfully. ${openError instanceof Error ? openError.message : 'Use the editor buttons below to open and download it.'}`); }
    } catch (studioError) {
      setError(studioError instanceof Error ? studioError.message : 'Website starter generation failed.');
      setStatus('Website starter was not created.');
    } finally {
      setStudioBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded border border-cyan-300/25 bg-slate-950/70 p-4 text-left font-mono text-xs text-cyan-50 shadow-[0_0_32px_rgba(34,211,238,0.08)]">
      <div className="flex flex-col gap-3 border-b border-cyan-300/15 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-200"><FileSearch size={16} /> Evidence-first local workbench</div>
          <p className="mt-2 max-w-3xl leading-5 text-cyan-100/70">
            Static, offline analysis only. FRIDAY stores a dedicated evidence copy, never executes the selected file, and labels observed facts separately from inferences.
          </p>
        </div>
        <button type="button" onClick={() => void refreshCapabilities(true)} className="inline-flex items-center gap-2 rounded border border-cyan-300/25 px-3 py-2 text-cyan-100 hover:bg-cyan-300/10" disabled={busy}>
          <RefreshCw size={14} /> Refresh tools
        </button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 rounded border border-cyan-300/15 bg-black/25 p-3 md:grid-cols-2">
            <label className="grid gap-2 text-cyan-100/80">
              Artifact (local file, max {formatBytes(UI_MAX_FILE_BYTES)})
              <input type="file" onChange={event => {
                setSelectedFile(event.target.files?.[0] || null);
                setArtifact(null);
                setJob(null);
                setError('');
              }} className="block w-full text-xs text-cyan-100 file:mr-3 file:rounded file:border-0 file:bg-cyan-300/15 file:px-3 file:py-2 file:text-cyan-100" disabled={busy || isActive} />
              {selectedFile && <span className="text-cyan-100/55">{selectedFile.name} · {formatBytes(selectedFile.size)}</span>}
            </label>
            <label className="grid gap-2 text-cyan-100/80">
              Analysis profile
              <select value={profile} onChange={event => setProfile(event.target.value)} className="rounded border border-cyan-300/25 bg-slate-950 px-3 py-2 text-cyan-50" disabled={busy || isActive}>
                {(capabilities?.profiles || [{ id: 'static-triage', label: 'Static file triage', available: true }]).map(item => (
                  <option key={item.id} value={item.id} disabled={!item.available}>{item.label}</option>
                ))}
              </select>
              <span className="min-h-8 text-cyan-100/55">{selectedProfile?.description || 'Bounded offline file identification.'}</span>
            </label>
          </div>

          <div className="grid gap-3 rounded border border-amber-300/20 bg-amber-300/[0.035] p-3">
            <label className="flex items-start gap-3 text-amber-100/90">
              <input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} className="mt-0.5 accent-cyan-300" disabled={busy || isActive} />
              <span>I confirm I own this artifact or have explicit authorization to analyze it within the scope below.</span>
            </label>
            <label className="grid gap-2 text-cyan-100/80">Approved scope
              <input value={scope} onChange={event => setScope(event.target.value)} className="rounded border border-cyan-300/25 bg-slate-950 px-3 py-2 text-cyan-50" maxLength={500} disabled={busy || isActive} />
            </label>
            <label className="grid gap-2 text-cyan-100/80">Purpose (optional)
              <input value={purpose} onChange={event => setPurpose(event.target.value)} className="rounded border border-cyan-300/25 bg-slate-950 px-3 py-2 text-cyan-50" maxLength={500} disabled={busy || isActive} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void runAnalysis()} disabled={busy || isActive} className="inline-flex items-center gap-2 rounded border border-emerald-300/35 bg-emerald-300/10 px-4 py-2 text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Ingest & analyze
              </button>
              {isActive && <button type="button" onClick={() => void cancel()} className="inline-flex items-center gap-2 rounded border border-rose-300/35 px-4 py-2 text-rose-100"><XCircle size={14} /> Cancel job</button>}
              <span className="text-cyan-100/65">{status}</span>
            </div>
          </div>

          <div className="rounded border border-violet-300/20 bg-violet-300/[0.035] p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="grid flex-1 gap-2 text-violet-100/85">Authorized public website URL
                <input value={websiteUrl} onChange={event => { setWebsiteUrl(event.target.value); setWebsiteAnalysis(null); setRenderedScan(null); }} placeholder="https://your-site.example" className="rounded border border-violet-300/25 bg-slate-950 px-3 py-2 text-cyan-50" disabled={websiteBusy || studioBusy} />
              </label>
              <button type="button" onClick={() => void analyzeWebsite()} disabled={websiteBusy || studioBusy} className="inline-flex items-center justify-center gap-2 rounded border border-violet-300/35 bg-violet-300/10 px-4 py-2 text-violet-100 disabled:opacity-50">
                {websiteBusy ? <LoaderCircle size={14} className="animate-spin" /> : <FileSearch size={14} />} Analyze website
              </button>
            </div>
            <p className="mt-2 leading-5 text-violet-100/60">Analyze one public page. Deep scan opens a fresh browser session to measure rendered blocks, styles, and loaded resources; HTML analysis collects headers and references. No sign-in or private-network access.</p>
            <label className="mt-3 flex items-start gap-2 text-cyan-100"><input type="checkbox" checked={deepScan} onChange={event => setDeepScan(event.target.checked)} disabled={websiteBusy} /><span>Deep live scan: six desktop and three mobile samples, with rendered blocks, style measurements, headings and controls. These observations feed the website builder.</span></label>
          </div>

          {scanEvents.length > 0 && <WebsiteScanView events={scanEvents} busy={websiteBusy} failed={scanFailed} />}
          {!websiteBusy && (websiteAnalysis || renderedScan?.snapshots.length) ? <WebsiteScanSummary url={websiteUrl} scan={renderedScan} analysis={websiteAnalysis} /> : null}
          {renderedScan && renderedScan.snapshots.length > 0 && <section className="rounded border border-cyan-300/25 bg-slate-950 p-4"><h3 className="text-cyan-200">Rendered page observations</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{renderedScan.snapshots.map((sample, index) => <article key={index} className="rounded border border-cyan-300/15 p-3"><strong>Viewport {index + 1} · {sample.blocks.length} visible blocks</strong><p className="mt-2 text-cyan-100/70">{sample.blocks.slice(0, 8).map(block => `${block.tag} (${block.layout}, ${block.width} × ${block.height})`).join(' · ') || 'No semantic blocks detected.'}</p><p className="mt-2 text-cyan-100/70">Fonts: {sample.fonts.join(', ')}</p><p className="mt-2 text-cyan-100/70">{sample.technology.join(' · ') || 'No conclusive framework markers.'}</p><p className="mt-2 text-cyan-100/60">{sample.resources.length} resource entries observed.</p></article>)}</div><p className="mt-3 text-cyan-100/60">These are rendered HTML regions and measured styles, not recovered React components or backend source.</p></section>}

          <section className="rounded border border-emerald-300/20 bg-emerald-300/[0.035] p-3">
            <div className="flex items-center gap-2 text-emerald-100"><ShieldCheck size={14} /> Website Studio — build, preview & edit</div>
            <p className="mt-2 leading-5 text-emerald-100/65">Builds a runnable HTML/CSS/JavaScript website from the scan and your preferences using FRIDAY's configured AI provider. Opens in Opera GX, saves editable source in Downloads, and enables editing below. If AI generation fails, the result is explicitly labeled as an adaptive template.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-cyan-100/80">Project folder name
                <input value={studioProjectName} onChange={event => setStudioProjectName(event.target.value)} className="rounded border border-emerald-300/25 bg-slate-950 px-3 py-2 text-cyan-50" maxLength={80} disabled={studioBusy} />
              </label>
              <label className="grid gap-2 text-cyan-100/80">Your site / brand name
                <input value={studioBrandName} onChange={event => setStudioBrandName(event.target.value)} placeholder="My New Site" className="rounded border border-emerald-300/25 bg-slate-950 px-3 py-2 text-cyan-50" maxLength={100} disabled={studioBusy} />
              </label>
              <label className="grid gap-2 text-cyan-100/80 md:col-span-2">Direction for the original design
                <textarea value={studioBrief} onChange={event => setStudioBrief(event.target.value)} className="min-h-28 rounded border border-emerald-300/25 bg-slate-950 px-3 py-2 text-cyan-50" maxLength={4000} placeholder="Keep the reference layout and motion. Use my brand, purple accents, a project gallery, and a working filter…" disabled={studioBusy} />
              </label>
            </div>
            <label className="mt-3 flex items-start gap-3 text-emerald-100/85"><input type="checkbox" checked={originalDesignConfirmed} onChange={event => setOriginalDesignConfirmed(event.target.checked)} className="mt-0.5 accent-emerald-300" disabled={studioBusy} /><span>Create an original site inspired only by high-level public cues; do not copy the reference brand, text, images, protected assets, source code, or private functionality.</span></label>
            <button type="button" onClick={() => void buildWebsiteStarter()} disabled={studioBusy || websiteBusy} className="mt-3 inline-flex items-center gap-2 rounded border border-emerald-300/35 bg-emerald-300/10 px-4 py-2 text-emerald-100 disabled:opacity-50">{studioBusy ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {studioBusy ? 'Building website…' : 'Create website · open & download'}</button>
            {studioProject && <div className="mt-3 rounded border border-emerald-300/20 bg-black/25 p-3 text-emerald-100/80"><strong>Created: </strong><code className="break-all">{studioProject.projectPath}</code><p className="mt-2">{studioProject.nextSteps.join(' ')}</p></div>}
          </section>

          <WebsiteStudioEditor createdId={studioProject?.id} />

          {error && <div className="flex gap-2 rounded border border-rose-300/30 bg-rose-300/10 p-3 text-rose-100"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}

          {artifact && (
            <div className="rounded border border-cyan-300/15 bg-black/25 p-3 leading-5">
              <strong className="text-cyan-200">Artifact evidence</strong>
              <div className="mt-2 grid gap-1 text-cyan-100/70">
                <span>ID: <code>{artifact.artifactId}</code></span>
                <span>SHA-256: <code className="break-all">{artifact.sha256}</code></span>
                <span>Detected: {artifact.detectedFormat?.description || 'pending'} ({artifact.detectedFormat?.confidence || 'unknown'} confidence)</span>
              </div>
            </div>
          )}

          {websiteAnalysis && (
            <section className="rounded border border-violet-300/20 bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-violet-200">Authorized website observation</strong><span className="text-violet-100/60">HTTP {websiteAnalysis.directlyObservedFacts.status}</span></div>
              <div className="mt-3 grid gap-2 text-cyan-100/70 md:grid-cols-2">
                <span>Title: {websiteAnalysis.directlyObservedFacts.title || 'not observed'}</span>
                <span>Final URL: <code className="break-all">{websiteAnalysis.directlyObservedFacts.finalUrl}</code></span>
                {Object.entries(websiteAnalysis.directlyObservedFacts.domCounts).map(([name, value]) => <span key={name}>{name}: {value}</span>)}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div><strong className="text-violet-100">Technology signals</strong><div className="mt-2 space-y-1 text-cyan-100/65">{websiteAnalysis.toolReportedFindings.frameworkSignals.length ? websiteAnalysis.toolReportedFindings.frameworkSignals.map(signal => <p key={signal.name}>{signal.name} · {signal.confidence} confidence — {signal.evidence}</p>) : <p>No recognizable client-side framework markers observed.</p>}</div></div>
                <div><strong className="text-violet-100">Client behavior signals</strong><div className="mt-2 space-y-1 text-cyan-100/65"><p>Inline event handlers: {websiteAnalysis.toolReportedFindings.clientBehaviorSignals.inlineEventHandlers}</p><p>Source-map references: {websiteAnalysis.toolReportedFindings.clientBehaviorSignals.sourceMapReferences}</p><p>API-like references: {websiteAnalysis.toolReportedFindings.clientBehaviorSignals.apiLikeReferences.join(', ') || 'none observed'}</p></div></div>
              </div>
              <details className="mt-4 text-cyan-100/65"><summary className="cursor-pointer text-violet-100">Observed headers, forms, and same-origin references</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/50 p-2 text-[10px] leading-4">{evidencePreview({ headers: websiteAnalysis.directlyObservedFacts.headers, forms: websiteAnalysis.directlyObservedFacts.forms, sameOriginAssets: websiteAnalysis.directlyObservedFacts.sameOriginAssets, sameOriginLinks: websiteAnalysis.directlyObservedFacts.sameOriginLinks })}</pre></details>
              <p className="mt-3 text-amber-100/70">Limits: {websiteAnalysis.unknownsAndLimitations.join(' ')}</p>
            </section>
          )}

          {job && (
            <div className="rounded border border-cyan-300/20 bg-black/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><strong className="text-cyan-200">Analysis job</strong> <code className="text-cyan-100/60">{job.jobId}</code></div>
                <span className={`rounded px-2 py-1 ${job.status === 'completed' ? 'bg-emerald-300/15 text-emerald-100' : job.status === 'failed' ? 'bg-rose-300/15 text-rose-100' : 'bg-cyan-300/15 text-cyan-100'}`}>{job.status}</span>
              </div>
              {job.error?.message && <p className="mt-2 text-rose-100">{job.error.message}</p>}
              {job.status === 'completed' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={apiUrl(`${API_ROOT}/jobs/${job.jobId}/report?format=markdown`)} className="rounded border border-cyan-300/25 px-3 py-2 text-cyan-100 hover:bg-cyan-300/10">Download Markdown</a>
                  <a href={apiUrl(`${API_ROOT}/jobs/${job.jobId}/report?format=json`)} className="rounded border border-cyan-300/25 px-3 py-2 text-cyan-100 hover:bg-cyan-300/10">Download JSON</a>
                </div>
              )}
            </div>
          )}

          {job?.result && (
            <div className="space-y-3">
              {findingGroups.map(group => {
                const findings = job.result?.[group.key] || [];
                if (!findings.length) return null;
                return (
                  <section key={group.key} className="rounded border border-cyan-300/15 bg-black/20 p-3">
                    <h3 className={`mb-3 ${group.accent}`}>{group.label} <span className="text-cyan-100/40">({findings.length})</span></h3>
                    <div className="space-y-2">
                      {findings.slice(0, 80).map(finding => (
                        <article key={finding.findingId} className="rounded border border-cyan-300/10 bg-slate-950/70 p-3">
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-cyan-100/50">
                            <span>{finding.domain || 'artifact'}</span><span>{finding.findingType || 'finding'}</span><span>{finding.confidence || 'unknown'} confidence</span><span>{finding.severity || 'info'}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap leading-5 text-cyan-50/90">{finding.description}</p>
                          {finding.evidence !== undefined && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/50 p-2 text-[10px] leading-4 text-cyan-100/60">{evidencePreview(finding.evidence)}</pre>}
                          {finding.limitations?.length ? <p className="mt-2 text-amber-100/70">Limits: {finding.limitations.join(' ')}</p> : null}
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
              {(job.result.limitations || []).length > 0 && <div className="rounded border border-amber-300/20 bg-amber-300/[0.035] p-3 text-amber-100/80">Limitations: {job.result.limitations?.join(' ')}</div>}
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <section className="rounded border border-cyan-300/15 bg-black/25 p-3">
            <div className="flex items-center gap-2 text-cyan-200"><CheckCircle2 size={14} /> Available now</div>
            <div className="mt-3 space-y-2">
              {(capabilities?.capabilities || []).map(capability => (
                <div key={capability.id} className="border-b border-cyan-300/10 pb-2 last:border-0">
                  <div className="flex justify-between gap-2"><strong className="text-cyan-50">{capability.label}</strong><span className={capability.status === 'available' ? 'text-emerald-200' : 'text-amber-200'}>{capability.status}</span></div>
                  <p className="mt-1 leading-4 text-cyan-100/55">{capability.detail}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded border border-cyan-300/15 bg-black/25 p-3">
            <strong className="text-cyan-200">Detected external tooling</strong>
            <div className="mt-3 space-y-2 text-cyan-100/65">
              {(capabilities?.externalTools || []).map(tool => <div key={tool.id} className="flex justify-between gap-3"><span>{tool.label}</span><span className={tool.detected ? 'text-amber-100' : 'text-cyan-100/35'} title={tool.reason}>{tool.detected ? 'detected / not enabled' : 'not installed'}</span></div>)}
              {!capabilities && <span>Loading local capability registry…</span>}
            </div>
          </section>
          <p className="rounded border border-amber-300/15 bg-amber-300/[0.035] p-3 leading-5 text-amber-100/70">
            Do not upload secrets, credentials, private keys, session cookies, or artifacts you are not allowed to inspect. Dynamic execution, live network interaction, and hardware writes are intentionally unavailable here.
          </p>
        </aside>
      </div>
    </section>
  );
}
