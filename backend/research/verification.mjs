import { clean } from './citations.mjs';

// A citation must point to retrieved evidence and include an exact supporting passage.
// This establishes provenance, not entailment or scientific truth.
export function verifyAnalysis(candidate, sources) {
  const byId = new Map(sources.map(s => [s.id, s]));
  const rejected = [];
  const findings = (Array.isArray(candidate?.findings) ? candidate.findings : []).slice(0, 12).flatMap(f => {
    if (!f || typeof f !== 'object') { rejected.push('Malformed finding rejected.'); return []; }
    const source = byId.get(f.sourceId), quote = clean(f.quote, 1000), claim = clean(f.claim, 1500);
    if (!claim || quote.length < 20 || !source?.excerpt.includes(quote)) { rejected.push('A proposed finding lacked an exact passage in a retrieved source.'); return []; }
    return [{ claim, quote, sourceIds: [source.id], status: 'source-reported-unvalidated', evidenceType: source.kind, realWorldValidated: false }];
  });
  const hypotheses = (Array.isArray(candidate?.hypotheses) ? candidate.hypotheses : []).slice(0, 4).flatMap(h => {
    if (!h || typeof h !== 'object') return [];
    const sourceIds = (Array.isArray(h.sourceIds) ? h.sourceIds : []).filter(id => byId.has(id));
    if (!sourceIds.length || !h.prediction || !h.test || !h.falsification) return [];
    return [{ idea: clean(h.idea, 1000), prediction: clean(h.prediction, 1000), test: clean(h.test, 1000), falsification: clean(h.falsification, 1000), sourceIds,
      status: 'speculation', outcome: null, realWorldValidated: false }];
  });
  const contradictions = (Array.isArray(candidate?.contradictions) ? candidate.contradictions : []).slice(0, 6).flatMap(c => {
    if (!Array.isArray(c?.evidence) || c.evidence.length !== 2 || c.evidence.some(e => !e || typeof e !== 'object')) return [];
    const evidence = c.evidence.map(e => ({ sourceId: e.sourceId, quote: clean(e.quote, 1000) }));
    if (evidence[0].sourceId === evidence[1].sourceId || evidence.some(e => e.quote.length < 20 || !byId.get(e.sourceId)?.excerpt.includes(e.quote))) return [];
    return [{ description: clean(c.description, 1000), evidence, status: 'possible-conflict-needs-review' }];
  });
  return { findings, hypotheses, contradictions, rejected,
    uncertainties: (Array.isArray(candidate?.uncertainties) ? candidate.uncertainties : []).slice(0, 8).map(x => clean(x, 1000)) };
}

export function critique(record, independentReview = null) {
  const issues = [
    'Only metadata, abstracts and discovery snippets were retrieved; full methods and results require review.',
    'Exact quote matching verifies provenance, not whether the proposed claim follows from the quote.',
    'No simulation or real-world experiment has been performed.',
    'The search is bounded and is not a systematic literature review. Missing contradictory evidence does not imply consensus.',
  ];
  if (!record.findings.length) issues.push('No claim passed evidence checks. The research question remains unanswered.');
  if (record.sources.some(s => s.reliability.level === 'preprint')) issues.push('Preprints are present; peer-review status is not verified.');
  if (record.sources.some(s => s.metadataConflicts?.length)) issues.push('Cross-provider metadata conflicts require manual resolution.');
  issues.push(...record.rejected);
  return { status: 'human-review-required', issues, independentReview: independentReview ? {
    status: 'model-review-unvalidated', issues: (Array.isArray(independentReview.issues) ? independentReview.issues : []).slice(0, 8).map(x => clean(x, 1200)),
  } : { status: 'unavailable', issues: ['Independent model review was unavailable; deterministic checks still ran.'] } };
}
