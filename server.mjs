import express from 'express';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const canUseDesktopBridge = process.platform === 'win32' && !process.env.RENDER;

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

app.use(express.json({ limit: '1mb' }));

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
