// Configuration is public build metadata, never a place for credentials.
export type ApiConfig = { origin: string; base?: string; mode?: string };
const local = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

export function createApiClient(config: ApiConfig, transport: typeof fetch = fetch) {
  const page = new URL(config.origin);
  const mode = config.mode || (local(page) ? 'desktop' : 'private-mobile');
  const base = new URL(config.base || page.origin);
  if (!['desktop', 'private-mobile'].includes(mode) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('Invalid API configuration');
  if (base.origin !== page.origin && !(mode === 'desktop' && local(page) && local(base))) throw Error('API must share the private application origin');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local(base) && local(page))) throw Error('HTTPS required');
  function url(path: string) {
    // Reject ambiguous paths before URL normalization; no caller-controlled hosts.
    if (/[\\%#]/.test(path.split('?')[0]) || path.split('?')[0].split('/').includes('..')) throw Error('Invalid API path');
    const target = new URL(path, base);
    if (target.username || target.password || target.hash) throw Error('Invalid API destination');
    const explicitLocal = mode === 'desktop' && local(page) && local(target) && target.protocol === 'http:';
    if (target.origin !== base.origin && !explicitLocal) throw Error('API destination denied');
    if (!target.pathname.startsWith('/api/')) throw Error('API path required');
    if ((!local(page) || mode !== 'desktop') && !target.pathname.startsWith('/api/mobile/')) throw Error('Laptop capability unavailable in this application');
    return target.href;
  }
  return {
    url,
    async fetch(path: string, options: RequestInit = {}) {
      return transport(url(path), { ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    },
  };
}

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env || {};
// Lazy initialization also supports offline tests without browser globals.
function current() { return createApiClient({ origin: window.location.origin, base: env.VITE_FRIDAY_API_BASE, mode: env.VITE_FRIDAY_API_MODE }); }
export const apiFetch = (path: string, options?: RequestInit) => current().fetch(path, options);
export const apiUrl = (path: string) => current().url(path);
