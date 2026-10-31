import { MAX_ARTIFACT_BYTES, RE_SCHEMA_VERSION, getAnalysisProfile } from './constants.mjs';

export class ReverseEngineeringError extends Error {
  constructor(message, { status = 400, code = 'invalid_request', details } = {}) {
    super(message);
    this.name = 'ReverseEngineeringError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReverseEngineeringError(`${label} must be an object.`);
  }
  return value;
}

function string(value, label, { min = 0, max = 1_000, pattern } = {}) {
  if (typeof value !== 'string') throw new ReverseEngineeringError(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ReverseEngineeringError(`${label} must be between ${min} and ${max} characters.`);
  }
  if (pattern && !pattern.test(normalized)) throw new ReverseEngineeringError(`${label} has an invalid format.`);
  return normalized;
}

export function safeOriginalFilename(value) {
  const name = string(value || 'artifact.bin', 'fileName', { min: 1, max: 240 });
  const safe = name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/^\.+$/, 'artifact.bin')
    .slice(0, 180);
  return safe || 'artifact.bin';
}

export function decodeBase64Artifact(value) {
  const encoded = string(value, 'contentBase64', { min: 4, max: Math.ceil(MAX_ARTIFACT_BYTES * 4 / 3) + 8 });
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new ReverseEngineeringError('contentBase64 must be canonical base64.', { code: 'invalid_base64' });
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new ReverseEngineeringError('The uploaded artifact is empty.', { code: 'empty_artifact' });
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    throw new ReverseEngineeringError(`Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte safety limit.`, { status: 413, code: 'artifact_too_large' });
  }
  return bytes;
}

export function validateAuthorization(value) {
  const auth = object(value, 'authorization');
  if (auth.confirmed !== true) {
    throw new ReverseEngineeringError('Explicit operator authorization is required before analysis.', {
      status: 403,
      code: 'authorization_required',
    });
  }

  return {
    schemaVersion: RE_SCHEMA_VERSION,
    confirmed: true,
    scope: string(auth.scope, 'authorization.scope', { min: 8, max: 500 }),
    purpose: typeof auth.purpose === 'string' ? auth.purpose.trim().slice(0, 500) : '',
    assertedAt: new Date().toISOString(),
    assurance: 'operator-asserted-not-authenticated',
  };
}

export function validateArtifactUpload(value) {
  const payload = object(value, 'request body');
  return {
    filename: safeOriginalFilename(payload.fileName),
    bytes: decodeBase64Artifact(payload.contentBase64),
    authorization: validateAuthorization(payload.authorization),
    acquisitionSource: 'local-upload',
  };
}

export function validateJobRequest(value) {
  const payload = object(value, 'request body');
  const artifactId = string(payload.artifactId, 'artifactId', { min: 12, max: 100, pattern: /^art_[a-f0-9-]+$/i });
  const profile = string(payload.profile, 'profile', { min: 3, max: 80, pattern: /^[a-z0-9-]+$/ });
  if (!getAnalysisProfile(profile)) {
    throw new ReverseEngineeringError(`Unsupported analysis profile: ${profile}.`, { code: 'unsupported_profile' });
  }

  return {
    artifactId,
    profile,
    authorization: validateAuthorization(payload.authorization),
  };
}

export function validateWebsiteRequest(value) {
  const payload = object(value, 'request body');
  return {
    url: string(payload.url, 'url', { min: 10, max: 2_000 }),
    authorization: validateAuthorization(payload.authorization),
  };
}

export function validateWebsiteStudioRequest(value) {
  const payload = object(value, 'request body');
  const website = validateWebsiteRequest(payload);
  let renderedScan;
  if (payload.renderedScan) {
    if (JSON.stringify(payload.renderedScan).length > 350000) throw new ReverseEngineeringError('Rendered scan exceeds the build input limit.');
    const scan = object(payload.renderedScan, 'renderedScan');
    if (!Array.isArray(scan.snapshots) || !scan.snapshots.length || scan.snapshots.length > 16) throw new ReverseEngineeringError('Invalid rendered scan samples.');
    for (const sample of scan.snapshots) {
      object(sample, 'rendered sample');
      for (const field of ['fonts', 'colors', 'backgrounds', 'blocks', 'headings', 'controls', 'technology', 'motion']) {
        if (sample[field] !== undefined && !Array.isArray(sample[field])) throw new ReverseEngineeringError(`Rendered sample ${field} must be an array.`);
      }
      for (const field of ['blocks', 'motion']) for (const item of sample[field] || []) object(item, `rendered ${field} entry`);
    }
    const canonical = input => {
      let url;
      try { url = new URL(input); } catch { throw new ReverseEngineeringError('Rendered scan URL is invalid.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new ReverseEngineeringError('Rendered scan URL must be a public HTTP(S) page.');
      return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search;
    };
    if (canonical(scan.url) !== canonical(website.url)) throw new ReverseEngineeringError('The rendered scan belongs to another page. Scan this URL before building.');
    renderedScan = scan;
  }
  return {
    ...website,
    projectName: string(payload.projectName, 'projectName', { min: 2, max: 80 }),
    brandName: typeof payload.brandName === 'string' ? payload.brandName.trim().slice(0, 100) : '',
    styleBrief: typeof payload.styleBrief === 'string' ? payload.styleBrief.trim().slice(0, 4000) : '',
    renderedScan,
    originalDesignConfirmation: payload.originalDesignConfirmation === true,
  };
}

export function validateId(value, prefix, label) {
  return string(value, label, { min: 12, max: 100, pattern: new RegExp(`^${prefix}_[a-f0-9-]+$`, 'i') });
}

export function errorPayload(error) {
  if (error instanceof ReverseEngineeringError) {
    return { ok: false, error: error.message, code: error.code, details: error.details };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'Unexpected reverse-engineering module error.', code: 'internal_error' };
}
