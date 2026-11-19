import type { AuditRepositoryPort, Printer, PrinterRepositoryPort } from '@printerops/domain';
import type { CupsDiscoveredDevice, CupsPrinterAdapter } from '@printerops/adapters';
import { AppError, ConflictError, generateTraceId, ValidationError } from '@printerops/shared';
import type { CupsAdminCredentials } from '../infra/cups-server-settings.js';
import type { CreatePrinterService } from './create-printer.service.js';

/**
 * PrintOps owns the station's CUPS spooler the way it owns the Windows spooler:
 * it finds the device on the network, creates the queue itself and records the
 * printer. No host-side `lpadmin` step is part of the supported flow.
 */
export const CUPS_QUEUE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/;
const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9a-fA-F:.]+\])$/;
const MAX_SCAN_HOSTS = 256;

/** CUPS reports a broken queue through printer-state-reasons, not an error. */
const READINESS_REASONS: Record<string, 'MISSING_FILTER' | 'INSECURE_FILTER' | 'STOPPED'> = {
  'cups-missing-filter-warning': 'MISSING_FILTER',
  'cups-insecure-filter-warning': 'INSECURE_FILTER',
  'cups-stopped': 'STOPPED',
  'paused': 'STOPPED',
};

export type CupsReadiness = {
  ready: boolean;
  reasons: string[];
  code?: 'MISSING_FILTER' | 'INSECURE_FILTER' | 'STOPPED';
};

export type CupsScanReport = {
  devices: CupsDiscoveredDevice[];
  failures: Array<{ host: string; error: string }>;
};

export type CupsQueueCreation = {
  queue: string;
  deviceUri: string;
  /** True when this call created the queue in CUPS. */
  created: boolean;
  /** True when this call registered the printer record in PrintOps. */
  registered: boolean;
  printer: Printer;
  device: CupsDiscoveredDevice;
  readiness: CupsReadiness;
};

export type CupsQueueInput = {
  queue?: string;
  host?: string;
  deviceUri?: string;
  info?: string;
  location?: string;
};

export class CupsProvisioningService {
  constructor(
    private readonly cups: CupsPrinterAdapter,
    private readonly printers: PrinterRepositoryPort,
    private readonly createPrinter: CreatePrinterService,
    private readonly audit: AuditRepositoryPort,
  ) {}

  /** Probe candidate hosts so a printer can be found before CUPS knows it. */
  async scan(hosts: string[]): Promise<CupsScanReport> {
    const cleaned = this.normalizeHosts(hosts);
    const results = await this.cups.probeHosts(cleaned);
    return {
      devices: results.flatMap((result) => (result.device ? [result.device] : [])),
      failures: results.flatMap((result) =>
        result.device || !result.error ? [] : [{ host: result.host, error: result.error }]),
    };
  }

  /**
   * Create the CUPS queue for a device and register it as a PrintOps printer.
   * Idempotent on both halves so a retry after a partial failure converges.
   */
  async createQueue(
    input: CupsQueueInput,
    actorId: string,
    credentials?: CupsAdminCredentials,
  ): Promise<CupsQueueCreation> {
    const device = await this.resolveDevice(input, credentials);
    const queue = this.normalizeQueueName(input.queue, device);
    const connectionUri = `cups://${queue}`;

    const existingQueues = await this.cups.listPrinters();
    let created = false;
    if (!existingQueues.includes(queue)) {
      const result = await this.cups.addQueue(
        {
          name: queue,
          deviceUri: device.uri,
          info: input.info ?? device.makeModel ?? device.info ?? queue,
          location: input.location,
          shared: true,
        },
        credentials,
      );
      if (!result.ok) {
        if (result.unauthorized) {
          throw new AppError(
            'CUPS_ADMIN_REQUIRED',
            `${result.message}. Provide the CUPS administrator account on the Printers page.`,
            403,
          );
        }
        throw new AppError('CUPS_QUEUE_CREATE_FAILED', result.message, 422);
      }
      created = true;
      // CUPS stops a new destination while it probes the device; clearing that
      // is what turns "queue exists" into "queue can print". Failures stay
      // inside the readiness report instead of aborting the whole call.
      await this.cups.resumeQueue(queue, credentials);
      await this.cups.acceptQueueJobs(queue, credentials);
    }

    const readiness = await this.readiness(queue, credentials);
    const { printer, registered } = await this.registerPrinter(
      queue,
      connectionUri,
      input.info ?? device.makeModel ?? device.info ?? queue,
      actorId,
      { deviceUri: device.uri, host: device.host, created },
    );

    await this.audit.create({
      traceId: generateTraceId(),
      action: 'printer.cups_queue_created',
      actorId,
      resourceType: 'printer',
      resourceId: printer.id,
      metadata: { queue, deviceUri: device.uri, created, registered, readiness },
    });

    return { queue, deviceUri: device.uri, created, registered, printer, device, readiness };
  }

