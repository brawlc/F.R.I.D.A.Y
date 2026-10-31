import { redactSensitiveText } from './redaction.mjs';

const SOURCE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cxx', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx', 'kt', 'kts',
  'm', 'md', 'mjs', 'php', 'py', 'rb', 'rs', 'sh', 'swift', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml',
]);

const TEXT_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, 'csv', 'env', 'ini', 'json', 'log', 'sql', 'txt']);

function extensionOf(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{1,12})$/i);
  return match?.[1] || '';
}

function hasPrefix(buffer, values) {
  return values.every((value, index) => buffer[index] === value);
}

function printableRatio(buffer, limit = 8_192) {
  const sample = buffer.subarray(0, Math.min(buffer.length, limit));
  if (!sample.length) return 0;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) printable += 1;
  }
  return printable / sample.length;
}

export function detectArtifactFormat(buffer, originalFilename = '') {
  const ext = extensionOf(originalFilename);
  const base = {
    extension: ext || null,
    id: 'unknown',
    category: 'unknown',
    description: 'Unknown binary or data format',
    confidence: 'low',
    evidence: [],
  };

  if (hasPrefix(buffer, [0x4d, 0x5a])) {
    return { ...base, id: 'pe', category: 'binary', description: 'Windows Portable Executable candidate', confidence: 'high', evidence: ['MZ DOS header'] };
  }
  if (hasPrefix(buffer, [0x7f, 0x45, 0x4c, 0x46])) {
    return { ...base, id: 'elf', category: 'binary', description: 'ELF executable, shared library, or object candidate', confidence: 'high', evidence: ['ELF magic'] };
  }
  if (hasPrefix(buffer, [0xfe, 0xed, 0xfa, 0xce]) || hasPrefix(buffer, [0xce, 0xfa, 0xed, 0xfe])
    || hasPrefix(buffer, [0xfe, 0xed, 0xfa, 0xcf]) || hasPrefix(buffer, [0xcf, 0xfa, 0xed, 0xfe])) {
    return { ...base, id: 'macho', category: 'binary', description: 'Mach-O binary candidate', confidence: 'high', evidence: ['Mach-O magic'] };
  }
  if (hasPrefix(buffer, [0xd4, 0xc3, 0xb2, 0xa1]) || hasPrefix(buffer, [0xa1, 0xb2, 0xc3, 0xd4])
    || hasPrefix(buffer, [0x4d, 0x3c, 0xb2, 0xa1]) || hasPrefix(buffer, [0xa1, 0xb2, 0x3c, 0x4d])) {
    return { ...base, id: 'pcap', category: 'capture', description: 'PCAP packet capture', confidence: 'high', evidence: ['PCAP global-header magic'] };
  }
  if (hasPrefix(buffer, [0x0a, 0x0d, 0x0d, 0x0a])) {
    return { ...base, id: 'pcapng', category: 'capture', description: 'PCAP Next Generation capture', confidence: 'high', evidence: ['PCAPNG section-header magic'] };
  }
  if (hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06]) || hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08])) {
    return {
      ...base,
      id: ext === 'apk' ? 'apk' : 'zip',
      category: ext === 'apk' ? 'mobile' : 'archive',
      description: ext === 'apk' ? 'Android application package (ZIP container)' : 'ZIP archive',
      confidence: 'high',
      evidence: ['ZIP local-header or end-of-central-directory magic'],
    };
  }
  if (hasPrefix(buffer, [0x1f, 0x8b, 0x08])) {
    return { ...base, id: 'gzip', category: 'archive', description: 'GZIP compressed stream', confidence: 'high', evidence: ['GZIP magic'] };
  }
  if (hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { ...base, id: 'pdf', category: 'document', description: 'PDF document', confidence: 'high', evidence: ['PDF header'] };
  }
  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ...base, id: 'png', category: 'image', description: 'PNG image', confidence: 'high', evidence: ['PNG signature'] };
  }
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return { ...base, id: 'jpeg', category: 'image', description: 'JPEG image', confidence: 'high', evidence: ['JPEG SOI marker'] };
  }
  if (SOURCE_EXTENSIONS.has(ext)) {
    return { ...base, id: 'source', category: 'source', description: `Source-like .${ext} text artifact`, confidence: 'medium', evidence: [`Filename extension .${ext}`] };
  }
  if (TEXT_EXTENSIONS.has(ext) || printableRatio(buffer) > 0.92) {
    return { ...base, id: 'text', category: 'text', description: 'Plain-text-like artifact', confidence: TEXT_EXTENSIONS.has(ext) ? 'medium' : 'low', evidence: TEXT_EXTENSIONS.has(ext) ? [`Filename extension .${ext}`] : ['High printable-byte ratio in bounded sample'] };
  }
  return base;
}

