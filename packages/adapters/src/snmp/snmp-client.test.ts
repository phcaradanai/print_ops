import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { snmpGet } from './snmp-client.js';

const OID = '1.3.6.1.2.1.43.10.2.1.4.1.1';
let agent: dgram.Socket | undefined;

afterEach(() => {
  agent?.close();
});

// Fake agent that drops the first `drop` requests and echoes the rest back
// (an echoed GetRequest parses as a varbind list with NULL values).
async function startAgent(drop: number): Promise<{ port: number; seen: () => number }> {
  let seen = 0;
  agent = dgram.createSocket('udp4');
  agent.on('message', (msg, rinfo) => {
    seen++;
    if (seen > drop) agent!.send(msg, rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve) => agent!.bind(0, '127.0.0.1', resolve));
  return { port: (agent.address() as AddressInfo).port, seen: () => seen };
}

describe('snmpGet', () => {
  it('re-sends after a lost reply instead of reporting the device silent', async () => {
    const { port, seen } = await startAgent(1);
    const result = await snmpGet('127.0.0.1', [OID], { port, timeoutMs: 100 });
    expect(result?.[0]?.oid).toBe(OID);
    expect(seen()).toBe(2);
  });

  it('gives up after the configured retries', async () => {
    const { port, seen } = await startAgent(99);
    expect(await snmpGet('127.0.0.1', [OID], { port, timeoutMs: 50, retries: 1 })).toBeNull();
    expect(seen()).toBe(2);
  });
});
