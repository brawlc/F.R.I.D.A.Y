import { readFile, stat } from 'node:fs/promises';
import { MAX_ARTIFACT_BYTES, MAX_INSPECT_BYTES, MODULE_VERSION, RE_SCHEMA_VERSION } from './constants.mjs';
import {
  detectArtifactFormat,
  extractPrintableStrings,
  formatEvidenceSummary,
  parseElf,
  parseMachO,
  parsePortableExecutable,
  shannonEntropy,
} from './format.mjs';
import { parsePcap } from './pcap.mjs';
import { analyzeSourceArtifact } from './source-analysis.mjs';
import { parseZipCentralDirectory } from './zip.mjs';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function finding(sequence, {
  domain,
  type,
  classification = 'tool-reported',
  severity = 'info',
  confidence = 'high',
  description,
  evidence = [],
  location = {},
  limitations = [],
}) {
  return {
    findingId: `worker_finding_${sequence}`,
    domain,
    findingType: type,
    classification,
    severity,
    confidence,
    confidenceRationale: classification === 'direct-observation'
      ? 'Derived directly from bounded artifact bytes.'
      : 'Produced by the bounded built-in static parser; review supporting evidence.',
    description,
    evidence,
    location,
    toolProvenance: {
      name: 'friday-static-worker',
      version: MODULE_VERSION,
      execution: 'completed',
    },
    limitations,
    verificationStatus: classification === 'confirmed-conclusion' ? 'confirmed' : 'unverified',
  };
}

function safeJson(value) {
  return JSON.stringify(value);
}

function formatParserFinding(sequence, format, parsed) {
  if (!parsed) return null;
  if (!parsed.valid) {
    return finding(sequence, {
      domain: 'binary', type: `${format.id}-header`, classification: 'unknown', severity: 'medium', confidence: 'high',
      description: `${format.description} was detected, but header validation was incomplete.`,
      evidence: format.evidence,
      limitations: [parsed.limitation || 'Parser could not validate the format header.'],
    });
  }
  return finding(sequence, {
    domain: 'binary', type: `${format.id}-header`, severity: 'info', confidence: 'high',
    description: `${format.id.toUpperCase()} header metadata: ${safeJson(parsed)}`,
    evidence: format.evidence,
    limitations: ['Header metadata does not reconstruct source code, control flow, imports, or runtime behavior.'],
  });
}

function summarizeZip(sequence, buffer, format) {
  const zip = parseZipCentralDirectory(buffer);
  if (!zip.valid) {
    return finding(sequence, {
      domain: 'archive', type: 'zip-central-directory', classification: 'unknown', severity: 'medium', confidence: 'high',
      description: 'ZIP-like input was detected but could not be safely parsed.', evidence: format.evidence,
      limitations: [zip.limitation || 'ZIP parser failed.'],
    });
  }
  const unsafeCount = zip.suspiciousEntries.length;
  const highRatio = (zip.compressionRatio || 0) > 50;
  return finding(sequence, {
    domain: 'archive', type: 'zip-central-directory', severity: unsafeCount || highRatio ? 'medium' : 'info', confidence: 'high',
    description: `ZIP metadata: ${zip.entryCount} entries (${zip.parsedEntryCount} parsed), ${zip.totalUncompressedBytes} declared uncompressed bytes, compression ratio ${zip.compressionRatio ?? 'unknown'}${unsafeCount ? `, ${unsafeCount} entries requiring safety handling` : ''}.`,
    evidence: [
      ...format.evidence,
      `parsedEntries=${zip.parsedEntryCount}`,
      `declaredUncompressedBytes=${zip.totalUncompressedBytes}`,
      `compressionRatio=${zip.compressionRatio ?? 'unknown'}`,
    ],
    limitations: [
      ...(zip.truncated ? ['Archive entry list was truncated at a safety limit.'] : []),
      ...(highRatio ? ['High declared compression ratio is a safety signal, not proof of a decompression bomb.'] : []),
      'The static triage profile does not extract archive files to disk.',
    ],
  });
}