export function shannonEntropy(buffer, maximumBytes = 1_048_576) {
  const sample = buffer.subarray(0, Math.min(buffer.length, maximumBytes));
  if (!sample.length) return { entropy: 0, sampledBytes: 0 };
  const counts = new Uint32Array(256);
  for (const value of sample) counts[value] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const probability = count / sample.length;
    entropy -= probability * Math.log2(probability);
  }
  return { entropy: Number(entropy.toFixed(4)), sampledBytes: sample.length };
}

export function extractPrintableStrings(buffer, { minimumLength = 4, maximumStrings = 200, maximumBytes = 1_048_576 } = {}) {
  const sample = buffer.subarray(0, Math.min(buffer.length, maximumBytes));
  const strings = [];
  const seen = new Set();
  let start = -1;

  const add = (end) => {
    if (start < 0 || end - start < minimumLength || strings.length >= maximumStrings) return;
    const text = redactSensitiveText(sample.toString('latin1', start, end), 300).trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      strings.push({ offset: start, text });
    }
  };

  for (let index = 0; index < sample.length; index += 1) {
    const value = sample[index];
    if (value >= 32 && value <= 126) {
      if (start < 0) start = index;
    } else {
      add(index);
      start = -1;
    }
    if (strings.length >= maximumStrings) break;
  }
  add(sample.length);
  return { strings, sampledBytes: sample.length, truncated: buffer.length > sample.length || strings.length >= maximumStrings };
}

