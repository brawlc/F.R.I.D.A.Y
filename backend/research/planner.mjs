import { clean } from './citations.mjs';
const text = (s, max = 500) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
export function decompose(objective) {
  return [
    { id: 'Q1', question: `What published principles and baseline evidence bear on: ${objective}?`, verification: 'Retrieve identifiable sources and exact supporting passages.' },
    { id: 'Q2', question: 'What alternatives and counterevidence apply under the specified operating conditions?', verification: 'Compare assumptions, conditions and conflicting passages; record missing evidence.' },
    { id: 'Q3', question: 'What measurable experiment could distinguish the alternatives from the baseline?', verification: 'Define a prediction, baseline, controlled variables and falsification criterion; do not execute.' },
  ];
}
export function fallbackPlan(objective) {
  return { origin: 'deterministic-fallback', rationale: 'Use verifiable baseline, counterevidence and proposal questions.', questions: decompose(objective).map((q, i) => ({ ...q, priority: i + 1, evidenceGap: i === 0 ? 'Supporting evidence is not yet retrieved.' : 'Comparative evidence remains unknown.' })), stoppingCriteria: ['Stop at any hard budget limit.', 'At most one targeted follow-up; unresolved gaps remain explicit.'] };
}
export function validatePlan(value) {
  if (!exact(value, ['questions', 'rationale', 'stoppingCriteria']) || !text(value.rationale) || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 3
    || !Array.isArray(value.stoppingCriteria) || !value.stoppingCriteria.length || value.stoppingCriteria.length > 3 || !value.stoppingCriteria.every(s => text(s, 200))) return null;
  if (!value.questions.every(q => exact(q, ['question', 'priority', 'evidenceGap', 'verification']) && text(q.question) && text(q.evidenceGap) && text(q.verification, 300) && Number.isInteger(q.priority) && q.priority >= 1 && q.priority <= 3)) return null;
  return { origin: 'model-proposed-unvalidated', rationale: clean(value.rationale, 500), stoppingCriteria: value.stoppingCriteria.map(s => clean(s, 200)), questions: [...value.questions].sort((a, b) => a.priority - b.priority).map((q, i) => ({ id: `Q${i + 1}`, question: clean(q.question, 500), verification: clean(q.verification, 300), evidenceGap: clean(q.evidenceGap, 500), priority: q.priority })) };
}
// Queries are text passed only to fixed retrieval adapters, never URLs or executable instructions.
export function queryText(value) { return clean(value, 2500).replace(/https?:\/\/\S+/gi, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 400); }
export function materialGaps(record, review) {
  const gaps = [];
  const add = (questionId, reason, query, sourceIds = [], origin = 'deterministic-check') => gaps.push({ questionId, reason, query: queryText(query), sourceIds: [...new Set(sourceIds)].slice(0, 8), origin, priority: record.questions.find(q => q.id === questionId)?.priority || 1, status: 'unresolved' });
  if (!record.findings.length) add(record.questions[0].id, 'No finding passed exact-passage verification.', `${record.objective} published evidence validation`);
  if (record.contradictions.length) add(record.questions[0].id, 'Retrieved passages suggest a conflict requiring comparison.', `${record.objective} conflicting results comparison`);
  const proposals = Array.isArray(review?.gaps) ? review.gaps.slice(0, 3) : [];
  for (const gap of proposals) {
    if (!exact(gap, ['questionId', 'reason', 'query', 'sourceIds']) || !record.questions.some(q => q.id === gap.questionId) || !text(gap.reason) || !text(gap.query, 400)
      || !Array.isArray(gap.sourceIds) || !gap.sourceIds.length || !gap.sourceIds.every(id => record.sources.some(s => s.id === id))) continue;
    add(gap.questionId, clean(gap.reason, 500), `${record.objective.slice(0, 120)} ${gap.query}`, gap.sourceIds, 'model-proposed-unvalidated');
  }
  return gaps.filter(g => g.query).sort((a, b) => a.priority - b.priority).slice(0, 3);
}
