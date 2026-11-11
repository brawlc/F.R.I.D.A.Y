import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { generateResearchPdf, createReportAttachment, reportAttachment, reportSections, reportSanitizer, MAX_PDF_BYTES } from '../pdf.mjs';
import { createReportStore } from '../report-store.mjs';
import { createResearchReports } from '../report-service.mjs';
import { createResearchRouter } from '../router.mjs';
import { requireLocalDefense } from '../../security/defense.mjs';
import { createCommunicationsHub, createDeliveryStore } from '../../communications/hub.mjs';
import { get } from 'node:http';

const id = '12345678-1234-1234-1234-123456789abc';

const fixture = () => ({ id, objective: 'Synthetic wing geometry review', createdAt: '2026-11-05T10:00:00Z', status: 'insufficient-evidence', conditions: 'Public literature only.', questions: [{ question: 'Which evidence is available?', verification: 'Exact supporting passages.' }], findings: [], hypotheses: [{ idea: 'A possible geometry', prediction: 'Compare drag', test: 'Matched-condition comparison', falsification: 'No benefit', sourceIds: ['S1'] }], contradictions: [], uncertainties: ['No validated measurements.'], experiments: [{ description: 'Proposed controlled comparison', status: 'approval-required' }], retrievalErrors: [{ provider: 'fixture', error: 'offline' }], sources: [{ id: 'S1', title: 'Synthetic test source - not a real paper', authors: ['Fixture Author'], url: 'https://example.org/source', published: '2026-01-01', kind: 'abstract', provenance: ['fixture'], reliability: { level: 'unvalidated' } }], usage: { modelCalls: 2, maxModelCalls: 5, outputTokensReserved: 2400 } });
const config = { ntfy: { enabled: true, token: 'fixture-token', accessControlled: true, url: 'https://ntfy.sh', topic: 'synthetic-fixture', token: 'fixture-token', accessControlled: true }, telegram: { enabled: false } };

