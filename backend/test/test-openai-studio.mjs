import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateStudioFiles } from '../reverse-engineering/studio-validation.mjs';

const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const helper = extract('async function generateOpenAIResponse(', 'async function generateVeniceResponse(');
const builder = extract('async function generateStudioWebsite(', 'function runKaliSshCommand(');
const files = { 'index.html': '<html><link rel="stylesheet" href="styles.css"><script src="app.js"></script>Product</html>', 'styles.css': 'body{}', 'app.js': 'void 0;' };
const calls = [];
let finish = 'stop';
let firstSucceeds = false;
let firstInvalid = false;
const context = vm.createContext({
  process: { env: {} }, AbortSignal, setTimeout, clearTimeout, validateStudioFiles,
  console: { error() {} }, openaiConfigured: true, openaiApiKey: 'test-only',
  veniceConfigured: true, gemini: true, useOllama: true,
  ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'test',
  generateVeniceResponse: async () => { calls.push('venice'); if (firstInvalid) return JSON.stringify({ ...files, 'app.js': 'const = ;' }); if (firstSucceeds) return JSON.stringify(files); throw Error('quota'); },
  generateGeminiResponse: async () => { calls.push('gemini'); throw Error('quota'); },
  fetch: async (url, options) => {
    if (url.includes('11434')) { calls.push('ollama'); return { ok: false }; }
    calls.push('openai');
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 14000);
    assert.equal(body.response_format.type, 'json_object');
    assert.ok(options.signal);
    assert.ok(body.messages.some(message => message.content.includes('purple headphones')));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(files) } }] }) };
  },
});
vm.runInContext(helper + builder, context);
const build = () => context.generateStudioWebsite({ brandName: 'NOVA', styleBrief: 'purple headphones', reference: {} });
assert.equal(JSON.stringify(await build()), JSON.stringify(files));
assert.deepEqual(calls.splice(0), ['venice', 'gemini', 'ollama', 'openai']);
firstInvalid = true;
assert.equal(JSON.stringify(await build()), JSON.stringify(files));
assert.deepEqual(calls.splice(0), ['venice', 'gemini', 'ollama', 'openai']);
firstInvalid = false;
finish = 'length';
await assert.rejects(build(), /providers were unavailable/);
calls.length = 0;
firstSucceeds = true;
await build();
assert.deepEqual(calls.splice(0), ['venice']);
firstSucceeds = false;
context.openaiConfigured = false;
await assert.rejects(build(), /providers were unavailable/);
assert.deepEqual(calls, ['venice', 'gemini', 'ollama']);
console.log('PASS: fourth fallback, preferences, JSON budget, truncation, early success, and missing-key skip. No paid requests made.');
