// Cookie values are discarded before observations leave the collector.
export function summarizeCookies(lines) {
  return lines.slice(0, 50).map((line, index) => {
    const [pair, ...parts] = line.split(';');
    const attrs = new Map(parts.map(part => { const [key, ...value] = part.trim().split('='); return [key.toLowerCase(), value.join('=')]; }));
    const name = pair.slice(0, pair.indexOf('=')).trim();
    return { index: index + 1, secure: attrs.has('secure'), httpOnly: attrs.has('httponly'), sameSite: (attrs.get('samesite') || '').toLowerCase(), hostPrefix: name.startsWith('__Host-'), securePrefix: name.startsWith('__Secure-'), domainPresent: attrs.has('domain'), rootPath: attrs.get('path') === '/' };
  });
}

export function reviewPolicies(facts) {
  const findings = [];
  const add = (id, title, severity, evidence, remediation) => findings.push({ id, title, severity, evidence, remediation, retest: 'Repeat this page assessment after the change and verify intended browser behaviour.', confidence: 'high for observed configuration; exploitability untested', classification: 'configuration-review' });
  const h = facts.headers || {};
  if (h['strict-transport-security']) {
    const ages = [...h['strict-transport-security'].matchAll(/(?:^|;)\s*max-age\s*=\s*(\d+)\s*(?=;|$)/gi)];
    if (ages.length !== 1 || Number(ages[0][1]) === 0) add('hsts-invalid', 'HSTS is disabled or not parseable', 'medium', h['strict-transport-security'], 'Provide one valid positive max-age after validating HTTPS deployment.');
  }
  const csp = h['content-security-policy'] || '';
  // Multiple policies combine restrictively. Do not flatten them into one policy.
  if (csp && !csp.includes(',')) {
    const directives = new Map();
    for (const part of csp.split(';')) {
      const [name, ...tokens] = part.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), tokens);
    }
    const scripts = directives.get('script-src') ?? directives.get('default-src');
    if (!scripts) add('csp-script-unrestricted', 'CSP does not restrict scripts', 'medium', csp, 'Define script-src or default-src appropriate to the application.');
    else {
      const nonceOrHash = scripts.some(token => /^'(nonce-|sha(?:256|384|512)-)/.test(token));
      if (scripts.includes("'unsafe-inline'") && !nonceOrHash) add('csp-inline', 'CSP allows inline scripts', 'medium', scripts.join(' '), 'Use per-response nonces or hashes and remove unnecessary inline execution.');
      if (scripts.includes("'unsafe-eval'")) add('csp-eval', 'CSP permits string-to-code evaluation', 'medium', scripts.join(' '), 'Remove dependencies on eval-like execution before removing unsafe-eval.');
      if (!scripts.includes("'strict-dynamic'") || !nonceOrHash) {
        if (scripts.some(token => ['*', 'http:', 'https:', 'data:'].includes(token))) add('csp-broad-script', 'CSP allows broad script sources', 'medium', scripts.join(' '), 'Constrain scripts to required origins or nonce/hash-based trust.');
      }
    }
    const ancestors = directives.get('frame-ancestors');
    if (ancestors?.some(token => ['*', 'http:', 'https:'].includes(token))) add('framing-broad', 'Framing policy allows broad origins', 'medium', ancestors.join(' '), 'Restrict frame-ancestors to intended embedding origins.');
  }
  for (const cookie of facts.cookies || []) {
    const label = `Response cookie ${cookie.index} (name and value omitted)`;
    if (!cookie.secure) add(`cookie-secure-${cookie.index}`, 'Cookie lacks Secure attribute', 'medium', label, 'Use Secure for cookies that should only travel over HTTPS.');
    if (!cookie.httpOnly) add(`cookie-httponly-${cookie.index}`, 'Review JavaScript-readable cookie', 'low', label, 'Use HttpOnly for session secrets; JavaScript-readable preference cookies may be intentional.');
    if (cookie.sameSite === 'none' && !cookie.secure) add(`cookie-samesite-${cookie.index}`, 'SameSite=None cookie lacks Secure', 'medium', label, 'Modern browsers require Secure with SameSite=None. Confirm cross-site cookies are actually needed.');
    if ((cookie.securePrefix && !cookie.secure) || (cookie.hostPrefix && (!cookie.secure || cookie.domainPresent || !cookie.rootPath))) add(`cookie-prefix-${cookie.index}`, 'Cookie prefix requirements not satisfied', 'medium', label, 'Match Secure/Host prefix requirements: Secure, and for Host no Domain and Path=/.');
  }
  for (const [index, form] of (facts.forms || []).entries()) {
    try {
      const target = form.action === '(same document)' ? new URL(facts.finalUrl) : new URL(form.action, facts.finalUrl);
      if (target.protocol === 'http:') add(`form-http-${index}`, 'Form declares an unencrypted destination', 'high', `Form ${index + 1}: HTTP action (not submitted).`, 'Use HTTPS for form destinations and validate server-side handling.');
      if (form.passwordCount > 0 && form.method === 'GET') add(`form-password-get-${index}`, 'Password form declares GET', 'high', `Form ${index + 1}: password field with GET method. JavaScript overrides were not tested.`, 'Use POST over HTTPS for credentials; keep credentials out of URLs and logs.');
    } catch { /* Malformed actions require browser/manual review. */ }
  }
  return findings;
}