test('PDF generator creates a bounded real document and password-free attachments', async () => {
  const bytes = await generateResearchPdf(fixture());
  assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.7'); assert.match(bytes.toString('latin1'), /%%EOF/); assert.ok(bytes.length < MAX_PDF_BYTES);
  const token = await createReportAttachment(fixture(), {});
  const encrypted = reportAttachment(token).bytes.toString('latin1');
  assert.doesNotMatch(encrypted, /\/Encrypt /);
  assert.equal(reportAttachment({ bytes }), undefined);
});
test('renderer field selection preserves insufficient evidence and errors while excluding configured credentials', () => {
  const sections = reportSections({ ...fixture(), arbitrarySecret: 'do not export', uncertainties: ['password=abc', 'fixture-env-secret'] }, reportSanitizer({ API_KEY: 'fixture-env-secret' }));
  const text = JSON.stringify(sections);
  assert.match(text, /offline/); assert.match(text, /speculation/); assert.match(text, /not scientific truth/);
  assert.doesNotMatch(text, /fixture-env-secret|password=abc|do not export/);
  assert.match(text, /redacted/);
});
test('PDF limits reject unsafe IDs, oversized content, and unsupported opaque attachment tokens', async () => {
  await assert.rejects(generateResearchPdf({ ...fixture(), id: '../secrets' }), /invalid_research_id/);
  await assert.rejects(generateResearchPdf({ ...fixture(), uncertainties: ['x'.repeat(500001)] }), /content_limit/);
  const hub = createCommunicationsHub({ config, fetchImpl: () => { throw Error('must not fetch'); } });
  assert.equal((await hub.notify({ type: 'research_completed', id, attachment: { bytes: Buffer.from('private') } })).status, 'rejected');
});
test('private store enforces retention and paths, and never deletes unrelated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-pdf-'));
  try {
    const root = join(dir, '.friday-reports'); const store = createReportStore({ directory: root, workspace: dir, maxReports: 1 });
    const pdf = await generateResearchPdf(fixture()); await store.save(id, pdf);
    await writeFile(join(root, 'keep.txt'), 'keep');
    const other = '22345678-1234-1234-1234-123456789abc'; await store.save(other, pdf);
    assert.equal((await store.status(id)).status, 'not_generated'); assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(store.save('../secret', pdf), /invalid_research_id/);
    await assert.rejects(createReportStore({ directory: join(dir, 'frontend', 'public'), workspace: dir }).save(id, pdf), /unsafe_report_directory/);
    await utimes(join(root, `research-${other}.pdf`), 0, 0); await utimes(join(root, `research-${other}.json`), 0, 0);
    assert.equal((await store.status(other)).status, 'not_generated');
    await assert.rejects(store.save(id, Buffer.alloc(MAX_PDF_BYTES + 1)), /invalid_pdf/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('store refuses junction traversal without following it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-pdf-link-'));
  try {
    const link = join(dir, 'linked'); await symlink(tmpdir(), link, process.platform === 'win32' ? 'junction' : 'dir');
    const store = createReportStore({ directory: link, workspace: dir });
    await assert.rejects(store.status(id), /symlink_refused/);
    await rm(link); // Remove only the link, never recurse through the target.
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('PDF upload produces one phone notification with attachment and click URL, deduplicated after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-pdf-delivery-')); const calls = [];
  try {
    const attachment = await createReportAttachment(fixture(), {});
    const fetchImpl = async (url, options) => {
      calls.push({ url, options }); assert.equal(options.redirect, 'error');
      if (options.method === 'PUT') { assert.ok(Buffer.isBuffer(options.body)); assert.doesNotMatch(options.body.toString('latin1'), /\/Encrypt /); return Response.json({ id: 'upload-id', topic: new URL(url).pathname.slice(1), attachment: { url: 'https://ntfy.sh/file/fixture.pdf', size: options.body.length, type: 'application/pdf', expires: Math.floor(Date.now() / 1000) + 3600 } }); }
      const body = JSON.parse(options.body); assert.equal(body.click, 'https://ntfy.sh/file/fixture.pdf'); assert.equal(body.attach, body.click); assert.equal(body.actions[0].action, 'view'); assert.doesNotMatch(options.body, /clipboard|127\.0\.0\.1|localhost|synthetic-test-password/);
      return Response.json({ id: 'notification-id', topic: config.ntfy.topic });
    };
    const options = { config, fetchImpl, store: createDeliveryStore(join(dir, 'journal.json')) };
    assert.equal((await createCommunicationsHub(options).notify({ type: 'research_completed', id, attachment })).status, 'sent');
    assert.equal((await createCommunicationsHub(options).notify({ type: 'research_completed', id, attachment })).status, 'deduplicated'); assert.equal(calls.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ambiguous upload is not replayed and invalid remote attachment URLs are rejected', async () => {
  const attachment = await createReportAttachment(fixture(), {});
  for (const url of ['http://127.0.0.1:3000/api/research', 'https://attacker.example/file/a', 'https://ntfy.sh/file/a?token=secret']) {
    let calls = 0;
    const hub = createCommunicationsHub({ config, fetchImpl: async (target, opts) => { calls++; return Response.json({ id: 'a', topic: new URL(target).pathname.slice(1), attachment: { url, size: opts.body.length, type: 'application/pdf', expires: 9999999999 } }); } });
    assert.equal((await hub.notify({ type: 'research_completed', id, attachment })).status, 'delivery_unknown_no_resend');
    assert.equal((await hub.notify({ type: 'research_completed', id, attachment })).status, 'delivery_unknown_no_resend'); assert.equal(calls, 1);
  }
});
test('report service delivers without passwords, respects opt-out and records failures safely', async () => {
  const saved = []; const events = [];
  const store = { save: async (...args) => saved.push(args), recordStatus: async (...args) => saved.push(args) };
  const reports = createResearchReports({ store, hub: { notify: async event => { events.push(event); return { status: 'sent' }; } }, env: {} });
  assert.equal((await reports.completed(fixture())).status, 'local_only'); assert.equal(events[0].attachment, undefined); assert.equal(saved[0][2].delivery, 'disabled');
  const enabled = createResearchReports({ store, hub: { notify: async event => { assert.ok(reportAttachment(event.attachment)); return { status: 'sent' }; } }, env: { FRIDAY_REPORT_NTFY_ENABLED: 'true' } });
  assert.equal((await enabled.completed(fixture())).status, 'sent');
  const failing = createResearchReports({ store, hub: {}, env: { FRIDAY_REPORT_NTFY_ENABLED: 'true' } });
  assert.equal((await failing.completed(fixture())).status, 'failed'); assert.doesNotMatch(JSON.stringify(saved.map(s => s[2])), /weak/);
});
test('manual export uses saved structured records and preserves local-only host guard', async () => {
  const app = express(); let exports = 0;
  app.use('/api/research/v1', requireLocalDefense, createResearchRouter({ memory: { get: async requested => requested === id ? fixture() : null } }, { export: async record => { exports++; return generateResearchPdf(record); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/research/v1/${id}/pdf`;
    const response = await fetch(url); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/pdf/); assert.match(response.headers.get('content-disposition'), /attachment/); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.arrayBuffer();
    const status = await new Promise((resolve, reject) => get(url, { headers: { Host: 'attacker.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    assert.equal(status, 403); assert.equal(exports, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