function readUInt16(buffer, offset, littleEndian = true) {
  if (offset < 0 || offset + 2 > buffer.length) return null;
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readUInt32(buffer, offset, littleEndian = true) {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function hex(value) {
  return value === null || value === undefined ? null : `0x${Number(value).toString(16)}`;
}

const PE_MACHINES = {
  0x014c: 'x86',
  0x8664: 'x86-64',
  0x01c0: 'ARM',
  0xaa64: 'ARM64',
  0x0200: 'IA-64',
};

export function parsePortableExecutable(buffer) {
  if (!hasPrefix(buffer, [0x4d, 0x5a]) || buffer.length < 0x40) return null;
  const peOffset = readUInt32(buffer, 0x3c, true);
  if (peOffset === null || peOffset + 24 > buffer.length || !hasPrefix(buffer.subarray(peOffset), [0x50, 0x45, 0x00, 0x00])) {
    return { valid: false, limitation: 'MZ header observed, but a bounded parser could not verify a valid PE header.' };
  }
  const machine = readUInt16(buffer, peOffset + 4, true);
  const sectionCount = readUInt16(buffer, peOffset + 6, true);
  const timestamp = readUInt32(buffer, peOffset + 8, true);
  const optionalHeaderSize = readUInt16(buffer, peOffset + 20, true);
  const optionalMagic = readUInt16(buffer, peOffset + 24, true);
  const sections = [];
  const sectionStart = peOffset + 24 + (optionalHeaderSize || 0);
  const boundedCount = Math.min(sectionCount || 0, 96);
  for (let index = 0; index < boundedCount; index += 1) {
    const offset = sectionStart + (index * 40);
    if (offset + 40 > buffer.length) break;
    const rawName = buffer.subarray(offset, offset + 8).toString('ascii').replace(/\0/g, '').trim();
    sections.push({
      name: rawName || `section_${index}`,
      virtualSize: readUInt32(buffer, offset + 8, true),
      rawSize: readUInt32(buffer, offset + 16, true),
      rawOffset: readUInt32(buffer, offset + 20, true),
    });
  }
  return {
    valid: true,
    architecture: PE_MACHINES[machine] || `unknown-machine-${hex(machine)}`,
    machine: hex(machine),
    sectionCount,
    parsedSections: sections,
    optionalHeader: optionalMagic === 0x20b ? 'PE32+' : optionalMagic === 0x10b ? 'PE32' : hex(optionalMagic),
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
  };
}

const ELF_MACHINES = {
  0x03: 'x86',
  0x28: 'ARM',
  0x3e: 'x86-64',
  0xb7: 'AArch64',
  0xf3: 'RISC-V',
  0x08: 'MIPS',
};

export function parseElf(buffer) {
  if (!hasPrefix(buffer, [0x7f, 0x45, 0x4c, 0x46]) || buffer.length < 20) return null;
  const bitness = buffer[4] === 2 ? 64 : buffer[4] === 1 ? 32 : null;
  const littleEndian = buffer[5] === 1 ? true : buffer[5] === 2 ? false : null;
  if (!bitness || littleEndian === null) return { valid: false, limitation: 'ELF magic observed, but class or byte order is invalid.' };
  const type = readUInt16(buffer, 16, littleEndian);
  const machine = readUInt16(buffer, 18, littleEndian);
  const entryOffset = bitness === 64 ? 24 : 24;
  let entryPoint = null;
  if (bitness === 32) entryPoint = readUInt32(buffer, entryOffset, littleEndian);
  if (bitness === 64 && entryOffset + 8 <= buffer.length) {
    const entry = littleEndian ? buffer.readBigUInt64LE(entryOffset) : buffer.readBigUInt64BE(entryOffset);
    entryPoint = `0x${entry.toString(16)}`;
  }
  const sectionCountOffset = bitness === 64 ? 60 : 48;
  return {
    valid: true,
    bitness,
    endianness: littleEndian ? 'little-endian' : 'big-endian',
    architecture: ELF_MACHINES[machine] || `unknown-machine-${hex(machine)}`,
    machine: hex(machine),
    type: ({ 1: 'relocatable', 2: 'executable', 3: 'shared-object', 4: 'core' })[type] || `unknown-type-${hex(type)}`,
    entryPoint: typeof entryPoint === 'string' ? entryPoint : hex(entryPoint),
    sectionCount: readUInt16(buffer, sectionCountOffset, littleEndian),
  };
}

const MACH_CPU_TYPES = {
  7: 'x86',
  12: 'ARM',
  0x01000007: 'x86-64',
  0x0100000c: 'ARM64',
};

export function parseMachO(buffer) {
  if (buffer.length < 28) return null;
  const magic = buffer.subarray(0, 4).toString('hex');
  const variants = {
    feedface: { bitness: 32, littleEndian: false },
    cefaedfe: { bitness: 32, littleEndian: true },
    feedfacf: { bitness: 64, littleEndian: false },
    cffaedfe: { bitness: 64, littleEndian: true },
  };
  const variant = variants[magic];
  if (!variant) return null;
  const cpuType = readUInt32(buffer, 4, variant.littleEndian);
  const fileType = readUInt32(buffer, 12, variant.littleEndian);
  const commandCount = readUInt32(buffer, 16, variant.littleEndian);
  return {
    valid: true,
    bitness: variant.bitness,
    endianness: variant.littleEndian ? 'little-endian' : 'big-endian',
    architecture: MACH_CPU_TYPES[cpuType] || `unknown-cpu-${hex(cpuType)}`,
    cpuType: hex(cpuType),
    fileType: hex(fileType),
    loadCommandCount: commandCount,
  };
}

export function formatEvidenceSummary(format) {
  return `${format.description}; confidence ${format.confidence}; evidence: ${format.evidence.join(', ') || 'none'}.`;
}
