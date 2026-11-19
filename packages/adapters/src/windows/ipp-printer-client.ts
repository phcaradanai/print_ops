import http from 'node:http';
import https from 'node:https';

/** A concrete IPP queue endpoint plus the HTTP transport needed to reach it. */
export type IppEndpoint = {
  /** URI placed in the IPP printer-uri operation attribute. */
  uri: string;
  /** Node has no `ipp:`/`ipps:` transport, so keep its HTTP equivalent here. */
  transport: 'http:' | 'https:';
  hostname: string;
  port: number;
  path: string;
};

/** Job attributes used to prove a particular document completed at the device. */
export type IppRemoteJob = {
  key: string;
  id?: number;
  uri?: string;
  uuid?: string;
  name?: string;
  state?: number;
  stateReasons: string[];
  impressions?: number;
  impressionsCompleted?: number;
  mediaSheetsCompleted?: number;
};

export type IppJobsQuery =
  | { ok: true; endpoint: IppEndpoint; jobs: IppRemoteJob[]; statusCode: number }
  | { ok: false; endpoint: IppEndpoint; jobs: []; error: string; statusCode?: number };

/** Value tags defined by RFC 8011 §4.5; only the ones this client sends. */
export const IPP_TAGS = {
  integer: 0x21,
  boolean: 0x22,
  enumeration: 0x23,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48,
} as const;

export const IPP_OPERATIONS = {
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
  resumePrinter: 0x0011,
  cupsAddModifyPrinter: 0x4003,
  cupsDeletePrinter: 0x4004,
  cupsAcceptJobs: 0x4008,
} as const;

export type IppAttributeValue = string | number | boolean;

export type IppAttribute = { tag: number; name: string; value: IppAttributeValue };

export type IppDecodedValue = IppAttributeValue | Buffer;
export type IppDecodedGroup = { tag: number; attributes: Map<string, IppDecodedValue[]> };

/** Where an IPP request is sent: a TCP endpoint or the local CUPS domain socket. */
export type IppTarget =
  | { kind: 'tcp'; hostname: string; port: number; secure?: boolean }
  | { kind: 'socket'; socketPath: string };

export type IppRequestOptions = {
  timeoutMs?: number;
  /** CUPS administrative operations authenticate with HTTP Basic credentials. */
  credentials?: { user: string; password: string };
  /** Replaces the TCP destination with the CUPS domain socket when supplied. */
  socketPath?: string;
  /** Error text used when the request exceeds timeoutMs. */
  timeoutError?: string;
};

const DEFAULT_IPP_PATH = '/ipp/print';
const GET_JOBS_OPERATION = IPP_OPERATIONS.getJobs;
const GET_PRINTER_ATTRIBUTES_OPERATION = IPP_OPERATIONS.getPrinterAttributes;
/**
 * CUPS rejects a negative request id with "Bad request ID". Draw ids from the
 * positive int32 range and keep them increasing instead of randomising.
 */
let lastRequestId = 0;

/**
 * Return conservative endpoint candidates for a printer host. IPPS is tried
 * first because Windows IPP devices commonly advertise a self-signed IPPS
 * endpoint on 631. `explicitUri` is the escape hatch for non-standard queues.
 */
export function buildIppEndpointCandidates(
  host: string | undefined,
  explicitUri?: string,
): IppEndpoint[] {
  if (explicitUri?.trim()) {
    const parsed = parseIppEndpoint(explicitUri.trim());
    return parsed ? [parsed] : [];
  }
  if (!host?.trim()) return [];
  const cleanHost = host.trim();
  const uriHost = cleanHost.includes(':')
    ? `[${cleanHost.replace(/%/g, '%25')}]`
    : cleanHost;
  return [
    parseIppEndpoint(`ipps://${uriHost}:631${DEFAULT_IPP_PATH}`),
    parseIppEndpoint(`ipp://${uriHost}:631${DEFAULT_IPP_PATH}`),
  ].filter((endpoint): endpoint is IppEndpoint => endpoint !== undefined);
}

