import express from 'express';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const canUseDesktopBridge = process.platform === 'win32' && !process.env.RENDER;
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const googleSearchApiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

const openTargets = {
  instagram: 'https://www.instagram.com/',
  youtube: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  gmail: 'https://mail.google.com/',
  whatsapp: 'https://web.whatsapp.com/',
  chatgpt: 'https://chatgpt.com/',
  github: 'https://github.com/',
  facebook: 'https://www.facebook.com/',
  twitter: 'https://x.com/',
  linkedin: 'https://www.linkedin.com/',
  amazon: 'https://www.amazon.com/',
  netflix: 'https://www.netflix.com/',
  spotify: 'https://open.spotify.com/',
  maps: 'https://www.google.com/maps',
};

app.use(express.json({ limit: '15mb' }));

app.use('/api/desktop', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get('/api/desktop/status', (_req, res) => {
  res.json({
    ok: true,
    desktopBridge: canUseDesktopBridge,
    platform: process.platform,
  });
});

app.post('/api/transcribe', async (req, res) => {
  if (!gemini) {
    res.status(500).json({
      ok: false,
      error: 'GEMINI_API_KEY is missing in .env.local.',
    });
    return;
  }

  const audioBase64 = String(req.body?.audioBase64 || '');
  const mimeType = String(req.body?.mimeType || 'audio/webm');

  if (!audioBase64) {
    res.status(400).json({
      ok: false,
      error: 'No audio payload received.',
    });
    return;
  }

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{
        role: 'user',
        parts: [
          {
            text: [
              'Transcribe the entire audio clip exactly as spoken.',
              'Preserve long sentences, command details, app names, file names, punctuation when clear, and the wake word if it was spoken.',
              'Do not summarize, shorten, correct intent, add commentary, add labels, add markdown, or wrap the result in quotes.',
              'Return only the spoken words.'
            ].join(' ')
          },
          {
            inlineData: {
              data: audioBase64,
              mimeType,
            }
          }
        ]
      }]
    });

    res.json({
      ok: true,
      text: response.text?.trim() || '',
    });
  } catch (error) {
    console.error('Gemini transcription error:', error);
    let message = error instanceof Error ? error.message : 'Gemini transcription failed.';

    try {
      const parsed = JSON.parse(message);
      message = parsed?.error?.message || message;
    } catch {
      // Keep the original SDK error message.
    }

    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

app.post('/api/chat', async (req, res) => {
  if (!gemini) {
    res.status(500).json({
      ok: false,
      error: 'GEMINI_API_KEY is missing on the server.',
    });
    return;
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const latestUserMessage = [...messages].reverse().find(message => message?.role === 'user');
  const text = String(latestUserMessage?.content || '').trim();
  const systemInstruction = String(req.body?.systemInstruction || '').trim();

  if (!text) {
    res.status(400).json({
      ok: false,
      error: 'No user message received.',
    });
    return;
  }

  try {
    const webContext = await getWebContextForPrompt(text);
    const promptText = webContext
      ? [
          text,
          '',
          'WEB SEARCH CONTEXT',
          'Use these Google Custom Search results when they help answer the user. Prefer the listed source URLs for current facts. If the results are weak or unrelated, say so briefly instead of pretending certainty.',
          webContext,
          '',
          'When using web results, include a short Sources section with the URLs you relied on.'
        ].join('\n')
      : text;

    const response = await gemini.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: systemInstruction ? { systemInstruction } : undefined,
      contents: [{
        role: 'user',
        parts: [{ text: promptText }],
      }],
    });

    res.json({
      ok: true,
      text: response.text?.trim() || '',
    });
  } catch (error) {
    console.error('Gemini chat error:', error);
    let message = error instanceof Error ? error.message : 'Gemini chat failed.';

    try {
      const parsed = JSON.parse(message);
      message = parsed?.error?.message || message;
    } catch {
      // Keep the SDK message.
    }

    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

function shouldUseWebSearch(text) {
  const normalized = text.toLowerCase();
  return /\b(search|google|research|look up|lookup|find out|latest|today|current|currently|recent|news|price|weather|score|schedule|source|sources|citation|cite|verify)\b/.test(normalized)
    || /\b(who is|what is|when is|where is|how much|which)\b/.test(normalized);
}

function formatSearchResult(item, index) {
  const title = String(item?.title || 'Untitled result').trim();
  const link = String(item?.link || '').trim();
  const snippet = String(item?.snippet || '').replace(/\s+/g, ' ').trim();
  return `${index + 1}. ${title}\nURL: ${link}\nSummary: ${snippet}`;
}

async function getWebContextForPrompt(text) {
  if (!shouldUseWebSearch(text)) return '';
  if (!googleSearchApiKey || !googleSearchEngineId) return '';

  const params = new URLSearchParams({
    key: googleSearchApiKey,
    cx: googleSearchEngineId,
    q: text,
    num: '5',
    safe: 'active',
  });

  try {
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('Google Custom Search error:', result?.error?.message || response.statusText);
      return '';
    }

    const items = Array.isArray(result?.items) ? result.items : [];
    return items
      .filter(item => item?.link)
      .slice(0, 5)
      .map(formatSearchResult)
      .join('\n\n');
  } catch (error) {
    console.error('Google Custom Search request failed:', error);
    return '';
  }
}

const userProfile = process.env.USERPROFILE || process.env.HOME || '';
const operaGxCandidates = [
  join(userProfile, 'AppData', 'Local', 'Programs', 'Opera GX', 'launcher.exe'),
  join(userProfile, 'AppData', 'Local', 'Programs', 'Opera GX', 'opera.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Opera GX', 'launcher.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Opera GX', 'launcher.exe'),
];
const operaGxExecutable = operaGxCandidates.find(path => existsSync(path));
const localTargets = {
  'opera gx': operaGxExecutable
    ? { command: operaGxExecutable }
    : { command: 'cmd.exe', args: ['/c', 'start', '', 'opera'] },
  opera: operaGxExecutable
    ? { command: operaGxExecutable }
    : { command: 'cmd.exe', args: ['/c', 'start', '', 'opera'] },
  notepad: { command: 'notepad.exe' },
  calculator: { command: 'calc.exe' },
  camera: { command: 'cmd.exe', args: ['/c', 'start', '', 'microsoft.windows.camera:'] },
  settings: { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:'] },
  explorer: { command: 'explorer.exe' },
  files: { command: 'explorer.exe' },
  downloads: { command: 'explorer.exe', args: [join(userProfile, 'Downloads')] },
  documents: { command: 'explorer.exe', args: [join(userProfile, 'Documents')] },
  desktop: { command: 'explorer.exe', args: [join(userProfile, 'Desktop')] },
  pictures: { command: 'explorer.exe', args: [join(userProfile, 'Pictures')] },
  music: { command: 'explorer.exe', args: [join(userProfile, 'Music')] },
  videos: { command: 'explorer.exe', args: [join(userProfile, 'Videos')] },
  vscode: { command: 'cmd.exe', args: ['/c', 'start', '', 'code'] },
  'vs code': { command: 'cmd.exe', args: ['/c', 'start', '', 'code'] },
};

function normalizeCommandText(rawTarget = '') {
  return String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTargetPhrase(command, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(command);
}

function findTarget(rawTarget, targets) {
  const target = normalizeCommandText(rawTarget);
  return Object.entries(targets)
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => hasTargetPhrase(target, name));
}

function resolveOpenTarget(rawTarget = '') {
  const target = normalizeCommandText(rawTarget);
  const explicitX = /(?:^|\s)(?:open|launch|start)\s+x(?:\s|$)/.test(target);
  if (explicitX) return { name: 'x', url: 'https://x.com/' };

  const match = findTarget(rawTarget, openTargets);
  return match ? { name: match[0], url: match[1] } : null;
}

function resolveLocalTarget(rawTarget = '') {
  const match = findTarget(rawTarget, localTargets);
  return match ? { name: match[0], target: match[1] } : null;
}

function openUrl(url) {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function openLocalTarget(target) {
  spawn(target.command, target.args || [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

app.post('/api/desktop/open', (req, res) => {
  const rawTarget = req.body?.target;
  const resolvedLocal = resolveLocalTarget(rawTarget);

  if (resolvedLocal) {
    if (!canUseDesktopBridge) {
      res.status(503).json({
        ok: false,
        desktopBridge: false,
        message: 'Local desktop bridge is not available from this hosted server. Keep FRIDAY running on your Windows desktop to open apps and folders.',
      });
      return;
    }

    openLocalTarget(resolvedLocal.target);
    res.json({
      ok: true,
      desktopBridge: true,
      name: resolvedLocal.name,
      message: `Opening ${resolvedLocal.name}.`,
    });
    return;
  }

  const resolved = resolveOpenTarget(rawTarget);

  if (!resolved) {
    res.status(400).json({
      ok: false,
      message: `I can open: ${[...Object.keys(openTargets), ...Object.keys(localTargets)].join(', ')}.`,
    });
    return;
  }

  if (canUseDesktopBridge) openUrl(resolved.url);
  res.json({
    ok: true,
    desktopBridge: canUseDesktopBridge,
    clientOpen: !canUseDesktopBridge,
    name: resolved.name,
    url: resolved.url,
    message: `Opening ${resolved.name}.`,
  });
});

if (process.env.NODE_ENV === 'production' && existsSync(resolve(__dirname, 'dist'))) {
  app.use(express.static(resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`FRIDAY online: http://${host}:${port}`);
});
