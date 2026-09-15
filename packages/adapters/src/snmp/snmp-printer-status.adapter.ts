import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';
import { readDeviceState, describeDeviceState, PRINTER_OID } from './printer-mib.js';
import { snmpGet } from './snmp-client.js';

/**
 * SnmpPrinterStatusAdapter — device-level status over SNMP (RFC 3805).
 *
 * Status only: SNMP reports what the hardware is doing (out of paper, jammed,
 * cover open, pages printed) but is not a print transport. Printing goes
 * through the spooler or raw-TCP adapters, which use the same MIB reader to
 * confirm that paper actually came out.
 *
 * `connectionUri` forms accepted:
 *   snmp://<host>            — community defaults to "public"
 *   snmp://<community>@<host>
 *   <host>                   — bare address, IPv4/IPv6/hostname
 */
export class SnmpPrinterStatusAdapter implements PrinterAdapterPort {
  readonly protocol = 'snmp';
  readonly adapterName = 'SnmpPrinterStatusAdapter';

  /** Parse `snmp://community@host` / `snmp://host` / `host`. */
  private parseTarget(uri: string): { host: string; community: string } | undefined {
    if (!uri) return undefined;
    const withoutScheme = uri.replace(/^snmp:\/\//i, '');
    if (!withoutScheme) return undefined;
    const at = withoutScheme.lastIndexOf('@');
    if (at > 0) {
      const host = withoutScheme.slice(at + 1);
      return host ? { host, community: withoutScheme.slice(0, at) } : undefined;
    }
    return { host: withoutScheme, community: 'public' };
  }

  /** Map a device reading onto the domain status codes. */
  private toStatusCode(state: {
    blocked: boolean;
    errors: string[];
    printerStatus?: number;
  }): PrinterStatus['code'] {
    if (state.blocked) return state.errors.includes('offline') ? 'offline' : 'error';
    if (state.printerStatus === 4) return 'busy';
    if (state.printerStatus === 3) return 'idle';
    return 'unknown';
  }

  async detect(uri: string): Promise<boolean> {
    const target = this.parseTarget(uri);
    if (!target) return false;
    const varbinds = await snmpGet(target.host, [PRINTER_OID.sysName], {
      community: target.community,
    });
    return Boolean(varbinds && varbinds.length > 0);
  }

  async getStatus(uri: string): Promise<PrinterStatus> {
    const target = this.parseTarget(uri);
    if (!target) {
      return {
        printerId: 'unknown',
        code: 'unknown',
        message: `Cannot parse SNMP target from "${uri}"`,
        checkedAt: new Date(),
      };
    }

    const state = await readDeviceState(target.host, { community: target.community });
    if (!state) {
      return {
        printerId: target.host,
        code: 'unknown',
        message: 'Printer did not answer SNMP',
        checkedAt: new Date(),
      };
    }

    return {
      printerId: target.host,
      code: this.toStatusCode(state),
      message:
        state.errors.length > 0
          ? `${state.errors.join(', ')} (${describeDeviceState(state)})`
          : describeDeviceState(state),
      checkedAt: new Date(),
    };
  }

  async getCapabilities(_uri: string): Promise<PrinterCapability> {
    // The MIB exposes capability tables, but nothing consumes them yet — report
    // conservative defaults rather than inventing values.
    return {
      colorSupported: true,
      duplexSupported: false,
      maxPageWidth: 210,
      maxPageHeight: 297,
      supportedMediaTypes: [],
      supportedResolutions: [],
      maxCopies: 1,
    };
  }

  async executeCommand(_cmd: PrintCommand): Promise<PrinterAdapterResult> {
    return {
      success: false,
      errorCode: 'NOT_A_PRINT_TRANSPORT',
      message: 'SnmpPrinterStatusAdapter reports status only — print via spooler or raw-TCP',
    };
  }

  async printTestPage(_uri: string, _id: string): Promise<PrinterAdapterResult> {
    return {
      success: false,
      errorCode: 'NOT_A_PRINT_TRANSPORT',
      message: 'SnmpPrinterStatusAdapter cannot print',
    };
  }

  async listQueue(_uri: string): Promise<QueueEntry[]> {
    // prtJobEntry is optional in the MIB and absent on the tested devices.
    return [];
  }

  async cancelJob(_uri: string, _jobId: string): Promise<PrinterAdapterResult> {
    return {
      success: false,
      errorCode: 'NOT_SUPPORTED',
      message: 'SNMP cannot cancel print jobs',
    };
  }
}
