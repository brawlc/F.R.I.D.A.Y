const { shell, app } = require('electron');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');

async function openStudioProject(id, port, download = true) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid project ID.');
  const base = `http://127.0.0.1:${port}/api/reverse-engineering/v1/website-studio/projects/${id}`;
  const response = await fetch(base, { signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || 'Project unavailable.');
  const preview = new URL(body.project.previewUrl);
  if (preview.protocol !== 'http:' || preview.hostname !== '127.0.0.1' || !/^\/[a-f0-9]{48}\/$/.test(preview.pathname)) throw new Error('Invalid local preview URL.');
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'launcher.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'opera.exe'),
    path.join(process.env.ProgramFiles || '', 'Opera GX', 'launcher.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Opera GX', 'launcher.exe'),
  ];
  const opera = candidates.find(candidate => existsSync(candidate));
  let browser = 'default browser';
  if (opera) {
    await new Promise((resolve, reject) => { const child = spawn(opera, [preview.toString()], { detached: true, stdio: 'ignore', windowsHide: false }); child.once('spawn', () => { child.unref(); resolve(); }); child.once('error', reject); });
    browser = 'Opera GX';
  } else await shell.openExternal(preview.toString());
  let downloadPath;
  if (download) {
    const archive = await fetch(`${base}/export`, { signal: AbortSignal.timeout(15000) });
    if (!archive.ok) throw new Error('Preview opened, but ZIP export failed. Use Download ZIP in FRIDAY to retry.');
    const name = String(body.project.projectName).replace(/[^a-z0-9-]/gi, '').slice(0, 60);
    downloadPath = path.join(app.getPath('downloads'), `${name}-${Date.now()}.zip`);
    await writeFile(downloadPath, Buffer.from(await archive.arrayBuffer()), { flag: 'wx' });
  }
  return { browser, downloadPath, previewUrl: preview.toString() };
}
async function openStudioInCode(id, port) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid project ID.');
  const executable = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'Code.exe'),
  ].find(candidate => existsSync(candidate));
  if (!executable) throw new Error('VS Code was not found. Open the project folder manually in your editor.');
  const response = await fetch(`http://127.0.0.1:${port}/api/reverse-engineering/v1/website-studio/projects/${id}/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not prepare the project handoff.');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--new-window', result.projectPath, result.handoffPath], { env, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { projectPath: result.projectPath, handoffPath: result.handoffPath };
}
module.exports = { openStudioProject, openStudioInCode };
