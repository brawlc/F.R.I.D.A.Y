import { MODULE_VERSION, RE_SCHEMA_VERSION, WORKER_MEMORY_MB, WORKER_TIMEOUT_MS } from './constants.mjs';
import { redactObject, redactSensitiveText } from './redaction.mjs';

function markdownEscape(value) {
  return redactSensitiveText(String(value ?? ''), 1_000).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function compactEvidence(value) {
  const serialized = JSON.stringify(redactObject(value));
  return serialized.length > 1_600 ? `${serialized.slice(0, 1_600)}… [truncated]` : serialized;
}

export function buildReport({ job, artifact, workerResult }) {
  const findings = [
    ...(workerResult.directFacts || []),
    ...(workerResult.toolFindings || []),
    ...(workerResult.hypotheses || []),
    ...(workerResult.confirmedConclusions || []),
    ...(workerResult.unknowns || []),
  ].map(finding => redactObject(finding));

  const failedStages = job.error ? [{ stage: 'execution', error: job.error.message || job.error }] : [];
  const report = {
    schemaVersion: RE_SCHEMA_VERSION,
    reportId: `report_${job.jobId.slice(4)}`,
    generatedAt: new Date().toISOString(),
    executiveSummary: {
      status: job.status,
      profile: job.profile,
      statement: job.status === 'completed'
        ? 'Static analysis completed. Findings separate direct observations, parser-reported findings, hypotheses, confirmed conclusions, and unknowns.'
        : 'Analysis did not complete; see failed or incomplete stages.',
      findingCounts: {
        directFacts: (workerResult.directFacts || []).length,
        toolFindings: (workerResult.toolFindings || []).length,
        hypotheses: (workerResult.hypotheses || []).length,
        confirmedConclusions: (workerResult.confirmedConclusions || []).length,
        unknowns: (workerResult.unknowns || []).length,
      },
    },
    artifactIdentification: {
      artifactId: artifact.artifactId,
      sha256: artifact.sha256,
      originalFilename: artifact.originalFilename,
      detectedFormat: artifact.detectedFormat || workerResult.artifactInspection?.format || null,
      size: artifact.size,
      acquisitionSource: artifact.acquisitionSource,
      provenance: artifact.provenance,
    },
    analysisPerformed: {
      profile: job.profile,
      tool: workerResult.worker || job.tool,
      staticOnly: true,
      dynamicExecution: false,
      networkOperations: false,
      resourcePolicy: job.resourcePolicy,
    },
    findings,
    evidenceClassification: {
      directlyObservedFacts: workerResult.directFacts || [],
      toolReportedFindings: workerResult.toolFindings || [],
      aiGeneratedHypotheses: workerResult.hypotheses || [],
      confirmedConclusions: workerResult.confirmedConclusions || [],
      unknowns: workerResult.unknowns || [],
    },
    limitations: workerResult.limitations || [],
    failedOrIncompleteStages: failedStages,
    recommendations: [
      'Review supporting evidence before treating any parser result as a confirmed conclusion.',
      'Use a separately provisioned VM/container and explicit human approval before any dynamic execution, network interaction, or hardware action.',
      'Retain the artifact SHA-256, job profile, worker version, and report together for reproducibility.',
    ],
    reproducibility: {
      workerName: 'friday-static-worker',
      workerVersion: MODULE_VERSION,
      timeoutMs: WORKER_TIMEOUT_MS,
      v8HeapLimitMb: WORKER_MEMORY_MB,
      artifactSha256: artifact.sha256,
      analysisProfile: job.profile,
      executionFinishedAt: job.finishedAt || null,
    },
  };

  const rows = findings.slice(0, 120).map(item => [
    markdownEscape(item.classification),
    markdownEscape(item.domain),
    markdownEscape(item.findingType),
    markdownEscape(item.confidence),
    markdownEscape(item.description),
  ]);
  const markdown = [
    '# FRIDAY Reverse Engineering Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Executive summary',
    '',
    report.executiveSummary.statement,
    '',
    '## Artifact identification',
    '',
    `- Artifact ID: \`${artifact.artifactId}\``,
    `- SHA-256: \`${artifact.sha256}\``,
    `- Original filename (metadata only): \`${markdownEscape(artifact.originalFilename)}\``,
    `- Size: ${artifact.size} bytes`,
    `- Detected format: ${markdownEscape(report.artifactIdentification.detectedFormat?.description || 'unknown')}`,
    '',
    '## Analysis performed',
    '',
    `- Profile: \`${job.profile}\``,
    `- Worker: \`${report.analysisPerformed.tool?.name || 'friday-static-worker'} ${report.analysisPerformed.tool?.version || MODULE_VERSION}\``,
    '- Mode: offline static analysis; no artifact execution or module network operations.',
    '',
    '## Findings',
    '',
    '| Class | Domain | Type | Confidence | Description |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## Evidence excerpts',
    '',
    ...findings.slice(0, 60).flatMap(item => [
      `### ${markdownEscape(item.findingType)}`,
      '',
      '```json',
      compactEvidence(item.evidence),
      '```',
      '',
    ]),
    '## Limitations and unknowns',
    '',
    ...(report.limitations.length ? report.limitations.map(item => `- ${markdownEscape(item)}`) : ['- No additional worker limitations recorded.']),
    ...(workerResult.unknowns?.length ? workerResult.unknowns.map(item => `- ${markdownEscape(item.description)}`) : []),
    '',
    '## Recommendations',
    '',
    ...report.recommendations.map(item => `- ${item}`),
    '',
    '## Reproducibility',
    '',
    `- Worker: ${report.reproducibility.workerName} ${report.reproducibility.workerVersion}`,
    `- Wall-clock timeout: ${report.reproducibility.timeoutMs}ms`,
    `- V8 heap cap: ${report.reproducibility.v8HeapLimitMb}MB`,
    `- Artifact SHA-256: \`${artifact.sha256}\``,
    '',
  ].join('\n');
  return { report, markdown };
}
