import { spawnSync } from 'node:child_process';
import { ANALYSIS_PROFILES, MODULE_VERSION, RE_API_VERSION, WORKER_MEMORY_MB, WORKER_TIMEOUT_MS } from './constants.mjs';
import { getEvidenceStoreStatus, verifyAuditChain } from './store.mjs';

const EXTERNAL_TOOLS = [
  { id: 'file', label: 'file', command: 'file', versionArgs: ['--version'], domain: 'binary' },
  { id: 'ghidra', label: 'Ghidra', command: process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless', versionArgs: ['-version'], domain: 'binary' },
  { id: 'gdb', label: 'GDB', command: 'gdb', versionArgs: ['--version'], domain: 'binary' },
  { id: 'lldb', label: 'LLDB', command: 'lldb', versionArgs: ['--version'], domain: 'binary' },
  { id: 'binwalk', label: 'Binwalk', command: 'binwalk', versionArgs: ['--version'], domain: 'firmware' },
  { id: 'tshark', label: 'TShark', command: 'tshark', versionArgs: ['--version'], domain: 'network' },
  { id: 'jadx', label: 'JADX', command: 'jadx', versionArgs: ['--version'], domain: 'mobile' },
  { id: 'apktool', label: 'apktool', command: 'apktool', versionArgs: ['--version'], domain: 'mobile' },
  { id: 'adb', label: 'Android Debug Bridge', command: 'adb', versionArgs: ['version'], domain: 'mobile' },
  { id: 'openocd', label: 'OpenOCD', command: 'openocd', versionArgs: ['--version'], domain: 'hardware' },
  { id: 'sigrok-cli', label: 'sigrok-cli', command: 'sigrok-cli', versionArgs: ['--version'], domain: 'hardware' },
  { id: 'docker', label: 'Docker', command: 'docker', versionArgs: ['--version'], domain: 'isolation' },
  { id: 'qemu', label: 'QEMU', command: process.platform === 'win32' ? 'qemu-system-x86_64.exe' : 'qemu-system-x86_64', versionArgs: ['--version'], domain: 'isolation' },
];

let cached = null;
let cachedAt = 0;

function findCommand(command) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [command], { encoding: 'utf8', timeout: 1_500, windowsHide: true });
  if (result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || null;
}

function getVersion(executable, args) {
  if (!executable) return null;
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 2_000,
    windowsHide: true,
    maxBuffer: 12 * 1024,
  });
  const firstLine = String(result.stdout || result.stderr || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 300) : null;
}

function externalToolStatus(tool) {
  const executable = findCommand(tool.command);
  return {
    id: tool.id,
    label: tool.label,
    domain: tool.domain,
    detected: Boolean(executable),
    executable: executable || null,
    version: executable ? getVersion(executable, tool.versionArgs) : null,
    integrationStatus: 'not-enabled',
    availableForJobs: false,
    reason: executable
      ? 'Tool was detected, but no external-tool adapter is enabled in this safety-first release.'
      : 'Tool was not found on PATH.',
  };
}

export async function getCapabilityRegistry({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cachedAt < 30_000) return cached;
  const audit = await verifyAuditChain().catch(error => ({ valid: false, events: 0, error: error instanceof Error ? error.message : 'Audit verification failed.' }));
  const externalTools = EXTERNAL_TOOLS.map(externalToolStatus);
  cached = {
    ok: true,
    apiVersion: RE_API_VERSION,
    moduleVersion: MODULE_VERSION,
    checkedAt: new Date().toISOString(),
    profiles: Object.values(ANALYSIS_PROFILES).map(profile => ({
      ...profile,
      available: true,
      execution: 'offline-static-worker',
    })),
    capabilities: [
      {
        id: 'native-static-worker',
        label: 'Bounded static worker',
        domain: 'core',
        status: 'available',
        detail: `Separate Node process; ${WORKER_TIMEOUT_MS}ms wall-clock cap; ${WORKER_MEMORY_MB}MB V8 heap cap.`,
      },
      {
        id: 'native-binary-triage',
        label: 'Native PE / ELF / Mach-O triage',
        domain: 'binary',
        status: 'available',
        detail: 'Header and section metadata only. It does not decompile or execute binaries.',
      },
      {
        id: 'native-pcap',
        label: 'Native offline PCAP summary',
        domain: 'network',
        status: 'available',
        detail: 'PCAP headers and packet metadata only; PCAPNG requires a future adapter.',
      },
      {
        id: 'native-source-map',
        label: 'Bounded source architecture map',
        domain: 'source',
        status: 'available',
        detail: 'Single source files and safe ZIP source archives; no build scripts, package installs, or repository path access.',
      },
      {
        id: 'authorized-website-observation',
        label: 'Authorized public website observation',
        domain: 'web',
        status: 'available',
        detail: 'One public HTML page plus same-origin references, headers, forms, and client technology signals. Private targets and cross-origin redirects are blocked.',
      },
      {
        id: 'dynamic-analysis',
        label: 'Dynamic analysis / VM execution',
        domain: 'dynamic',
        status: 'unavailable',
        detail: 'Not provisioned. Requires a disposable VM or hardened sandbox plus explicit per-job human approval.',
      },
      {
        id: 'external-networking',
        label: 'Network probing / web crawling',
        domain: 'network',
        status: 'unavailable',
        detail: 'Disabled in this module. The worker has no network-analysis operations.',
      },
      {
        id: 'physical-hardware',
        label: 'Physical hardware interaction',
        domain: 'hardware',
        status: 'unavailable',
        detail: 'Disabled. No serial writes, flashing, powering, or debug-port actions are exposed.',
      },
    ],
    externalTools,
    isolation: {
      workerProcess: true,
      networkDefault: 'no module network operations are implemented; this is not an OS-enforced network namespace',
      vmOrContainer: false,
      dynamicExecution: false,
      evidenceStore: getEvidenceStoreStatus(),
    },
    audit,
    limitations: [
      'This release has no application authentication layer; authorization is an explicit operator assertion recorded in the audit trail.',
      'A child process and V8 memory cap are not equivalent to a container or disposable VM.',
      'External analysis tools are detected for setup visibility only and are not executed by jobs.',
    ],
  };
  cachedAt = Date.now();
  return cached;
}
