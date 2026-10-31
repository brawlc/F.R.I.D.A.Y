import express from 'express';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function voiceInput(body) {
  if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 4000) throw new Error('Speech must contain 1–4000 characters.');
  const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return { text: body.text.trim(), rate: `${Math.round((bounded(body.rate, 0.96, 0.7, 1.2) - 1) * 100)}%`, pitch: `${Math.round((bounded(body.pitch, 1, 0.6, 1.35) - 1) * 100)}%` };
}
export function synthesize(input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [fileURLToPath(new URL('./edge-worker.mjs', import.meta.url))], { timeout: 22000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', windowsHide: true }, (error, stdout) => {
      if (error || !stdout.length) reject(new Error('Online voice unavailable.'));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
export function createVoiceRouter(generate = synthesize) {
  const router = express.Router();
  let running = 0;
  router.post('/synthesize', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let input;
    try { input = voiceInput(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (running >= 2) return res.status(429).json({ error: 'Voice busy; use local fallback.' });
    running++;
    try { res.type('audio/mpeg').send(await generate(input)); }
    catch { res.status(503).json({ error: 'Online voice unavailable; use local fallback.' }); }
    finally { running--; }
  });
  return router;
}
