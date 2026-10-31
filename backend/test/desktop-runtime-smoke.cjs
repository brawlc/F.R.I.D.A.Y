// Run with the installed Electron executable; never opens a visible window.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'friday-runtime-smoke-')));
const timer = setTimeout(() => { console.error('Desktop runtime smoke timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<h1>FRIDAY runtime test</h1>');
  const result = await win.webContents.executeJavaScript('({ title: document.querySelector("h1").textContent, node: typeof require })');
  assert.equal(result.title, 'FRIDAY runtime test');
  assert.equal(result.node, 'undefined');
  console.log(`PASS: Electron ${process.versions.electron}, sandboxed renderer loads without Node access.`);
  win.destroy(); clearTimeout(timer); app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