function buildStaticTriage({ buffer, format, profile, originalFilename }) {
  const directFacts = [];
  const toolFindings = [];
  const hypotheses = [];
  const unknowns = [];
  const limitations = [];
  let sequence = 1;

  directFacts.push(finding(sequence++, {
    domain: 'artifact', type: 'format-identification', classification: 'direct-observation', severity: 'info', confidence: format.confidence,
    description: formatEvidenceSummary(format), evidence: format.evidence,
  }));

  const entropy = shannonEntropy(buffer);
  directFacts.push(finding(sequence++, {
    domain: 'artifact', type: 'entropy', classification: 'direct-observation', severity: 'info', confidence: 'high',
    description: `Shannon entropy is ${entropy.entropy} bits per byte across a ${entropy.sampledBytes}-byte bounded sample.`,
    evidence: [`sampledBytes=${entropy.sampledBytes}`, `entropy=${entropy.entropy}`],
    limitations: ['Entropy is a statistical characteristic and cannot prove encryption, packing, or maliciousness.'],
  }));
  if (entropy.entropy >= 7.4) {
    hypotheses.push(finding(sequence++, {
      domain: 'artifact', type: 'high-entropy-signal', classification: 'ai-hypothesis', severity: 'info', confidence: 'low',
      description: 'The bounded sample has high entropy. Compression, encrypted data, packed code, or normal binary data are possible explanations.',
      evidence: [`entropy=${entropy.entropy}`],
      limitations: ['No causal conclusion is made from entropy alone.'],
    }));
  }

  if (profile !== 'pcap-summary') {
    const strings = extractPrintableStrings(buffer);
    toolFindings.push(finding(sequence++, {
      domain: 'artifact', type: 'printable-strings', severity: 'info', confidence: 'medium',
      description: `${strings.strings.length} printable strings were collected from ${strings.sampledBytes} bounded bytes; sensitive-looking values were redacted.`,
      evidence: strings.strings.slice(0, 80).map(item => ({ offset: item.offset, text: item.text })),
      limitations: [
        ...(strings.truncated ? ['String collection was truncated by a safety limit.'] : []),
        'Absence of a string does not prove the related behavior is absent.',
      ],
    }));
  } else {
    limitations.push('Printable-string extraction is intentionally disabled for packet captures so packet payloads are not exposed in findings.');
  }

  if (['pe', 'elf', 'macho'].includes(format.id)) {
    const parsed = format.id === 'pe' ? parsePortableExecutable(buffer) : format.id === 'elf' ? parseElf(buffer) : parseMachO(buffer);
    const parsedFinding = formatParserFinding(sequence++, format, parsed);
    if (parsedFinding) toolFindings.push(parsedFinding);
  }
  if (['zip', 'apk'].includes(format.id)) toolFindings.push(summarizeZip(sequence++, buffer, format));

  if (profile === 'pcap-summary') {
    if (format.id !== 'pcap') {
      unknowns.push(finding(sequence++, {
        domain: 'network', type: 'pcap-summary', classification: 'unknown', severity: 'medium', confidence: 'high',
        description: `The passive PCAP profile requires a classic PCAP artifact; detected ${format.id}.`, evidence: format.evidence,
        limitations: ['PCAPNG requires a future parser or an explicitly enabled TShark adapter.'],
      }));
    } else {
      const pcap = parsePcap(buffer);
      if (!pcap.valid) {
        unknowns.push(finding(sequence++, {
          domain: 'network', type: 'pcap-summary', classification: 'unknown', severity: 'medium', confidence: 'high',
          description: 'PCAP was detected but its bounded parser could not produce a summary.', evidence: format.evidence,
          limitations: [pcap.limitation || 'PCAP parsing failed.'],
        }));
      } else {
        toolFindings.push(finding(sequence++, {
          domain: 'network', type: 'pcap-summary', severity: 'info', confidence: 'high',
          description: `Passive PCAP summary: ${pcap.packetsRead} packets, ${pcap.bytesCaptured} captured bytes, protocols ${safeJson(pcap.protocolCounts)}.`,
          evidence: {
            protocolCounts: pcap.protocolCounts,
            topEndpoints: pcap.topEndpoints,
            firstTimestamp: pcap.firstTimestamp,
            lastTimestamp: pcap.lastTimestamp,
          },
          limitations: [
            ...(pcap.truncated ? ['Packet processing stopped at a safety limit or before trailing data.'] : []),
            ...(pcap.limitation ? [pcap.limitation] : []),
            'Only link, IP, and selected transport headers were summarized; packet payloads were not inspected.',
          ],
        }));
      }
    }
  }

  if (profile === 'source-architecture') {
    if (!['source', 'text', 'zip'].includes(format.id)) {
      unknowns.push(finding(sequence++, {
        domain: 'source', type: 'source-architecture', classification: 'unknown', severity: 'medium', confidence: 'high',
        description: `Source architecture mapping is limited to source text or safe ZIP source archives; detected ${format.id}.`, evidence: format.evidence,
      }));
    } else {
      const source = analyzeSourceArtifact(buffer, format.id === 'zip' ? originalFilename || 'source-archive.zip' : originalFilename || 'uploaded-source.txt');
      toolFindings.push(finding(sequence++, {
        domain: 'source', type: 'source-architecture', severity: 'info', confidence: source.filesScanned ? 'medium' : 'low',
        description: `Source mapping inspected ${source.filesScanned} source file(s), found ${source.imports.length} unique imports, ${source.definitions.length} definitions, and ${source.routes.length} route declarations.`,
        evidence: {
          imports: source.imports.slice(0, 120),
          definitions: source.definitions.slice(0, 100),
          routes: source.routes.slice(0, 80),
          dependencies: source.dependencies.slice(0, 120),
        },
        limitations: source.limitations,
      }));
      if (source.routes.length) {
        hypotheses.push(finding(sequence++, {
          domain: 'source', type: 'declared-route-map', classification: 'ai-hypothesis', severity: 'info', confidence: 'medium',
          description: 'Route declarations provide a likely server interface map; actual reachability, auth, and runtime behavior require separate authorized testing.',
          evidence: source.routes.slice(0, 80),
          limitations: ['Static route declarations do not prove that a route is deployed or reachable.'],
        }));
      }
    }
  }

  if (profile === 'firmware-static') {
    limitations.push('Firmware extraction, emulation, signature validation, flash access, and bootloader modification are not performed by this profile.');
  }
  if (profile === 'binary-static') {
    limitations.push('Disassembly, decompilation, debugging, and dynamic execution require separately provisioned tools and explicit approval.');
  }
  limitations.push('The worker does not execute the artifact, invoke a shell, open network connections, or extract archive contents to disk.');
  return { directFacts, toolFindings, hypotheses, confirmedConclusions: [], unknowns, limitations };
}

