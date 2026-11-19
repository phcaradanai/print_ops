import { describe, it, expect } from 'vitest';
import {
  IPP_OPERATIONS,
  IPP_TAGS,
  decodeIppResponse,
  encodeIppAttribute,
  encodeIppRequest,
  requestedAttributeList,
  type IppRequestOptions,
  type IppTarget,
} from '../windows/ipp-printer-client.js';
import { CupsAdminClient, resolveCupsAdminTarget } from './cups-admin-client.js';
import { CupsPrinterAdapter } from './cups-printer.adapter.js';

/** Build an IPP response body the way CUPS or a device would return one. */
function ippResponse(
  statusCode: number,
  operationAttributes: Array<[number, string, string | number | boolean]> = [],
  groups: Array<{ tag: number; attributes: Array<[number, string, string | number | boolean]> }> = [],
): Buffer {
  const header = Buffer.alloc(9);
  header[0] = 0x02;
  header[1] = 0x00;
  header.writeUInt16BE(statusCode, 2);
  header.writeUInt32BE(1, 4);
  header[8] = 0x01;
  const chunks: Buffer[] = [header];
  for (const [tag, name, value] of operationAttributes) chunks.push(encodeIppAttribute(tag, name, value));
  for (const group of groups) {
    chunks.push(Buffer.from([group.tag]));
    for (const [tag, name, value] of group.attributes) chunks.push(encodeIppAttribute(tag, name, value));
  }
  chunks.push(Buffer.from([0x03]));
  return Buffer.concat(chunks);
}

const tcp = resolveCupsAdminTarget('cups:631');

describe('CUPS admin transport resolution', () => {
  it('treats a socket path as the local scheduler and a host as TCP', () => {
    expect(resolveCupsAdminTarget('/run/cups/cups.sock')).toEqual({
      kind: 'socket',
      socketPath: '/run/cups/cups.sock',
    });
    expect(resolveCupsAdminTarget(undefined)).toEqual({ kind: 'socket', socketPath: '/run/cups/cups.sock' });
    expect(resolveCupsAdminTarget('cups:631')).toEqual({
      kind: 'tcp', hostname: 'cups', port: 631, secure: false,
    });
    expect(resolveCupsAdminTarget('https://cups.example')).toEqual({
      kind: 'tcp', hostname: 'cups.example', port: 631, secure: true,
    });
    expect(resolveCupsAdminTarget('10.0.0.5:8631')).toEqual({
      kind: 'tcp', hostname: '10.0.0.5', port: 8631, secure: false,
    });
  });
});

describe('CUPS queue management over IPP', () => {
  it('encodes repeated requested-attributes with an empty name, as RFC 8011 requires', () => {
    const attributes = requestedAttributeList(['printer-name', 'printer-state', 'printer-state-reasons']);
    expect(attributes.map((attribute) => attribute.name)).toEqual(['requested-attributes', '', '']);
    const request = encodeIppRequest(IPP_OPERATIONS.getPrinterAttributes, [
      { tag: IPP_TAGS.charset, name: 'attributes-charset', value: 'utf-8' },
      ...attributes,
    ]);
    const decoded = decodeIppResponse(request);
    expect(decoded.groups[0]!.attributes.get('requested-attributes')).toEqual([
      'printer-name',
      'printer-state',
      'printer-state-reasons',
    ]);
  });

  it('keeps asking until a newly created queue reports its state', async () => {
    const bodies = [
      ippResponse(0x0000, [], [{ tag: 0x04, attributes: [[IPP_TAGS.name, 'printer-name', 'FRESH']] }]),
      ippResponse(0x0000, [], [{
        tag: 0x04,
        attributes: [
          [IPP_TAGS.name, 'printer-name', 'FRESH'],
          [IPP_TAGS.enumeration, 'printer-state', 3],
          [IPP_TAGS.boolean, 'printer-is-accepting-jobs', true],
        ],
      }]),
    ];
    let call = 0;
    const client = new CupsAdminClient(tcp, async () => ({
      httpStatus: 200,
      body: bodies[Math.min(call++, bodies.length - 1)]!,
    }));
    const state = await client.queueAttributes('FRESH', { timeoutMs: 2_000 });
    expect(call).toBe(2);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.printer.state).toBe(3);
    expect(state.printer.acceptingJobs).toBe(true);
  });

  it('creates a driverless queue with CUPS-Add-Modify-Printer and Basic credentials', async () => {
    const calls: Array<{ target: IppTarget; path: string; options: IppRequestOptions | undefined }> = [];
    const client = new CupsAdminClient(tcp, async (target, path, _body, options) => {
      calls.push({ target, path, options });
      return { httpStatus: 200, body: ippResponse(0x0000) };
    });
    const result = await client.addPrinter(
      { name: 'EPSON_L6580', deviceUri: 'ipps://192.168.10.11:631/ipp/print', info: 'EPSON L6580' },
      { credentials: { user: 'print', password: 'print' } },
    );
    expect(result.ok).toBe(true);
    expect(calls[0]!.path).toBe('/admin/');
    expect(calls[0]!.target).toEqual({ kind: 'tcp', hostname: 'cups', port: 631, secure: false });
    expect(calls[0]!.options?.credentials).toEqual({ user: 'print', password: 'print' });
  });

  it('reports an authorization failure instead of a generic error', async () => {
    const client = new CupsAdminClient(tcp, async () => ({
      httpStatus: 401,
      body: ippResponse(0x0401, [[IPP_TAGS.text, 'status-message', 'Unauthorized']]),
    }));
    const result = await client.addPrinter({ name: 'Q1', deviceUri: 'ipps://10.0.0.9/ipp/print' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unauthorized).toBe(true);
    expect(result.message).toContain('administrator credentials');
  });

  it('distinguishes a missing queue when deleting', async () => {
    const client = new CupsAdminClient(tcp, async () => ({
      httpStatus: 200,
      body: ippResponse(0x0406, [[IPP_TAGS.text, 'status-message', 'Not found']]),
    }));
    const result = await client.deletePrinter('GONE');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.notFound).toBe(true);
  });

  it('reads a queue state so a missing filter is visible to the caller', async () => {
    const client = new CupsAdminClient(tcp, async () => ({
      httpStatus: 200,
      body: ippResponse(0x0000, [], [{
        tag: 0x04,
        attributes: [
          [IPP_TAGS.name, 'printer-name', 'EPSON_L6580'],
          [IPP_TAGS.name, 'printer-make-and-model', 'EPSON L6580 Series'],
          [IPP_TAGS.enumeration, 'printer-state', 3],
          [IPP_TAGS.keyword, 'printer-state-reasons', 'cups-missing-filter-warning'],
        ],
      }]),
    }));
    const state = await client.queueAttributes('EPSON_L6580');
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.printer.makeModel).toBe('EPSON L6580 Series');
    expect(state.printer.stateReasons).toContain('cups-missing-filter-warning');
  });
});

