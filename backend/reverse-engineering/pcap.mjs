function u16(buffer, offset, littleEndian) {
  if (offset < 0 || offset + 2 > buffer.length) return null;
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function u32(buffer, offset, littleEndian) {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function ipv4(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
}

function ipv6(buffer, offset) {
  if (offset < 0 || offset + 16 > buffer.length) return null;
  const parts = [];
  for (let index = 0; index < 16; index += 2) parts.push(buffer.readUInt16BE(offset + index).toString(16));
  return parts.join(':');
}

function protocolName(protocol) {
  return ({ 1: 'ICMP', 6: 'TCP', 17: 'UDP', 58: 'ICMPv6' })[protocol] || `IP-${protocol}`;
}

function parseIpPacket(packet, offset) {
  if (offset >= packet.length) return null;
  const version = packet[offset] >> 4;
  if (version === 4) {
    const headerLength = (packet[offset] & 0x0f) * 4;
    if (headerLength < 20 || offset + headerLength > packet.length) return { kind: 'malformed-ipv4' };
    const protocol = packet[offset + 9];
    const source = ipv4(packet, offset + 12);
    const destination = ipv4(packet, offset + 16);
    let sourcePort = null;
    let destinationPort = null;
    if ((protocol === 6 || protocol === 17) && offset + headerLength + 4 <= packet.length) {
      sourcePort = packet.readUInt16BE(offset + headerLength);
      destinationPort = packet.readUInt16BE(offset + headerLength + 2);
    }
    return { version: 4, protocol: protocolName(protocol), source, destination, sourcePort, destinationPort };
  }
  if (version === 6) {
    if (offset + 40 > packet.length) return { kind: 'malformed-ipv6' };
    const protocol = packet[offset + 6];
    const source = ipv6(packet, offset + 8);
    const destination = ipv6(packet, offset + 24);
    let sourcePort = null;
    let destinationPort = null;
    // Extension headers are intentionally not walked: this is a bounded summary, not a full dissector.
    if ((protocol === 6 || protocol === 17) && offset + 44 <= packet.length) {
      sourcePort = packet.readUInt16BE(offset + 40);
      destinationPort = packet.readUInt16BE(offset + 42);
    }
    return { version: 6, protocol: protocolName(protocol), source, destination, sourcePort, destinationPort };
  }
  return { kind: 'non-ip' };
}

function parsePacketLinkLayer(packet, linkType) {
  if (linkType === 1) {
    if (packet.length < 14) return { kind: 'truncated-ethernet' };
    let etherType = packet.readUInt16BE(12);
    let offset = 14;
    let vlanDepth = 0;
    while ([0x8100, 0x88a8, 0x9100].includes(etherType) && vlanDepth < 2) {
      if (offset + 4 > packet.length) return { kind: 'truncated-vlan' };
      etherType = packet.readUInt16BE(offset + 2);
      offset += 4;
      vlanDepth += 1;
    }
    if (etherType === 0x0800 || etherType === 0x86dd) return parseIpPacket(packet, offset);
    return { kind: `ethernet-0x${etherType.toString(16)}` };
  }
  if (linkType === 101 || linkType === 228) return parseIpPacket(packet, 0);
  return { kind: `unsupported-linktype-${linkType}` };
}

function timestampToIso(seconds, fraction, nanosecondPrecision) {
  if (!Number.isFinite(seconds) || seconds > 4_102_444_800 || seconds < 0) return null;
  const milliseconds = (seconds * 1000) + (nanosecondPrecision ? Math.floor(fraction / 1_000_000) : Math.floor(fraction / 1_000));
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function parsePcap(buffer, { maximumPackets = 10_000 } = {}) {
  if (buffer.length < 24) return { valid: false, limitation: 'PCAP global header is truncated.' };
  const magic = buffer.subarray(0, 4).toString('hex');
  const layout = {
    d4c3b2a1: { littleEndian: true, nanosecondPrecision: false },
    a1b2c3d4: { littleEndian: false, nanosecondPrecision: false },
    '4d3cb2a1': { littleEndian: true, nanosecondPrecision: true },
    a1b23c4d: { littleEndian: false, nanosecondPrecision: true },
  }[magic];
  if (!layout) return { valid: false, limitation: 'Unrecognized PCAP global-header magic.' };
  const majorVersion = u16(buffer, 4, layout.littleEndian);
  const minorVersion = u16(buffer, 6, layout.littleEndian);
  const snapLength = u32(buffer, 16, layout.littleEndian);
  const linkType = u32(buffer, 20, layout.littleEndian);
  if ([majorVersion, minorVersion, snapLength, linkType].some(value => value === null)) return { valid: false, limitation: 'PCAP global header is malformed.' };

  const protocolCounts = {};
  const endpointCounts = new Map();
  let offset = 24;
  let packetsRead = 0;
  let bytesCaptured = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let malformedPackets = 0;
  let limitation = '';

  while (offset + 16 <= buffer.length && packetsRead < maximumPackets) {
    const timestampSeconds = u32(buffer, offset, layout.littleEndian);
    const timestampFraction = u32(buffer, offset + 4, layout.littleEndian);
    const includedLength = u32(buffer, offset + 8, layout.littleEndian);
    const originalLength = u32(buffer, offset + 12, layout.littleEndian);
    if ([timestampSeconds, timestampFraction, includedLength, originalLength].some(value => value === null)
      || includedLength > 1_048_576 || offset + 16 + includedLength > buffer.length) {
      limitation = 'Stopped at an invalid or oversized packet record.';
      break;
    }
    const packet = buffer.subarray(offset + 16, offset + 16 + includedLength);
    const timestamp = timestampToIso(timestampSeconds, timestampFraction, layout.nanosecondPrecision);
    if (timestamp && !firstTimestamp) firstTimestamp = timestamp;
    if (timestamp) lastTimestamp = timestamp;
    bytesCaptured += includedLength;
    const summary = parsePacketLinkLayer(packet, linkType);
    if (summary?.protocol) {
      protocolCounts[summary.protocol] = (protocolCounts[summary.protocol] || 0) + 1;
      const source = summary.sourcePort === null ? summary.source : `${summary.source}:${summary.sourcePort}`;
      const destination = summary.destinationPort === null ? summary.destination : `${summary.destination}:${summary.destinationPort}`;
      endpointCounts.set(source, (endpointCounts.get(source) || 0) + 1);
      endpointCounts.set(destination, (endpointCounts.get(destination) || 0) + 1);
    } else if (String(summary?.kind || '').startsWith('malformed') || String(summary?.kind || '').startsWith('truncated')) {
      malformedPackets += 1;
    }
    packetsRead += 1;
    offset += 16 + includedLength;
  }

  const topEndpoints = [...endpointCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([endpoint, packets]) => ({ endpoint, packets }));
  return {
    valid: true,
    version: `${majorVersion}.${minorVersion}`,
    linkType,
    snapLength,
    timePrecision: layout.nanosecondPrecision ? 'nanosecond' : 'microsecond',
    packetsRead,
    bytesCaptured,
    protocolCounts,
    topEndpoints,
    firstTimestamp,
    lastTimestamp,
    malformedPackets,
    truncated: packetsRead >= maximumPackets || offset < buffer.length,
    limitation: limitation || null,
  };
}
