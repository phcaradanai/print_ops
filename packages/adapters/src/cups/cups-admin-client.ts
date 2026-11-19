import { setTimeout as delay } from 'node:timers/promises';
import {
  IPP_OPERATIONS,
  IPP_TAGS,
  decodeIppResponse,
  encodeIppRequest,
  ippPostRequest,
  readPrinterAttributes,
  requestedAttributeList,
  type IppAttribute,
  type IppPrinterAttributes,
  type IppRequestOptions,
  type IppTarget,
} from '../windows/ipp-printer-client.js';

/**
 * CUPS administrative access. A station's CUPS is its own spooler — the Linux
 * equivalent of the Windows spooler — so PrintOps manages it directly instead
 * of asking an operator to run `lpadmin` on the host. Every operation here is a
 * standard CUPS IPP request, sent either over the local domain socket or to a
 * TCP endpoint with HTTP Basic credentials.
 */
export type CupsAdminTarget =
  | { kind: 'socket'; socketPath: string }
  | { kind: 'tcp'; hostname: string; port: number; secure: boolean };

export type CupsCredentials = { user: string; password: string };

export type CupsAdminResult =
  | { ok: true; statusCode: number; transport: IppTarget }
  | {
      ok: false;
      transport: IppTarget;
      unauthorized: boolean;
      notFound: boolean;
      message: string;
      statusCode?: number;
      httpStatus?: number;
    };

const DEFAULT_SOCKET = '/run/cups/cups.sock';
const DEFAULT_CUPS_PORT = 631;

/**
 * Derive the admin transport from the configured `CUPS_SERVER`. A path means
 * the local scheduler socket (the app image default); anything else is a host
 * with an optional port, mirroring what `CUPS_SERVER` accepts for `lpstat`.
 */
