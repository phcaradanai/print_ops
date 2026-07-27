/**
 * Outbound callback URL safety (SSRF).
 *
 * PrintOps is a LAN-oriented print gateway, and callback URLs are frequently
 * caller-supplied (`$.field` destinations resolve out of the intake payload).
 * That is a classic SSRF primitive: whoever can send a print request can make
 * the API issue an HTTP POST to an address of their choosing.
 *
 * The usual mitigation — "block every RFC1918 address" — is wrong here. A
 * hospital deployment's legitimate callback receiver IS on 10.x/192.168.x.
 * So the policy is:
 *
 *   - always reject what is never legitimate (non-http(s) schemes, embedded
 *     credentials, malformed hosts, cloud metadata, loopback-of-another-proto,
 *     unspecified/multicast/broadcast destinations);
 *   - allow private ranges BY DEFAULT, because that is the product;
 *   - let an operator tighten it to an explicit allowlist when the gateway sits
 *     somewhere less trusted.
 *
 * Configuration (project style: PRINTOPS_-prefixed env vars read at call time):
 *
 *   WEBHOOK_ALLOWED_HOSTS   comma-separated hostnames/IPs; supports a leading
 *                           "*." wildcard. When set, ONLY these are allowed.
 *   WEBHOOK_ALLOWED_CIDRS   comma-separated IPv4 CIDRs. When set, a literal-IP
 *                           target must fall inside one of them.
 *   WEBHOOK_BLOCK_METADATA  "false" to allow cloud metadata addresses.
 *                           Defaults to true (blocked).
 *
 * DNS rebinding: a hostname that resolves to a blocked address is caught by
 * `assertResolvedAddressAllowed`, which the sender calls with the address it is
 * about to connect to. Full TOCTOU-proof pinning would need a custom
 * agent/socket hook; this narrows the window without breaking Node's fetch.
 */

import { isIP } from 'node:net';

export class CallbackUrlRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CallbackUrlRejected';
  }
}

export interface CallbackUrlPolicy {
  allowedHosts: string[];
  allowedCidrs: string[];
  blockMetadata: boolean;
}

export function callbackUrlPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): CallbackUrlPolicy {
  const list = (raw: string | undefined): string[] =>
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  return {
    allowedHosts: list(env['WEBHOOK_ALLOWED_HOSTS']),
    allowedCidrs: list(env['WEBHOOK_ALLOWED_CIDRS']),
    // Default-deny for metadata: an IMDS credential leak is not recoverable,
    // and no legitimate print-result receiver lives at 169.254.169.254.
    blockMetadata: (env['WEBHOOK_BLOCK_METADATA'] ?? 'true').toLowerCase() !== 'false',
  };
}

/** Cloud instance-metadata endpoints. Reaching one of these from a
 *  caller-controlled URL is credential theft, never a callback. */
const METADATA_ADDRESSES = new Set([
  '169.254.169.254', // AWS / Azure / DigitalOcean / OpenStack
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba Cloud
  'fd00:ec2::254', // AWS IMDS over IPv6
]);

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

/**
 * Structural validation of a callback URL. Runs at accept time (so a bad
 * destination is rejected before a job is even created) and again before each
 * delivery attempt.
 */
