export function renderReport(r) {
  if (r.status === 'needs-clarification') return `Research objective: ${r.objective}\n\nBefore researching, please specify ${r.clarifications.join('; ')}.\nReply with your conditions, or say "use exploratory assumptions".\nResearch clarification ID: ${r.id}`;
  const lines = [`RESEARCH BRIEF — ${r.objective}`, `Research ID: ${r.id}`, `Status: ${r.status}`, `Conditions: ${r.conditions}`, '', 'Questions', ...r.questions.map(q => `- ${q.question} Verification: ${q.verification}`), '', 'Findings (source-reported; not independently validated)'];
  if (r.plan) lines.splice(4, 0, `Plan: ${r.plan.origin}; ${r.plan.rationale}`, `Stopping reason: ${r.stoppingReason || 'in-progress; interrupted records are not automatically resumed'}`, `Investigations: ${r.usage?.followUps || 0}/1 follow-ups; HTTP attempts: ${r.usage?.httpAttempts || 0}/15; model calls: ${r.usage?.modelCalls || 0}/5`, ...r.plan.questions.map(q => `Priority ${q.priority}: ${q.question} Evidence gap: ${q.evidenceGap}`));
  if (r.planRevisions?.length) lines.splice(4, 0, ...r.planRevisions.at(-1).evidenceGaps.map(g => `Unresolved gap (${g.origin || 'unvalidated'}): ${g.reason}`));
  lines.push(...(r.findings.length ? r.findings.map(f => `- ${f.claim} [${f.sourceIds.join(', ')}]\n  Supporting passage: ${f.quote}`) : ['No scientific finding could be verified from the retrieved evidence.']));
  lines.push('', 'Testable hypotheses — speculation', ...r.hypotheses.map(h => `- ${h.idea} [${h.sourceIds.join(', ')}]\n  Prediction: ${h.prediction}\n  Test: ${h.test}\n  Falsification: ${h.falsification}`));
  lines.push('', 'Contradictory evidence', ...(r.contradictions.length ? r.contradictions.map(c => `- ${c.description}\n${c.evidence.map(e => `  [${e.sourceId}] ${e.quote}`).join('\n')}`) : ['No supported contradiction identified in this bounded search; consensus is unknown.']));
  lines.push('', 'Limitations and uncertainties', ...[...r.critic.issues, ...r.critic.independentReview.issues, ...r.uncertainties, ...r.retrievalErrors.map(e => `${e.provider}: ${e.error}`)].map(s => `- ${s}`));
  lines.push('', 'Recommended next experiments', ...r.experiments.map(e => `- ${e.description} Status: ${e.status}; approval required before execution.`));
  lines.push('', 'Sources', ...r.sources.map(s => `[${s.id}] ${s.title}\n${s.authors.join(', ') || 'Authors unknown'}; published ${s.published || 'unknown'}; citations ${s.citationCount ?? 'unknown'}; ${s.reliability.level}\n${s.url}\nRetrieved ${s.retrievedAt}`));
  return lines.join('\n');
}
