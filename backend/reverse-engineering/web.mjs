import { lookup } from 'node:dns/promises';
import { redactObject, redactSensitiveText } from './redaction.mjs';
import { ReverseEngineeringError } from './schemas.mjs';
import { readBoundedHtml, inspectHtmlStructure } from './web-observation.mjs';
import { summarizeCookies } from '../security/policy-review.mjs';

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')
    || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
}

export function isPublicAddress(address, family) {
  return family === 4 ? !isPrivateIpv4(address) : family === 6 ? !isPrivateIpv6(address) : false;
}

export function normalizeAuthorizedWebsiteTarget(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || '').trim());
  } catch {
    throw new ReverseEngineeringError('Enter a valid public http:// or https:// URL.', { code: 'invalid_website_url' });
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new ReverseEngineeringError('Only credential-free public HTTP(S) URLs are supported.', { code: 'invalid_website_url' });
  }
  if (target.port && !['80', '443'].includes(target.port)) {
    throw new ReverseEngineeringError('Only standard HTTP(S) ports are supported by this read-only web profile.', { code: 'invalid_website_port' });
  }
  if (target.hostname.toLowerCase() === 'localhost' || target.hostname.endsWith('.localhost')) {
    throw new ReverseEngineeringError('Localhost is not an allowed website-analysis target.', { status: 403, code: 'private_target' });
  }
  return target;
}

async function assertPublicDns(target) {
  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address, entry.family))) {
    throw new ReverseEngineeringError('Target resolves to a private, loopback, link-local, or reserved address and is blocked.', { status: 403, code: 'private_target' });
  }
  return addresses.map(entry => ({ address: entry.address, family: entry.family }));
}

export function isAllowedWebsiteRedirect(initialTarget, next) {
  const canonicalHost = host => host.toLowerCase().replace(/^www\./, '');
  return canonicalHost(initialTarget.hostname) === canonicalHost(next.hostname)
    && !next.username && !next.password
    && ['http:', 'https:'].includes(next.protocol)
    && !(initialTarget.protocol === 'https:' && next.protocol !== 'https:')
    && !next.port;
}

async function fetchPublicPage(initialTarget, onProgress) {
  let current = initialTarget;
  let dnsEvidence = [];
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    dnsEvidence = await assertPublicDns(current);
    onProgress({ stage: 'fetch', message: `Public address verified. Requesting ${current.hostname}…` });
    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.4',
          'User-Agent': 'FRIDAY-Reverse-Engineering/1.0 (+authorized-read-only-analysis)',
        },
      });
    } catch (error) {
      throw new ReverseEngineeringError(`Website request failed: ${error instanceof Error ? error.message : 'unknown error'}`, { code: 'website_request_failed' });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new ReverseEngineeringError('Website returned a redirect without a Location header.', { code: 'invalid_redirect' });
      const next = normalizeAuthorizedWebsiteTarget(new URL(location, current).toString());
      await response.body?.cancel();
      if (!isAllowedWebsiteRedirect(initialTarget, next)) {
        throw new ReverseEngineeringError('This page redirects to another website. Enter the final public website URL directly to analyze it.', { status: 403, code: 'cross_origin_redirect' });
      }
      current = normalizeAuthorizedWebsiteTarget(next.toString());
      onProgress({ stage: 'redirect', message: `Following canonical redirect to ${current.hostname}.` });
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ReverseEngineeringError(`The website returned HTTP ${response.status}. It may require login, block automated requests, or no longer have this page.`, { status: 422, code: 'website_http_error' });
    }
    const type = response.headers.get('content-type') || '';
    if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) {
      await response.body?.cancel();
      throw new ReverseEngineeringError(`Target response is not HTML (${type || 'unknown content type'}).`, { code: 'unsupported_web_content' });
    }
    const html = await readBoundedHtml(response, MAX_HTML_BYTES);
    const embeddingRestricted = Boolean(response.headers.get('x-frame-options')) || /frame-ancestors/i.test(response.headers.get('content-security-policy') || '');
    onProgress({ stage: 'page', message: `HTTP ${response.status} — received ${Buffer.byteLength(html)} bytes of HTML.`, url: current.toString(), embeddingRestricted });
    return { response, html, target: current, dnsEvidence };
  }
  throw new ReverseEngineeringError('Website redirect limit reached.', { code: 'redirect_limit' });
}

