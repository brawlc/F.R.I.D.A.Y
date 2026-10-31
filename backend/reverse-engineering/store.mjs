import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RE_SCHEMA_VERSION, STORAGE_ROOT } from './constants.mjs';
import { redactObject } from './redaction.mjs';
import { ReverseEngineeringError, safeOriginalFilename } from './schemas.mjs';

const directories = {
  artifacts: join(STORAGE_ROOT, 'artifacts'),
  jobs: join(STORAGE_ROOT, 'jobs'),
  reports: join(STORAGE_ROOT, 'reports'),
  audit: join(STORAGE_ROOT, 'audit'),
};

let initialized = false;
let auditTail = Promise.resolve();

function assertSafeId(id, prefix) {
  if (typeof id !== 'string' || !new RegExp(`^${prefix}_[a-f0-9-]+$`, 'i').test(id)) {
    throw new ReverseEngineeringError(`Invalid ${prefix} identifier.`, { status: 400, code: 'invalid_identifier' });
  }
  return id;
}

function artifactBinaryPath(id) {
  return join(directories.artifacts, `${assertSafeId(id, 'art')}.bin`);
}

function artifactMetadataPath(id) {
  return join(directories.artifacts, `${assertSafeId(id, 'art')}.json`);
}

function jobPath(id) {
  return join(directories.jobs, `${assertSafeId(id, 'job')}.json`);
}

function reportJsonPath(id) {
  return join(directories.reports, `${assertSafeId(id, 'job')}.json`);
}

function reportMarkdownPath(id) {
  return join(directories.reports, `${assertSafeId(id, 'job')}.md`);
}

function auditLogPath() {
  return join(directories.audit, 'events.jsonl');
}

function auditStatePath() {
  return join(directories.audit, 'state.json');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeAtomic(path, content) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  // Windows can briefly hold a just-read JSON file open (antivirus/indexing can
  // do the same). Retrying the replace keeps metadata persistence reliable
  // without weakening the content or path policy.
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt === 5) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function readJson(path, missingValue = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return missingValue;
    throw error;
  }
}

export async function initializeEvidenceStore() {
  if (initialized) return { root: STORAGE_ROOT, ...directories };
  await Promise.all(Object.values(directories).map(path => mkdir(path, { recursive: true, mode: 0o700 })));
  initialized = true;
  return { root: STORAGE_ROOT, ...directories };
}

export async function createArtifact({ bytes, filename, authorization, acquisitionSource = 'local-upload' }) {
  await initializeEvidenceStore();
  const artifactId = `art_${randomUUID()}`;
  const hash = sha256(bytes);
  const binaryPath = artifactBinaryPath(artifactId);
  const storageLocation = `artifacts/${artifactId}.bin`;
  await writeFile(binaryPath, bytes, { mode: 0o600 });
  const record = {
    schemaVersion: RE_SCHEMA_VERSION,
    artifactId,
    sha256: hash,
    originalFilename: safeOriginalFilename(filename),
    size: bytes.length,
    acquisitionSource,
    authorizationContext: authorization,
    ingestedAt: new Date().toISOString(),
    storageLocation,
    provenance: {
      source: acquisitionSource,
      contentAddress: `sha256:${hash}`,
      immutableInputExpectation: 'The artifact copy is addressed by an internal identifier and never executed by this module.',
    },
  };
  await writeAtomic(artifactMetadataPath(artifactId), JSON.stringify(record, null, 2));
  await appendAuditEvent({
    type: 'artifact.ingested',
    artifactId,
    sha256: hash,
    size: bytes.length,
    acquisitionSource,
    actor: authorization.assurance,
  });
  return record;
}

export async function updateArtifact(id, changes) {
  const current = await loadArtifact(id);
  if (!current) throw new ReverseEngineeringError('Artifact was not found.', { status: 404, code: 'artifact_not_found' });
  const updated = { ...current, ...changes, artifactId: current.artifactId };
  await writeAtomic(artifactMetadataPath(id), JSON.stringify(updated, null, 2));
  return updated;
}

export async function loadArtifact(id) {
  await initializeEvidenceStore();
  return readJson(artifactMetadataPath(id));
}

export async function loadArtifactBytes(id) {
  await initializeEvidenceStore();
  return readFile(artifactBinaryPath(id));
}

export async function artifactExists(id) {
  try {
    await stat(artifactBinaryPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function saveJob(job) {
  await initializeEvidenceStore();
  await writeAtomic(jobPath(job.jobId), JSON.stringify(job, null, 2));
  return job;
}

export async function loadJob(id) {
  await initializeEvidenceStore();
  return readJson(jobPath(id));
}

export async function listJobs({ limit = 50 } = {}) {
  await initializeEvidenceStore();
  const names = (await readdir(directories.jobs)).filter(name => /^job_[a-f0-9-]+\.json$/i.test(name)).slice(-Math.max(1, Math.min(limit, 100)));
  const jobs = await Promise.all(names.map(name => readJson(join(directories.jobs, name))));
  return jobs.filter(Boolean).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function saveReport(jobId, report, markdown) {
  await initializeEvidenceStore();
  await Promise.all([
    writeAtomic(reportJsonPath(jobId), JSON.stringify(report, null, 2)),
    writeAtomic(reportMarkdownPath(jobId), markdown),
  ]);
}

export async function loadReport(jobId, format = 'json') {
  await initializeEvidenceStore();
  const path = format === 'markdown' ? reportMarkdownPath(jobId) : reportJsonPath(jobId);
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function appendAuditEventNow(input) {
  await initializeEvidenceStore();
  const state = await readJson(auditStatePath(), { sequence: 0, lastHash: 'GENESIS' });
  const payload = redactObject({
    schemaVersion: RE_SCHEMA_VERSION,
    sequence: Number(state.sequence || 0) + 1,
    at: new Date().toISOString(),
    ...input,
  });
  const canonical = JSON.stringify(payload);
  const event = {
    ...payload,
    previousHash: state.lastHash || 'GENESIS',
    hash: sha256(`${state.lastHash || 'GENESIS'}\n${canonical}`),
  };
  await appendFile(auditLogPath(), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeAtomic(auditStatePath(), JSON.stringify({ sequence: event.sequence, lastHash: event.hash }, null, 2));
  return event;
}

export function appendAuditEvent(input) {
  const operation = auditTail.then(() => appendAuditEventNow(input));
  auditTail = operation.catch(() => undefined);
  return operation;
}

export async function verifyAuditChain() {
  await initializeEvidenceStore();
  let raw = '';
  try {
    raw = await readFile(auditLogPath(), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { valid: true, events: 0, lastHash: 'GENESIS' };
    throw error;
  }
  let previousHash = 'GENESIS';
  let events = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { valid: false, events, error: 'Audit log contains invalid JSON.' };
    }
    const { previousHash: storedPrevious, hash, ...payload } = event;
    if (storedPrevious !== previousHash || hash !== sha256(`${previousHash}\n${JSON.stringify(payload)}`)) {
      return { valid: false, events, error: `Audit-chain validation failed at sequence ${event.sequence || '?'}.` };
    }
    previousHash = hash;
    events += 1;
  }
  return { valid: true, events, lastHash: previousHash };
}

export function getEvidenceStoreStatus() {
  return {
    root: STORAGE_ROOT,
    isolatedFromPublicAssets: true,
    storageScope: 'project-local reverse-engineering evidence store',
    platformIsolation: 'filesystem separation and separate static-analysis process; not a VM or container boundary',
  };
}
