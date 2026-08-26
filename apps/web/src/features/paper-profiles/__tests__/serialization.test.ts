import { describe, expect, it } from 'vitest';
import { serializeProfiles, stringifyProfiles } from '../model/serialization.js';
import type { PaperProfile } from '../model/types.js';

const profile: PaperProfile = {
  id: 'internal-id',
  code: 'shipping',
  name: 'Shipping label',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 3,
  marginBottomMm: 4,
  marginLeftMm: 5,
  dpi: 203,
  orientation: 'landscape',
  unit: 'mm',
  fields: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('Paper Profile serialization', () => {
  it('preserves the v1 export envelope and excludes server-only properties', () => {
    const result = serializeProfiles([profile], '2026-07-30T00:00:00.000Z');
    expect(result).toEqual({
      version: '1.0',
      type: 'paper_profile_export',
      exportedAt: '2026-07-30T00:00:00.000Z',
      profiles: [
        {
          code: 'shipping',
          name: 'Shipping label',
          widthMm: 100,
          heightMm: 50,
          marginTopMm: 2,
          marginRightMm: 3,
          marginBottomMm: 4,
          marginLeftMm: 5,
          dpi: 203,
          orientation: 'landscape',
          unit: 'mm',
          fields: [],
        },
      ],
    });
  });

  it('exports explicitly configured transform fields', () => {
    const result = serializeProfiles([{
      ...profile,
      rotation: 37,
      flipHorizontal: true,
      flipVertical: true,
    }], '2026-07-30T00:00:00.000Z');

    expect(result.profiles[0]).toMatchObject({
      rotation: 37,
      flipHorizontal: true,
      flipVertical: true,
    });
  });

  it('keeps the established two-space formatted JSON representation', () => {
    const json = stringifyProfiles([profile], '2026-07-30T00:00:00.000Z');
    expect(json).toContain('\n  "version": "1.0"');
    expect(JSON.parse(json)).toEqual(serializeProfiles([profile], '2026-07-30T00:00:00.000Z'));
  });
});
