import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { createMemoryStore } from '../memory-store.mjs';
import health from '../electron/server-health.cjs';

test('memory preserves concurrent updates, filters malformed facts, and never overwrites corrupt JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friday-memory-test-'));
  const file = join(directory, 'memory.json');
  try {
    const store = createMemoryStore(file);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.update(memory => ({ facts: [...memory.facts, `Fact ${index}`] }))));
    assert.equal((await store.read()).facts.length, 20);
    assert.deepEqual(await readdir(directory), ['memory.json']);
    await writeFile(file, JSON.stringify({ facts: [null, 3, '', 'Valid fact'] }));
    assert.deepEqual((await store.read()).facts, ['Valid fact']);
    await writeFile(file, '{broken');
    await assert.rejects(store.update(() => ({ facts: [] })), /preserved/);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'friday-memory-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop readiness checks FRIDAY identity on the chosen port without news requests', async () => {
  assert.equal(await health.isServerReady(4567, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:4567/api/health');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ ok: true, service: 'friday', status: 'ready' }) };
  }), true);
  assert.equal(await health.isServerReady(4567, async () => ({ ok: true, json: async () => ({ ok: true, service: 'other' }) })), false);
  assert.equal(await health.isServerReady(4567, async () => { throw Error('offline'); }), false);
});

test('desktop bridge rejects other windows, subframes and remote page origins', async () => {
  const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const guards = source.slice(source.indexOf('function isTrustedUrl('), source.indexOf('const gotSingleInstanceLock'));
  const mainFrame = { url: 'http://127.0.0.1:4567/' };
  const sender = { mainFrame };
  const context = vm.createContext({ URL, appUrl: mainFrame.url, mainWindow: { isDestroyed: () => false, webContents: sender }, gestureWindow: null });
  vm.runInContext(guards, context);
  assert.doesNotThrow(() => context.requireTrustedCaller({ sender, senderFrame: mainFrame }));
  assert.throws(() => context.requireTrustedCaller({ sender: { mainFrame }, senderFrame: mainFrame }), /must come from/);
  assert.throws(() => context.requireTrustedCaller({ sender, senderFrame: { url: mainFrame.url } }), /must come from/);
  mainFrame.url = 'https://unrelated.example/';
  assert.throws(() => context.requireTrustedCaller({ sender, senderFrame: mainFrame }), /must come from/);
});

test('storage failures retain session edits and notify without throwing or deleting existing storage', async () => {
  const code = await readFile(new URL('../../frontend/src/services/storage.ts', import.meta.url), 'utf8');
  let notifications = 0;
  const context = vm.createContext({ exports: {}, Event, queueMicrotask, window: { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('blocked'); } }, dispatchEvent() { notifications++; } } });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const { safeStorage, getStorageWarning } = context.exports;
  assert.equal(safeStorage.getItem('missing'), null);
  safeStorage.setItem('project', 'keep this');
  assert.equal(safeStorage.getItem('project'), 'keep this');
  safeStorage.removeItem('project');
  assert.equal(safeStorage.getItem('project'), null);
  await Promise.resolve();
  assert.ok(notifications > 0);
  assert.match(getStorageWarning(), /this session/);
});