describe('CUPS device discovery without a configured queue', () => {
  function adapter(probe: (endpoint: { uri: string; transport: string }) => ReturnType<typeof Promise.resolve> | Promise<unknown>) {
    return new CupsPrinterAdapter({
      run: async () => 'scheduler is running',
      probePrinter: async (endpoint) => (await probe(endpoint)) as never,
    });
  }

  it('prefers the IPPS URI the printer advertises', async () => {
    const probed: string[] = [];
    const cups = adapter(async (endpoint) => {
      probed.push(`${endpoint.transport}//${endpoint.uri}`);
      return {
        ok: true,
        endpoint,
        statusCode: 0,
        printer: {
          makeModel: 'EPSON L6580 Series',
          info: 'EPSON L6580 Series',
          state: 3,
          acceptingJobs: true,
          stateReasons: [],
          uriSupported: ['ipps://192.168.10.11:631/ipp/print', 'ipp://192.168.10.11:631/ipp/print'],
          formats: ['image/urf', 'image/pwg-raster', 'application/octet-stream'],
        },
      };
    });
    const result = await cups.probeHost('192.168.10.11');
    expect(probed).toHaveLength(1);
    expect(result.device?.uri).toBe('ipps://192.168.10.11:631/ipp/print');
    expect(result.device?.secure).toBe(true);
    expect(result.device?.driverless).toBe(true);
    expect(result.device?.makeModel).toBe('EPSON L6580 Series');
  });

  it('falls back to plain IPP and keeps scanning other hosts after a failure', async () => {
    const cups = adapter(async (endpoint) => {
      if (endpoint.transport === 'https:') throw new Error('connection refused');
      if (!endpoint.uri.includes('10.0.0.7')) throw new Error('connection refused');
      return {
        ok: true,
        endpoint,
        statusCode: 0,
        printer: {
          makeModel: 'Label Printer', state: 3, acceptingJobs: true, stateReasons: [],
          uriSupported: ['ipp://10.0.0.7:631/ipp/print'], formats: ['application/vnd.zebra-zpl'],
        },
      };
    });
    const results = await cups.probeHosts(['10.0.0.2', '10.0.0.7'], { concurrency: 2 });
    expect(results.map((result) => result.host)).toEqual(['10.0.0.2', '10.0.0.7']);
    expect(results[0]!.device).toBeUndefined();
    expect(results[0]!.error).toBeDefined();
    expect(results[1]!.device?.uri).toBe('ipp://10.0.0.7:631/ipp/print');
    expect(results[1]!.device?.driverless).toBe(false);
  });

  it('creates the queue with the discovered device URI', async () => {
    const bodies: Buffer[] = [];
    const cups = new CupsPrinterAdapter({
      run: async () => 'scheduler is running',
      adminPost: async (_target, _path, body) => {
        bodies.push(body);
        return { httpStatus: 200, body: ippResponse(0x0000) };
      },
    });
    const result = await cups.addQueue(
      { name: 'EPSON_L6580', deviceUri: 'ipps://192.168.10.11:631/ipp/print', info: 'EPSON L6580 Series' },
      { user: 'print', password: 'print' },
    );
    expect(result.ok).toBe(true);
    const request = bodies[0]!.toString('utf-8');
    expect(request).toContain('printer-name');
    expect(request).toContain('EPSON_L6580');
    expect(request).toContain('ipps://192.168.10.11:631/ipp/print');
    expect(request).toContain('everywhere');
  });
});
