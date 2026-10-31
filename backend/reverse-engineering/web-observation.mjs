import { ReverseEngineeringError } from './schemas.mjs';

// Count received bytes as they arrive; Content-Length may be missing or compressed.
export async function readBoundedHtml(response, limit) {
  const tooLarge = () => new ReverseEngineeringError('Website HTML exceeds the 1 MB safety limit.', { status: 413, code: 'web_content_too_large' });
  if (Number(response.headers.get('content-length') || 0) > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw tooLarge();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const attributes = tag => Object.fromEntries([...tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));

export function inspectHtmlStructure(html) {
  // Bounded static inspection, not a browser DOM parser. Ignore script and comment decoys.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const forms = [...markup.matchAll(/<form\b([^>]*)>([\s\S]*?)(?:<\/form\s*>|$)/gi)].slice(0, 50).map(match => {
    const attrs = attributes(' ' + match[1]);
    return {
      method: (attrs.method || 'GET').toUpperCase(),
      action: attrs.action || '(same document)',
      inputCount: (match[2].match(/<input\b/gi) || []).length,
      selectCount: (match[2].match(/<select\b/gi) || []).length,
      textareaCount: (match[2].match(/<textarea\b/gi) || []).length,
      passwordCount: [...match[2].matchAll(/<input\b[^>]*>/gi)].filter(input => (attributes(input[0]).type || '').toLowerCase() === 'password').length,
    };
  });
  const links = [...markup.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0]));
  return { forms, canonical: links.find(link => (link.rel || '').toLowerCase().split(/\s+/).includes('canonical'))?.href || null };
}
