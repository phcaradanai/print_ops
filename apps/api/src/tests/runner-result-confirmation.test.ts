import { describe, expect, it } from 'vitest';
import {
  buildRunnerResultMetadata,
  enforceWindowsSpoolerConfirmation,
  isWindowsSpoolerExecution,
} from '../routes/v1/runner-jobs.routes.js';

describe('runner result Windows spooler confirmation gate', () => {
  it('uses the concrete dispatcher executor and rejects a global SNMP confirmation alone', () => {
    const input = {
      executor: 'rawtcp',
      evidence: {
        dispatched_executor: 'windows-spooler',
        device_confirmed: true,
      },
    };

    expect(isWindowsSpoolerExecution(input)).toBe(true);
    expect(enforceWindowsSpoolerConfirmation('SUCCESS', input)).toBe('UNVERIFIED');
  });

  it.each([
    {
      label: 'snake_case evidence',
      evidence: {
        dispatched_executor: 'windows-spooler',
        device_confirmed: true,
        ipp_job_confirmed: true,
      },
    },
    {
      label: 'camelCase evidence',
      evidence: {
        dispatchedExecutor: 'WindowsSpoolerAdapter',
        deviceConfirmed: true,
        ippJobConfirmed: true,
      },
    },
  ])('keeps SUCCESS with exact job proof using $label', ({ evidence }) => {
    expect(enforceWindowsSpoolerConfirmation('SUCCESS', {
      executor: 'rawtcp',
      evidence,
    })).toBe('SUCCESS');
  });

  it('uses the persisted printer protocol when runner labels omit the concrete executor', () => {
    expect(enforceWindowsSpoolerConfirmation('SUCCESS', {
      executor: 'multi',
      printerProtocol: 'windows_spooler',
      evidence: { device_confirmed: true },
    })).toBe('UNVERIFIED');
  });

  it('does not impose Windows IPP evidence on a non-Windows executor', () => {
    expect(enforceWindowsSpoolerConfirmation('SUCCESS', {
      executor: 'rawtcp',
      printerProtocol: 'raw-tcp-9100',
      evidence: {},
    })).toBe('SUCCESS');
  });

  it('persists sanitized printer proof without replacing existing job metadata', () => {
    expect(buildRunnerResultMetadata(
      { sandbox: true },
      { ipp_job_confirmed: true, device_confirmed: true, access_token: 'do-not-store' },
    )).toEqual({
      sandbox: true,
      printEvidence: { ipp_job_confirmed: true, device_confirmed: true },
    });
  });
});