function extractAttributeValues(html, tagName, attribute) {
  const values = [];
  const expression = new RegExp(`<${tagName}\\b[^>]*?\\b${attribute}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'gi');
  for (const match of html.matchAll(expression)) {
    values.push(match[1]);
    if (values.length >= 100) break;
  }
  return values;
}

function absoluteSameOriginUrls(values, base) {
  const urls = [];
  for (const value of values) {
    try {
      const resolved = new URL(value, base);
      if (resolved.origin === base.origin && ['http:', 'https:'].includes(resolved.protocol)) urls.push(resolved.toString());
    } catch {
      // Malformed client references are represented in counts, not fetched.
    }
  }
  return [...new Set(urls)].slice(0, 100);
}

function frameworkSignals(html, headers) {
  const signals = [];
  const add = (name, evidence, confidence = 'medium') => signals.push({ name, confidence, evidence });
  if (/__NEXT_DATA__|\/_next\//i.test(html)) add('Next.js', 'Observed __NEXT_DATA__ or /_next/ asset path.', 'high');
  if (/__NUXT__|\/_nuxt\//i.test(html)) add('Nuxt', 'Observed __NUXT__ or /_nuxt/ asset path.', 'high');
  if (/data-reactroot|react(?:\.production)?\.min\.js|_reactRootContainer/i.test(html)) add('React', 'Observed React client markers or asset name.', 'medium');
  if (/ng-version|\bangular(?:\.min)?\.js/i.test(html)) add('Angular', 'Observed Angular marker.', 'high');
  if (/data-v-[a-f0-9]+|__VUE__/i.test(html)) add('Vue', 'Observed Vue marker.', 'medium');
  if (/wp-content|wp-includes/i.test(html)) add('WordPress', 'Observed WordPress asset path.', 'high');
  if (/shopify/i.test(html) || /shopify/i.test(headers['x-shopify-stage'] || '')) add('Shopify', 'Observed Shopify marker.', 'medium');
  if (headers.server) add(`Server: ${headers.server}`, 'Response Server header.', 'high');
  if (headers['x-powered-by']) add(`Powered by: ${headers['x-powered-by']}`, 'Response X-Powered-By header.', 'high');
  return signals;
}

function safeHeaderSubset(headers) {
  const allowlist = ['content-type', 'content-length', 'server', 'x-powered-by', 'content-security-policy', 'strict-transport-security', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-content-type-options', 'cache-control'];
  return Object.fromEntries(allowlist.filter(name => headers[name]).map(name => [name, redactSensitiveText(headers[name], 1_000)]));
}

export async function analyzeAuthorizedWebsite({ url, authorization }, onProgress = () => {}) {
  const target = normalizeAuthorizedWebsiteTarget(url);
  onProgress({ stage: 'validate', message: 'Checking URL and public DNS addresses…' });
  const { response, html, target: finalTarget, dnsEvidence } = await fetchPublicPage(target, onProgress);
  onProgress({ stage: 'inspect', message: 'Inspecting HTML structure, forms, asset references, and technology markers…' });
  const headers = Object.fromEntries(response.headers.entries());
  const scripts = extractAttributeValues(html, 'script', 'src');
  const styles = extractAttributeValues(html, 'link', 'href');
  const links = extractAttributeValues(html, 'a', 'href');
  const { forms, canonical } = inspectHtmlStructure(html);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  const sameOriginAssets = absoluteSameOriginUrls([...scripts, ...styles], finalTarget);
  const sameOriginLinks = absoluteSameOriginUrls(links, finalTarget);
  const framework = frameworkSignals(html, headers);
  onProgress({ stage: 'finding', message: `Title: ${title ? redactSensitiveText(title, 200) : 'not present'}. Found ${scripts.length} script references, ${forms.length} forms, and ${links.length} links.` });
  onProgress({ stage: 'finding', message: framework.length ? `Technology signals: ${framework.map(item => item.name).join(', ')}.` : 'No recognizable framework markers in the HTML.' });
  const result = redactObject({
    schemaVersion: '1.0.0',
    analysisType: 'authorized-public-website-observation',
    analyzedAt: new Date().toISOString(),
    authorizationContext: authorization,
    directlyObservedFacts: {
      requestedUrl: target.toString(),
      finalUrl: finalTarget.toString(),
      dnsAddresses: dnsEvidence,
      status: response.status,
      headers: safeHeaderSubset(headers),
      title: title ? redactSensitiveText(title, 500) : null,
      canonical,
      htmlBytes: Buffer.byteLength(html),
      domCounts: {
        links: links.length,
        forms: forms.length,
        scripts: scripts.length,
        stylesheetReferences: styles.filter(value => /\.css(?:[?#]|$)/i.test(value)).length,
        images: extractAttributeValues(html, 'img', 'src').length,
      },
      forms,
      cookies: summarizeCookies(typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []),
      sameOriginAssets,
      sameOriginLinks: sameOriginLinks.slice(0, 80),
    },
    toolReportedFindings: {
      frameworkSignals: framework,
      clientBehaviorSignals: {
        inlineEventHandlers: (html.match(/\son[a-z]+\s*=/gi) || []).length,
        sourceMapReferences: (html.match(/sourceMappingURL=/gi) || []).length,
        apiLikeReferences: [...new Set((html.match(/(?:\/api\/|graphql|wss?:\/\/)[^\s"'<>]{0,180}/gi) || []).map(value => redactSensitiveText(value, 240)))].slice(0, 40),
      },
    },
    hypotheses: [
      ...(framework.length ? [{ description: 'Framework and technology signals are indicators based on observable client output, not proof of server-side implementation.' }] : []),
    ],
    unknownsAndLimitations: [
      'This read-only profile observes one public HTML document and its references; it does not recursively crawl routes or execute client JavaScript.',
      'It cannot reveal server source code, databases, private APIs, authentication-protected views, user-specific behavior, or unexposed application logic.',
      'No credentials, cookies, session tokens, form submissions, browser automation, vulnerability exploitation, or access-control bypasses are used.',
      canonical ? `A canonical reference was observed: ${redactSensitiveText(canonical, 300)}.` : 'No canonical-reference interpretation was performed beyond static HTML inspection.',
    ],
  });
  return result;
}
