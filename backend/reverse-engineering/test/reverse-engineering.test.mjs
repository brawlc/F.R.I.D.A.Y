import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import test, { after } from 'node:test';

process.env.FRIDAY_RE_STORAGE_DIR = `.friday-re-test-${randomUUID()}`;
process.env.FRIDAY_WEBSITE_STUDIO_OUTPUT_DIR = `.friday-website-studio-test-${randomUUID()}`;

const {
  detectArtifactFormat,
  extractPrintableStrings,
  parsePortableExecutable,
} = await import('../format.mjs');
const { parsePcap } = await import('../pcap.mjs');
const { analyzeSourceArtifact } = await import('../source-analysis.mjs');
const { parseZipCentralDirectory } = await import('../zip.mjs');
const { validateArtifactUpload, validateJobRequest } = await import('../schemas.mjs');
const { ReverseEngineeringService } = await import('../service.mjs');
const { STORAGE_ROOT } = await import('../constants.mjs');
const { verifyAuditChain } = await import('../store.mjs');
const { isPublicAddress, normalizeAuthorizedWebsiteTarget, isAllowedWebsiteRedirect } = await import('../web.mjs');

test('website redirects permit canonical www and HTTPS upgrades, but reject scope changes', () => {
  const allowed = (from, to) => isAllowedWebsiteRedirect(new URL(from), new URL(to));
  assert.equal(allowed('https://igloo.inc', 'https://www.igloo.inc/'), true);
  assert.equal(allowed('http://example.com', 'https://www.example.com/'), true);
  assert.equal(allowed('https://www.example.com', 'https://example.com/path'), true);
  assert.equal(allowed('https://example.com', 'http://example.com/'), false);
  assert.equal(allowed('https://example.com', 'https://example.com.evil.test/'), false);
  assert.equal(allowed('https://example.com', 'https://127.0.0.1/'), false);
  assert.equal(allowed('https://example.com', 'https://user:pass@example.com/'), false);
});
const { createWebsiteStudioProject } = await import('../website-studio.mjs');
const { createStudioProject, readStudioProject, editStudioFile, exportStudioZip, listStudioProjects, prepareStudioHandoff, proposeStudioEdit, updateStudioSources } = await import('../studio-workspace.mjs');
const { fallbackWebsite } = await import('../studio-template.mjs');

test('studio builds from scan preferences, previews, edits with conflict detection, and exports current sources', async () => {
  let builderInput;
  const project = await createStudioProject({
    projectName: `studio-${randomUUID()}`, brandName: 'Aurora Studio', referenceUrl: 'https://example.com/', styleBrief: 'Warm orange immersive motion',
    renderedScan: { snapshots: [{ counts: { canvas: 1 }, viewport: '390 × 844', backgrounds: ['rgb(10, 20, 30)'], blocks: [{ tag: 'canvas', width: 390, height: 844, layout: 'block' }] }] },
    generate: async input => { builderInput = input; return fallbackWebsite(input); },
  });
  assert.equal(project.generation, 'ai-generated');
  let duplicateBuilderCalled = false;
  await assert.rejects(createStudioProject({ projectName: project.projectName, generate: async () => { duplicateBuilderCalled = true; return {}; } }), /already exists/);
  assert.equal(duplicateBuilderCalled, false, 'An existing folder must be rejected before spending generation credit');
  assert.equal(builderInput.styleBrief, 'Warm orange immersive motion');
  assert.equal(builderInput.reference.samples[0].counts.canvas, 1);
  const handoff = await prepareStudioHandoff(project.id);
  assert.equal(handoff.projectPath, project.projectPath);
  assert.match(await readFile(handoff.handoffPath, 'utf8'), /Warm orange immersive motion/);
  await writeFile(handoff.handoffPath, 'User-reviewed handoff notes', 'utf8');
  await prepareStudioHandoff(project.id);
  assert.equal(await readFile(handoff.handoffPath, 'utf8'), 'User-reviewed handoff notes');
  await assert.rejects(prepareStudioHandoff('missing'), /Invalid project ID/);
  const preview = await fetch(project.previewUrl);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(await preview.text(), /Aurora Studio/);
  assert.equal((await fetch(new URL('reference.json', project.previewUrl))).status, 404);
  const opened = await readStudioProject(project.id);
  const changed = opened.files['index.html'].content.replace('Aurora Studio', 'Edited inside FRIDAY');
  await editStudioFile(project.id, { name: 'index.html', content: changed, expectedHash: opened.files['index.html'].hash });
  assert.match(await (await fetch(project.previewUrl)).text(), /Edited inside FRIDAY/);
  await assert.rejects(editStudioFile(project.id, { name: 'index.html', content: changed, expectedHash: opened.files['index.html'].hash }), /changed since/);
  await assert.rejects(editStudioFile(project.id, { name: '../outside.txt', content: 'no' }), /Only/);
  await assert.rejects(readStudioProject('../outside'), /Invalid project ID/);
  const archive = await exportStudioZip(project.id);
  const parsed = parseZipCentralDirectory(archive.bytes);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.suspiciousEntries.length, 0);
  assert.ok(archive.bytes.includes(Buffer.from('Edited inside FRIDAY')));
  assert.ok(archive.bytes.includes(Buffer.from('User-reviewed handoff notes')));
  assert.ok((await listStudioProjects()).some(item => item.id === project.id));
});

