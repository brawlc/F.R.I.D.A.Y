import test from 'node:test';
import assert from 'node:assert/strict';
import { selectConversationRoute, looksLikeCrmSpecification } from '../../frontend/src/services/commandRouting.ts';
import { isTimeRequest } from '../../shared/conversation-intent.mjs';

const ferrari = "FRIDAY, investigate Ferrari's latest technical upgrades for the 2026 Mexico City Grand Prix. Identify which upgrades are confirmed, which are rumored, and which are merely proposed. Research Ferrari's aerodynamic package, cooling requirements, floor, wings, suspension, and power-unit-related changes. Analyze how Mexico City's high altitude, thin air, and circuit characteristics affect Ferrari's performance. Compare Ferrari's likely strengths and weaknesses against McLaren, Mercedes, and Red Bull. Propose three realistic engineering or setup improvements, explain benefits and trade-offs, and design simulation plans to test them. Cite credible sources, challenge your conclusions, distinguish evidence from hypotheses, and do not claim to have performed simulations or implement anything without my approval.";
const route = (text, extra = {}) => selectConversationRoute({ text, crmFactoryActive: false, crmStart: false, crmBuild: false, hasPreviousCrmSpec: false, ...extra });

test('engineering brief without a research prefix bypasses clock and CRM handlers', () => {
  const text = 'Help me improve a rocket design using publicly documented designs and credible academic sources. Propose three engineering improvements, explaining the physics, advantages, disadvantages, technical risks, and expected effects. Include calculations only when reliable inputs exist. Compare each proposal with publicly documented designs, distinguishing verified facts from estimates and hypotheses. Use an independent critic to challenge conclusions. Rank proposals by feasibility, impact, and evidence quality. Recommend one small-scale simulation. Do not fabricate measurements, claim simulations were performed, or execute experiments without my approval. Estimate development time.';
  assert.deepEqual(route(text, { crmFactoryActive: true }), { research: true, captureCrm: false, buildCrm: false });
  assert.equal(isTimeRequest(text), false);
  assert.equal(route('Please conduct research on rocket cooling using credible sources.').research, true);
});
test('clock requires a clock question, not an incidental word', () => {
  for (const text of ['time', 'What time is it?', 'What is the time?', 'Friday, what date is it?', 'what day is today?']) {
    // Include these normal phrasings in the supported command vocabulary.
    assert.equal(isTimeRequest(text), true, text);
  }
  for (const text of ['Explain time dilation', 'Compare rocket burn time and engine efficiency', 'Describe a typical day in mission control', 'Find the publication date of this paper']) assert.equal(isTimeRequest(text), false, text);
});

test('exact Ferrari prompt bypasses CRM with or without persisted CRM mode', () => {
  assert.equal(looksLikeCrmSpecification(ferrari), false);
  for (const crmFactoryActive of [false, true]) assert.deepEqual(route(ferrari, { crmFactoryActive, hasPreviousCrmSpec: true }), { research: true, captureCrm: false, buildCrm: false });
});
test('long unrelated requests and generic engineering terms are not CRM specifications', () => {
  assert.equal(route('Explain the benefits and expected trade-offs of this engine and its security features. '.repeat(4)).captureCrm, false);
  assert.equal(route('Explain Ferrari cooling requirements', { crmFactoryActive: true }).captureCrm, false);
});
test('research continuation and research about CRM remain research', () => {
  assert.equal(route('Use the existing baseline; do not run simulations', { crmFactoryActive: true, previousAssistant: 'Research clarification ID: 11111111-1111-1111-1111-111111111111' }).research, true);
  assert.equal(route('research CRM systems with leads contacts and sales pipelines for a small business').captureCrm, false);
});
test('explicit CRM specifications, active intake and requested builds still work', () => {
  assert.equal(route('Build a CRM for a sales team with contacts leads and reminders').captureCrm, true);
  assert.equal(route('Track leads and customers', { crmFactoryActive: true }).captureCrm, true);
  assert.equal(route('build it', { crmBuild: true, hasPreviousCrmSpec: true }).buildCrm, true);
  assert.equal(route('open crm factory', { crmStart: true }).captureCrm, false);
});
