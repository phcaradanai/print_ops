import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

function pngBase64(width = 100, height = 50): string {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  return Buffer.concat([signature, chunk('IHDR', ihdrData), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

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

function importPayload(code: string, dataBase64 = pngBase64()) {
  return {
    fileName: 'C:\\exports\\label.png',
    declaredMimeType: 'image/png',
    dataBase64,
    profile: {
      code,
      name: 'Imported label',
      widthMm: 100,
      heightMm: 50,
      marginTopMm: 2,
      marginRightMm: 2,
      marginBottomMm: 2,
      marginLeftMm: 2,
      dpi: 300,
      orientation: 'landscape',
      unit: 'mm',
    },
    fitMode: 'contain',
  };
}

describe('paper profile raster import API', () => {
  it('analyzes PNG metadata and rejects MIME spoofing as a client error', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const body = { fileName: 'label.png', declaredMimeType: 'image/png', dataBase64: pngBase64() };
      const analyzed = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports/analyze', headers: auth(admin), payload: body });
      expect(analyzed.statusCode).toBe(200);
      expect(analyzed.json()).toMatchObject({ detectedMimeType: 'image/png', pixelWidth: 100, pixelHeight: 50, detectedDpi: null, suggestedDpi: 300 });

      const spoofed = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports/analyze', headers: auth(admin), payload: { ...body, declaredMimeType: 'image/jpeg' } });
      expect(spoofed.statusCode).toBe(400);
      expect((spoofed.json() as { error: string }).error).toBe('MIME_SPOOF');
    } finally {
      await app.close();
    }
  });

  it('imports, deduplicates, and retrieves persisted artwork without auditing bytes', async () => {
    const { app } = await buildApp();
    try {
      const admin = await login(app, 'admin@printerops.local');
      const created = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports', headers: auth(admin), payload: importPayload('IMPORT_LABEL_1') });
      expect(created.statusCode).toBe(201);
      const first = created.json() as { profile: { id: string }; artwork: { fileName: string; fitMode: string; dataBase64?: string }; duplicate: boolean };
      expect(first.duplicate).toBe(false);
      expect(first.artwork).toMatchObject({ fileName: 'label.png', fitMode: 'contain' });
      expect(first.artwork.dataBase64).toBeUndefined();

      const duplicate = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports', headers: auth(admin), payload: importPayload('IMPORT_LABEL_2') });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json()).toMatchObject({ duplicate: true, profile: { id: first.profile.id } });

      const artwork = await app.inject({ method: 'GET', url: `/api/v1/paper-profiles/${first.profile.id}/artwork`, headers: auth(admin) });
      expect(artwork.statusCode).toBe(200);
      expect(artwork.json()).toMatchObject({ dataBase64: pngBase64(), mimeType: 'image/png', fitMode: 'contain' });

      const audit = await app.inject({ method: 'GET', url: '/audit-logs?resourceType=paper_profile', headers: auth(admin) });
      const auditJson = JSON.stringify(audit.json());
      expect(auditJson).toContain('paper_profile.artwork_imported');
      expect(auditJson).not.toContain(pngBase64());
      expect(auditJson).not.toContain('dataBase64');
    } finally {
      await app.close();
    }
  });

  it('enforces permissions, validates profiles, and returns artwork 404', async () => {
    const { app } = await buildApp();
    try {
      const viewer = await login(app, 'viewer@printerops.local');
      const admin = await login(app, 'admin@printerops.local');
      const denied = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports/analyze', headers: auth(viewer), payload: { fileName: 'label.png', declaredMimeType: 'image/png', dataBase64: pngBase64() } });
      expect(denied.statusCode).toBe(403);

      const invalid = importPayload('IMPORT_INVALID');
      invalid.profile.marginLeftMm = 60;
      invalid.profile.marginRightMm = 60;
      const invalidResponse = await app.inject({ method: 'POST', url: '/api/v1/paper-profile-imports', headers: auth(admin), payload: invalid });
      expect(invalidResponse.statusCode).toBe(400);

      const missing = await app.inject({ method: 'GET', url: '/api/v1/paper-profiles/not-found/artwork', headers: auth(admin) });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