test('studio labels AI failure as a template and does not overwrite existing folders', async () => {
  const options = { projectName: `fallback-${randomUUID()}`, brandName: 'Fallback', styleBrief: 'Warm orange', generate: async () => { throw new Error('offline'); } };
  const project = await createStudioProject(options);
  assert.equal(project.generation, 'adaptive-template');
  assert.match(project.warning, /unavailable/);
  const opened = await readStudioProject(project.id);
  assert.match(opened.files['styles.css'].content, /#ffb575/);
  await assert.rejects(createStudioProject(options), /already exists/);
});

test('conversational edits stay drafts until applied, snapshot all sources, and reject stale restores', async () => {
  const created = await createStudioProject({ projectName: `edits-${randomUUID()}`, brandName: 'Original' });
  const original = await readStudioProject(created.id);
  const hashes = project => Object.fromEntries(Object.entries(project.files).map(([name, file]) => [name, file.hash]));
  const content = project => Object.fromEntries(Object.entries(project.files).map(([name, file]) => [name, file.content]));
  let called = false;
  await assert.rejects(proposeStudioEdit(created.id, { instruction: 'Make it blue', expectedHashes: {} }, async () => { called = true; }), /changed/);
  assert.equal(called, false);
  const draft = await proposeStudioEdit(created.id, { instruction: 'Make it blue', expectedHashes: hashes(original) }, async input => {
    assert.equal(input.styleBrief, 'Make it blue');
    return { ...input.currentFiles, 'styles.css': input.currentFiles['styles.css'] + '\nbody { color: blue; }' };
  });
  assert.deepEqual(draft.changedFiles, ['styles.css']);
  assert.deepEqual(content(await readStudioProject(created.id)), content(original));
  await updateStudioSources(created.id, { files: draft.files, expectedHashes: hashes(original) });
  const changed = await readStudioProject(created.id);
  assert.equal(changed.history.length, 1);
  assert.match(changed.files['styles.css'].content, /color: blue/);
  await assert.rejects(updateStudioSources(created.id, { restoreId: changed.history[0].id, expectedHashes: hashes(original) }), /changed/);
  await updateStudioSources(created.id, { restoreId: changed.history[0].id, expectedHashes: hashes(changed) });
  const restored = await readStudioProject(created.id);
  assert.deepEqual(content(restored), content(original));
  assert.equal(restored.history.length, 2);
  await assert.rejects(updateStudioSources(created.id, { restoreId: '../outside', expectedHashes: hashes(restored) }), /not found/);
  await assert.rejects(proposeStudioEdit(created.id, { instruction: 'Make it blue', expectedHashes: hashes(restored) }, async () => { throw new Error('Provider unavailable'); }), /Provider unavailable/);
  assert.deepEqual(content(await readStudioProject(created.id)), content(original));
});

const authorization = {
  confirmed: true,
  scope: 'I own this benign test fixture and authorize offline static analysis.',
  purpose: 'Automated regression test',
};

function peFixture() {
  const bytes = Buffer.alloc(0x300);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'binary');
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  bytes.writeUInt32LE(0, 0x88);
  bytes.writeUInt16LE(0xf0, 0x94);
  bytes.writeUInt16LE(0x2022, 0x96);
  bytes.writeUInt16LE(0x20b, 0x98);
  bytes.write('.text\0\0\0', 0x188, 'ascii');
  bytes.writeUInt32LE(0x100, 0x190);
  bytes.writeUInt32LE(0x200, 0x198);
  bytes.writeUInt32LE(0x200, 0x19c);
  bytes.write('https://example.invalid/api\0Authorization: Bearer unit-test-secret\0', 0x210, 'ascii');
  return bytes;
}