/** Parse IPP(S), accepting scoped link-local IPv6 addresses such as `%256`. */
export function parseIppEndpoint(raw: string): IppEndpoint | undefined {
  const match = raw.match(/^(ipps?|https?):\/\/(?:\[([^\]]+)\]|([^/:]+))(?::(\d+))?(\/.*)?$/i);
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const hostname = (match[2] ?? match[3] ?? '').replace(/%25/gi, '%');
  if (!hostname) return undefined;
  const secure = scheme === 'ipps' || scheme === 'https';
  const port = Number(match[4] ?? (secure ? 631 : 631));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  const path = match[5] || DEFAULT_IPP_PATH;
  const ippScheme = secure ? 'ipps' : 'ipp';
  const uriHost = hostname.includes(':')
    ? `[${hostname.replace(/%/g, '%25')}]`
    : hostname;
  return {
    uri: `${ippScheme}://${uriHost}:${port}${path}`,
    transport: secure ? 'https:' : 'http:',
    hostname,
    port,
    path,
  };
}

/**
 * Query completed and active printer-side jobs. This is deliberately a tiny,
 * read-only IPP client: Windows still renders and submits the document, so the
 * selected driver retains full control of custom paper/tray/margin settings.
 */
export async function queryIppJobs(
  endpoint: IppEndpoint,
  timeoutMs = 4_000,
): Promise<IppJobsQuery> {
  // RFC 8011 defines `completed` and `not-completed`; `all` is a CUPS
  // extension and Epson correctly rejects it with client-error-attributes-or-
  // values-not-supported. Both standard sets are required for a safe baseline
  // so a same-name completed job from an earlier attempt cannot be reused.
  const active = await queryIppJobSet(endpoint, 'not-completed', timeoutMs);
  if (!active.ok) return active;
  const completed = await queryIppJobSet(endpoint, 'completed', timeoutMs);
  if (!completed.ok) return completed;
  const jobs = new Map<string, IppRemoteJob>();
  for (const job of [...active.jobs, ...completed.jobs]) jobs.set(job.key, job);
  return {
    ok: true,
    endpoint,
    jobs: [...jobs.values()],
    statusCode: completed.statusCode,
  };
}

