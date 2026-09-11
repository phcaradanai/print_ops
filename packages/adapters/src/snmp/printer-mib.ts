/**
 * Printer MIB (RFC 3805) + Host Resources MIB (RFC 2790) readings.
 *
 * These give device-level truth that the Windows spooler cannot: the spooler
 * reports a job as done when it finished handing bytes to the driver, which on
 * a real EPSON is ~15 seconds before the paper actually comes out.
 */
import { snmpGet, type SnmpOptions } from './snmp-client.js';

export const PRINTER_OID = {
  sysName: '1.3.6.1.2.1.1.5.0',
  /** 1=unknown 2=running 3=warning 4=testing 5=down */
  hrDeviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',
  /** 1=other 2=unknown 3=idle 4=printing 5=warmup */
  hrPrinterStatus: '1.3.6.1.2.1.25.3.5.1.1.1',
  /** Bit field, see PRINTER_ERROR_BITS */
  hrPrinterDetectedErrorState: '1.3.6.1.2.1.25.3.5.1.2.1',
  /** Lifetime page counter — increments once per printed page. */
  prtMarkerLifeCount: '1.3.6.1.2.1.43.10.2.1.4.1.1',
  /** Remaining supply level (-2 unknown, -3 "some left") */
  prtMarkerSuppliesLevel: '1.3.6.1.2.1.43.11.1.1.9.1.1',
} as const;

/** hrPrinterDetectedErrorState bit positions, most significant bit first. */
const PRINTER_ERROR_BITS = [
  'lowPaper',
  'noPaper',
  'lowToner',
  'noToner',
  'doorOpen',
  'jammed',
  'offline',
  'serviceRequested',
  'inputTrayMissing',
  'outputTrayMissing',
  'markerSupplyMissing',
  'outputNearFull',
  'outputFull',
  'inputTrayEmpty',
  'overduePreventMaint',
] as const;

/** Errors that mean the job will not print without human intervention. */
const BLOCKING_ERRORS = new Set([
  'noPaper',
  'noToner',
  'doorOpen',
  'jammed',
  'offline',
  'serviceRequested',
  'inputTrayMissing',
  'markerSupplyMissing',
  'outputFull',
  'inputTrayEmpty',
]);

export interface PrinterDeviceState {
  host: string;
  /** Lifetime page count, or undefined when the printer does not expose it. */
  pageCount?: number;
  deviceStatus?: number;
  printerStatus?: number;
  /** Decoded names of every raised error bit. */
  errors: string[];
  /** True when a raised error prevents printing. */
  blocked: boolean;
  supplyLevel?: number;
}

/** Decode the hrPrinterDetectedErrorState octet string into error names. */
export function decodeErrorState(value: number | string | null | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  const names: string[] = [];
  for (let byteIndex = 0; byteIndex < value.length; byteIndex++) {
    const byte = value.charCodeAt(byteIndex);
    for (let bit = 0; bit < 8; bit++) {
      if (!(byte & (0x80 >> bit))) continue;
      const name = PRINTER_ERROR_BITS[byteIndex * 8 + bit];
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Read the device state over SNMP. Returns undefined when the printer does not
 * answer — callers must treat that as "cannot verify", never as a failure.
 */
export async function readDeviceState(
  host: string,
  options: SnmpOptions = {},
): Promise<PrinterDeviceState | undefined> {
  const varbinds = await snmpGet(
    host,
    [
      PRINTER_OID.hrDeviceStatus,
      PRINTER_OID.hrPrinterStatus,
      PRINTER_OID.hrPrinterDetectedErrorState,
      PRINTER_OID.prtMarkerLifeCount,
      PRINTER_OID.prtMarkerSuppliesLevel,
    ],
    options,
  );
  if (!varbinds || varbinds.length === 0) return undefined;

  const valueOf = (oid: string): number | string | null | undefined =>
    varbinds.find((vb) => vb.oid === oid)?.value;

  const asNumber = (oid: string): number | undefined => {
    const value = valueOf(oid);
    return typeof value === 'number' ? value : undefined;
  };

  const errors = decodeErrorState(valueOf(PRINTER_OID.hrPrinterDetectedErrorState));

  return {
    host,
    pageCount: asNumber(PRINTER_OID.prtMarkerLifeCount),
    deviceStatus: asNumber(PRINTER_OID.hrDeviceStatus),
    printerStatus: asNumber(PRINTER_OID.hrPrinterStatus),
    errors,
    blocked: errors.some((name) => BLOCKING_ERRORS.has(name)),
    supplyLevel: asNumber(PRINTER_OID.prtMarkerSuppliesLevel),
  };
}

/** Read only the page counter — the cheap poll used while waiting for paper. */
export async function readPageCount(
  host: string,
  options: SnmpOptions = {},
): Promise<number | undefined> {
  const varbinds = await snmpGet(host, [PRINTER_OID.prtMarkerLifeCount], options);
  const value = varbinds?.find((vb) => vb.oid === PRINTER_OID.prtMarkerLifeCount)?.value;
  return typeof value === 'number' ? value : undefined;
}

/** Human-readable summary for trace output. */
export function describeDeviceState(state: PrinterDeviceState): string {
  const parts: string[] = [];
  if (state.pageCount !== undefined) parts.push(`pages=${state.pageCount}`);
  if (state.printerStatus !== undefined) parts.push(`printerStatus=${state.printerStatus}`);
  if (state.errors.length > 0) parts.push(`errors=${state.errors.join(',')}`);
  return parts.join(' ');
}
