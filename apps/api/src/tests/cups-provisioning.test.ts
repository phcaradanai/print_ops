import { beforeEach, describe, expect, it } from 'vitest';
import {
  IPP_TAGS,
  decodeIppResponse,
  encodeIppAttribute,
  type IppTarget,
} from '@printerops/adapters';
import { CupsPrinterAdapter } from '@printerops/adapters';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { CreatePrinterService } from '../services/create-printer.service.js';
import { CupsProvisioningService } from '../services/cups-provisioning.service.js';

function ippResponse(
  statusCode: number,
  operationAttributes: Array<[number, string, string | number | boolean]> = [],
  printerAttributes: Array<[number, string, string | number | boolean]> = [],
): Buffer {
  const header = Buffer.alloc(9);
  header[0] = 0x02;
  header[1] = 0x00;
  header.writeUInt16BE(statusCode, 2);
  header.writeUInt32BE(1, 4);
  header[8] = 0x01;
  const chunks: Buffer[] = [header];
  for (const [tag, name, value] of operationAttributes) chunks.push(encodeIppAttribute(tag, name, value));
  if (printerAttributes.length > 0) {
    chunks.push(Buffer.from([0x04]));
    for (const [tag, name, value] of printerAttributes) chunks.push(encodeIppAttribute(tag, name, value));
  }
  chunks.push(Buffer.from([0x03]));
  return Buffer.concat(chunks);
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness(options: {
  unauthorized?: boolean;
  stateReasons?: string[];
  probeFails?: boolean;
} = {}) {
  const queues = new Set<string>();
  const created: string[] = [];
  const adminPosts: Array<{ target: IppTarget; path: string; body: Buffer }> = [];
  const runs: Array<{ file: string; args: string[] }> = [];
  const adapter = new CupsPrinterAdapter({
    server: 'cups:631',
    credentials: { user: 'print', password: 'print' },
    run: async (file, args) => {
      runs.push({ file, args });
      if (args[0] === '-p' && args.length === 1) {
        return [...queues].map((queue) => `printer ${queue} is idle.  enabled since Thu 01 Jan 2026`).join('\n');
      }
      if (args[0] === '-v') {
        return [...queues].map((queue) => `device for ${queue}: ipps://192.168.10.11:631/ipp/print`).join('\n');
      }
      return 'scheduler is running';
    },
    probePrinter: async (endpoint) => {
      if (options.probeFails) throw new Error('connection refused');
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
    },
    adminPost: async (target, path, body) => {
      adminPosts.push({ target, path, body });
      if (options.unauthorized) {
        return { httpStatus: 401, body: ippResponse(0x0401, [[IPP_TAGS.text, 'status-message', 'Unauthorized']]) };
      }
      const operation = body.readUInt16BE(2);
      if (operation === 0x4003) {
        const decoded = decodeIppResponse(body);
        const name = decoded.groups[0]!.attributes.get('printer-name')?.[0];
        if (typeof name === 'string') {
          queues.add(name);
          created.push(name);
        }
        return { httpStatus: 200, body: ippResponse(0x0000) };
      }
      const reasons = options.stateReasons ?? ['none'];
      return {
        httpStatus: 200,
        body: ippResponse(0x0000, [], [
          [IPP_TAGS.name, 'printer-make-and-model', 'EPSON L6580 Series'],
          [IPP_TAGS.enumeration, 'printer-state', 3],
          [IPP_TAGS.keyword, 'printer-is-accepting-jobs', true],
          ...reasons.map((reason) => [IPP_TAGS.keyword, 'printer-state-reasons', reason] as [number, string, string]),
        ]),
      };
    },
  });

  const printers = new InMemoryPrinterRepository();
  const audit = new InMemoryAuditRepository();
  const createPrinter = new CreatePrinterService(printers, new InMemoryEventBus(), audit);
  const service = new CupsProvisioningService(adapter, printers, createPrinter, audit);
  return { adapter, service, printers, audit, queues, created, adminPosts, runs };
}

describe('CUPS provisioning', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('finds an IPP printer that CUPS has never seen', async () => {
    const report = await h.service.scan(['192.168.10.11', '192.168.10.12']);
    expect(report.devices).toHaveLength(2);
    expect(report.failures).toHaveLength(0);
    expect(report.devices[0]!.uri).toBe('ipps://192.168.10.11:631/ipp/print');
    expect(report.devices[0]!.driverless).toBe(true);
  });

  it('creates the queue in CUPS and registers the printer in one step', async () => {
    const result = await h.service.createQueue({ host: '192.168.10.11', queue: 'EPSON_L6580' }, 'operator-1');
    expect(result.created).toBe(true);
    expect(result.registered).toBe(true);
    expect(result.queue).toBe('EPSON_L6580');
    expect(result.deviceUri).toBe('ipps://192.168.10.11:631/ipp/print');
    expect(result.readiness).toEqual({ ready: true, reasons: [], code: undefined });
    expect(h.queues.has('EPSON_L6580')).toBe(true);
    // One CUPS-Add-Modify-Printer request, sent to the admin channel.
    expect(h.adminPosts.filter((post) => post.body.readUInt16BE(2) === 0x4003)).toHaveLength(1);
    expect(h.adminPosts[0]!.path).toBe('/admin/');

    const printer = (await h.printers.findAll()).find((candidate) => candidate.connectionUri === 'cups://EPSON_L6580');
    expect(printer?.protocol).toBe('cups');
    expect(printer?.code).toBe('CUPS_EPSON_L6580');
    const actions = (await h.audit.findAll({ limit: 50 })).map((entry) => entry.action);
    expect(actions).toContain('printer.cups_queue_created');
  });

  it('is idempotent: a second call neither recreates the queue nor re-registers', async () => {
    await h.service.createQueue({ host: '192.168.10.11', queue: 'EPSON_L6580' }, 'operator-1');
    const second = await h.service.createQueue({ host: '192.168.10.11', queue: 'EPSON_L6580' }, 'operator-1');
    expect(second.created).toBe(false);
    expect(second.registered).toBe(false);
    expect(h.created).toEqual(['EPSON_L6580']);
  });

  it('asks for CUPS administrator credentials instead of failing opaquely', async () => {
    const denied = await harness({ unauthorized: true });
    await expect(denied.service.createQueue({ host: '192.168.10.11', queue: 'EPSON_L6580' }, 'operator-1'))
      .rejects.toMatchObject({ code: 'CUPS_ADMIN_REQUIRED', statusCode: 403 });
    expect(await denied.printers.findAll()).toHaveLength(0);
  });

  it('reports a queue whose CUPS filters are missing', async () => {
    const warning = await harness({ stateReasons: ['cups-missing-filter-warning'] });
    const result = await warning.service.createQueue({ host: '192.168.10.11', queue: 'EPSON_L6580' }, 'operator-1');
    expect(result.readiness).toEqual({
      ready: false,
      reasons: ['cups-missing-filter-warning'],
      code: 'MISSING_FILTER',
    });
  });

  it('accepts an explicit device URI without probing the network', async () => {
    const result = await h.service.createQueue(
      { deviceUri: 'ipps://192.168.10.20/ipp/print', queue: 'REMOTE_LABEL' },
      'operator-1',
    );
    expect(result.created).toBe(true);
    expect(result.device.uri).toBe('ipps://192.168.10.20/ipp/print');
  });

  it('rejects an unknown device, empty search and invalid queue names', async () => {
    const failing = await harness({ probeFails: true });
    await expect(failing.service.createQueue({ host: '192.168.10.99' }, 'operator-1'))
      .rejects.toMatchObject({ code: 'CUPS_DEVICE_NOT_FOUND', statusCode: 422 });
    await expect(h.service.scan([])).rejects.toThrow();
    await expect(h.service.createQueue({ host: '192.168.10.11', queue: 'bad name' }, 'operator-1'))
      .rejects.toThrow();
    await expect(h.service.createQueue({ queue: 'NO_DEVICE' }, 'operator-1')).rejects.toThrow();
  });
});