async function queryIppJobSet(
  endpoint: IppEndpoint,
  whichJobs: 'completed' | 'not-completed',
  timeoutMs: number,
): Promise<IppJobsQuery> {
  const body = encodeGetJobs(endpoint.uri, nextRequestId(), whichJobs);
  try {
    const response = await postIpp(endpoint, body, timeoutMs);
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      return {
        ok: false,
        endpoint,
        jobs: [],
        error: `IPP endpoint returned HTTP ${response.httpStatus}`,
      };
    }
    const decoded = decodeIppJobs(response.body);
    if (decoded.statusCode >= 0x0400) {
      return {
        ok: false,
        endpoint,
        jobs: [],
        statusCode: decoded.statusCode,
        error:
          `IPP Get-Jobs (${whichJobs}) failed with status ` +
          `0x${decoded.statusCode.toString(16).padStart(4, '0')}`,
      };
    }
    return { ok: true, endpoint, jobs: decoded.jobs, statusCode: decoded.statusCode };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      jobs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Printer identity reported by a device or by a CUPS queue. */
export type IppPrinterAttributes = {
  makeModel?: string;
  info?: string;
  /** IPP `printer-state`: 3 idle, 4 processing, 5 stopped. */
  state?: number;
  acceptingJobs?: boolean;
  stateReasons: string[];
  /** Device-advertised URIs, most secure first; used as the CUPS device-uri. */
  uriSupported: string[];
  formats: string[];
  uuid?: string;
};

export type IppPrinterQuery =
  | { ok: true; endpoint: IppEndpoint; printer: IppPrinterAttributes; statusCode: number }
  | { ok: false; endpoint: IppEndpoint; error: string; statusCode?: number; httpStatus?: number };

/**
 * Read a printer's identity and capabilities with Get-Printer-Attributes.
 * This is what lets PrintOps find a printer that CUPS has never seen: the
 * answer comes from the device itself, not from a configured queue.
 */
export async function getPrinterAttributes(
  endpoint: IppEndpoint,
  options: IppRequestOptions = {},
): Promise<IppPrinterQuery> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const requested = [
    'printer-make-and-model',
    'printer-info',
    'printer-state',
    'printer-state-reasons',
    'printer-is-accepting-jobs',
    'printer-uri-supported',
    'document-format-supported',
    'printer-uuid',
  ];
  const body = encodeIppRequest(
    GET_PRINTER_ATTRIBUTES_OPERATION,
    [
      { tag: IPP_TAGS.charset, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.naturalLanguage, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.uri, name: 'printer-uri', value: endpoint.uri },
      { tag: IPP_TAGS.name, name: 'requesting-user-name', value: 'printops' },
      ...requestedAttributeList(requested),
    ],
  );
  try {
    const response = await ippPostRequest(
      { kind: 'tcp', hostname: endpoint.hostname, port: endpoint.port, secure: endpoint.transport === 'https:' },
      endpoint.path,
      body,
      {
        timeoutMs,
        credentials: options.credentials,
        socketPath: options.socketPath,
        timeoutError: `IPP Get-Printer-Attributes timed out after ${timeoutMs}ms`,
      },
    );
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      return {
        ok: false,
        endpoint,
        httpStatus: response.httpStatus,
        error: `IPP endpoint returned HTTP ${response.httpStatus}`,
      };
    }
    const decoded = decodeIppResponse(response.body);
    if (decoded.statusCode >= 0x0400) {
      return {
        ok: false,
        endpoint,
        statusCode: decoded.statusCode,
        error:
          `IPP Get-Printer-Attributes failed with status ` +
          `0x${decoded.statusCode.toString(16).padStart(4, '0')}` +
          (decoded.statusMessage ? `: ${decoded.statusMessage}` : ''),
      };
    }
    return {
      ok: true,
      endpoint,
      statusCode: decoded.statusCode,
      printer: readPrinterAttributes(response.body),
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nextRequestId(): number {
  lastRequestId = (lastRequestId + 1) % 0x7fff_ffff;
  return lastRequestId;
}

/** Read printer identity and capabilities out of a Get-Printer-Attributes body. */
export function readPrinterAttributes(body: Buffer): IppPrinterAttributes {
  const decoded = decodeIppResponse(body);
  const attributes = mergedAttributes(decoded.groups.filter((group) => group.tag !== 0x01));
  return {
    makeModel: firstString(attributes, 'printer-make-and-model'),
    info: firstString(attributes, 'printer-info'),
    state: firstNumber(attributes, 'printer-state'),
    acceptingJobs: firstBoolean(attributes, 'printer-is-accepting-jobs'),
    stateReasons: strings(attributes, 'printer-state-reasons'),
    uriSupported: strings(attributes, 'printer-uri-supported'),
    formats: strings(attributes, 'document-format-supported'),
    uuid: firstString(attributes, 'printer-uuid'),
  };
}

/**
 * Build a multi-valued `requested-attributes` list. RFC 8011 says only the
 * first value carries the attribute name; the rest repeat it with an empty
 * name. CUPS silently keeps just the first value when every repetition is
 * named, which reads as "the queue has no state" instead of an error.
 */
export function requestedAttributeList(names: string[]): IppAttribute[] {
  return names.map((name, index) => ({
    tag: IPP_TAGS.keyword,
    name: index === 0 ? 'requested-attributes' : '',
    value: name,
  }));
}

/** Encode one IPP attribute: value-tag, name-length, name, value-length, value. */
export function encodeIppAttribute(tag: number, name: string, value: IppAttributeValue): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  let valueBytes: Buffer;
  if (tag === IPP_TAGS.boolean) valueBytes = Buffer.from([value ? 1 : 0]);
  else if (tag === IPP_TAGS.integer || tag === IPP_TAGS.enumeration) {
    valueBytes = Buffer.alloc(4);
    valueBytes.writeInt32BE(Number(value), 0);
  } else {
    valueBytes = Buffer.from(String(value), 'utf-8');
  }
  const result = Buffer.alloc(5 + nameBytes.length + valueBytes.length);
  result[0] = tag;
  result.writeUInt16BE(nameBytes.length, 1);
  nameBytes.copy(result, 3);
  result.writeUInt16BE(valueBytes.length, 3 + nameBytes.length);
  valueBytes.copy(result, 5 + nameBytes.length);
  return result;
}

/** Encode a complete IPP 2.0 request: header, operation group, optional groups. */
export function encodeIppRequest(
  operation: number,
  operationAttributes: IppAttribute[],
  groups: Array<{ tag: number; attributes: IppAttribute[] }> = [],
): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(9);
  header[0] = 0x02;
  header[1] = 0x00;
  header.writeUInt16BE(operation, 2);
  header.writeUInt32BE(nextRequestId(), 4);
  header[8] = 0x01; // operation-attributes-tag
  chunks.push(header);
  for (const attribute of operationAttributes) {
    chunks.push(encodeIppAttribute(attribute.tag, attribute.name, attribute.value));
  }
  for (const group of groups) {
    chunks.push(Buffer.from([group.tag]));
    for (const attribute of group.attributes) {
      chunks.push(encodeIppAttribute(attribute.tag, attribute.name, attribute.value));
    }
  }
  chunks.push(Buffer.from([0x03])); // end-of-attributes-tag
  return Buffer.concat(chunks);
}

