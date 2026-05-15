const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const appUrl = 'http://127.0.0.1:3000/?desktop=1';
const nativeVoiceConfidenceThreshold = Number(process.env.FRIDAY_NATIVE_VOICE_CONFIDENCE || '0.35');
let mainWindow;
let serverProcess;
let voiceProcess;
let nativeVoiceRestarting = false;
let nativeVoiceAutoRestartTimer;

async function isLocalServerReady() {
  try {
    const statusResponse = await fetch('http://127.0.0.1:3000/api/desktop/status');
    if (!statusResponse.ok) return false;

    const newsResponse = await fetch('http://127.0.0.1:3000/api/news/top-headline');
    const contentType = newsResponse.headers.get('content-type') || '';
    return contentType.includes('application/json');
  } catch {
    return false;
  }
}

async function startLocalServer() {
  if (await isLocalServerReady()) return;

  serverProcess = spawn('node', ['server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: '3000',
      HOST: '127.0.0.1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForServer(retries = 60) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await isLocalServerReady()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function showFridayWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setOpacity(1);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('friday:window-shown');
  }
}

function sendNativeVoiceStatus(status) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('friday:native-voice-status', status);
}

function startNativeVoiceListener() {
  if (process.platform !== 'win32' || voiceProcess) return;
  if (nativeVoiceAutoRestartTimer) {
    clearTimeout(nativeVoiceAutoRestartTimer);
    nativeVoiceAutoRestartTimer = null;
  }

  voiceProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'windows-voice-listener.ps1'),
  ], {
    cwd: projectRoot,
    windowsHide: true,
  });

  voiceProcess.stdout.setEncoding('utf8');
  voiceProcess.stdout.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      const raw = line.trim();
      if (!raw || !mainWindow || mainWindow.webContents.isDestroyed()) continue;

      try {
        const event = JSON.parse(raw);
        const type = String(event?.type || '');
        const text = String(event?.text || '').trim();
        const confidence = Number(event?.confidence || 0);

        if (type === 'recognized' && text) {
          if (confidence < nativeVoiceConfidenceThreshold && !/\bfriday\b/i.test(text)) {
            mainWindow.webContents.send('friday:native-voice-status', `Heard unclearly (${confidence.toFixed(2)}): ${text}`);
            continue;
          }

          mainWindow.webContents.send('friday:native-voice-command', text);
          continue;
        }

        if (type === 'hypothesis' && text) {
          mainWindow.webContents.send('friday:native-voice-status', `Hearing: ${text}`);
          continue;
        }

        if (type === 'rejected') {
          mainWindow.webContents.send('friday:native-voice-status', text ? `Heard unclearly: ${text}` : 'Heard sound, but speech was unclear');
          continue;
        }

        if ((type === 'status' || type === 'error') && text) {
          mainWindow.webContents.send('friday:native-voice-status', text);
        }
      } catch {
        mainWindow.webContents.send('friday:native-voice-command', raw);
      }
    }
  });

  voiceProcess.stderr.setEncoding('utf8');
  voiceProcess.stderr.on('data', (chunk) => {
    const status = chunk.trim();
    if (status) sendNativeVoiceStatus(status);
  });

  voiceProcess.on('exit', () => {
    voiceProcess = null;
    if (!nativeVoiceRestarting) {
      sendNativeVoiceStatus('Windows native voice listener stopped.');
      if (!app.isQuitting && mainWindow && !mainWindow.webContents.isDestroyed()) {
        nativeVoiceAutoRestartTimer = setTimeout(() => {
          nativeVoiceAutoRestartTimer = null;
          sendNativeVoiceStatus('Restarting Windows native voice listener');
          startNativeVoiceListener();
        }, 1200);
      }
    }
  });
}

function stopNativeVoiceListener() {
  if (nativeVoiceAutoRestartTimer) {
    clearTimeout(nativeVoiceAutoRestartTimer);
    nativeVoiceAutoRestartTimer = null;
  }
  if (!voiceProcess) return;
  const processToStop = voiceProcess;
  voiceProcess = null;
  processToStop.kill();
}

function restartNativeVoiceListener() {
  nativeVoiceRestarting = true;
  sendNativeVoiceStatus('Restarting Windows voice listener');
  stopNativeVoiceListener();
  setTimeout(() => {
    nativeVoiceRestarting = false;
    startNativeVoiceListener();
  }, 450);
}

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    show: true,
    backgroundColor: '#050505',
    title: 'F.R.I.D.A.Y',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('friday:window-hidden');
      }
      mainWindow.setOpacity(0.01);
      mainWindow.setSkipTaskbar(true);
      mainWindow.setIgnoreMouseEvents(true);
      mainWindow.blur();
    }
  });

  mainWindow.on('hide', () => {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('friday:window-hidden');
    }
  });

  mainWindow.loadURL(appUrl);
  mainWindow.once('ready-to-show', showFridayWindow);
  // Command speech now uses the browser mic meter plus local Whisper. The
  // Windows recognizer is intentionally not started because it is blocked on
  // some Windows installs and can steal/confuse command transcripts.
}

app.whenReady().then(async () => {
  ipcMain.on('friday:show-window', showFridayWindow);
  ipcMain.handle('friday:restart-native-voice', async () => {
    sendNativeVoiceStatus('Windows native voice is disabled; using local Whisper.');
    return false;
  });
  ipcMain.handle('friday:open-external-url', async (_event, url) => {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return false;
    await shell.openExternal(target);
    return true;
  });
  await startLocalServer();
  await waitForServer();
  createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
  stopNativeVoiceListener();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('activate', () => {
  showFridayWindow();
});
