const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { isServerReady } = require('./server-health.cjs');
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const localPort = process.env.PORT || '3000';
const appUrl = `http://127.0.0.1:${localPort}/?desktop=1`;
const nativeVoiceConfidenceThreshold = Number(process.env.FRIDAY_NATIVE_VOICE_CONFIDENCE || '0.35');
let mainWindow;
let gestureWindow;
let gestureWindowNormalBounds = null;
let gestureWindowCompact = false;
let serverProcess;
let serverStartupError;
let voiceProcess;
let nativeVoiceRestarting = false;
let nativeVoiceAutoRestartTimer;

function isTrustedUrl(url) {
  try { return new URL(url).origin === new URL(appUrl).origin; } catch { return false; }
}
function requireTrustedCaller(event) {
  const trusted = [mainWindow, gestureWindow].some(win => win && !win.isDestroyed() && win.webContents === event.sender);
  if (!trusted || event.senderFrame !== event.sender.mainFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('This action must come from FRIDAY.');
}
function constrainNavigation(win) {
  win.webContents.on('will-navigate', (event, url) => { if (!isTrustedUrl(url)) event.preventDefault(); });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
  process.exit(0);
}

async function isLocalServerReady() {
  return isServerReady(localPort);
}

async function startLocalServer() {
  if (await isLocalServerReady()) return;

  serverProcess = spawn('node', ['backend/server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: localPort,
      HOST: '127.0.0.1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  serverProcess.once('error', () => { serverStartupError = new Error('Could not start the local server. Check that Node.js is installed and available.'); });
  serverProcess.once('exit', code => { if (!app.isQuitting) serverStartupError = new Error(`Local server exited (${code}). Check the configured port and backend configuration.`); });
}

async function waitForServer(retries = 60) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (serverStartupError) throw serverStartupError;
    if (await isLocalServerReady()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`FRIDAY did not become ready on port ${localPort}. Close any older FRIDAY server and try again.`);
}

function showFridayWindow(forceEngage = false) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setOpacity(1);
  mainWindow.setSkipTaskbar(false);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('friday:window-shown', { forceEngage });
  }
}

function focusFridayWindow(forceEngage = true) {
  if (!mainWindow) return;
  showFridayWindow(forceEngage);
  if (!mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(true);
  }
}

function exitFridayFullScreen() {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  showFridayWindow(false);
}

