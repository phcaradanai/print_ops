import { describe, expect, it } from 'vitest';
import type { PaperProfile } from '@printerops/domain';
import { buildApp } from '../app.js';
import { validatePaperProfileCreate, validatePaperProfileUpdate } from '../routes/v1/paper-profile-validation.js';

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'Dev-password1!' },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const validProfile = {
  code: 'VALID_100X50',
  name: 'Valid 100x50',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 2,
  marginBottomMm: 2,
  marginLeftMm: 2,
  dpi: 203,
  orientation: 'portrait',
  unit: 'mm',
};

describe('paper profile server-side validation', () => {
  it('rejects zero and negative dimensions on create', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      for (const patch of [{ widthMm: 0 }, { heightMm: -5 }, { dpi: 0 }]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/paper-profiles',
          headers: auth(admin),
          payload: { ...validProfile, ...patch },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string; issues: Array<{ field: string }> };
        expect(body.error).toBe('VALIDATION_ERROR');
        expect(body.issues[0]!.field).toBe(Object.keys(patch)[0]);
      }
    } finally {
      await app.close();
    }
  });

  it('rejects negative margins and margins that consume the whole page', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');

      const negative = await app.inject({
        method: 'POST',
        url: '/api/v1/paper-profiles',
        headers: auth(admin),
        payload: { ...validProfile, marginLeftMm: -1 },
      });
      expect(negative.statusCode).toBe(400);
      expect((negative.json() as { issues: Array<{ field: string }> }).issues[0]!.field).toBe('marginLeftMm');

      const consumed = await app.inject({
        method: 'POST',
        url: '/api/v1/paper-profiles',
        headers: auth(admin),
        payload: { ...validProfile, marginLeftMm: 60, marginRightMm: 60 },
      });
      expect(consumed.statusCode).toBe(400);
      expect((consumed.json() as { issues: Array<{ field: string }> }).issues[0]!.field).toBe('margins');
    } finally {
      await app.close();
    }
  });

  it('accepts a valid create, then rejects a partial update that breaks the merged geometry', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/paper-profiles',
        headers: auth(admin),
        payload: validProfile,
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { id: string }).id;

      // Margins alone exceed the EXISTING height: only the merged view catches it.
      const badPatch = await app.inject({
        method: 'PUT',
        url: `/api/v1/paper-profiles/${id}`,
        headers: auth(admin),
        payload: { marginTopMm: 30, marginBottomMm: 30 },
      });
      expect(badPatch.statusCode).toBe(400);
      expect((badPatch.json() as { issues: Array<{ field: string }> }).issues[0]!.field).toBe('margins');

      const goodPatch = await app.inject({
        method: 'PUT',
        url: `/api/v1/paper-profiles/${id}`,
        headers: auth(admin),
        payload: { marginTopMm: 5 },
      });
      expect(goodPatch.statusCode).toBe(200);
      expect((goodPatch.json() as { marginTopMm: number }).marginTopMm).toBe(5);
    } finally {
      await app.close();
    }
  });

  it('returns 404 (not 500) when updating a missing profile', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/paper-profiles/no-such-id',
        headers: auth(admin),
        payload: { marginTopMm: 5 },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('import rejects a present-but-invalid number instead of silently defaulting it', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/paper-profiles/import',
        headers: auth(admin),
        payload: { profiles: [{ code: 'BAD_IMPORT', name: 'Bad import', widthMm: 'abc', heightMm: 50 }] },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; issues: Array<{ field: string }> };
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.issues[0]!.field).toBe('widthMm');
    } finally {
      await app.close();
    }
  });

  it('import still applies legacy defaults for ABSENT numeric fields', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/paper-profiles/import',
        headers: auth(admin),
        payload: { profiles: [{ code: 'DEFAULTED_IMPORT', name: 'Defaulted import' }] },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { imported: Array<{ widthMm: number; heightMm: number; dpi: number }> };
      expect(body.imported[0]!.widthMm).toBe(100);
      expect(body.imported[0]!.heightMm).toBe(150);
      expect(body.imported[0]!.dpi).toBe(203);
    } finally {
      await app.close();
    }
  });
});

const baseProfile = {
  code: 'LABEL_100X50',
  name: 'Label 100x50',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 0,
  marginRightMm: 0,
  marginBottomMm: 0,
  marginLeftMm: 0,
  dpi: 203,
  orientation: 'landscape' as const,
  unit: 'mm' as const,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
};

const qrField = (overrides: Partial<PaperProfile['fields'][number]> = {}): PaperProfile['fields'][number] => ({
  id: 'qr-1',
  key: 'code',
  label: 'Code',
  defaultValue: 'ABC123',
  type: 'qrcode',
  qrSizeMm: 10,
  xMm: 45,
  yMm: 20,
  fontSize: 12,
  bold: false,
  color: '#000000',
  align: 'left',
  ...overrides,
});

function storedProfile(fields: PaperProfile['fields']): PaperProfile {
  const now = new Date();
  return {
    id: 'paper-1',
    ...baseProfile,
    fields,
    createdAt: now,
    updatedAt: now,
  };
}

describe('paper profile field geometry validation', () => {
  it('accepts a QR field at the center through quarter-turn transforms', () => {
    for (const rotation of [0, 90, 180, 270]) {
      expect(validatePaperProfileCreate({
        ...baseProfile,
        rotation,
        fields: [qrField()],
      })).toEqual([]);
    }
  });

  it('rejects a field whose transformed bounds exceed the paper', () => {
    const issues = validatePaperProfileCreate({
      ...baseProfile,
      rotation: 90,
      fields: [qrField({ xMm: 95 })],
    });

    expect(issues).toContainEqual({
      field: 'fields.qr-1',
      message: 'field extends beyond the transformed paper boundary',
    });
  });

  it('revalidates existing fields when a profile update changes paper dimensions', () => {
    const issues = validatePaperProfileUpdate(storedProfile([qrField()]), { widthMm: 50 });

    expect(issues).toContainEqual({
      field: 'fields.qr-1',
      message: 'field extends beyond the transformed paper boundary',
    });
  });
});
