/**
 * Minimal SNMPv1 GET client.
 *
 * Hand-rolled BER rather than a dependency: the API ships as a pkg-bundled
 * single .exe, so the zero-native-dependency rule that picked sql.js applies
 * here too. Only GetRequest is needed — the Printer MIB values this reads are
 * all scalar.
 *
 * Every failure path resolves to null. Callers use SNMP to *enrich* a print
 * result, so an unreachable printer must never turn into a thrown error.
 */
import dgram from 'node:dgram';

export interface Varbind {
  oid: string;
  /** Number for INTEGER/Counter/Gauge/TimeTicks, latin1 string for OCTET STRING. */
  value: number | string | null;
  tag: number;
}

export interface SnmpOptions {
  community?: string;
  timeoutMs?: number;
  port?: number;
}

// ── BER encoding ──────────────────────────────────────────────────────

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

function encodeInt(value: number): Buffer {
  const bytes: number[] = [];
  let n = value;
  do {
    bytes.unshift(n & 0xff);
    n >>= 8;
  } while (n > 0);
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

function encodeOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
  for (const part of parts.slice(2)) {
    if (part < 0x80) {
      bytes.push(part);
      continue;
    }
    const chunk: number[] = [];
    let n = part;
    while (n > 0) {
      chunk.unshift(n & 0x7f);
      n >>= 7;
    }
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] = (chunk[i] ?? 0) | 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function buildGetRequest(community: string, oids: string[], requestId: number): Buffer {
  const varbinds = oids.map((oid) =>
    tlv(0x30, Buffer.concat([encodeOid(oid), tlv(0x05, Buffer.alloc(0))])),
  );
  const pdu = tlv(
    0xa0,
    Buffer.concat([
      encodeInt(requestId),
      encodeInt(0), // error-status
      encodeInt(0), // error-index
      tlv(0x30, Buffer.concat(varbinds)),
    ]),
  );
  return tlv(
    0x30,
    Buffer.concat([encodeInt(0) /* version 1 */, tlv(0x04, Buffer.from(community, 'ascii')), pdu]),
  );
}

// ── BER decoding ──────────────────────────────────────────────────────

function readLength(buf: Buffer, offset: number): { length: number; next: number } | undefined {
  if (offset >= buf.length) return undefined;
  const first = buf[offset] as number;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 4 || offset + count >= buf.length) return undefined;
  let length = 0;
  for (let i = 0; i < count; i++) length = (length << 8) | (buf[offset + 1 + i] as number);
  return { length, next: offset + 1 + count };
}

function decodeOid(buf: Buffer): string {
  const head = buf[0] ?? 0;
  const parts = [Math.floor(head / 40), head % 40];
  let value = 0;
  for (const byte of buf.subarray(1)) {
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function decodeValue(tag: number, body: Buffer): number | string | null {
  // INTEGER, Counter32, Gauge32, TimeTicks
  if (tag === 0x02 || tag === 0x41 || tag === 0x42 || tag === 0x43) {
    let value = 0;
    for (const byte of body) value = value * 256 + byte;
    return value;
  }
  // OCTET STRING — kept as latin1 so byte-oriented values (error bitmasks)
  // survive intact.
  if (tag === 0x04) return body.toString('latin1');
  return null;
}

/** Extract varbinds from a response, tolerating anything malformed. */
function parseResponse(buf: Buffer): Varbind[] {
  const results: Varbind[] = [];

  const visit = (start: number, end: number, depth: number): void => {
    if (depth > 6) return;
    let offset = start;
    while (offset < end && offset < buf.length) {
      const tag = buf[offset] as number;
      const header = readLength(buf, offset + 1);
      if (!header) return;
      const bodyEnd = Math.min(header.next + header.length, buf.length);
      const body = buf.subarray(header.next, bodyEnd);

      if (tag === 0x30 && body[0] === 0x06) {
        // varbind: SEQUENCE { OID, value }
        const oidHeader = readLength(body, 1);
        if (oidHeader) {
          const oid = decodeOid(body.subarray(oidHeader.next, oidHeader.next + oidHeader.length));
          const valueOffset = oidHeader.next + oidHeader.length;
          const valueTag = body[valueOffset];
          const valueHeader = readLength(body, valueOffset + 1);
          if (valueTag !== undefined && valueHeader) {
            const valueBody = body.subarray(
              valueHeader.next,
              Math.min(valueHeader.next + valueHeader.length, body.length),
            );
            results.push({ oid, value: decodeValue(valueTag, valueBody), tag: valueTag });
          }
        }
      } else if (tag === 0x30 || tag === 0xa0 || tag === 0xa1 || tag === 0xa2) {
        visit(header.next, bodyEnd, depth + 1);
      }

      offset = bodyEnd;
    }
  };

  const outer = readLength(buf, 1);
  if (!outer) return results;
  visit(outer.next, Math.min(outer.next + outer.length, buf.length), 0);
  return results;
}

// ── public API ────────────────────────────────────────────────────────

/**
 * Issue an SNMPv1 GET. Resolves to null on timeout, socket error, or an
 * unparseable reply — never rejects.
 *
 * `host` may be an IPv4 address, a hostname, or an IPv6 link-local address
 * with a scope id (`fe80::1%6`), which is what WSD-attached printers expose.
 */
export function snmpGet(
  host: string,
  oids: string[],
  options: SnmpOptions = {},
): Promise<Varbind[] | null> {
  const { community = 'public', timeoutMs = 2000, port = 161 } = options;

  return new Promise((resolve) => {
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: Varbind[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    // Do not hold the process open just for a status probe.
    if (typeof timer.unref === 'function') timer.unref();

    socket.on('message', (msg) => {
      try {
        finish(parseResponse(msg));
      } catch {
        finish(null);
      }
    });
    socket.on('error', () => finish(null));

    try {
      const requestId = Math.floor(Math.random() * 0x7ffe) + 1;
      socket.send(buildGetRequest(community, oids, requestId), port, host, (err) => {
        if (err) finish(null);
      });
    } catch {
      finish(null);
    }
  });
}
