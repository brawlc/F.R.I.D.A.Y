const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const original = Module._load;
let launch;
Module._load = function(name, ...args) {
  if (name === 'electron') return { shell: {}, app: {} };
  if (name === 'node:child_process') return { spawn(executable, argumentsList, options) {
    launch = { executable, argumentsList, options };
    const child = new EventEmitter(); child.unref = () => {};
    process.nextTick(() => child.emit('spawn'));
    return child;
  } };
  return original.call(this, name, ...args);
};
const { openStudioInCode } = require('../electron/studio-browser.cjs');
global.fetch = async (url, options) => {
  assert.match(url, /\/website-studio\/projects\/[a-f0-9]{32}\/handoff$/);
  assert.equal(options.method, 'POST');
  return { ok: true, json: async () => ({ ok: true, projectPath: 'C:\\Example Project', handoffPath: 'C:\\Example Project\\FRIDAY-CODEX-HANDOFF.md' }) };
};
(async () => {
  await assert.rejects(openStudioInCode('../anything', 3000), /Invalid project ID/);
  assert.equal(launch, undefined);
  const result = await openStudioInCode('a'.repeat(32), 3000);
  assert.deepEqual(launch.argumentsList, ['--new-window', result.projectPath, result.handoffPath]);
  assert.equal(launch.options.shell, undefined);
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.match(launch.executable, /Code\.exe$/);
  console.log('PASS: registered-project handoff, VS Code launch arguments, no shell, invalid ID rejection. No editor was launched during this test.');
})().catch(error => { console.error(error); process.exitCode = 1; });