function toggleFridayFullScreen() {
  if (!mainWindow) return;
  showFridayWindow(false);
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
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

function runWindowsGeolocator() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Windows location is unavailable on this platform.' });
      return;
    }

    const script = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
      Function Await($operation, $resultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
        $task = $asTask.Invoke($null, @($operation))
        $task.Wait(15000) | Out-Null
        return $task.Result
      }
      [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
      [Windows.Devices.Geolocation.Geoposition,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
      $geolocator = [Windows.Devices.Geolocation.Geolocator]::new()
      $geolocator.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::High
      $geolocator.ReportInterval = 1000
      $position = Await $geolocator.GetGeopositionAsync() ([Windows.Devices.Geolocation.Geoposition])
      $coord = $position.Coordinate.Point.Position
      $accuracy = $position.Coordinate.Accuracy
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      @{ lat = $coord.Latitude; lon = $coord.Longitude; accuracy = $accuracy } | ConvertTo-Json -Compress
    `;

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 1024 * 256,
    }, (error, stdout, stderr) => {
      if (error || !stdout) {
        resolve({ ok: false, error: stderr?.trim() || error?.message || 'Windows Location service did not return a position.' });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (typeof result.lat !== 'number' || typeof result.lon !== 'number') {
          resolve({ ok: false, error: 'Windows Location service returned an invalid position.' });
          return;
        }
        resolve({
          ok: true,
          lat: result.lat,
          lon: result.lon,
          accuracy: typeof result.accuracy === 'number' ? result.accuracy : null,
          source: 'windows-location',
        });
      } catch (parseError) {
        resolve({ ok: false, error: parseError instanceof Error ? parseError.message : 'Could not parse Windows Location result.' });
      }
    });
  });
}

function getWifiBasedLocation() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Windows Wi-Fi location fallback is unavailable on this platform.' });
      return;
    }

    execFile('netsh.exe', ['wlan', 'show', 'networks', 'mode=bssid'], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }, async (error, stdout) => {
      if (error || !stdout) {
        resolve({ ok: false, error: error?.message || 'Could not scan Wi-Fi networks.' });
        return;
      }

      const wifiAccessPoints = [];
      const lines = stdout.split(/\r?\n/);
      let current = null;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        const bssidMatch = line.match(/^BSSID\s+\d+\s*:\s*([0-9a-f:.-]{12,})/i);
        if (bssidMatch) {
          current = { macAddress: bssidMatch[1].replace(/-/g, ':') };
          wifiAccessPoints.push(current);
          continue;
        }

        const signalMatch = line.match(/^Signal\s*:\s*(\d+)%/i);
        if (signalMatch && current) {
          current.signalStrength = Math.min(-30, Math.round(Number(signalMatch[1]) / 2 - 100));
        }
      }

      const filtered = wifiAccessPoints.filter(item => item.macAddress).slice(0, 20);
      if (filtered.length < 2) {
        resolve({ ok: false, error: 'Not enough nearby Wi-Fi access points for location fallback.' });
        return;
      }

      try {
        const response = await fetch('https://www.googleapis.com/geolocation/v1/geolocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            considerIp: true,
            wifiAccessPoints: filtered,
          }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.location) {
          resolve({ ok: false, error: result?.error?.message || `Google geolocation returned ${response.status}.` });
          return;
        }
        resolve({
          ok: true,
          lat: result.location.lat,
          lon: result.location.lng,
          accuracy: result.accuracy || null,
          source: 'windows-wifi',
        });
      } catch (fetchError) {
        resolve({ ok: false, error: fetchError instanceof Error ? fetchError.message : 'Wi-Fi location request failed.' });
      }
    });
  });
}

async function getBestWindowsLocation() {
  const windowsLocation = await runWindowsGeolocator();
  if (windowsLocation.ok) return windowsLocation;

  const wifiLocation = await getWifiBasedLocation();
  if (wifiLocation.ok) return wifiLocation;

  return {
    ok: false,
    error: `${windowsLocation.error || 'Windows Location failed'}; ${wifiLocation.error || 'Wi-Fi fallback failed'}`,
  };
}

async function clearRendererCache() {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['appcache', 'shadercache', 'serviceworkers', 'cachestorage'],
    });
  } catch (error) {
    console.warn('Could not clear renderer cache:', error);
  }
}

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(Boolean(contents && isTrustedUrl(contents.getURL()) && isTrustedUrl(details.requestingUrl || contents.getURL()) && (permission === 'media' || permission === 'geolocation')));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return Boolean(contents && isTrustedUrl(contents.getURL()) && isTrustedUrl(requestingOrigin) && (permission === 'media' || permission === 'geolocation'));
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#050505',
    title: 'F.R.I.D.A.Y',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#05080b',
      symbolColor: '#67e8f9',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  constrainNavigation(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.key === 'Escape') {
      exitFridayFullScreen();
      event.preventDefault();
      return;
    }

    if (input.key === 'F11') {
      toggleFridayFullScreen();
      event.preventDefault();
    }
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

  const cacheBustedUrl = `${appUrl}&v=${Date.now()}`;
  mainWindow.loadURL(cacheBustedUrl);
  mainWindow.once('ready-to-show', () => showFridayWindow(true));
  // Command speech now uses the browser mic meter plus local Whisper. The
  // Windows recognizer is intentionally not started because it is blocked on
  // some Windows installs and can steal/confuse command transcripts.
}

function openGestureControlWindow() {
  if (gestureWindow && !gestureWindow.isDestroyed()) {
    if (gestureWindow.isMinimized()) gestureWindow.restore();
    if (gestureWindowCompact && gestureWindowNormalBounds) {
      gestureWindow.setBounds(gestureWindowNormalBounds);
      gestureWindow.setOpacity(1);
      gestureWindow.setSkipTaskbar(false);
      gestureWindowCompact = false;
    }
    gestureWindow.show();
    gestureWindow.focus();
    return true;
  }

  gestureWindow = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 220,
    minHeight: 180,
    show: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#07090d',
    title: 'FRIDAY Gesture Cursor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  gestureWindow.setMenuBarVisibility(false);
  constrainNavigation(gestureWindow);
  gestureWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  gestureWindow.loadURL(`http://127.0.0.1:${localPort}/gesture-control.html?desktop=1&v=${Date.now()}`);
  gestureWindow.on('minimize', (event) => {
    event.preventDefault();
    if (!gestureWindow || gestureWindow.isDestroyed()) return;
    gestureWindowNormalBounds = gestureWindow.getBounds();
    gestureWindowCompact = true;
    setTimeout(() => {
      if (!gestureWindow || gestureWindow.isDestroyed()) return;
      if (gestureWindow.isMinimized()) gestureWindow.restore();
      gestureWindow.setOpacity(0.86);
      gestureWindow.setSkipTaskbar(true);
      gestureWindow.setAlwaysOnTop(true, 'screen-saver');
      gestureWindow.setBounds({ width: 260, height: 220, x: 20, y: 20 });
      gestureWindow.showInactive();
    }, 0);
  });

  gestureWindow.on('restore', () => {
    if (!gestureWindow || gestureWindow.isDestroyed()) return;
    gestureWindow.setOpacity(1);
    gestureWindow.setSkipTaskbar(false);
    gestureWindowCompact = false;
  });

  gestureWindow.on('closed', () => {
    gestureWindow = null;
    gestureWindowCompact = false;
  });

  return true;
}

app.on('second-instance', () => {
  focusFridayWindow(true);
});

app.whenReady().then(async () => {
  ipcMain.handle('friday:studio-code', async (event, id) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== `http://127.0.0.1:${localPort}`) throw new Error('Editor opening must be requested from FRIDAY.');
    return require('./studio-browser.cjs').openStudioInCode(String(id), localPort);
  });
  ipcMain.handle('friday:studio-open', async (event, id, download) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== `http://127.0.0.1:${localPort}`) throw new Error('Project opening must be requested from FRIDAY.');
    return require('./studio-browser.cjs').openStudioProject(String(id), localPort, download !== false);
  });
  ipcMain.handle('friday:scan-website', async (event, url) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Scan requests must come from FRIDAY.');
    const senderUrl = new URL(event.senderFrame.url);
    if (senderUrl.origin !== `http://127.0.0.1:${localPort}`) throw new Error('Untrusted scan request.');
    return require('./website-scanner.cjs').openWebsiteScan(String(url || ''));
  });
  ipcMain.on('friday:show-window', () => showFridayWindow(true));
  ipcMain.on('friday:focus-window', () => focusFridayWindow(true));
  ipcMain.on('friday:exit-fullscreen', () => exitFridayFullScreen());
  ipcMain.handle('friday:restart-native-voice', async () => {
    sendNativeVoiceStatus('Windows native voice is disabled; using local Whisper.');
    return false;
  });
  ipcMain.handle('friday:open-external-url', async (event, url) => {
    requireTrustedCaller(event);
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return false;
    await shell.openExternal(target);
    return true;
  });
  ipcMain.handle('friday:open-gesture-control', async event => { requireTrustedCaller(event); return openGestureControlWindow(); });
  ipcMain.handle('friday:get-windows-location', async event => { requireTrustedCaller(event); return getBestWindowsLocation(); });
  await startLocalServer();
  await waitForServer();
  await clearRendererCache();
  createWindow();
}).catch(error => {
  dialog.showErrorBox('FRIDAY could not start', error instanceof Error ? error.message : 'Startup failed.');
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
  if (gestureWindow && !gestureWindow.isDestroyed()) gestureWindow.destroy();
  stopNativeVoiceListener();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('activate', () => {
  showFridayWindow(true);
});
