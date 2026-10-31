const { app, BrowserWindow } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openStudioProject } = require('../../electron/studio-browser.cjs');
const outputDir = require('./work-dir.cjs');
app.setPath('userData', path.join(outputDir, 'studio-preview-test-profile'));
app.whenReady().then(async () => {
  try {
    const project = JSON.parse(await readFile(path.join(outputDir, 'studio-live-result.json'), 'utf8'));
    const result = await openStudioProject(project.id, 3000, true);
    assert.equal(result.browser, 'Opera GX');
    const archive = await readFile(result.downloadPath);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await win.loadURL(result.previewUrl);
    const state = await win.webContents.executeJavaScript(`(() => {
      const filter = document.querySelector('[data-filter="technology"]');
      if (filter) filter.click();
      const detail = document.querySelector('[data-detail]'); if (detail) detail.click();
      return { title: document.title, body: document.body.innerText.length, visibleProjects: document.querySelectorAll('[data-category]:not([hidden])').length, dialog: Boolean(document.querySelector('dialog[open]')), scripts: document.scripts.length };
    })()`);
    assert.ok(state.body > 100);
    if (project.generation === 'adaptive-template') { assert.equal(state.visibleProjects, 1); assert.equal(state.dialog, true); }
    await writeFile(path.join(outputDir, 'studio-preview.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('dialog[open]')?.close()`);
    win.setSize(390, 844);
    await new Promise(resolve => setTimeout(resolve, 500));
    const mobile = await win.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth})`);
    assert.ok(mobile.scroll <= mobile.width + 1, JSON.stringify(mobile));
    console.log(JSON.stringify({ passed: true, ...result, state, mobile }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
