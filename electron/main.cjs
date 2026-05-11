const { app, BrowserWindow, ipcMain, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const appUrl = 'http://127.0.0.1:3000/?desktop=1';
let mainWindow;
let serverProcess;

function startLocalServer() {
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
    try {
      const response = await fetch('http://127.0.0.1:3000/api/desktop/status');
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function showFridayWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    show: false,
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
      mainWindow.hide();
    }
  });

  mainWindow.loadURL(appUrl);
}

app.whenReady().then(async () => {
  ipcMain.on('friday:show-window', showFridayWindow);
  startLocalServer();
  await waitForServer();
  createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('activate', () => {
  showFridayWindow();
});
