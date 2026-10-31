import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function u16(buffer, offset) {
  return offset >= 0 && offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : null;
}

function u32(buffer, offset) {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;
}

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (u32(buffer, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

export function safeArchivePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))) return null;
  return parts.join('/');
}

export function parseZipCentralDirectory(buffer, { maximumEntries = 500 } = {}) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) return { valid: false, limitation: 'ZIP end-of-central-directory record was not found in the bounded artifact.' };

  const entryCount = u16(buffer, endOffset + 10);
  const centralDirectorySize = u32(buffer, endOffset + 12);
  const centralDirectoryOffset = u32(buffer, endOffset + 16);
  if (entryCount === null || centralDirectorySize === null || centralDirectoryOffset === null) {
    return { valid: false, limitation: 'ZIP end-of-central-directory record is truncated.' };
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    return { valid: false, limitation: 'ZIP64 is not parsed by the built-in bounded parser.' };
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    return { valid: false, limitation: 'ZIP central-directory bounds are invalid.' };
  }

  const entries = [];
  let offset = centralDirectoryOffset;
  const cappedEntryCount = Math.min(entryCount, maximumEntries);
  for (let index = 0; index < cappedEntryCount; index += 1) {
    if (u32(buffer, offset) !== CENTRAL_SIGNATURE || offset + 46 > buffer.length) {
      return { valid: false, limitation: `ZIP central-directory entry ${index} is malformed or truncated.` };
    }
    const flags = u16(buffer, offset + 8);
    const method = u16(buffer, offset + 10);
    const compressedSize = u32(buffer, offset + 20);
    const uncompressedSize = u32(buffer, offset + 24);
    const filenameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const externalAttributes = u32(buffer, offset + 38);
    const localHeaderOffset = u32(buffer, offset + 42);
    const headerLength = 46 + filenameLength + extraLength + commentLength;
    if ([flags, method, compressedSize, uncompressedSize, filenameLength, extraLength, commentLength, externalAttributes, localHeaderOffset].some(value => value === null)
      || offset + headerLength > buffer.length) {
      return { valid: false, limitation: `ZIP central-directory entry ${index} has invalid bounds.` };
    }
    const rawName = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString((flags & 0x0800) ? 'utf8' : 'latin1');
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & 0o170000;
    entries.push({
      index,
      name: rawName,
      safePath: safeArchivePath(rawName),
      isDirectory: rawName.endsWith('/'),
      isSymlink: fileType === 0o120000,
      encrypted: Boolean(flags & 0x0001),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += headerLength;
  }

  const totalCompressedBytes = entries.reduce((total, entry) => total + entry.compressedSize, 0);
  const totalUncompressedBytes = entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
  const suspiciousEntries = entries.filter(entry => !entry.safePath || entry.isSymlink || entry.encrypted);
  return {
    valid: true,
    entryCount,
    parsedEntryCount: entries.length,
    entries,
    totalCompressedBytes,
    totalUncompressedBytes,
    compressionRatio: totalCompressedBytes ? Number((totalUncompressedBytes / totalCompressedBytes).toFixed(2)) : null,
    suspiciousEntries,
    truncated: entryCount > maximumEntries,
  };
}

function dataOffsetForEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (u32(buffer, offset) !== LOCAL_SIGNATURE || offset + 30 > buffer.length) return null;
  const filenameLength = u16(buffer, offset + 26);
  const extraLength = u16(buffer, offset + 28);
  if (filenameLength === null || extraLength === null) return null;
  const dataOffset = offset + 30 + filenameLength + extraLength;
  if (dataOffset < 0 || dataOffset + entry.compressedSize > buffer.length) return null;
  return dataOffset;
}

export function readSafeZipEntries(buffer, {
  maximumFiles = 120,
  maximumFileBytes = 512 * 1024,
  maximumTotalBytes = 2 * 1024 * 1024,
  include = () => true,
} = {}) {
  const archive = parseZipCentralDirectory(buffer);
  if (!archive.valid) return { ...archive, files: [], skipped: [] };

  const files = [];
  const skipped = [];
  let totalBytes = 0;
  for (const entry of archive.entries) {
    if (files.length >= maximumFiles) {
      skipped.push({ path: entry.name, reason: 'file-count-limit' });
      continue;
    }
    if (entry.isDirectory || !entry.safePath || entry.isSymlink || entry.encrypted) {
      skipped.push({ path: entry.name, reason: entry.isSymlink ? 'symlink' : entry.encrypted ? 'encrypted' : 'unsafe-path-or-directory' });
      continue;
    }
    if (!include(entry.safePath)) continue;
    if (entry.uncompressedSize > maximumFileBytes || entry.uncompressedSize + totalBytes > maximumTotalBytes) {
      skipped.push({ path: entry.safePath, reason: 'uncompressed-size-limit' });
      continue;
    }
    if (![0, 8].includes(entry.method)) {
      skipped.push({ path: entry.safePath, reason: `unsupported-compression-method-${entry.method}` });
      continue;
    }
    const dataOffset = dataOffsetForEntry(buffer, entry);
    if (dataOffset === null) {
      skipped.push({ path: entry.safePath, reason: 'invalid-local-header' });
      continue;
    }
    try {
      const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
      const data = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.min(maximumFileBytes, maximumTotalBytes - totalBytes) });
      if (data.length > maximumFileBytes || data.length + totalBytes > maximumTotalBytes) {
        skipped.push({ path: entry.safePath, reason: 'decompressed-size-limit' });
        continue;
      }
      totalBytes += data.length;
      files.push({ path: entry.safePath, data });
    } catch {
      skipped.push({ path: entry.safePath, reason: 'decompression-failed' });
    }
  }
  return { ...archive, files, skipped, extractedBytes: totalBytes };
}
