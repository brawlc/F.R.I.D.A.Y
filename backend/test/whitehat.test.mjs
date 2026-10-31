import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildWhitehatReport, createWhitehatRouter } from '../security/whitehat.mjs';
import { reviewPolicies, summarizeCookies } from '../security/policy-review.mjs';
const observation = headers => ({ analyzedAt: '2026-10-28T00:00:00Z', authorizationContext: { scope: 'Owned public page' }, directlyObservedFacts: { finalUrl: 'https://example.com/', status: 200, headers, forms: [], sameOriginAssets: [], sameOriginLinks: [] }, toolReportedFindings: { frameworkSignals: [] }, unknownsAndLimitations: ['Single response only.'] });

test('policy checks distinguish permissive policies from nonce and restrictive configurations', () => {
  const ids = headers => reviewPolicies({ headers }).map(item => item.id);
  assert.deepEqual(ids({ 'content-security-policy': "default-src 'self'" }), []);
  assert.deepEqual(ids({ 'content-security-policy': "script-src 'nonce-YWJj' 'strict-dynamic' https: 'unsafe-inline'" }), []);
  assert.deepEqual(ids({ 'content-security-policy': "script-src *, script-src 'none'" }), []);
  assert.ok(ids({ 'strict-transport-security': 'max-age=0' }).includes('hsts-invalid'));
  const risky = ids({ 'content-security-policy': "script-src * 'unsafe-inline' 'unsafe-eval'; frame-ancestors *" });
  for (const id of ['csp-inline', 'csp-eval', 'csp-broad-script', 'framing-broad']) assert.ok(risky.includes(id));
});

test('cookies are checked individually without retaining names or values', () => {
  const cookies = summarizeCookies(['session=SECRET; Secure; HttpOnly; SameSite=Lax', '__Host-private=OTHER; SameSite=None; Domain=example.com']);
  assert.doesNotMatch(JSON.stringify(cookies), /SECRET|OTHER|private|session/);
  const ids = reviewPolicies({ cookies }).map(item => item.id);
  assert.ok(!ids.includes('cookie-secure-1'));
  for (const id of ['cookie-secure-2', 'cookie-httponly-2', 'cookie-samesite-2', 'cookie-prefix-2']) assert.ok(ids.includes(id));
});

test('form declarations report unsafe transport and password GET without submission', () => {
  const findings = reviewPolicies({ finalUrl: 'https://example.com/', forms: [{ action: 'http://example.com/login', method: 'GET', passwordCount: 1 }] });
  assert.deepEqual(findings.map(item => item.id), ['form-http-0', 'form-password-get-0']);
  assert.deepEqual(reviewPolicies({ finalUrl: 'https://example.com/', forms: [{ action: '/login', method: 'POST', passwordCount: 1 }] }), []);
});

test('explicit page scope rejects other origins and preserves partial failures', async () => {
  const calls = [];
  const app = express(); app.use(express.json());
  app.use(createWhitehatRouter(async request => {
    calls.push(request.url);
    if (request.url.endsWith('/unavailable')) throw new Error('Fixture unavailable');
    const result = observation({}); result.directlyObservedFacts.finalUrl = request.url; return result;
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const post = additionalUrls => fetch(`http://127.0.0.1:${server.address().port}/assess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/', additionalUrls, authorization: { confirmed: true, scope: 'Owned website pages' } }) });
  try {
    assert.equal((await post(['https://other.example/'])).status, 400);
    assert.equal((await post(['/a', '/b', '/c'])).status, 400);
    assert.equal(calls.length, 0);
    const response = await post(['https://example.com/about', 'https://example.com/unavailable']);
    assert.equal(response.status, 200);
    const { report } = await response.json();
    assert.equal(report.coverage.assessed, 2); assert.equal(report.coverage.failed, 1);
    assert.equal(report.pages.length, 2);
    assert.ok(report.findings.every(item => item.page && item.id.startsWith(item.page)));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('findings include evidence and retest instructions without claiming exploits', () => {
  const report = buildWhitehatReport(observation({}));
  assert.equal(report.findings.length, 5);
  assert.ok(report.findings.every(item => item.evidence && item.remediation && item.retest && item.classification === 'configuration-review'));
  assert.match(report.summary, /not proof/);
  const configured = buildWhitehatReport(observation({ 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' }));
  assert.equal(configured.findings.length, 0);
  assert.ok(configured.limitations.some(line => line.includes('not evidence')));
  const permissive = buildWhitehatReport(observation({ 'x-frame-options': 'ALLOWALL' }));
  assert.ok(permissive.findings.some(item => item.id === 'framing'));
});

test('workbench validates authorization before collection and enforces concurrency', async () => {
  let calls = 0;
  const releases = [];
  const app = express(); app.use(express.json());
  app.use(createWhitehatRouter(async () => { calls++; await new Promise(resolve => releases.push(resolve)); return observation({}); }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/assess`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { url: 'https://example.com/', authorization: { confirmed: true, scope: 'Owned public website' } };
  try {
    assert.equal((await post({ ...body, authorization: { ...body.authorization, confirmed: false } })).status, 403);
    assert.equal(calls, 0);
    const first = post(body); const second = post(body);
    for (let attempt = 0; attempt < 100 && calls < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2);
    assert.equal((await post(body)).status, 429);
    releases.splice(0).forEach(resolve => resolve());
    assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  } finally { releases.forEach(resolve => resolve()); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