function pcapFixture() {
  const packet = Buffer.alloc(42);
  packet.writeUInt16BE(0x0800, 12);
  packet[14] = 0x45;
  packet.writeUInt16BE(28, 16);
  packet[22] = 64;
  packet[23] = 17;
  packet.set([192, 0, 2, 10], 26);
  packet.set([198, 51, 100, 20], 30);
  packet.writeUInt16BE(12345, 34);
  packet.writeUInt16BE(53, 36);
  packet.writeUInt16BE(8, 38);
  const bytes = Buffer.alloc(24 + 16 + packet.length);
  bytes.set([0xd4, 0xc3, 0xb2, 0xa1], 0);
  bytes.writeUInt16LE(2, 4);
  bytes.writeUInt16LE(4, 6);
  bytes.writeUInt32LE(65_535, 16);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt32LE(1_700_000_000, 24);
  bytes.writeUInt32LE(0, 28);
  bytes.writeUInt32LE(packet.length, 32);
  bytes.writeUInt32LE(packet.length, 36);
  packet.copy(bytes, 40);
  return bytes;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralDirectory.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, footer]);
}

async function waitForJob(service, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.getJob(jobId);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for analysis job.');
}

after(async () => {
  await rm(STORAGE_ROOT, { recursive: true, force: true });
  await rm(process.env.FRIDAY_WEBSITE_STUDIO_OUTPUT_DIR, { recursive: true, force: true });
});

test('detects and parses a bounded PE header while redacting sensitive strings', () => {
  const bytes = peFixture();
  const format = detectArtifactFormat(bytes, 'fixture.exe');
  const parsed = parsePortableExecutable(bytes);
  const strings = extractPrintableStrings(bytes);
  assert.equal(format.id, 'pe');
  assert.equal(parsed?.valid, true);
  assert.equal(parsed?.architecture, 'x86-64');
  assert.ok(strings.strings.some(item => item.text.includes('[REDACTED]')));
  assert.ok(!strings.strings.some(item => item.text.includes('unit-test-secret')));
});

test('parses passive PCAP headers without inspecting payloads', () => {
  const result = parsePcap(pcapFixture());
  assert.equal(result.valid, true);
  assert.equal(result.packetsRead, 1);
  assert.equal(result.protocolCounts.UDP, 1);
  assert.ok(result.topEndpoints.some(item => item.endpoint === '192.0.2.10:12345'));
});

test('keeps archive traversal entries out of source architecture analysis', () => {
  const archive = storedZip([
    ['src/server.js', "import express from 'express';\nconst app = express();\napp.get('/health', () => {});\nexport function run() {}"],
    ['../outside.js', 'should never be selected'],
    ['package.json', '{"dependencies":{"express":"1.0.0"}}'],
  ]);
  const parsed = parseZipCentralDirectory(archive);
  const source = analyzeSourceArtifact(archive, 'source.zip');
  assert.equal(parsed.valid, true);
  assert.ok(parsed.suspiciousEntries.some(entry => entry.name === '../outside.js'));
  assert.ok(!source.sourceFiles.some(file => file.path.includes('outside.js')));
  assert.ok(source.imports.includes('express'));
  assert.ok(source.routes.some(route => route.path === '/health'));
  assert.ok(source.dependencies.includes('express'));
});