  /** Register an existing CUPS queue; the legacy import path shares this. */
  async registerQueue(queueName: string, actorId: string): Promise<{ printer: Printer; registered: boolean }> {
    const queue = this.normalizeQueueName(queueName);
    const queues = await this.cups.listPrinters();
    if (!queues.includes(queue)) {
      throw new AppError('CUPS_QUEUE_NOT_FOUND', `CUPS has no queue named ${queue}`, 404);
    }
    const result = await this.registerPrinter(queue, `cups://${queue}`, queue, actorId, {});
    if (result.registered) {
      await this.audit.create({
        traceId: generateTraceId(),
        action: 'printer.cups_queue_registered',
        actorId,
        resourceType: 'printer',
        resourceId: result.printer.id,
        metadata: { queue },
      });
    }
    return result;
  }

  private async registerPrinter(
    queue: string,
    connectionUri: string,
    name: string,
    actorId: string,
    metadata: Record<string, unknown>,
  ): Promise<{ printer: Printer; registered: boolean }> {
    const existing = (await this.printers.findAll()).find(
      (printer) => printer.protocol === 'cups' && printer.connectionUri === connectionUri,
    );
    if (existing) return { printer: existing, registered: false };

    const code = `CUPS_${queue}`;
    try {
      const printer = await this.createPrinter.execute(
        { code, name, protocol: 'cups', connectionUri, metadata },
        actorId,
      );
      return { printer, registered: true };
    } catch (error) {
      const registered = await this.printers.findByCode(code);
      if (registered?.protocol === 'cups' && registered.connectionUri === connectionUri) {
        return { printer: registered, registered: false };
      }
      if (registered) throw new ConflictError(`Printer code ${code} is already in use`);
      throw error;
    }
  }

  private async readiness(queue: string, credentials?: CupsAdminCredentials): Promise<CupsReadiness> {
    const state = await this.cups.queueState(queue, credentials);
    if (!state.ok) return { ready: false, reasons: [], code: undefined };
    const reasons = state.printer.stateReasons.filter((reason) => reason !== 'none');
    const failing = state.printer.state === 5
      ? 'STOPPED' as const
      : reasons.map((reason) => READINESS_REASONS[reason]).find((code) => code !== undefined);
    return { ready: failing === undefined, reasons, code: failing };
  }

  private async resolveDevice(
    input: CupsQueueInput,
    credentials?: CupsAdminCredentials,
  ): Promise<CupsDiscoveredDevice> {
    if (input.host?.trim()) {
      const probe = await this.cups.probeHost(input.host.trim());
      if (!probe.device) {
        throw new AppError(
          'CUPS_DEVICE_NOT_FOUND',
          `No IPP printer answered at ${probe.host}: ${probe.error ?? 'no attributes returned'}`,
          422,
        );
      }
      return probe.device;
    }
    const rawUri = input.deviceUri?.trim();
    if (!rawUri) {
      throw new ValidationError('Enter the printer host or its device URI');
    }
    if (!/^(ipps?|socket|lpd|usb):\/\//i.test(rawUri)) {
      throw new ValidationError('Use an ipp://, ipps://, socket://, lpd:// or usb:// device URI');
    }
    const host = /^(?:ipps?):\/\/(?:\[([^\]]+)\]|([^/:]+))/i.exec(rawUri);
    return {
      host: host?.[1] ?? host?.[2] ?? rawUri,
      uri: rawUri,
      secure: /^ipps:/i.test(rawUri),
      formats: [],
      driverless: /^ipps?:\/\//i.test(rawUri),
    };
  }

  private normalizeHosts(hosts: string[]): string[] {
    if (!Array.isArray(hosts) || hosts.length === 0) {
      throw new ValidationError('Provide at least one host or IP address to search');
    }
    const unique = [...new Set(hosts.map((host) => String(host).trim()).filter(Boolean))];
    if (unique.length === 0) throw new ValidationError('Provide at least one host or IP address to search');
    if (unique.length > MAX_SCAN_HOSTS) {
      throw new ValidationError(`Search at most ${MAX_SCAN_HOSTS} addresses at once`);
    }
    for (const host of unique) {
      if (!HOST_PATTERN.test(host)) throw new ValidationError(`Invalid host or IP address: ${host}`);
    }
    return unique;
  }

  private normalizeQueueName(queue: string | undefined, device?: CupsDiscoveredDevice): string {
    if (queue !== undefined) {
      const trimmed = queue.trim();
      if (!CUPS_QUEUE_NAME.test(trimmed)) {
        throw new ValidationError('Queue names may use letters, digits, dot, dash and underscore');
      }
      return trimmed;
    }
    const basis = device?.host ?? 'printer';
    const derived = `PRINT_${basis.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
    return derived.slice(0, 127);
  }
}