export function assertCallbackUrlAllowed(
  rawUrl: string,
  policy: CallbackUrlPolicy = callbackUrlPolicyFromEnv(),
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CallbackUrlRejected('CALLBACK_URL_MALFORMED', `callback URL is not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CallbackUrlRejected(
      'CALLBACK_URL_SCHEME_BLOCKED',
      `callback URL scheme '${url.protocol}' is not allowed (only http and https)`,
    );
  }

  // file:// and gopher:// are gone by now, but `http://user:pass@host` is still
  // a way to smuggle credentials into a log or an upstream proxy.
  if (url.username || url.password) {
    throw new CallbackUrlRejected(
      'CALLBACK_URL_HAS_CREDENTIALS',
      'callback URL must not embed credentials',
    );
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    throw new CallbackUrlRejected('CALLBACK_URL_MALFORMED', 'callback URL has no host');
  }

  if (policy.blockMetadata && METADATA_HOSTNAMES.has(host)) {
    throw new CallbackUrlRejected(
      'CALLBACK_URL_METADATA_BLOCKED',
      `callback URL host '${host}' is a cloud metadata endpoint`,
    );
  }

  if (policy.allowedHosts.length > 0 && !hostMatchesAllowlist(host, policy.allowedHosts)) {
    throw new CallbackUrlRejected(
      'CALLBACK_URL_HOST_NOT_ALLOWED',
      `callback URL host '${host}' is not in WEBHOOK_ALLOWED_HOSTS`,
    );
  }

  // A literal IP can be checked right now; a hostname is checked again after
  // resolution by assertResolvedAddressAllowed.
  if (isIP(host) !== 0) assertResolvedAddressAllowed(host, policy);

  return url;
}

/**
 * Address-level check, applied to the address the request will actually connect
 * to. Separate from the URL check so a hostname that resolves to a forbidden
 * address (DNS rebinding) is still caught.
 */
export function assertResolvedAddressAllowed(
  address: string,
  policy: CallbackUrlPolicy = callbackUrlPolicyFromEnv(),
): void {
  const addr = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (policy.blockMetadata && METADATA_ADDRESSES.has(addr)) {
    throw new CallbackUrlRejected(
      'CALLBACK_URL_METADATA_BLOCKED',
      `callback target ${addr} is a cloud metadata endpoint`,
    );
  }

  const version = isIP(addr);
  if (version === 4) {
    const octets = addr.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];

    // 0.0.0.0/8 — "this network". Connecting here means connecting to the local
    // host on most stacks, which is never a deliberate callback destination.
    if (a === 0) {
      throw new CallbackUrlRejected('CALLBACK_URL_UNSPECIFIED', `callback target ${addr} is unspecified`);
    }
    // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (which contains
    // 255.255.255.255 broadcast).
    if (a >= 224) {
      throw new CallbackUrlRejected(
        'CALLBACK_URL_MULTICAST',
        `callback target ${addr} is a multicast/reserved/broadcast address`,
      );
    }
    // 169.254.0.0/16 link-local. The metadata addresses live here, but so does
    // every APIPA address — none of them is a real receiver.
    if (a === 169 && b === 254) {
      throw new CallbackUrlRejected(
        'CALLBACK_URL_LINK_LOCAL',
        `callback target ${addr} is link-local`,
      );
    }
    // NOTE: 10/8, 172.16/12, 192.168/16 and 127/8 are deliberately ALLOWED.
    // This gateway's normal deployment is a LAN, and its callback receiver is
    // routinely on the same subnet or on localhost.
    if (policy.allowedCidrs.length > 0 && !ipv4InAnyCidr(addr, policy.allowedCidrs)) {
      throw new CallbackUrlRejected(
        'CALLBACK_URL_CIDR_NOT_ALLOWED',
        `callback target ${addr} is not inside WEBHOOK_ALLOWED_CIDRS`,
      );
    }
    return;
  }

  if (version === 6) {
    if (addr === '::' ) {
      throw new CallbackUrlRejected('CALLBACK_URL_UNSPECIFIED', `callback target ${addr} is unspecified`);
    }
    if (addr.startsWith('ff')) {
      throw new CallbackUrlRejected('CALLBACK_URL_MULTICAST', `callback target ${addr} is multicast`);
    }
    if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
      throw new CallbackUrlRejected('CALLBACK_URL_LINK_LOCAL', `callback target ${addr} is link-local`);
    }
    // An IPv4-mapped IPv6 address (::ffff:169.254.169.254) must not slip past
    // the IPv4 rules above.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped?.[1]) assertResolvedAddressAllowed(mapped[1], policy);
    return;
  }

  // Not an IP at all — a hostname reached this function, meaning resolution has
  // not happened yet. Nothing to assert here; the URL-level checks already ran.
}

function hostMatchesAllowlist(host: string, allowed: string[]): boolean {
  return allowed.some((entry) => {
    if (entry.startsWith('*.')) return host === entry.slice(2) || host.endsWith(entry.slice(1));
    return host === entry;
  });
}

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

export function ipv4InAnyCidr(ip: string, cidrs: string[]): boolean {
  const target = ipv4ToInt(ip);
  if (target === undefined) return false;
  return cidrs.some((cidr) => {
    const [base, bitsRaw] = cidr.split('/');
    if (!base) return false;
    const baseInt = ipv4ToInt(base);
    if (baseInt === undefined) return false;
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (target & mask) >>> 0 === (baseInt & mask) >>> 0;
  });
}
