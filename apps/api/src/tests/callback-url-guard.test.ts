import { describe, it, expect } from 'vitest';
import {
  assertCallbackUrlAllowed,
  assertResolvedAddressAllowed,
  CallbackUrlRejected,
  ipv4InAnyCidr,
  callbackUrlPolicyFromEnv,
  type CallbackUrlPolicy,
} from '../infra/http/callback-url-guard.js';

const OPEN: CallbackUrlPolicy = { allowedHosts: [], allowedCidrs: [], blockMetadata: true };

function rejectionCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof CallbackUrlRejected) return err.code;
    return `UNEXPECTED:${String(err)}`;
  }
  return 'NO_REJECTION';
}

describe('callback URL SSRF guard', () => {
  describe('always rejected', () => {
    it.each([
      ['file:///etc/passwd', 'CALLBACK_URL_SCHEME_BLOCKED'],
      ['gopher://evil/x', 'CALLBACK_URL_SCHEME_BLOCKED'],
      ['ftp://host/x', 'CALLBACK_URL_SCHEME_BLOCKED'],
      ['http://user:pass@hook.example/cb', 'CALLBACK_URL_HAS_CREDENTIALS'],
      ['not a url at all', 'CALLBACK_URL_MALFORMED'],
      // Cloud metadata: an IMDS credential leak is unrecoverable, and no real
      // print-result receiver has ever lived at 169.254.169.254.
      ['http://169.254.169.254/latest/meta-data/', 'CALLBACK_URL_METADATA_BLOCKED'],
      ['http://metadata.google.internal/computeMetadata/v1/', 'CALLBACK_URL_METADATA_BLOCKED'],
      ['http://100.100.100.200/', 'CALLBACK_URL_METADATA_BLOCKED'],
      // link-local / unspecified / multicast / broadcast
      ['http://169.254.10.5/cb', 'CALLBACK_URL_LINK_LOCAL'],
      ['http://0.0.0.0/cb', 'CALLBACK_URL_UNSPECIFIED'],
      ['http://239.1.2.3/cb', 'CALLBACK_URL_MULTICAST'],
      ['http://255.255.255.255/cb', 'CALLBACK_URL_MULTICAST'],
    ])('rejects %s', (url, expected) => {
      expect(rejectionCode(() => assertCallbackUrlAllowed(url, OPEN))).toBe(expected);
    });
  });

  describe('local-network deployment stays possible', () => {
    // PrintOps is a LAN print gateway. Blanket-blocking RFC1918 — the usual
    // SSRF advice — would break the product's normal deployment.
    it.each([
      'http://192.168.1.50:8080/callbacks',
      'http://10.0.3.7/callbacks',
      'http://172.16.4.9/callbacks',
      'http://127.0.0.1:3005/callbacks',
      'https://receiver.hospital.local/print-results',
    ])('allows %s by default', (url) => {
      expect(() => assertCallbackUrlAllowed(url, OPEN)).not.toThrow();
    });
  });

  it('blocks an IPv4-mapped IPv6 metadata address', () => {
    expect(rejectionCode(() => assertResolvedAddressAllowed('::ffff:169.254.169.254', OPEN))).toBe(
      'CALLBACK_URL_METADATA_BLOCKED',
    );
  });

  it('allows metadata addresses when the operator explicitly opts out', () => {
    const permissive: CallbackUrlPolicy = { ...OPEN, blockMetadata: false };
    expect(() => assertResolvedAddressAllowed('169.254.169.254', permissive)).toThrow(
      // still link-local, which is a separate rule
      CallbackUrlRejected,
    );
  });

  describe('operator tightening', () => {
    it('enforces WEBHOOK_ALLOWED_HOSTS when set', () => {
      const policy: CallbackUrlPolicy = { ...OPEN, allowedHosts: ['receiver.example', '*.trusted.local'] };
      expect(() => assertCallbackUrlAllowed('https://receiver.example/cb', policy)).not.toThrow();
      expect(() => assertCallbackUrlAllowed('https://a.trusted.local/cb', policy)).not.toThrow();
      expect(rejectionCode(() => assertCallbackUrlAllowed('https://evil.example/cb', policy))).toBe(
        'CALLBACK_URL_HOST_NOT_ALLOWED',
      );
    });

    it('enforces WEBHOOK_ALLOWED_CIDRS for literal IPs', () => {
      const policy: CallbackUrlPolicy = { ...OPEN, allowedCidrs: ['192.168.1.0/24'] };
      expect(() => assertCallbackUrlAllowed('http://192.168.1.20/cb', policy)).not.toThrow();
      expect(rejectionCode(() => assertCallbackUrlAllowed('http://10.0.0.5/cb', policy))).toBe(
        'CALLBACK_URL_CIDR_NOT_ALLOWED',
      );
    });
  });

  it('parses policy from env in the project style', () => {
    const policy = callbackUrlPolicyFromEnv({
      WEBHOOK_ALLOWED_HOSTS: 'A.example, b.example',
      WEBHOOK_ALLOWED_CIDRS: '10.0.0.0/8',
      WEBHOOK_BLOCK_METADATA: 'false',
    } as NodeJS.ProcessEnv);
    expect(policy.allowedHosts).toEqual(['a.example', 'b.example']);
    expect(policy.allowedCidrs).toEqual(['10.0.0.0/8']);
    expect(policy.blockMetadata).toBe(false);
  });

  it('matches CIDRs correctly at boundaries', () => {
    expect(ipv4InAnyCidr('192.168.1.255', ['192.168.1.0/24'])).toBe(true);
    expect(ipv4InAnyCidr('192.168.2.0', ['192.168.1.0/24'])).toBe(false);
    expect(ipv4InAnyCidr('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });
});