test('rejects missing authorization and malformed job requests', () => {
  assert.throws(() => validateArtifactUpload({ fileName: 'a.bin', contentBase64: Buffer.from('x').toString('base64') }), /authorization/i);
  assert.throws(() => validateJobRequest({ artifactId: 'art_not-a-uuid', profile: 'static-triage', authorization }), /invalid format/i);
});

test('blocks private web-analysis targets before any fetch', () => {
  assert.equal(isPublicAddress('8.8.8.8', 4), true);
  assert.equal(isPublicAddress('127.0.0.1', 4), false);
  assert.equal(isPublicAddress('192.168.1.1', 4), false);
  assert.equal(isPublicAddress('::1', 6), false);
  assert.throws(() => normalizeAuthorizedWebsiteTarget('http://localhost/'), /not an allowed/i);
  assert.throws(() => normalizeAuthorizedWebsiteTarget('http://user:pass@example.com/'), /credential-free/i);
});

test('creates an original editable website starter without reference assets or copied page text', async () => {
  const project = await createWebsiteStudioProject({
    projectName: 'Reference-inspired demo',
    brandName: 'North Star Studio',
    referenceUrl: 'https://example.com/',
    styleBrief: 'Warm, modern, and product focused.',
    analysis: { toolReportedFindings: { frameworkSignals: [{ name: 'React', confidence: 'medium', evidence: 'test signal' }] } },
  });
  const readme = await readFile(`${project.projectPath}/README.md`, 'utf8');
  const source = await readFile(`${project.projectPath}/src/main.jsx`, 'utf8');
  assert.equal(project.projectName, 'reference-inspired-demo');
  assert.match(readme, /original, editable/i);
  assert.match(source, /North Star Studio/);
  assert.ok(!source.includes('https://example.com/'));
});

test('runs a static job in a child worker, writes a report, and preserves audit integrity', async () => {
  const service = new ReverseEngineeringService();
  const artifact = await service.ingestArtifact({ bytes: peFixture(), filename: '../fixture.exe', authorization, acquisitionSource: 'local-upload' });
  assert.equal(artifact.originalFilename, '.._fixture.exe');
  assert.equal(artifact.detectedFormat?.id, 'pe');
  const submitted = await service.submitJob({ artifactId: artifact.artifactId, profile: 'binary-static', authorization });
  const finished = await waitForJob(service, submitted.jobId);
  assert.equal(finished.status, 'completed', JSON.stringify(finished.error));
  assert.ok(finished.result?.toolFindings?.some(item => item.findingType === 'pe-header'));
  const report = await service.getReport(finished.jobId, 'json');
  assert.match(report, /FRIDAY Reverse Engineering Report|executiveSummary/);
  const markdown = await service.getReport(finished.jobId, 'markdown');
  assert.match(markdown, /# FRIDAY Reverse Engineering Report/);
  const audit = await verifyAuditChain();
  assert.equal(audit.valid, true);
});

test('cancels a queued job without starting its worker', async () => {
  const service = new ReverseEngineeringService();
  const firstArtifact = await service.ingestArtifact({ bytes: pcapFixture(), filename: 'capture.pcap', authorization, acquisitionSource: 'local-upload' });
  const secondArtifact = await service.ingestArtifact({ bytes: Buffer.from('plain source'), filename: 'notes.txt', authorization, acquisitionSource: 'local-upload' });
  const first = await service.submitJob({ artifactId: firstArtifact.artifactId, profile: 'pcap-summary', authorization });
  const queued = await service.submitJob({ artifactId: secondArtifact.artifactId, profile: 'static-triage', authorization });
  const cancelled = await service.cancelJob(queued.jobId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await waitForJob(service, first.jobId)).status, 'completed');
});