async function main() {
  const inputPath = argumentValue('--input');
  if (!inputPath) throw new Error('Worker input manifest is required.');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  if (!input?.artifactPath || !input?.profile || !input?.artifactId) throw new Error('Worker input manifest is invalid.');
  const fileInfo = await stat(input.artifactPath);
  if (!fileInfo.isFile() || fileInfo.size <= 0 || fileInfo.size > MAX_ARTIFACT_BYTES) {
    throw new Error('Artifact does not satisfy worker size policy.');
  }
  const raw = await readFile(input.artifactPath);
  const buffer = raw.subarray(0, Math.min(raw.length, MAX_INSPECT_BYTES));
  const format = detectArtifactFormat(buffer, input.originalFilename || 'artifact.bin');
  const startedAt = new Date().toISOString();
  const analysis = buildStaticTriage({ buffer, format, profile: input.profile, originalFilename: input.originalFilename });
  const result = {
    ok: true,
    schemaVersion: RE_SCHEMA_VERSION,
    worker: {
      name: 'friday-static-worker',
      version: MODULE_VERSION,
      executionMode: 'offline-static-only',
      networkOperations: false,
      dynamicExecution: false,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    artifactInspection: {
      inspectedBytes: buffer.length,
      totalArtifactBytes: raw.length,
      format,
    },
    ...analysis,
  };
  process.stdout.write(safeJson(result));
}

main().catch(error => {
  process.stdout.write(safeJson({ ok: false, error: error instanceof Error ? error.message : 'Static worker failed.' }));
  process.exitCode = 1;
});
