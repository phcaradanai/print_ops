import { isIP } from 'node:net';
import type {
  CreateLocationPrinterBindingInput,
  DiscoveredPrinterRepositoryPort,
  LocationPrinterBinding,
  LocationPrinterBindingRepositoryPort,
  Printer,
  PrinterRepositoryPort,
} from '@printerops/domain';
import { AppError, NotFoundError, ValidationError } from '@printerops/shared';

/** IP a registered printer is reached at: the network URI host
 *  (`tcp://10.0.0.5:9100`), else the Windows spooler TCP/IP port name. */
export function printerIp(printer: Printer): string | undefined {
  try {
    const host = new URL(printer.connectionUri).hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return host;
  } catch { /* not a URL */ }
  return discoveredIp(
    printer.metadata['discoveryAttributes'] as Record<string, unknown> | undefined,
    printer.metadata['portName'],
  );
}

/** IP of a discovered printer: the network-scan address, else a TCP/IP port name. */
function discoveredIp(attrs: Record<string, unknown> | undefined, port: unknown): string | undefined {
  if (typeof attrs?.['networkAddress'] === 'string' && isIP(attrs['networkAddress'])) return attrs['networkAddress'];
  if (typeof port === 'string') {
    const ip = port.replace(/^IP_/i, '').replace(/:\d+$/, '').replace(/_\d+$/, '');
    if (isIP(ip)) return ip;
  }
  return undefined;
}

/**
 * Location → printer binding. A caller sends `location_code` (e.g. `wardA`);
 * the job goes to the registered printer whose IP matches the location's
 * default binding (or its only/first binding when none is marked default).
 */
export class LocationPrinterService {
  constructor(
    private readonly bindings: LocationPrinterBindingRepositoryPort,
    private readonly printers: PrinterRepositoryPort,
    private readonly discovered?: DiscoveredPrinterRepositoryPort,
  ) {}

  /** Printers the system already knows that have an IP, for the binding picker:
   *  registered ones first (printerCode set = jobs can print there), then
   *  discovered-but-unregistered ones (printerCode null). One entry per IP. */
  async printerOptions(): Promise<Array<{ ip: string; name: string; model?: string; printerCode: string | null }>> {
    const seen = new Set<string>();
    const options: Array<{ ip: string; name: string; model?: string; printerCode: string | null }> = [];
    for (const p of await this.printers.findAll()) {
      const ip = printerIp(p);
      if (!p.isActive || !ip || seen.has(ip)) continue;
      seen.add(ip);
      const driver = p.metadata['driverName'];
      options.push({ ip, name: p.name, model: typeof driver === 'string' ? driver : undefined, printerCode: p.code });
    }
    for (const d of (await this.discovered?.findAll()) ?? []) {
      const ip = discoveredIp(d.attributes, d.portName);
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      options.push({ ip, name: d.localPrinterName, model: d.driverName, printerCode: null });
    }
    return options;
  }

  /**
   * Printer for a request that names a `printer_ip` and/or a `location_code`.
   * `printer_ip` wins when both are sent. Returns undefined when neither is.
   */
  async resolveTarget(target: { printerIp?: unknown; locationCode?: unknown }): Promise<{ printerCode: string; printerIp: string } | undefined> {
    const ip = typeof target.printerIp === 'string' ? target.printerIp.trim() : '';
    const code = typeof target.locationCode === 'string' ? target.locationCode.trim() : '';
    if (ip) {
      if (!isIP(ip)) throw new ValidationError('printer_ip must be a valid IP address');
      const printer = await this.findPrinterByIp(ip);
      if (!printer) {
        throw new AppError('PRINTER_IP_NOT_REGISTERED', `No active printer with IP ${ip} is registered.`, 422);
      }
      return { printerCode: printer.code, printerIp: ip };
    }
    if (!code) return undefined;
    return { printerCode: await this.printerCodeFor(code), printerIp: (await this.locationBinding(code)).printerIp };
  }

  private async locationBinding(code: string): Promise<LocationPrinterBinding> {
    const candidates = await this.bindings.findAll({ locationCode: code });
    const chosen = candidates.find((b) => b.isDefault) ?? candidates[0];
    if (!chosen) throw new NotFoundError('location', code);
    return chosen;
  }

  async printerCodeFor(locationCode: string): Promise<string> {
    const code = locationCode.trim();
    const chosen = await this.locationBinding(code);
    const printer = await this.findPrinterByIp(chosen.printerIp);
    if (!printer) {
      throw new AppError(
        'LOCATION_PRINTER_NOT_REGISTERED',
        `Location '${code}' is bound to ${chosen.printerIp}, but no active printer with that IP is registered.`,
        422,
      );
    }
    return printer.code;
  }

  async findPrinterByIp(ip: string): Promise<Printer | undefined> {
    return (await this.printers.findAll()).find((p) => p.isActive && printerIp(p) === ip);
  }

  async create(input: Partial<CreateLocationPrinterBindingInput>): Promise<LocationPrinterBinding> {
    const clean = await this.validate(input);
    const siblings = await this.bindings.findAll({ locationCode: clean.locationCode });
    if (siblings.some((b) => b.printerIp === clean.printerIp)) {
      throw new AppError('CONFLICT', `${clean.printerIp} is already bound to '${clean.locationCode}'`, 409);
    }
    // The first printer of a location is its default; otherwise only on request.
    const isDefault = siblings.length === 0 || input.isDefault === true;
    if (isDefault) await this.clearDefault(clean.locationCode);
    return this.bindings.create({ ...clean, isDefault });
  }

  async update(id: string, patch: Partial<CreateLocationPrinterBindingInput>): Promise<LocationPrinterBinding> {
    const existing = await this.bindings.findById(id);
    if (!existing) throw new NotFoundError('location_binding', id);
    const clean = await this.validate({ ...existing, ...patch });
    const siblings = await this.bindings.findAll({ locationCode: clean.locationCode });
    if (siblings.some((b) => b.id !== id && b.printerIp === clean.printerIp)) {
      throw new AppError('CONFLICT', `${clean.printerIp} is already bound to '${clean.locationCode}'`, 409);
    }
    const isDefault = patch.isDefault ?? (existing.locationCode === clean.locationCode ? existing.isDefault : false);
    if (isDefault) await this.clearDefault(clean.locationCode, id);
    return this.bindings.update(id, { ...clean, isDefault });
  }

  async delete(id: string): Promise<void> {
    await this.bindings.delete(id);
  }

  private async clearDefault(locationCode: string, exceptId?: string): Promise<void> {
    for (const b of await this.bindings.findAll({ locationCode })) {
      if (b.isDefault && b.id !== exceptId) await this.bindings.update(b.id, { isDefault: false });
    }
  }

  private async validate(input: Partial<CreateLocationPrinterBindingInput>): Promise<Omit<CreateLocationPrinterBindingInput, 'isDefault'>> {
    const locationCode = typeof input.locationCode === 'string' ? input.locationCode.trim() : '';
    const ip = typeof input.printerIp === 'string' ? input.printerIp.trim() : '';
    if (!locationCode) throw new ValidationError('locationCode is required');
    if (!isIP(ip)) throw new ValidationError('printerIp must be a valid IP address');
    // Name/model default to what the registered printer at that IP reports.
    const printer = await this.findPrinterByIp(ip);
    const driver = printer?.metadata['driverName'];
    return {
      locationCode,
      printerIp: ip,
      printerName: input.printerName?.trim() || printer?.name,
      printerModel: input.printerModel?.trim() || (typeof driver === 'string' ? driver : undefined),
    };
  }
}