/** Decode any IPP response into its delimiter groups and attribute values. */
export function decodeIppResponse(body: Buffer): {
  statusCode: number;
  statusMessage?: string;
  groups: IppDecodedGroup[];
} {
  if (body.length < 9) throw new Error('IPP response is shorter than its header');
  const statusCode = body.readUInt16BE(2);
  let offset = 8;
  let previousName = '';
  let current: IppDecodedGroup | undefined;
  const groups: IppDecodedGroup[] = [];
  while (offset < body.length) {
    const tag = body[offset++]!;
    if (tag === 0x03) break;
    if (tag <= 0x0f) {
      previousName = '';
      current = { tag, attributes: new Map() };
      groups.push(current);
      continue;
    }
    if (offset + 2 > body.length) throw new Error('IPP response ended inside an attribute name');
    const nameLength = body.readUInt16BE(offset);
    offset += 2;
    if (offset + nameLength + 2 > body.length) throw new Error('IPP response contains a truncated attribute name');
    const suppliedName = body.toString('utf-8', offset, offset + nameLength);
    offset += nameLength;
    const name = suppliedName || previousName;
    if (suppliedName) previousName = suppliedName;
    const valueLength = body.readUInt16BE(offset);
    offset += 2;
    if (offset + valueLength > body.length) throw new Error('IPP response contains a truncated attribute value');
    const rawValue = body.subarray(offset, offset + valueLength);
    offset += valueLength;
    if (!current || !name) continue;
    const values = current.attributes.get(name) ?? [];
    values.push(decodeAttributeValue(tag, rawValue));
    current.attributes.set(name, values);
  }
  const statusMessage = firstString(mergedAttributes(groups), 'status-message');
  return { statusCode, statusMessage, groups };
}

/** Merge every group so callers can ask one map for a value or a status message. */
function mergedAttributes(groups: IppDecodedGroup[]): Map<string, IppDecodedValue[]> {
  const merged = new Map<string, IppDecodedValue[]>();
  for (const group of groups) {
    for (const [name, values] of group.attributes) {
      const current = merged.get(name) ?? [];
      current.push(...values);
      merged.set(name, current);
    }
  }
  return merged;
}

/**
 * POST one IPP body. Every request in this module funnels through here so the
 * timeout, CUPS domain-socket support and Basic credentials stay in one place.
 */
