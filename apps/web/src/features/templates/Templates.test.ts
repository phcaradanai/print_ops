import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { buildSample, placeholdersOf } from './hooks/helpers.js';
import { classifyTemplateDeleteFailure } from './hooks/useTemplateWorkspace.js';

describe('Templates preview helpers', () => {
  it('collects plain and explicit barcode/QR token keys without duplicates', () => {
    expect(placeholdersOf(
      '{{label}} {{barcode:patient_id}} {{qrcode:visit.id}} {{patient_id}}',
    )).toEqual(['label', 'patient_id', 'visit.id']);
  });

  it('builds default sample values for explicit barcode and QR keys', () => {
    const sample = buildSample(
      'default',
      '{{barcode:patient_id}}\n{{qrcode:visit_id}}',
    );

    expect(sample.patient_id).toBe('PATIENT_ID');
    expect(sample.visit_id).toBe('VISIT_ID');
  });

  it('does not silently substitute default data when profile sample has no profile', () => {
    expect(buildSample('profile', '{{label}}')).toEqual({});
  });

  it('uses paper-profile field defaults for profile sample mode', () => {
    const sample = buildSample('profile', '{{barcode:patient_id}}', {
      id: 'profile-1',
      code: 'RX-50',
      name: 'Prescription label',
      fields: [
        { key: 'patient_id', label: 'Patient ID', defaultValue: 'HN000123', type: 'barcode' },
        { key: 'ward', label: 'Ward A', type: 'text' },
      ],
    });

    expect(sample).toEqual({ patient_id: 'HN000123', ward: 'Ward A' });
  });
});

describe('Templates delete error mapping', () => {
  it('maps an HTTP 409 ApiError to the bound-template message', () => {
    expect(classifyTemplateDeleteFailure(new ApiError({
      status: 409,
      path: '/v1/templates/template-1',
      message: 'Template is referenced by an active binding',
    }))).toBe('bound');
  });

  it('maps an HTTP 403 ApiError to the permission message', () => {
    expect(classifyTemplateDeleteFailure(new ApiError({
      status: 403,
      path: '/v1/templates/template-1',
      message: 'Missing permission: template:delete',
    }))).toBe('forbidden');
  });

  it('keeps network and unknown failures generic', () => {
    expect(classifyTemplateDeleteFailure(new ApiError({
      status: 0,
      path: '/v1/templates/template-1',
      message: 'Network request failed',
    }))).toBe('generic');
    expect(classifyTemplateDeleteFailure(new Error('unknown'))).toBe('generic');
  });
});
