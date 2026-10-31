async function isServerReady(port, fetcher = fetch) {
  try {
    const response = await fetcher(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.service === 'friday' && body?.status === 'ready';
  } catch { return false; }
}
module.exports = { isServerReady };