export function ippPostRequest(
  target: IppTarget,
  path: string,
  body: Buffer,
  options: IppRequestOptions = {},
): Promise<{ httpStatus: number; body: Buffer }> {
  const timeoutMs = options.timeoutMs ?? 4_000;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/ipp',
      'Content-Length': body.length,
    };
    if (options.credentials) {
      headers['Authorization'] =
        `Basic ${Buffer.from(`${options.credentials.user}:${options.credentials.password}`).toString('base64')}`;
    }
    const secure = target.kind === 'tcp' && target.secure === true;
    const transport = secure ? https : http;
    const request = transport.request({
      ...(target.kind === 'socket'
        ? { socketPath: target.socketPath }
        : { hostname: target.hostname, port: target.port }),
      ...(options.socketPath ? { socketPath: options.socketPath } : {}),
      path,
      method: 'POST',
      headers,
      // Embedded printers and LAN CUPS normally use a self-signed certificate.
      // An administrative request is always authenticated with Basic
      // credentials, which is what protects it, not the certificate chain; the
      // alternative would make certificate installation a deployment
      // prerequisite for a printer that cannot be validated usefully.
      ...(secure ? { rejectUnauthorized: false } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({ httpStatus: response.statusCode ?? 0, body: Buffer.concat(chunks) });
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(options.timeoutError ?? `IPP request timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function postIpp(
  endpoint: IppEndpoint,
  body: Buffer,
  timeoutMs: number,
): Promise<{ httpStatus: number; body: Buffer }> {
  return ippPostRequest(
    { kind: 'tcp', hostname: endpoint.hostname, port: endpoint.port, secure: endpoint.transport === 'https:' },
    endpoint.path,
    body,
    { timeoutMs, timeoutError: `IPP Get-Jobs timed out after ${timeoutMs}ms` },
  );
}

function encodeGetJobs(
  printerUri: string,
  id: number,
  whichJobs: 'completed' | 'not-completed',
): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(9);
  header[0] = 0x02;
  header[1] = 0x00;
  header.writeUInt16BE(GET_JOBS_OPERATION, 2);
  header.writeUInt32BE(id >>> 0, 4);
  header[8] = 0x01; // operation-attributes-tag
  chunks.push(header);
  chunks.push(encodeIppAttribute(0x47, 'attributes-charset', 'utf-8'));
  chunks.push(encodeIppAttribute(0x48, 'attributes-natural-language', 'en'));
  chunks.push(encodeIppAttribute(0x45, 'printer-uri', printerUri));
  chunks.push(encodeIppAttribute(0x44, 'which-jobs', whichJobs));
  const requested = [
    'job-id',
    'job-uri',
    'job-name',
    'job-state',
    'job-state-reasons',
    'job-impressions',
    'job-impressions-completed',
    'job-originating-user-name',
    'time-at-completed',
  ];
  requested.forEach((attribute, index) => {
    chunks.push(encodeIppAttribute(0x44, index === 0 ? 'requested-attributes' : '', attribute));
  });
  chunks.push(Buffer.from([0x03])); // end-of-attributes-tag
  return Buffer.concat(chunks);
}

function encodeAttribute(tag: number, name: string, value: string): Buffer {
  return encodeIppAttribute(tag, name, value);
}

type DecodedAttribute = IppDecodedValue;

function decodeIppJobs(body: Buffer): { statusCode: number; jobs: IppRemoteJob[] } {
  const decoded = decodeIppResponse(body);
  return {
    statusCode: decoded.statusCode,
    jobs: decoded.groups
      .filter((group) => group.tag === 0x02)
      .map(toRemoteJob)
      .filter((job): job is IppRemoteJob => job !== undefined),
  };
}

function decodeAttributeValue(tag: number, value: Buffer): DecodedAttribute {
  if ((tag === 0x21 || tag === 0x23) && value.length === 4) return value.readInt32BE(0);
  if (tag === 0x22 && value.length === 1) return value[0] !== 0;
  if (tag === 0x35 || tag === 0x36) {
    // textWithLanguage/nameWithLanguage: language-length, language,
    // text-length, text. Epson uses nameWithLanguage for job-name.
    if (value.length < 4) return Buffer.from(value);
    const languageLength = value.readUInt16BE(0);
    const textLengthOffset = 2 + languageLength;
    if (textLengthOffset + 2 > value.length) return Buffer.from(value);
    const textLength = value.readUInt16BE(textLengthOffset);
    const textOffset = textLengthOffset + 2;
    if (textOffset + textLength > value.length) return Buffer.from(value);
    return value.toString('utf-8', textOffset, textOffset + textLength);
  }
  // Text, name, keyword, URI and charset families are all UTF-8 strings for
  // the attributes requested above. Preserve unknown binary syntaxes safely.
  if (tag >= 0x41 && tag <= 0x4a) return value.toString('utf-8');
  return Buffer.from(value);
}

function toRemoteJob(group: IppDecodedGroup): IppRemoteJob | undefined {
  const id = firstNumber(group.attributes, 'job-id');
  const uri = firstString(group.attributes, 'job-uri');
  const uuid = firstString(group.attributes, 'job-uuid');
  const name = firstString(group.attributes, 'job-name');
  const key = uuid || uri || (id === undefined ? undefined : `job-id:${id}`);
  if (!key) return undefined;
  return {
    key,
    id,
    uri,
    uuid,
    name,
    state: firstNumber(group.attributes, 'job-state'),
    stateReasons: strings(group.attributes, 'job-state-reasons'),
    impressions: firstNumber(group.attributes, 'job-impressions'),
    impressionsCompleted: firstNumber(group.attributes, 'job-impressions-completed'),
    mediaSheetsCompleted: firstNumber(group.attributes, 'job-media-sheets-completed'),
  };
}

function firstNumber(attributes: Map<string, IppDecodedValue[]>, name: string): number | undefined {
  return attributes.get(name)?.find((value): value is number => typeof value === 'number');
}

function firstString(attributes: Map<string, IppDecodedValue[]>, name: string): string | undefined {
  return attributes.get(name)?.find((value): value is string => typeof value === 'string');
}

function firstBoolean(attributes: Map<string, IppDecodedValue[]>, name: string): boolean | undefined {
  return attributes.get(name)?.find((value): value is boolean => typeof value === 'boolean');
}

function strings(attributes: Map<string, IppDecodedValue[]>, name: string): string[] {
  return (attributes.get(name) ?? []).filter((value): value is string => typeof value === 'string');
}
