const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const assert = require('node:assert/strict');
const { openWebsiteScan } = require('../../electron/website-scanner.cjs');
const outputDir = require('./work-dir.cjs');
app.setPath('userData', require('node:path').join(outputDir, 'scan-test-profile'));
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('PAGE:', message.slice(0, 300)); });
});
app.whenReady().then(async () => {
  let timer;
  try {
    await assert.rejects(openWebsiteScan('http://localhost'), /Localhost/);
    timer = setTimeout(async () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        const shot = await win.webContents.capturePage();
        await writeFile(require('node:path').join(outputDir, 'live-scan-panel.png'), shot.toPNG());
      }
    }, 10000);
    const result = await openWebsiteScan('https://igloo.inc');
    assert.equal(result.ok, true, result.error);
    assert.equal(result.snapshots.length, 9);
    assert.equal(result.snapshots.filter(s => s.device === 'mobile').length, 3);
    assert.ok(result.snapshots.some(s => s.viewport.startsWith('390')));
    await writeFile(require('node:path').join(outputDir, 'latest-rendered-scan.json'), JSON.stringify(result));
    console.log('OBSERVED', JSON.stringify(result.snapshots.map(s => ({ title: s.title, counts: s.counts, resources: s.resources.length }))));
    const remote = BrowserWindow.getAllWindows()[0].contentView.children.find(child => child.webContents && child.webContents.getURL().startsWith('https:'));
    if (remote) {
      await writeFile(require('node:path').join(outputDir, 'live-scan-site.png'), (await remote.webContents.capturePage()).toPNG());
      assert.equal(await remote.webContents.executeJavaScript('typeof window.fridayDesktop'), 'undefined');
      assert.equal(await remote.webContents.executeJavaScript('typeof require'), 'undefined');
    }
    assert.ok(result.snapshots.some(snapshot => snapshot.counts.canvas > 0), 'Igloo canvas should be observed');
    const win = BrowserWindow.getAllWindows()[0];
    const panel = await win.webContents.executeJavaScript('document.body.innerText');
    assert.match(panel, /COMPLETE/);
    assert.match(panel, /Typography/);
    console.log(JSON.stringify({ passed: true, samples: result.snapshots.length, title: result.snapshots[0].title, counts: result.snapshots[0].counts, resources: result.snapshots[3].resources.length }));
    await writeFile(require('node:path').join(outputDir, 'live-scan-panel-complete.png'), (await win.webContents.capturePage()).toPNG());
    await new Promise(resolve => { win.once('closed', resolve); win.close(); });
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { clearTimeout(timer); }
});