export function resolveCupsAdminTarget(server: string | undefined): CupsAdminTarget {
  const value = server?.trim() ?? '';
  if (!value || value.startsWith('/')) {
    return { kind: 'socket', socketPath: value || DEFAULT_SOCKET };
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const parsed = new URL(withScheme);
  return {
    kind: 'tcp',
    hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number(parsed.port) : DEFAULT_CUPS_PORT,
    secure: parsed.protocol === 'https:',
  };
}

/** The transport handed to the IPP client. */
function targetOf(transport: CupsAdminTarget): IppTarget {
  return transport.kind === 'socket'
    ? { kind: 'socket', socketPath: transport.socketPath }
    : { kind: 'tcp', hostname: transport.hostname, port: transport.port, secure: transport.secure };
}

/** CUPS identifies a destination by its printer-uri, not by the socket path. */
function printerUri(transport: CupsAdminTarget, name: string): string {
  const host = transport.kind === 'socket' ? 'localhost' : hostnameForUri(transport.hostname);
  const port = transport.kind === 'socket' ? DEFAULT_CUPS_PORT : transport.port;
  return `ipp://${host}:${port}/printers/${encodeURIComponent(name)}`;
}

function hostnameForUri(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

function baseAttributes(
  transport: CupsAdminTarget,
  name: string,
  options: IppRequestOptions,
): IppAttribute[] {
  return [
    { tag: IPP_TAGS.charset, name: 'attributes-charset', value: 'utf-8' },
    { tag: IPP_TAGS.naturalLanguage, name: 'attributes-natural-language', value: 'en' },
    { tag: IPP_TAGS.uri, name: 'printer-uri', value: printerUri(transport, name) },
    { tag: IPP_TAGS.name, name: 'requesting-user-name', value: options.credentials?.user ?? 'printops' },
  ];
}

function unauthorizedStatus(httpStatus: number, statusCode: number | undefined): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  // client-error-forbidden / not-authenticated / not-authorized
  return statusCode === 0x0401 || statusCode === 0x0402 || statusCode === 0x0403;
}

function failure(
  transport: CupsAdminTarget,
  operation: string,
  httpStatus: number,
  statusCode: number | undefined,
  statusMessage: string | undefined,
): CupsAdminResult {
  const unauthorized = unauthorizedStatus(httpStatus, statusCode);
  const detail =
    statusMessage ??
    (statusCode === undefined
      ? `CUPS returned HTTP ${httpStatus}`
      : `CUPS rejected ${operation} with status 0x${statusCode.toString(16).padStart(4, '0')}`);
  const message = unauthorized
    ? `CUPS needs administrator credentials for ${operation} (${detail})`
    : detail;
  return {
    ok: false,
    transport: targetOf(transport),
    unauthorized,
    notFound: statusCode === 0x0406,
    message,
    statusCode,
    httpStatus,
  };
}

export class CupsAdminClient {
  constructor(
    private readonly transport: CupsAdminTarget,
    private readonly post: typeof ippPostRequest = ippPostRequest,
  ) {}

  get target(): CupsAdminTarget {
    return this.transport;
  }

  /**
   * Create (or update) a CUPS queue that points at a discovered device.
   * `ppd-name=everywhere` selects the driverless IPP Everywhere PPD, which is
   * the only driver PrintOps can choose without guessing a vendor PPD name.
   */
  async addPrinter(
    input: {
      name: string;
      deviceUri: string;
      info?: string;
      location?: string;
      shared?: boolean;
      ppdName?: string;
    },
    options: IppRequestOptions = {},
  ): Promise<CupsAdminResult> {
    const attributes: IppAttribute[] = [
      ...baseAttributes(this.transport, input.name, options),
      { tag: IPP_TAGS.name, name: 'printer-name', value: input.name },
      { tag: IPP_TAGS.uri, name: 'device-uri', value: input.deviceUri },
      { tag: IPP_TAGS.name, name: 'ppd-name', value: input.ppdName ?? 'everywhere' },
      { tag: IPP_TAGS.boolean, name: 'printer-is-shared', value: input.shared ?? true },
    ];
    if (input.info) attributes.push({ tag: IPP_TAGS.text, name: 'printer-info', value: input.info });
    if (input.location) attributes.push({ tag: IPP_TAGS.text, name: 'printer-location', value: input.location });
    return this.send(IPP_OPERATIONS.cupsAddModifyPrinter, 'CUPS-Add-Modify-Printer', '/admin/', attributes, options);
  }

  /** Remove a queue. Idempotent: a missing queue reports `notFound`. */
  async deletePrinter(name: string, options: IppRequestOptions = {}): Promise<CupsAdminResult> {
    return this.send(
      IPP_OPERATIONS.cupsDeletePrinter,
      'CUPS-Delete-Printer',
      '/admin/',
      baseAttributes(this.transport, name, options),
      options,
    );
  }

  /**
   * CUPS stops a freshly added queue when the device reports an alert (paper
   * out, cover open) during the initial probe. Resuming it and accepting jobs
   * is what makes a new queue usable instead of silently disabled.
   */
  async resumePrinter(name: string, options: IppRequestOptions = {}): Promise<CupsAdminResult> {
    return this.send(
      IPP_OPERATIONS.resumePrinter,
      'Resume-Printer',
      '/admin/',
      baseAttributes(this.transport, name, options),
      options,
    );
  }

  async acceptJobs(name: string, options: IppRequestOptions = {}): Promise<CupsAdminResult> {
    return this.send(
      IPP_OPERATIONS.cupsAcceptJobs,
      'CUPS-Accept-Jobs',
      '/admin/',
      baseAttributes(this.transport, name, options),
      options,
    );
  }

  /**
   * Read a queue's own state, which is how CUPS reports missing filters.
   * A destination that was just created answers before it finishes loading, so
   * keep asking for a short, bounded window instead of reporting a phantom
   * "no state" queue.
   */
  async queueAttributes(
    name: string,
    options: IppRequestOptions = {},
  ): Promise<{ ok: true; printer: IppPrinterAttributes } | { ok: false; message: string; unauthorized: boolean }> {
    const requested = [
      'printer-name',
      'printer-make-and-model',
      'printer-info',
      'printer-state',
      'printer-state-reasons',
      'printer-is-accepting-jobs',
      'document-format-supported',
    ];
    const body = encodeIppRequest(IPP_OPERATIONS.getPrinterAttributes, [
      ...baseAttributes(this.transport, name, options),
      ...requestedAttributeList(requested),
    ]);
    const deadline = Date.now() + (options.timeoutMs ?? 4_000);
    for (;;) {
      try {
        const response = await this.post(targetOf(this.transport), '/', body, {
          timeoutMs: Math.min(2_000, Math.max(500, deadline - Date.now())),
          credentials: options.credentials,
          timeoutError: 'Get-Printer-Attributes timed out',
        });
        const decoded = decodeIppResponse(response.body);
        if (response.httpStatus < 200 || response.httpStatus >= 300 || decoded.statusCode >= 0x0400) {
          return {
            ok: false,
            message:
              decoded.statusMessage ??
              `CUPS returned ${response.httpStatus} / 0x${decoded.statusCode.toString(16).padStart(4, '0')}`,
            unauthorized: unauthorizedStatus(response.httpStatus, decoded.statusCode),
          };
        }
        const printer = readPrinterAttributes(response.body);
        if (printer.state !== undefined || Date.now() >= deadline) return { ok: true, printer };
        await delay(250);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          unauthorized: false,
        };
      }
    }
  }

  private async send(
    operation: number,
    label: string,
    path: string,
    attributes: IppAttribute[],
    options: IppRequestOptions,
  ): Promise<CupsAdminResult> {
    const body = encodeIppRequest(operation, attributes);
    try {
      const response = await this.post(targetOf(this.transport), path, body, {
        timeoutMs: options.timeoutMs ?? 10_000,
        credentials: options.credentials,
        timeoutError: `${label} timed out`,
      });
      const decoded = decodeIppResponse(response.body);
      if (response.httpStatus >= 200 && response.httpStatus < 300 && decoded.statusCode < 0x0400) {
        return { ok: true, statusCode: decoded.statusCode, transport: targetOf(this.transport) };
      }
      return failure(
        this.transport,
        label,
        response.httpStatus,
        decoded.statusCode,
        decoded.statusMessage,
      );
    } catch (error) {
      return {
        ok: false,
        transport: targetOf(this.transport),
        unauthorized: false,
        notFound: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
