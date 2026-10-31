// Offline Electron integration check: no remote sites, user profiles or API calls.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { inspectRenderedPage } = require('../../electron/scan-probe.cjs');
app.setPath('userData', require('node:path').join(require('./work-dir.cjs'), 'probe-fixture-profile'));
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL('data:text/html,' + encodeURIComponent('<html><style>nav{position:fixed;display:flex;gap:8px;border-radius:12px;width:300px;height:60px}main{height:2000px} @keyframes pulse{to{opacity:.5}}h1{animation:pulse 2s linear infinite}</style><nav>Menu</nav><main><h1>Product</h1></main></html>'));
    const snapshot = await win.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${inspectRenderedPage.toString()})(0,true)` }]);
    const nav = snapshot.blocks.find(block => block.tag === 'nav');
    assert.equal(nav.position, 'fixed');
    assert.equal(nav.gap, '8px');
    assert.equal(nav.borderRadius, '12px');
    assert.equal(snapshot.animations, 1, 'The scanner sweep must not count as a page animation');
    assert.equal(snapshot.motion[0].target, 'h1');
    assert.equal(snapshot.motion[0].duration, 2000);
    assert.ok(snapshot.sampledAt);
    console.log('PASS: real Chromium geometry and motion sampling; overlay excluded.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
