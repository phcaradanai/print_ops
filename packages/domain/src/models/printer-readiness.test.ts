import { describe, expect, it } from 'vitest';
import { evaluatePrinterReadiness } from './printer-readiness.js';

describe('evaluatePrinterReadiness', () => {
  it('allows a detected USB printer with UNKNOWN and WorkOffline=false', () => {
    expect(evaluatePrinterReadiness({
      detected: true,
      statusCode: 'unknown',
      rawStatus: 'Unknown',
      rawState: 'Unknown',
      workOffline: false,
    })).toEqual({ ready: true, warning: 'unknown-status' });
  });

  it.each(['offline', 'error', 'paused'])('blocks explicit %s', (statusCode) => {
    expect(evaluatePrinterReadiness({
      detected: true,
      statusCode,
      workOffline: false,
    })).toEqual({ ready: false, blockedBy: statusCode });
  });

  it('does not turn a non-blocking Windows fault flag into readiness ERROR', () => {
    expect(evaluatePrinterReadiness({
      detected: true,
      statusCode: 'unknown',
      rawStatus: 'PaperOut',
      workOffline: false,
    })).toEqual({ ready: true });
  });

  it('still requires evidence for a printer with no detection/status signal', () => {
    expect(evaluatePrinterReadiness({})).toEqual({
      ready: false,
      blockedBy: 'status-unavailable',
    });
  });
});
