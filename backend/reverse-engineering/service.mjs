import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ARTIFACT_BYTES,
  MAX_QUEUED_JOBS,
  MODULE_VERSION,
  RE_SCHEMA_VERSION,
  STORAGE_ROOT,
  WORKER_MEMORY_MB,
  WORKER_TIMEOUT_MS,
} from './constants.mjs';
import { getCapabilityRegistry } from './capabilities.mjs';
import { detectArtifactFormat } from './format.mjs';
import { redactObject, redactSensitiveText } from './redaction.mjs';
import { buildReport } from './report.mjs';
import { ReverseEngineeringError } from './schemas.mjs';
import {
  appendAuditEvent,
  artifactExists,
  createArtifact,
  initializeEvidenceStore,
  listJobs,
  loadArtifact,
  loadJob,
  loadReport,
  saveJob,
  saveReport,
  updateArtifact,
} from './store.mjs';

const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs');

function now() {
  return new Date().toISOString();
}

function errorInfo(error) {
  return {
    message: redactSensitiveText(error instanceof Error ? error.message : String(error), 1_000),
    code: error?.code || 'analysis_failed',
  };
}

function makeResourcePolicy() {
  return {
    maxArtifactBytes: MAX_ARTIFACT_BYTES,
    workerWallClockTimeoutMs: WORKER_TIMEOUT_MS,
    workerV8HeapLimitMb: WORKER_MEMORY_MB,
    concurrentWorkers: 1,
    inputMount: 'artifact path is read by a dedicated child process; no artifact execution is implemented',
    network: 'no module network operations; not an OS-enforced network namespace',
    outputLimitBytes: 2 * 1024 * 1024,
  };
}

function addAuditTrail(job, event, detail = '') {
  const trail = Array.isArray(job.auditTrail) ? job.auditTrail : [];
  return [...trail, { at: now(), event, detail: redactSensitiveText(detail, 500) }].slice(-80);
}

function workerEnvironment() {
  const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'COMSPEC'];
  const env = { NODE_ENV: 'production' };
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function normalizeFindings(job, workerResult) {
  const groups = [
    ['directFacts', 'direct-observation'],
    ['toolFindings', 'tool-reported'],
    ['hypotheses', 'ai-hypothesis'],
    ['confirmedConclusions', 'confirmed-conclusion'],
    ['unknowns', 'unknown'],
  ];
  let sequence = 0;
  const normalized = {};
  for (const [key, fallbackClassification] of groups) {
    normalized[key] = (Array.isArray(workerResult[key]) ? workerResult[key] : []).map(item => {
      sequence += 1;
      const clean = redactObject(item);
      return {
        ...clean,
        workerFindingId: clean.findingId || null,
        findingId: `fin_${job.jobId.slice(4)}_${sequence}`,
        artifactId: job.artifactId,
        jobId: job.jobId,
        classification: clean.classification || fallbackClassification,
        evidence: redactObject(clean.evidence || []),
        limitations: Array.isArray(clean.limitations) ? clean.limitations.map(item => redactSensitiveText(item, 1_000)) : [],
      };
    });
  }
  return normalized;
}

export class ReverseEngineeringService {
  constructor() {
    this.queue = [];
    this.activeJobId = null;
    this.children = new Map();
    this.initializePromise = null;
  }

