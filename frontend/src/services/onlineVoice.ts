import { apiFetch } from './apiClient';
// Temporary audio only: no persistent cache or saved speech history.
export async function playOnlineVoice(text: string, rate: number, pitch: number, signal: AbortSignal) {
  const response = await apiFetch('/api/voice/synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, rate, pitch }), signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
  });
  if (!response.ok) throw new Error('Online voice unavailable');
  const url = URL.createObjectURL(await response.blob());
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { audio.pause(); resolve(); };
      signal.addEventListener('abort', stop, { once: true });
      const finish = () => { signal.removeEventListener('abort', stop); resolve(); };
      audio.onended = finish;
      audio.onerror = () => { signal.removeEventListener('abort', stop); reject(new Error('Audio playback failed')); };
      if (signal.aborted) { finish(); return; }
      void audio.play().catch(error => { signal.removeEventListener('abort', stop); reject(error); });
    });
  } finally { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
}
