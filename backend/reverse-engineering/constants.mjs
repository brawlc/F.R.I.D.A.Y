import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RE_SCHEMA_VERSION = '1.0.0';
export const RE_API_VERSION = 'v1';
export const MODULE_VERSION = '1.0.0';

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(moduleDir, '..', '..');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function isWithin(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(':'));
}

const configuredStorage = String(process.env.FRIDAY_RE_STORAGE_DIR || '.friday-re').trim();
const proposedStorage = resolve(PROJECT_ROOT, configuredStorage || '.friday-re');

// This module intentionally keeps evidence in a dedicated project-local store.
// An absolute or escaping path is rejected so an environment typo cannot point the
// service at a personal-data directory or web-served path.
export const STORAGE_ROOT = isWithin(PROJECT_ROOT, proposedStorage)
  ? proposedStorage
  : resolve(PROJECT_ROOT, '.friday-re');

export const MAX_ARTIFACT_BYTES = boundedInteger(
  process.env.FRIDAY_RE_MAX_ARTIFACT_BYTES,
  8 * 1024 * 1024,
  64 * 1024,
  10 * 1024 * 1024,
);

export const MAX_INSPECT_BYTES = Math.min(
  MAX_ARTIFACT_BYTES,
  boundedInteger(process.env.FRIDAY_RE_MAX_INSPECT_BYTES, 4 * 1024 * 1024, 64 * 1024, 4 * 1024 * 1024),
);

export const WORKER_TIMEOUT_MS = boundedInteger(
  process.env.FRIDAY_RE_WORKER_TIMEOUT_MS,
  30_000,
  5_000,
  120_000,
);

export const WORKER_MEMORY_MB = boundedInteger(
  process.env.FRIDAY_RE_WORKER_MEMORY_MB,
  192,
  64,
  512,
);

export const MAX_QUEUED_JOBS = boundedInteger(
  process.env.FRIDAY_RE_MAX_QUEUED_JOBS,
  20,
  1,
  100,
);

export const ANALYSIS_PROFILES = Object.freeze({
  'static-triage': {
    id: 'static-triage',
    label: 'Static file triage',
    description: 'Offline identification, hashes, bounded metadata parsing, and redacted string evidence.',
    requiresDynamicApproval: false,
    supportedCategories: ['any'],
  },
  'binary-static': {
    id: 'binary-static',
    label: 'Binary metadata',
    description: 'Offline PE, ELF, Mach-O, archive, and generic binary metadata inspection.',
    requiresDynamicApproval: false,
    supportedCategories: ['binary', 'archive', 'firmware'],
  },
  'firmware-static': {
    id: 'firmware-static',
    label: 'Firmware static triage',
    description: 'Offline firmware identification, archive-bomb signals, strings, and embedded-format evidence. No extraction or flashing.',
    requiresDynamicApproval: false,
    supportedCategories: ['firmware', 'binary', 'archive'],
  },
  'pcap-summary': {
    id: 'pcap-summary',
    label: 'Passive PCAP summary',
    description: 'Offline packet-capture metadata and packet-header summary. Payloads are not inspected.',
    requiresDynamicApproval: false,
    supportedCategories: ['capture'],
  },
  'source-architecture': {
    id: 'source-architecture',
    label: 'Source architecture map',
    description: 'Offline source-file or safe source-archive import/export and entry-point mapping. No build scripts run.',
    requiresDynamicApproval: false,
    supportedCategories: ['source', 'archive'],
  },
});

export const EXPLICIT_APPROVAL_ACTIONS = Object.freeze([
  'dynamic-execution',
  'network-probe',
  'authenticated-web-analysis',
  'hardware-interaction',
  'firmware-write',
  'physical-device-flash',
]);

export function getAnalysisProfile(profileId) {
  return ANALYSIS_PROFILES[profileId] || null;
}

export function boundedNumber(value, fallback, minimum, maximum) {
  return boundedInteger(value, fallback, minimum, maximum);
}
