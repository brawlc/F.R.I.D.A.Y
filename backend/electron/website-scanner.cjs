const { BrowserWindow, WebContentsView, session, ipcMain } = require('electron');
const { lookup } = require('node:dns/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { inspectRenderedPage } = require('./scan-probe.cjs');
let currentScan;

async function openWebsiteScan(rawUrl) {
  if (currentScan && !currentScan.isDestroyed()) throw new Error('Close the existing scan window before starting another scan.');
  const { normalizeAuthorizedWebsiteTarget, isPublicAddress, isAllowedWebsiteRedirect } = await import('../reverse-engineering/web.mjs');
  const target = normalizeAuthorizedWebsiteTarget(rawUrl);
  const publicHost = async hostname => {
    const records = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true });
    return records.length > 0 && records.every(r => isPublicAddress(r.address, r.family));
  };
  if (!await publicHost(target.hostname)) throw new Error('The scan requires a public website address.');
  const isolatedSession = session.fromPartition(`friday-scan-${randomUUID()}`);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on('will-download', event => event.preventDefault());
  const hostChecks = new Map();
  isolatedSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    let url;
    try { url = new URL(details.url); } catch { callback({ cancel: true }); return; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) { callback({ cancel: true }); return; }
    if (details.resourceType === 'mainFrame' && !isAllowedWebsiteRedirect(target, url)) { callback({ cancel: true }); return; }
    if (!hostChecks.has(url.hostname)) hostChecks.set(url.hostname, publicHost(url.hostname).catch(() => false));
    hostChecks.get(url.hostname).then(allowed => callback({ cancel: !allowed }));
  });
  const win = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 600, title: 'FRIDAY — Live website scan', backgroundColor: '#07111e', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'scan-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  currentScan = win;
  const page = new WebContentsView({ webPreferences: { session: isolatedSession, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  page.webContents.setAudioMuted(true);
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  page.webContents.on('will-navigate', (event, url) => { if (url !== page.webContents.getURL()) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.contentView.addChildView(page);
  const layout = () => { const [width, height] = win.getContentSize(); page.setBounds({ x: 0, y: 68, width: Math.max(1, width - 360), height: Math.max(1, height - 68) }); };
  layout(); win.on('resize', layout);
  let stopped = false;
  let latest;
  const snapshots = [];
  const stop = event => { if (event.sender === win.webContents) { stopped = true; page.webContents.stop(); } };
  ipcMain.on('friday:scan-stop', stop);
  win.on('closed', () => {
    stopped = true;
    ipcMain.removeListener('friday:scan-stop', stop);
    if (!page.webContents.isDestroyed()) page.webContents.close();
    isolatedSession.closeAllConnections().catch(() => {});
    isolatedSession.clearStorageData().catch(() => {});
    if (currentScan === win) currentScan = null;
  });
  const emit = (state, message, progress = 0) => {
    if (!win.isDestroyed()) win.webContents.send('friday:scan-update', { state, message, progress, url: latest?.url || target.origin + target.pathname, snapshot: latest });
  };
  const probe = async (fraction, active) => {
    const snapshot = await page.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${inspectRenderedPage.toString()})(${JSON.stringify(fraction)},${active})` }]);
    // Chromium's DOM inspector also sees closed web-component roots. Standard
    // document queries cannot see those even though their pixels are visible.
    if (!page.webContents.debugger.isAttached()) {
      page.webContents.debugger.attach('1.3');
      await page.webContents.debugger.sendCommand('DOM.enable');
      await page.webContents.debugger.sendCommand('CSS.enable');
    }
    const { root } = await page.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const nodes = []; let shadows = 0;
    const walk = node => {
      if (nodes.length >= 10000 || node.attributes?.includes('__fridayScanOverlay')) return;
      if (node.nodeType === 1) nodes.push(node);
      if (node.shadowRoots) shadows += node.shadowRoots.length;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    walk(root);
    if (shadows > 0) {
      for (const key of Object.keys(snapshot.counts)) snapshot.counts[key] = nodes.filter(n => n.localName === key).length;
      snapshot.technology = snapshot.technology.filter(s => !s.includes('shadow roots'));
      snapshot.technology.push(`${shadows} shadow roots observed by Chromium: web-component structure`);
      if (snapshot.counts.canvas && !snapshot.technology.some(s => s.includes('Canvas'))) snapshot.technology.push('Canvas rendering observed; the 3D engine is not confirmed');
      const fonts = new Set(snapshot.fonts);
      const blocks = [];
      for (const node of nodes.filter(n => /^(canvas|header|nav|main|section|article|footer|video|h1|p|span|a|button)$/.test(n.localName)).slice(0, 60)) {
        try {
          const { model } = await page.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId: node.nodeId });
          if (model.width < 20 || model.height < 15) continue;
          const { computedStyle } = await page.webContents.debugger.sendCommand('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
          const css = Object.fromEntries(computedStyle.map(p => [p.name, p.value]));
          if (css['font-family']) fonts.add(css['font-family']);
          if (css.visibility === 'hidden' || css.display === 'none') continue;
          if (/^(canvas|header|nav|main|section|article|footer|video|h1)$/.test(node.localName)) blocks.push({ tag: node.localName, width: model.width, height: model.height, layout: css.display, position: css.position, x: model.border[0], y: model.border[1] });
        } catch { /* Nodes can disappear during animated client rendering. */ }
      }
      snapshot.fonts = [...fonts].slice(-8);
      snapshot.blocks = blocks.slice(0, 30);
      const labels = JSON.stringify(blocks.slice(0, 12));
      await page.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => { const root = document.getElementById('__fridayScanOverlay')?.shadowRoot; if (!root) return; for (const b of ${labels}) { const box = document.createElement('div'); box.className = 'box'; box.style.cssText = 'left:'+b.x+'px;top:'+b.y+'px;width:'+Math.min(b.width,innerWidth)+'px;height:'+Math.min(b.height,innerHeight)+'px'; const label = document.createElement('span'); label.className = 'label'; label.textContent = b.tag+' · '+b.layout+' · '+b.width+' × '+b.height; box.appendChild(label); root.appendChild(box); } })()` }]);
    }
    return snapshot;
  };
  let deadline;
  try {
    await win.loadFile(path.join(__dirname, 'scan-panel.html'));
    emit('CONNECTING', 'Loading the real website in an isolated browser session.');
    await Promise.race([
      page.webContents.loadURL(target.toString()),
      new Promise((_, reject) => { deadline = setTimeout(() => { page.webContents.stop(); reject(new Error('The website did not finish loading within 30 seconds.')); }, 30000); }),
    ]);
    clearTimeout(deadline);
    // Heavy client-rendered sites can finish document loading before their
    // models, textures and application UI are ready. Observe that startup.
    for (let attempt = 0; attempt < 25 && !stopped && !win.isDestroyed(); attempt += 1) {
      latest = await probe(null, true);
      emit('SCANNING', `Waiting for the rendered interface: ${latest.resources.length} resource entries observed…`, 0);
      if (latest.blocks.length > 0 || latest.counts.canvas > 0 || latest.counts.img > 0) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1, 0, 0.5, 1];
    for (const [index, fraction] of samples.entries()) {
      if (stopped || win.isDestroyed()) break;
      if (index === 6) await page.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      if (index > 0) page.webContents.sendInputEvent({ type: 'mouseWheel', x: 300, y: 300, deltaY: -600, deltaX: 0 });
      await probe(fraction, true);
      emit('SCANNING', `Inspecting ${index < 6 ? 'desktop' : 'mobile'} viewport ${index + 1} of ${samples.length}. Waiting for lazy content and rendered styles…`, Math.round(index / samples.length * 100));
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (stopped || win.isDestroyed()) break;
      latest = await probe(null, true);
      latest.device = index < 6 ? 'desktop' : 'mobile';
      snapshots.push(latest);
      emit('SCANNING', `Measured ${latest.device} viewport ${index + 1}: ${latest.blocks.length} visible blocks, ${latest.resources.length} resource entries.`, Math.round((index + 1) / samples.length * 100));
    }
    if (!win.isDestroyed()) {
      await page.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await probe(0, false).catch(() => {});
      const sparse = snapshots.every(sample => sample.blocks.length === 0 && sample.counts.canvas === 0);
      emit(stopped ? 'STOPPED' : 'COMPLETE', stopped ? 'Scan stopped. Collected observations remain available.' : sparse ? 'Sampling complete, but little rendered content was detected. This site may still be loading or may not run in this session.' : 'Desktop and mobile samples complete. Return to FRIDAY to build with these observations.', stopped ? Math.round(snapshots.length / samples.length * 100) : 100);
    }
    return { ok: !stopped, cancelled: stopped, snapshots, requestedUrl: target.toString(), url: latest?.url || target.toString() };
  } catch (error) {
    emit(stopped ? 'STOPPED' : 'FAILED', stopped ? 'Scan cancelled.' : error.message);
    if (!page.webContents.isDestroyed()) await probe(null, false).catch(() => {});
    return { ok: false, cancelled: stopped, error: error.message, snapshots };
  } finally { clearTimeout(deadline); }
}
module.exports = { openWebsiteScan };
