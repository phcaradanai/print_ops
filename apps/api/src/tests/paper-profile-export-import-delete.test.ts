import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'Dev-password1!' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe('Paper Profile Export, Import, and Delete API', () => {
  it('allows admin to create, export, import, and delete paper profile', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');

    // 1. Create a paper profile
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(admin),
      payload: {
        code: 'LABEL_EXPORT_1',
        name: 'Export Test Label',
        widthMm: 80,
        heightMm: 50,
        marginTopMm: 3,
        marginRightMm: 3,
        marginBottomMm: 3,
        marginLeftMm: 3,
        dpi: 203,
        orientation: 'portrait',
        unit: 'mm',
        fields: [
          { id: 'f1', key: 'title', label: 'Title', type: 'text', xMm: 10, yMm: 10, fontSize: 12, bold: true, align: 'left', color: '#000000' },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdProfile = createRes.json();
    expect(createdProfile.code).toBe('LABEL_EXPORT_1');

    // 2. Single profile export
    const exportSingleRes = await app.inject({
      method: 'GET',
      url: `/api/v1/paper-profiles/${createdProfile.id}/export`,
      headers: auth(admin),
    });
    expect(exportSingleRes.statusCode).toBe(200);
    const singleExportJson = exportSingleRes.json();
    expect(singleExportJson.version).toBe('1.0');
    expect(singleExportJson.profiles.length).toBe(1);
    expect(singleExportJson.profiles[0].code).toBe('LABEL_EXPORT_1');

    // 3. Batch profile export
    const exportBatchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles/export',
      headers: auth(admin),
      payload: { ids: [createdProfile.id] },
    });
    expect(exportBatchRes.statusCode).toBe(200);
    const batchExportJson = exportBatchRes.json();
    expect(batchExportJson.profiles.length).toBe(1);
    expect(batchExportJson.profiles[0].code).toBe('LABEL_EXPORT_1');

    // 4. Import profile (without overwrite => generates unique code copy)
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles/import',
      headers: auth(admin),
      payload: singleExportJson,
    });
    expect(importRes.statusCode).toBe(201);
    const importResult = importRes.json();
    expect(importResult.count).toBe(1);
    expect(importResult.imported[0].code).toBe('LABEL_EXPORT_1_copy');

    // 5. Import profile with overwrite=true
    const overwriteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles/import?overwrite=true',
      headers: auth(admin),
      payload: {
        profiles: [
          { ...singleExportJson.profiles[0], name: 'Updated Export Label' },
        ],
      },
    });
    expect(overwriteRes.statusCode).toBe(201);
    const overwriteResult = overwriteRes.json();
    expect(overwriteResult.imported[0].code).toBe('LABEL_EXPORT_1');
    expect(overwriteResult.imported[0].name).toBe('Updated Export Label');

    // 6. Delete imported profile
    const deleteCopiedRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/paper-profiles/${importResult.imported[0].id}`,
      headers: auth(admin),
    });
    expect(deleteCopiedRes.statusCode).toBe(200);
    expect(deleteCopiedRes.json()).toEqual({ deleted: true, id: importResult.imported[0].id });

    // Verify it's deleted
    const verifyGet = await app.inject({
      method: 'GET',
      url: `/api/v1/paper-profiles/${importResult.imported[0].id}`,
      headers: auth(admin),
    });
    expect(verifyGet.statusCode).toBe(404);
  });

  it('prevents viewer from deleting or importing paper profiles', async () => {
    const { app } = await buildApp();
    const viewer = await login(app, 'viewer@printerops.local');

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles/import',
      headers: auth(viewer),
      payload: { profiles: [{ name: 'Test', code: 'TEST' }] },
    });
    expect(importRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/paper-profiles/some-id',
      headers: auth(viewer),
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('refuses deletion with 409 if paper profile is bound to a custom template', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');

    // Create profile
    const paperRes = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(admin),
      payload: {
        code: 'BOUND_PROFILE',
        name: 'Bound Profile',
        widthMm: 100,
        heightMm: 150,
        marginTopMm: 0,
        marginRightMm: 0,
        marginBottomMm: 0,
        marginLeftMm: 0,
        dpi: 203,
        orientation: 'portrait',
        unit: 'mm',
      },
    });
    const paper = paperRes.json();

    // Create custom template linked to profile
    await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(admin),
      payload: {
        templateCode: 'CUSTOM_TEMPLATE_1',
        name: 'Custom Template 1',
        engine: 'HTML',
        content: '<div>test</div>',
        paperProfileId: paper.id,
      },
    });

    // Attempt delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/paper-profiles/${paper.id}`,
      headers: auth(admin),
    });
    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.json().error).toBe('Paper profile is used by templates');
  });
});
