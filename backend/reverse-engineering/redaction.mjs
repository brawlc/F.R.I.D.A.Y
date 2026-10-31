const SECRET_PATTERNS = [
  [/\b(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s'"`,;]+/gi, '$1[REDACTED]'],
  [/\b(x-api-key\s*[:=]\s*)[^\s'"`,;]+/gi, '$1[REDACTED]'],
  [/\b((?:api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]\s*["']?)[^\s"'`,;]+/gi, '$1[REDACTED]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_ACCESS_KEY]'],
  [/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_JWT]'],
];

export function redactSensitiveText(value, maximumLength = 4_000) {
  let text = String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  return text.length > maximumLength ? `${text.slice(0, maximumLength)}… [truncated]` : text;
}

export function redactObject(value) {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/(?:password|token|secret|credential|cookie|authorization|api.?key|private.?key)/i.test(key)) {
      return [key, '[REDACTED]'];
    }
    return [key, redactObject(entry)];
  }));
}
