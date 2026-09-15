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

const DEFAULT_IPP_PATH = '/ipp/print';
const GET_JOBS_OPERATION = 0x000a;
let requestId = 1;

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
  const body = encodeGetJobs(endpoint.uri, requestId++, whichJobs);
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

function postIpp(
  endpoint: IppEndpoint,
  body: Buffer,
  timeoutMs: number,
): Promise<{ httpStatus: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const transport = endpoint.transport === 'https:' ? https : http;
    const request = transport.request({
      protocol: endpoint.transport,
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: endpoint.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/ipp',
        'Content-Length': body.length,
      },
      // Embedded printers normally use a self-signed certificate. The IPP
      // response is only corroborating read-only telemetry and never carries
      // credentials or print data, so certificate trust is intentionally not
      // made a deployment prerequisite.
      rejectUnauthorized: false,
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
      request.destroy(new Error(`IPP Get-Jobs timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
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
  chunks.push(encodeAttribute(0x47, 'attributes-charset', 'utf-8'));
  chunks.push(encodeAttribute(0x48, 'attributes-natural-language', 'en'));
  chunks.push(encodeAttribute(0x45, 'printer-uri', printerUri));
  chunks.push(encodeAttribute(0x44, 'which-jobs', whichJobs));
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
    chunks.push(encodeAttribute(0x44, index === 0 ? 'requested-attributes' : '', attribute));
  });
  chunks.push(Buffer.from([0x03])); // end-of-attributes-tag
  return Buffer.concat(chunks);
}

function encodeAttribute(tag: number, name: string, value: string): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  const valueBytes = Buffer.from(value, 'utf-8');
  const result = Buffer.alloc(5 + nameBytes.length + valueBytes.length);
  result[0] = tag;
  result.writeUInt16BE(nameBytes.length, 1);
  nameBytes.copy(result, 3);
  result.writeUInt16BE(valueBytes.length, 3 + nameBytes.length);
  valueBytes.copy(result, 5 + nameBytes.length);
  return result;
}

type DecodedAttribute = string | number | boolean | Buffer;

function decodeIppJobs(body: Buffer): { statusCode: number; jobs: IppRemoteJob[] } {
  if (body.length < 9) throw new Error('IPP response is shorter than its header');
  const statusCode = body.readUInt16BE(2);
  let offset = 8;
  let currentGroup: Map<string, DecodedAttribute[]> | undefined;
  let previousName = '';
  const jobGroups: Array<Map<string, DecodedAttribute[]>> = [];

  while (offset < body.length) {
    const tag = body[offset++]!;
    if (tag === 0x03) break;
    if (tag <= 0x0f) {
      previousName = '';
      currentGroup = new Map();
      if (tag === 0x02) jobGroups.push(currentGroup);
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
    if (!currentGroup || !name) continue;
    const values = currentGroup.get(name) ?? [];
    values.push(decodeAttributeValue(tag, rawValue));
    currentGroup.set(name, values);
  }

  return {
    statusCode,
    jobs: jobGroups.map(toRemoteJob).filter((job): job is IppRemoteJob => job !== undefined),
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

function toRemoteJob(group: Map<string, DecodedAttribute[]>): IppRemoteJob | undefined {
  const id = firstNumber(group, 'job-id');
  const uri = firstString(group, 'job-uri');
  const uuid = firstString(group, 'job-uuid');
  const name = firstString(group, 'job-name');
  const key = uuid || uri || (id === undefined ? undefined : `job-id:${id}`);
  if (!key) return undefined;
  return {
    key,
    id,
    uri,
    uuid,
    name,
    state: firstNumber(group, 'job-state'),
    stateReasons: strings(group, 'job-state-reasons'),
    impressions: firstNumber(group, 'job-impressions'),
    impressionsCompleted: firstNumber(group, 'job-impressions-completed'),
    mediaSheetsCompleted: firstNumber(group, 'job-media-sheets-completed'),
  };
}

function firstNumber(group: Map<string, DecodedAttribute[]>, name: string): number | undefined {
  return group.get(name)?.find((value): value is number => typeof value === 'number');
}

function firstString(group: Map<string, DecodedAttribute[]>, name: string): string | undefined {
  return group.get(name)?.find((value): value is string => typeof value === 'string');
}

function strings(group: Map<string, DecodedAttribute[]>, name: string): string[] {
  return (group.get(name) ?? []).filter((value): value is string => typeof value === 'string');
}
