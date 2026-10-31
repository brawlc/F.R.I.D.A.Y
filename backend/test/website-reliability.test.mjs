import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHtmlStructure, readBoundedHtml } from '../reverse-engineering/web-observation.mjs';
import { validateWebsiteStudioRequest } from '../reverse-engineering/schemas.mjs';
import { summarizeReference } from '../reverse-engineering/studio-template.mjs';
import { validateStudioFiles } from '../reverse-engineering/studio-validation.mjs';

test('HTML report counts real fields and reads canonical rel independently of attribute order', () => {
  const report = inspectHtmlStructure(`<link href='/products' rel='alternate canonical'><script>const fake='<form><input></form>'</script><!-- <form><input></form> --><form action='/contact' method=post><input name=email><input name=name><select></select><textarea></textarea></form>`);
  assert.equal(report.canonical, '/products');
  assert.deepEqual(report.forms, [{ action: '/contact', method: 'POST', inputCount: 2, selectCount: 1, textareaCount: 1, passwordCount: 0 }]);
});

test('HTML reader cancels oversized streamed bodies, including multibyte text', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('€€')); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedHtml(new Response(body), 5), error => error.code === 'web_content_too_large');
  assert.equal(cancelled, true);
  assert.equal(await readBoundedHtml(new Response('€'), 3), '€');
  await assert.rejects(readBoundedHtml(new Response('test', { headers: { 'content-length': '100' } }), 5), /exceeds/);
});

test('scan validation rejects another query/page, empty samples and malformed collections', () => {
  const request = { url: 'https://example.com/product?id=1', projectName: 'example', authorization: { confirmed: true, scope: 'Test public reference' }, renderedScan: { url: 'https://www.example.com/product?id=1', snapshots: [{ blocks: [] }] } };
  assert.ok(validateWebsiteStudioRequest(request).renderedScan);
  assert.throws(() => validateWebsiteStudioRequest({ ...request, url: 'https://example.com/product?id=2' }), /another page/);
  for (const snapshots of [[], [null], [{ fonts: 'Arial' }], [{ blocks: [null] }]]) {
    assert.throws(() => validateWebsiteStudioRequest({ ...request, renderedScan: { ...request.renderedScan, snapshots } }));
  }
});

test('build brief preserves measured geometry, motion and coverage without inventing backend details', () => {
  const summary = summarizeReference(null, { snapshots: [{ device: 'mobile', animations: 2, scrollY: 500, documentHeight: 2200, blocks: [{ tag: 'nav', width: 390, height: 50, x: 0, y: 0, position: 'fixed', gap: '8px', borderRadius: '12px' }], motion: [{ target: 'section', duration: 800, easing: 'ease-in', iterations: 'infinite' }] }] });
  assert.equal(summary.samples[0].blocks[0].position, 'fixed');
  assert.equal(summary.samples[0].motion[0].duration, 800);
  assert.equal(summary.coverage.mobile, 1);
  assert.equal(summary.coverage.desktop, 0);
  assert.equal(summary.samples[0].scrollY, 500);
  assert.ok(summary.limitations.some(line => line.includes('backend')));
});

test('generated files need actual local asset tags and syntactically valid JavaScript', () => {
  const files = { 'index.html': '<html><link href="./styles.css"><script src="app.js"></script></html>', 'styles.css': 'body{}', 'app.js': 'void 0;' };
  assert.deepEqual(validateStudioFiles(files), files);
  assert.throws(() => validateStudioFiles({ ...files, 'app.js': 'const = ;' }), /syntax errors/);
  assert.throws(() => validateStudioFiles({ ...files, 'index.html': '<html>styles.css app.js</html>' }), /linked/);
});