  async initialize() {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      await initializeEvidenceStore();
      const previousJobs = await listJobs({ limit: 100 });
      for (const job of previousJobs) {
        if (!['queued', 'running'].includes(job.status)) continue;
        const recovered = {
          ...job,
          status: 'cancelled',
          finishedAt: now(),
          error: {
            code: 'service_restarted',
            message: 'The service restarted before this analysis completed. Resubmit the job after reviewing authorization.',
          },
          auditTrail: addAuditTrail(job, 'cancelled-after-restart', 'A running or queued job is never resumed silently.'),
        };
        await saveJob(recovered);
        await appendAuditEvent({ type: 'job.cancelled-after-restart', jobId: job.jobId, artifactId: job.artifactId });
      }
    })();
    return this.initializePromise;
  }

  async ingestArtifact(upload) {
    await this.initialize();
    const artifact = await createArtifact(upload);
    const detectedFormat = detectArtifactFormat(upload.bytes, upload.filename);
    const updated = await updateArtifact(artifact.artifactId, { detectedFormat });
    await appendAuditEvent({
      type: 'artifact.identified', artifactId: artifact.artifactId, format: detectedFormat.id, category: detectedFormat.category,
    });
    return updated;
  }

  async submitJob(request) {
    await this.initialize();
    const artifact = await loadArtifact(request.artifactId);
    if (!artifact || !(await artifactExists(request.artifactId))) {
      throw new ReverseEngineeringError('Artifact was not found.', { status: 404, code: 'artifact_not_found' });
    }
    if (this.queue.length >= MAX_QUEUED_JOBS) {
      throw new ReverseEngineeringError('Reverse-engineering job queue is full. Wait for an existing job to finish.', { status: 429, code: 'queue_full' });
    }
    const jobId = `job_${randomUUID()}`;
    const job = {
      schemaVersion: RE_SCHEMA_VERSION,
      jobId,
      artifactId: request.artifactId,
      requestedAnalysisProfile: request.profile,
      profile: request.profile,
      authorizationContext: request.authorization,
      tool: { name: 'friday-static-worker', version: MODULE_VERSION, executionMode: 'offline-static-only' },
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      resourcePolicy: makeResourcePolicy(),
      resourceUsage: null,
      error: null,
      result: null,
      auditTrail: [{ at: now(), event: 'queued', detail: 'Submitted after explicit operator authorization assertion.' }],
    };
    await saveJob(job);
    await appendAuditEvent({
      type: 'job.queued', jobId, artifactId: job.artifactId, profile: job.profile, actor: request.authorization.assurance,
    });
    this.queue.push(jobId);
    this.schedule();
    return job;
  }

  schedule() {
    if (this.activeJobId || !this.queue.length) return;
    const jobId = this.queue.shift();
    if (!jobId) return;
    setImmediate(() => {
      void this.runJob(jobId);
    });
  }

  async runJob(jobId) {
    if (this.activeJobId) return;
    let job = await loadJob(jobId);
    if (!job || job.status !== 'queued') {
      this.schedule();
      return;
    }
    this.activeJobId = jobId;
    const started = Date.now();
    try {
      job = {
        ...job,
        status: 'running',
        startedAt: now(),
        auditTrail: addAuditTrail(job, 'started', 'Static worker started.'),
      };
      await saveJob(job);
      await appendAuditEvent({ type: 'job.started', jobId, artifactId: job.artifactId, profile: job.profile });
      const artifact = await loadArtifact(job.artifactId);
      if (!artifact) throw new ReverseEngineeringError('Artifact record disappeared before analysis.', { status: 404, code: 'artifact_not_found' });
      const workerResult = await this.runStaticWorker(job, artifact);
      const current = await loadJob(jobId);
      if (current?.cancellationRequestedAt) {
        throw new ReverseEngineeringError('Job was cancelled by the operator.', { code: 'cancelled' });
      }
      const normalizedResult = {
        ...workerResult,
        ...normalizeFindings(job, workerResult),
        limitations: (workerResult.limitations || []).map(item => redactSensitiveText(item, 1_000)),
      };
      const updatedArtifact = await updateArtifact(job.artifactId, { detectedFormat: workerResult.artifactInspection?.format || artifact.detectedFormat });
      const completed = {
        ...job,
        status: 'completed',
        finishedAt: now(),
        resourceUsage: { wallClockMs: Date.now() - started, inspectedBytes: workerResult.artifactInspection?.inspectedBytes || null, cpuMs: null, memoryBytes: null },
        result: normalizedResult,
        auditTrail: addAuditTrail(job, 'completed', 'Static worker completed.'),
      };
      const { report, markdown } = buildReport({ job: completed, artifact: updatedArtifact, workerResult: normalizedResult });
      await saveReport(jobId, report, markdown);
      await appendAuditEvent({
        type: 'job.completed', jobId, artifactId: job.artifactId, profile: job.profile,
        findingCount: Object.values(normalizeFindings(job, workerResult)).reduce((total, entries) => total + entries.length, 0),
      });
      await saveJob(completed);
    } catch (error) {
      const latest = await loadJob(jobId);
      const wasCancelled = latest?.cancellationRequestedAt || error?.code === 'cancelled';
      const failed = {
        ...(latest || job),
        status: wasCancelled ? 'cancelled' : 'failed',
        finishedAt: now(),
        resourceUsage: { wallClockMs: Date.now() - started, inspectedBytes: null, cpuMs: null, memoryBytes: null },
        error: errorInfo(error),
        auditTrail: addAuditTrail(latest || job, wasCancelled ? 'cancelled' : 'failed', errorInfo(error).message),
      };
      await saveJob(failed);
      const artifact = await loadArtifact(failed.artifactId);
      if (artifact) {
        const workerResult = {
          directFacts: [], toolFindings: [], hypotheses: [], confirmedConclusions: [], unknowns: [],
          limitations: [failed.error.message],
        };
        const { report, markdown } = buildReport({ job: failed, artifact, workerResult });
        await saveReport(jobId, report, markdown);
      }
      await appendAuditEvent({
        type: wasCancelled ? 'job.cancelled' : 'job.failed', jobId, artifactId: failed.artifactId, error: failed.error.message,
      });
    } finally {
      this.children.delete(jobId);
      this.activeJobId = null;
      this.schedule();
    }
  }

  async runStaticWorker(job, artifact) {
    const inputPath = join(STORAGE_ROOT, 'jobs', `${job.jobId}.worker-input.json`);
    const artifactPath = join(STORAGE_ROOT, 'artifacts', `${artifact.artifactId}.bin`);
    await writeFile(inputPath, JSON.stringify({
      artifactId: artifact.artifactId,
      artifactPath,
      originalFilename: artifact.originalFilename,
      profile: job.profile,
    }), { encoding: 'utf8', mode: 0o600 });
    try {
      return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [
          `--max-old-space-size=${WORKER_MEMORY_MB}`,
          workerPath,
          '--input', inputPath,
        ], {
          cwd: STORAGE_ROOT,
          env: workerEnvironment(),
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.children.set(job.jobId, child);
        let output = '';
        let diagnostic = '';
        let timedOut = false;
        let outputExceeded = false;
        const maximumOutput = 2 * 1024 * 1024;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, WORKER_TIMEOUT_MS);
        const terminate = () => {
          if (!child.killed) child.kill();
        };
        child.stdout.on('data', chunk => {
          output += String(chunk);
          if (output.length > maximumOutput) {
            outputExceeded = true;
            terminate();
          }
        });
        child.stderr.on('data', chunk => {
          diagnostic += String(chunk);
          if (diagnostic.length > 16_384) diagnostic = diagnostic.slice(0, 16_384);
        });
        child.on('error', error => {
          clearTimeout(timer);
          rejectPromise(error);
        });
        child.on('close', code => {
          clearTimeout(timer);
          if (timedOut) {
            rejectPromise(new ReverseEngineeringError(`Static worker exceeded the ${WORKER_TIMEOUT_MS}ms time limit.`, { code: 'worker_timeout' }));
            return;
          }
          if (outputExceeded) {
            rejectPromise(new ReverseEngineeringError('Static worker exceeded its output limit.', { code: 'worker_output_limit' }));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(output);
          } catch {
            rejectPromise(new ReverseEngineeringError(`Static worker returned invalid output${diagnostic ? `: ${redactSensitiveText(diagnostic, 600)}` : ''}`, { code: 'worker_invalid_output' }));
            return;
          }
          if (code !== 0 || !parsed?.ok) {
            rejectPromise(new ReverseEngineeringError(redactSensitiveText(parsed?.error || diagnostic || `Static worker exited with code ${code}.`, 1_000), { code: 'worker_failed' }));
            return;
          }
          resolvePromise(parsed);
        });
      });
    } finally {
      await rm(inputPath, { force: true }).catch(() => undefined);
    }
  }

  async getJob(jobId) {
    await this.initialize();
    const job = await loadJob(jobId);
    if (!job) throw new ReverseEngineeringError('Analysis job was not found.', { status: 404, code: 'job_not_found' });
    return job;
  }

  async getArtifact(artifactId) {
    await this.initialize();
    const artifact = await loadArtifact(artifactId);
    if (!artifact) throw new ReverseEngineeringError('Artifact was not found.', { status: 404, code: 'artifact_not_found' });
    return artifact;
  }

  async getJobs() {
    await this.initialize();
    return listJobs({ limit: 50 });
  }

  async cancelJob(jobId) {
    await this.initialize();
    const job = await this.getJob(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    if (job.status === 'queued') {
      this.queue = this.queue.filter(id => id !== jobId);
      const cancelled = {
        ...job,
        status: 'cancelled',
        finishedAt: now(),
        error: { code: 'cancelled', message: 'Cancelled before worker start.' },
        auditTrail: addAuditTrail(job, 'cancelled', 'Cancelled before worker start.'),
      };
      await saveJob(cancelled);
      await appendAuditEvent({ type: 'job.cancelled', jobId, artifactId: job.artifactId, reason: 'queued-cancellation' });
      return cancelled;
    }
    const requested = {
      ...job,
      cancellationRequestedAt: now(),
      auditTrail: addAuditTrail(job, 'cancellation-requested', 'Operator requested cancellation.'),
    };
    await saveJob(requested);
    await appendAuditEvent({ type: 'job.cancellation-requested', jobId, artifactId: job.artifactId });
    const child = this.children.get(jobId);
    if (child && !child.killed) child.kill();
    return requested;
  }

  async getReport(jobId, format = 'json') {
    await this.getJob(jobId);
    const report = await loadReport(jobId, format);
    if (!report) throw new ReverseEngineeringError('Report is not available yet.', { status: 404, code: 'report_not_ready' });
    return report;
  }

  async capabilities({ refresh = false } = {}) {
    await this.initialize();
    return getCapabilityRegistry({ refresh });
  }
}
