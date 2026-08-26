import type { PaperProfile } from './types.js';

export interface PaperProfileExport {
  version: '1.0';
  type: 'paper_profile_export';
  exportedAt: string;
  profiles: Array<
    Pick<
      PaperProfile,
      | 'code'
      | 'name'
      | 'widthMm'
      | 'heightMm'
      | 'marginTopMm'
      | 'marginRightMm'
      | 'marginBottomMm'
      | 'marginLeftMm'
      | 'dpi'
      | 'orientation'
      | 'unit'
      | 'rotation'
      | 'flipHorizontal'
      | 'flipVertical'
      | 'fields'
    >
  >;
}

export function serializeProfiles(
  profiles: PaperProfile[],
  exportedAt = new Date().toISOString(),
): PaperProfileExport {
  return {
    version: '1.0',
    type: 'paper_profile_export',
    exportedAt,
    profiles: profiles.map((profile) => ({
      code: profile.code,
      name: profile.name,
      widthMm: profile.widthMm,
      heightMm: profile.heightMm,
      marginTopMm: profile.marginTopMm,
      marginRightMm: profile.marginRightMm,
      marginBottomMm: profile.marginBottomMm,
      marginLeftMm: profile.marginLeftMm,
      dpi: profile.dpi,
      orientation: profile.orientation,
      unit: profile.unit,
      ...(profile.rotation !== undefined ? { rotation: profile.rotation } : {}),
      ...(profile.flipHorizontal !== undefined ? { flipHorizontal: profile.flipHorizontal } : {}),
      ...(profile.flipVertical !== undefined ? { flipVertical: profile.flipVertical } : {}),
      fields: profile.fields ?? [],
    })),
  };
}

export function stringifyProfiles(profiles: PaperProfile[], exportedAt?: string): string {
  return JSON.stringify(serializeProfiles(profiles, exportedAt), null, 2);
}
