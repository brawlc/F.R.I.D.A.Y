import express from 'express';
import { analyzeAuthorizedWebsite } from '../reverse-engineering/web.mjs';
import { validateWebsiteRequest, errorPayload } from '../reverse-engineering/schemas.mjs';
import { normalizeAuthorizedWebsiteTarget } from '../reverse-engineering/web.mjs';
import { reviewPolicies } from './policy-review.mjs';

export function buildWhitehatReport(observation) {
  const facts = observation.directlyObservedFacts;
  const headers = facts.headers || {};
  const findings = [];
  const add = (id, title, severity, evidence, remediation, retest) => findings.push({ id, title, severity, confidence: 'high for observed response; exploitability untested', classification: 'configuration-review', evidence, remediation, retest });
  if (new URL(facts.finalUrl).protocol !== 'https:') add('transport', 'Page served without HTTPS', 'high', facts.finalUrl, 'Serve the page over HTTPS and redirect HTTP after validating certificate deployment.', 'Request both URLs and verify the final response uses HTTPS.');
  if (!headers['strict-transport-security']) add('hsts', 'HSTS header not observed', 'medium', 'Strict-Transport-Security absent on the sampled response.', 'Evaluate HSTS after HTTPS works on the intended host. Review subdomains before applying includeSubDomains.', 'Repeat on the HTTPS response and inspect Strict-Transport-Security.');
  if (!headers['content-security-policy']) add('csp', 'Enforced CSP not observed', 'medium', 'Content-Security-Policy absent on the sampled response.', 'Design a policy for actual script/style origins; test a report-only policy before enforcing it.', 'Inspect the enforced CSP response header and test intended UI flows.');
  if (String(headers['x-content-type-options'] || '').toLowerCase() !== 'nosniff') add('nosniff', 'MIME-sniffing protection not observed', 'low', headers['x-content-type-options'] || 'X-Content-Type-Options absent.', 'Return correct Content-Type values and X-Content-Type-Options: nosniff.', 'Verify the header on HTML, script and stylesheet responses.');
  const csp = headers['content-security-policy'] || '';
  const framing = /(?:^|;)\s*frame-ancestors\s+[^;]+/i.test(csp) || /^(DENY|SAMEORIGIN)$/i.test(headers['x-frame-options'] || '');
  if (!framing) add('framing', 'Framing policy needs review', 'medium', 'No recognized frame-ancestors or X-Frame-Options policy observed.', 'Define allowed embedding origins with CSP frame-ancestors; preserve intentional embedding.', 'Check the response policy and test embedding from approved and unapproved origins.');
  if (!headers['referrer-policy']) add('referrer', 'Explicit referrer policy not observed', 'low', 'Referrer-Policy absent; browser defaults still apply.', 'Choose an explicit policy appropriate to the application, such as strict-origin-when-cross-origin.', 'Inspect the header and verify outbound requests reveal only intended referrer data.');
  findings.push(...reviewPolicies(facts));
  return {
    version: 1, assessedAt: observation.analyzedAt, target: facts.finalUrl,
    scope: observation.authorizationContext,
    method: 'Single public HTML response and reference inspection; no exploitation, login, submissions, or route crawling.',
    summary: `${findings.length} configuration review item(s). This is not proof of vulnerabilities or a clean bill of health.`,
    findings, observed: { status: facts.status, headers, forms: facts.forms, cookies: facts.cookies || [], assets: facts.sameOriginAssets, links: facts.sameOriginLinks },
    technologySignals: observation.toolReportedFindings.frameworkSignals,
    manualReview: ['Test access control with separate authorized test accounts.', 'Review session expiry, logout and cookie flags in a dedicated test environment.', 'Review server-side input validation and dependency advisories using the source code.', 'Verify backup restoration and logging without exposing customer data.'],
    limitations: [...observation.unknownsAndLimitations, 'Header presence is not evidence that the policy is effective. Missing headers alone do not confirm XSS, injection, or broken access control.', 'Policy checks cover selected declarations, not full browser enforcement. Combined CSP policies are not evaluated. Cookies are limited to the sampled response (up to 50); absence does not establish secure session handling.'],
    reference: 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html',
  };
}

export function createWhitehatRouter(analyze = analyzeAuthorizedWebsite) {
  const router = express.Router();
  let running = 0;
  router.post('/assess', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let request, targets;
    try {
      request = validateWebsiteRequest(req.body);
      const root = normalizeAuthorizedWebsiteTarget(request.url);
      const extra = req.body.additionalUrls || [];
      if (!Array.isArray(extra) || extra.length > 2 || extra.some(url => typeof url !== 'string' || url.length > 2000)) throw new Error('Provide at most two additional approved page URLs.');
      targets = [root, ...extra.map(url => normalizeAuthorizedWebsiteTarget(url))];
      if (targets.some(url => url.origin !== root.origin)) throw new Error('Additional pages must use the exact same origin as the approved target.');
      targets = [...new Set(targets.map(url => { url.hash = ''; return url.href; }))];
    } catch (error) { return res.status(error.status || 400).json(errorPayload(error)); }
    if (running >= 2) return res.status(429).set('Retry-After', '10').json({ ok: false, error: 'Two assessments are already running. Retry shortly.' });
    running++;
    try {
      const pages = [], failures = [];
      for (const url of targets) {
        try { pages.push(buildWhitehatReport(await analyze({ ...request, url }))); }
        catch (error) { failures.push({ url, error: errorPayload(error).error }); }
      }
      if (!pages.length) return res.status(422).json({ ok: false, error: failures[0]?.error || 'No approved page could be assessed.' });
      const report = { ...pages[0], findings: pages.flatMap(page => page.findings.map(finding => ({ ...finding, id: `${page.target}#${finding.id}`, page: page.target }))),
        coverage: { requested: targets, assessed: pages.length, failed: failures.length, failures }, pages,
        method: 'Public HTML and response-policy inspection of explicitly approved pages only; no discovered-link crawling or submissions.' };
      report.summary = `${report.findings.length} review item(s) across ${pages.length}/${targets.length} approved page(s). Exploitability remains untested.`;
      res.json({ ok: true, report });
    }
    catch (error) { res.status(error.status || 502).json(errorPayload(error)); }
    finally { running--; }
  });
  return router;
}
