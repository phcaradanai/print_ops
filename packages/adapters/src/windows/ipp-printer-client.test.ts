import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIppEndpointCandidates,
  parseIppEndpoint,
  queryIppJobs,
} from './ipp-printer-client.js';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('IPP printer job client', () => {
  it('preserves a scoped IPv6 host for the socket and percent-encodes it in printer-uri', () => {
    const [endpoint] = buildIppEndpointCandidates('fe80::5257:9cff:fe49:f1bc%6');

    expect(endpoint).toMatchObject({
      hostname: 'fe80::5257:9cff:fe49:f1bc%6',
      transport: 'https:',
      port: 631,
      path: '/ipp/print',
      uri: 'ipps://[fe80::5257:9cff:fe49:f1bc%256]:631/ipp/print',
    });
    expect(parseIppEndpoint(endpoint!.uri)).toEqual(endpoint);
  });

  it('decodes Epson nameWithLanguage and job-specific completion attributes', async () => {
    let requestBody = Buffer.alloc(0);
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requestBody = Buffer.concat(chunks);
        response.writeHead(200, { 'Content-Type': 'application/ipp' });
        response.end(ippCompletedJobResponse());
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port');
    const endpoint = parseIppEndpoint(`ipp://127.0.0.1:${address.port}/ipp/print`)!;

    const result = await queryIppJobs(endpoint);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(requestBody.readUInt16BE(2)).toBe(0x000a);
    expect(requestBody.includes(Buffer.from('which-jobs'))).toBe(true);
    expect(requestBody.includes(Buffer.from('completed'))).toBe(true);
    expect(result.jobs).toEqual([{
      key: 'ipps://printer.local/ipp/print/job-12',
      id: 12,
      uri: 'ipps://printer.local/ipp/print/job-12',
      uuid: undefined,
      name: 'PrintOps_live-verified-1784723966144',
      state: 9,
      stateReasons: ['completed-successfully'],
      impressions: 1,
      impressionsCompleted: 1,
      mediaSheetsCompleted: 1,
    }]);
  });
});

function ippCompletedJobResponse(): Buffer {
  return Buffer.concat([
    Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
    Buffer.from([0x02]), // job-attributes-tag
    integerAttribute(0x21, 'job-id', 12),
    stringAttribute(0x45, 'job-uri', 'ipps://printer.local/ipp/print/job-12'),
    languageAttribute(0x36, 'job-name', 'en', 'PrintOps_live-verified-1784723966144'),
    integerAttribute(0x23, 'job-state', 9),
    stringAttribute(0x44, 'job-state-reasons', 'completed-successfully'),
    integerAttribute(0x21, 'job-impressions', 1),
    integerAttribute(0x21, 'job-impressions-completed', 1),
    integerAttribute(0x21, 'job-media-sheets-completed', 1),
    Buffer.from([0x03]),
  ]);
}

function stringAttribute(tag: number, name: string, value: string): Buffer {
  return rawAttribute(tag, name, Buffer.from(value, 'utf-8'));
}

function integerAttribute(tag: number, name: string, value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return rawAttribute(tag, name, bytes);
}

function languageAttribute(tag: number, name: string, language: string, value: string): Buffer {
  const languageBytes = Buffer.from(language, 'utf-8');
  const valueBytes = Buffer.from(value, 'utf-8');
  const bytes = Buffer.alloc(4 + languageBytes.length + valueBytes.length);
  bytes.writeUInt16BE(languageBytes.length, 0);
  languageBytes.copy(bytes, 2);
  bytes.writeUInt16BE(valueBytes.length, 2 + languageBytes.length);
  valueBytes.copy(bytes, 4 + languageBytes.length);
  return rawAttribute(tag, name, bytes);
}

function rawAttribute(tag: number, name: string, value: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  const result = Buffer.alloc(5 + nameBytes.length + value.length);
  result[0] = tag;
  result.writeUInt16BE(nameBytes.length, 1);
  nameBytes.copy(result, 3);
  result.writeUInt16BE(value.length, 3 + nameBytes.length);
  value.copy(result, 5 + nameBytes.length);
  return result;
}
