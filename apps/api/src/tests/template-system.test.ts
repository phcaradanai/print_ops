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

describe('Template management, sandbox, and dynamic intake', () => {
  it('returns a sandbox job immediately and persists its terminal result', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'sysadmin@printerops.local');
    const templates = (await app.inject({
      method: 'GET', url: '/api/v1/sandbox/templates', headers: auth(admin),
    })).json() as Array<{ id: string; paperProfileId?: string }>;
    const printers = (await app.inject({
      method: 'GET', url: '/printers', headers: auth(admin),
    })).json() as Array<{ id: string; protocol: string }>;
    const template = templates.find((item) => item.paperProfileId);
    const printer = printers.find((item) => item.protocol === 'fake');
    expect(template).toBeDefined();
    expect(printer).toBeDefined();
    const papers = (await app.inject({
      method: 'GET', url: '/api/v1/paper-profiles', headers: auth(admin),
    })).json() as Array<{ id: string; dpi: number }>;
    const paper = papers.find((item) => item.id === template!.paperProfileId)!;
    const calibration = await app.inject({
      method: 'POST', url: '/api/v1/printer-calibrations', headers: auth(admin),
      payload: { printerId: printer!.id, paperProfileId: paper.id, dpi: paper.dpi, xOffsetDots: 0, yOffsetDots: 100 },
    });
    expect(calibration.statusCode).toBe(201);

    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/sandbox/test-print',
      headers: auth(admin),
      payload: {
        templateId: template!.id,
        paperProfileId: template!.paperProfileId,
        printerId: printer!.id,
        copies: 1,
        samplePayload: { label: 'test', barcode: 'ABC123' },
      },
    });
    expect(submitted.statusCode).toBe(202);
    const body = submitted.json() as { accepted: boolean; jobId: string };
    expect(body.accepted).toBe(true);

    let status = '';
    for (let attempt = 0; attempt < 20 && status !== 'SUCCESS'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const read = await app.inject({ method: 'GET', url: `/jobs/${body.jobId}`, headers: auth(admin) });
      const job = read.json();
      expect(job.metadata).toMatchObject({
        paperProfile: { paperProfileId: paper.id, dpi: paper.dpi },
        printerCalibration: { printerId: printer!.id, paperProfileId: paper.id, dpi: paper.dpi, yOffsetDots: 100 },
      });
      status = job.status;
    }
    expect(status).toBe('SUCCESS');
  });

  it('allows admin to create paper profile and denies viewer create', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');
    const viewer = await login(app, 'viewer@printerops.local');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(admin),
      payload: {
        code: 'LABEL_TEST',
        name: 'Label Test',
        widthMm: 70,
        heightMm: 30,
        marginTopMm: 2,
        marginRightMm: 2,
        marginBottomMm: 2,
        marginLeftMm: 2,
        dpi: 203,
        orientation: 'portrait',
        unit: 'mm',
      },
    });
    expect(created.statusCode).toBe(201);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(viewer),
      payload: created.json(),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('allows admin to create template and render preview with missing-field warning', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');
    const papers = await app.inject({ method: 'GET', url: '/api/v1/paper-profiles', headers: auth(admin) });
    const paperId = (papers.json() as { id: string }[])[0]!.id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(admin),
      payload: {
        templateCode: 'UNIT_TEST_TEMPLATE',
        name: 'Unit Test Template',
        engine: 'RAW_TEXT',
        content: 'Hello {{label}} {{missing}}',
        paperProfileId: paperId,
      },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json() as { id: string };

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${template.id}/preview`,
      headers: auth(admin),
      payload: { samplePayload: { label: 'A' } },
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { warnings: string[] }).warnings.join(' ')).toContain('missing');

    const audit = await app.inject({ method: 'GET', url: '/audit-logs?resourceType=template', headers: auth(admin) });
    expect(JSON.stringify(audit.json())).toContain('template.created');
  });

  it('places multi-column companion fields in the printed cell, without media margins', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(admin),
      payload: {
        code: 'GRID_FIELD_TEST', name: 'Grid Field Test',
        widthMm: 104, heightMm: 30,
        marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
        dpi: 203, orientation: 'landscape', unit: 'mm',
        layout: { columns: 2, cellWidthMm: 48, cellHeightMm: 25, columnGapMm: 4, rowPitchMm: 28 },
        fields: [{ id: 'f1', key: 'name', label: 'Name', defaultValue: '', type: 'text', xMm: 5, yMm: 4, fontSize: 10, bold: false, color: '#000000', align: 'left', displayWidthMm: 30, bgColor: '#ffee00' }],
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    const templates = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(admin) });
    const companion = (templates.json() as { paperProfileId?: string; content: string }[]).find((t) => t.paperProfileId === id)!;
    expect(companion.content).toContain('width:48mm;height:25mm');
    expect(companion.content).toContain('left:5mm;top:4mm');
    expect(companion.content).toContain('width:30mm;overflow:hidden;text-align:left;');
    expect(companion.content).toContain('background-color:#ffee00;');
  });

  it('prints static shapes and logos into the companion template, and rejects SVG logos', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');
    const base = { label: '', defaultValue: '', fontSize: 10, bold: false, color: '#000000', align: 'left' };
    const payload = (logo: string) => ({
      code: `STATIC_${logo.length}`, name: 'Static', widthMm: 70, heightMm: 30,
      marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2, dpi: 203, orientation: 'landscape', unit: 'mm',
      fields: [
        { ...base, id: 'b', key: 'frame', type: 'shape', xMm: 1, yMm: 1, boxWidthMm: 30, boxHeightMm: 0.5, borderMm: 0, bgColor: '#000000' },
        { ...base, id: 'i', key: 'logo', type: 'image', xMm: 40, yMm: 2, boxWidthMm: 15, boxHeightMm: 10, imageDataUri: logo },
      ],
    });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/paper-profiles', headers: auth(admin),
      payload: payload('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=') });
    expect(bad.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/v1/paper-profiles', headers: auth(admin), payload: payload('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==') });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    const templates = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(admin) });
    const companion = (templates.json() as { paperProfileId?: string; content: string }[]).find((t) => t.paperProfileId === id)!;
    expect(companion.content).toContain('left:3mm;top:3mm;width:30mm;height:0.5mm;box-sizing:border-box;display:block;background-color:#000000;"></span>');
    expect(companion.content).toContain('<img alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="');
    expect(companion.content).not.toContain('{{frame}}');
  });

  it('lists saved versions and restores one, re-syncing the companion template', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');
    const field = { id: 'f1', key: 'hn', label: 'HN', defaultValue: '', type: 'text', xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000000', align: 'left' };
    const created = await app.inject({ method: 'POST', url: '/api/v1/paper-profiles', headers: auth(admin), payload: {
      code: 'VERSIONED', name: 'v1', widthMm: 70, heightMm: 30, marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
      dpi: 203, orientation: 'landscape', unit: 'mm', fields: [field] } });
    const { id } = created.json() as { id: string };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5)); // versions sort by audit time (ms)
    await tick();
    await app.inject({ method: 'PUT', url: `/api/v1/paper-profiles/${id}`, headers: auth(admin), payload: { name: 'v2', fields: [{ ...field, xMm: 30 }] } });

    const versions = (await app.inject({ method: 'GET', url: `/api/v1/paper-profiles/${id}/versions`, headers: auth(admin) })).json() as { versionId: string; profile: { name: string } }[];
    expect(versions.map((v) => v.profile.name)).toEqual(['v2', 'v1']);

    await tick();
    const restored = await app.inject({ method: 'POST', url: `/api/v1/paper-profiles/${id}/versions/${versions[1]!.versionId}/restore`, headers: auth(admin) });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id, name: 'v1', fields: [{ xMm: 5 }] });
    const templates = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(admin) });
    const companion = (templates.json() as { paperProfileId?: string; content: string }[]).find((t) => t.paperProfileId === id)!;
    expect(companion.content).toContain('left:7mm;top:7mm');
    const after = (await app.inject({ method: 'GET', url: `/api/v1/paper-profiles/${id}/versions`, headers: auth(admin) })).json() as { action: string }[];
    expect(after[0]!.action).toBe('paper_profile.restored');
    expect((await app.inject({ method: 'POST', url: `/api/v1/paper-profiles/${id}/versions/nope/restore`, headers: auth(admin) })).statusCode).toBe(404);
  });

  it('persists paper profile fields and keeps a companion HTML template in sync', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');

    const field = {
      id: 'f1', key: 'hn_masked', label: 'HN', defaultValue: '', type: 'text',
      xMm: 5.5, yMm: 10, fontSize: 12, bold: true, color: '#111111', align: 'center',
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/paper-profiles',
      headers: auth(admin),
      payload: {
        code: 'FIELD_SYNC_TEST', name: 'Field Sync Test',
        widthMm: 70, heightMm: 30,
        marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
        dpi: 203, orientation: 'portrait', unit: 'mm',
        fields: [field],
      },
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json() as { id: string; fields: unknown[] };
    expect(profile.fields).toEqual([field]);

    // Re-fetching must return the same fields — this is what "field
    // disappears after save" meant: fields were UI-only and never round-tripped.
    const refetched = await app.inject({ method: 'GET', url: `/api/v1/paper-profiles/${profile.id}`, headers: auth(admin) });
    expect((refetched.json() as { fields: unknown[] }).fields).toEqual([field]);

    const templates = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(admin) });
    const companion = (templates.json() as { paperProfileId?: string; engine: string; content: string }[])
      .find((t) => t.paperProfileId === profile.id);
    expect(companion).toBeDefined();
    expect(companion!.engine).toBe('HTML');
    expect(companion!.content).toContain('{{hn_masked}}');
    // Stored geometry is 70x30 (landscape), but explicit orientation is
    // portrait. Match the editor's clockwise point mapping while leaving the
    // actual glyph upright, then offset the printable-relative result by the
    // rotated page margins: x'=(30-2-2)-10+2=18, y'=5.5+2=7.5.
    expect(companion!.content).toContain('width:30mm;height:70mm');
    expect(companion!.content).toContain('left:18mm');
    expect(companion!.content).toContain('top:7.5mm');
    expect(companion!.content).toContain('translateX(-50%)'); // center align
    expect(companion!.content).not.toContain('rotate(');

    // Editing the profile's fields updates the SAME template, not a duplicate.
    const updatedField = { ...field, key: 'hn_masked_v2' };
    await app.inject({
      method: 'PUT',
      url: `/api/v1/paper-profiles/${profile.id}`,
      headers: auth(admin),
      payload: { fields: [updatedField] },
    });

    const templatesAfter = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(admin) });
    const companionsAfter = (templatesAfter.json() as { paperProfileId?: string; content: string }[])
      .filter((t) => t.paperProfileId === profile.id);
    expect(companionsAfter).toHaveLength(1);
    expect(companionsAfter[0]!.content).toContain('{{hn_masked_v2}}');
  });

  it('allows sysadmin sandbox access and denies normal user sandbox', async () => {
    const { app } = await buildApp();
    const owner = await login(app, 'sysadmin@printerops.local');
    const user = await login(app, 'user@printerops.local');

    const ok = await app.inject({ method: 'GET', url: '/api/v1/sandbox/templates', headers: auth(owner) });
    expect(ok.statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/api/v1/sandbox/templates', headers: auth(user) });
    expect(denied.statusCode).toBe(403);
  });

  it('accepts dynamic intake, resolves static route, populates job metadata, trace, audit, and prints again on resend', async () => {
    const { app } = await buildApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/dev-intake',
      payload: { request_id: 'INTAKE-001', type: 'lab_label', label: 'Tube A', barcode: 'ABC123', hn: 'HN001' },
    });
    expect(first.statusCode).toBe(202);
    const body = first.json() as { print_job_id: string; resolved_template_code: string; resolved_printer_code: string };
    expect(body.resolved_printer_code).toBe('LAB_LABEL_01');
    expect(body.resolved_template_code).toBe('LAB_LABEL_DEFAULT');

    const admin = await login(app, 'admin@printerops.local');
    const job = await app.inject({ method: 'GET', url: `/jobs/${body.print_job_id}`, headers: auth(admin) });
    expect(job.statusCode).toBe(200);
    const jobBody = job.json() as { resolvedTemplateCode?: string; paperProfileId?: string; routePolicyId?: string; templateTiming?: { renderMs?: number } };
    expect(jobBody.resolvedTemplateCode).toBe('LAB_LABEL_DEFAULT');
    expect(jobBody.paperProfileId).toBeDefined();
    expect(jobBody.routePolicyId).toBeDefined();
    expect(jobBody.templateTiming?.renderMs).toBeGreaterThanOrEqual(0);

    const trace = await app.inject({ method: 'GET', url: `/jobs/${body.print_job_id}/trace`, headers: auth(admin) });
    expect(JSON.stringify((trace.json() as { steps: unknown[] }).steps)).toContain('template_rendered');

    const audit = await app.inject({ method: 'GET', url: '/audit-logs?resourceType=webhook', headers: auth(admin) });
    expect(JSON.stringify(audit.json())).toContain('webhook.intake.accepted');

    const resend = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/dev-intake',
      payload: { request_id: 'INTAKE-001', type: 'lab_label', label: 'Tube A', barcode: 'ABC123', hn: 'HN001' },
    });
    expect(resend.statusCode).toBe(202);
    expect((resend.json() as { print_job_id?: string }).print_job_id).not.toBe(body.print_job_id);
  });

  it('supports field-based printer and template mapping and rejects raw JS eval policies', async () => {
    const { app } = await buildApp();
    const admin = await login(app, 'admin@printerops.local');

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook-route-policies',
      headers: auth(admin),
      payload: { policyCode: 'bad', name: 'bad', matchRules: { when: [] }, printerMapping: { eval: 'eval(payload)' }, templateMapping: {}, payloadMapping: {}, enabled: true },
    });
    expect(rejected.statusCode).toBe(400);

    const policy = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook-route-policies',
      headers: auth(admin),
      payload: {
        policyCode: 'field-map',
        name: 'Field Map',
        matchRules: { when: [{ field: 'type', op: 'eq', value: 'field_label' }] },
        printerMapping: { strategy: 'field', field: 'target_printer' },
        templateMapping: { strategy: 'field', field: 'template_code' },
        payloadMapping: { barcode: '$.barcode', label: '$.label', hn_masked: '$.hn' },
        enabled: true,
      },
    });
    expect(policy.statusCode).toBe(201);
    const policyAudit = await app.inject({ method: 'GET', url: '/audit-logs?resourceType=webhook_policy', headers: auth(admin) });
    expect(JSON.stringify(policyAudit.json())).toContain('webhook_policy.created');

    const endpoint = await app.inject({
      method: 'POST',
      url: '/api/v1/webhook-endpoints',
      headers: auth(admin),
      payload: { endpointCode: 'field-intake', name: 'Field Intake', sourceSystem: 'field-system', authMode: 'NONE', enabled: true, routePolicyId: (policy.json() as { id: string }).id },
    });
    expect(endpoint.statusCode).toBe(201);

    const intake = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/field-intake',
      payload: { request_id: 'FIELD-001', type: 'field_label', target_printer: 'LAB_LABEL_01', template_code: 'LAB_LABEL_DEFAULT', label: 'Tube B', barcode: 'B1', hn: 'HN2' },
    });
    expect(intake.statusCode).toBe(202);
    expect((intake.json() as { resolved_template_code: string }).resolved_template_code).toBe('LAB_LABEL_DEFAULT');
  });

  it('deletes an unbound template, writes an audit entry, and refuses a bound one', async () => {
    const { app } = await buildApp();
    const owner = await login(app, 'sysadmin@printerops.local');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(owner),
      payload: { templateCode: 'DELETE_ME', name: 'Delete Me', engine: 'RAW_TEXT', content: '{{label}}' },
    });
    expect(created.statusCode).toBe(201);
    const templateId = (created.json() as { id: string }).id;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/templates/${templateId}`, headers: auth(owner) });
    expect(deleted.statusCode).toBe(200);
    expect((deleted.json() as { deleted: boolean }).deleted).toBe(true);

    const gone = await app.inject({ method: 'GET', url: `/api/v1/templates/${templateId}`, headers: auth(owner) });
    expect(gone.statusCode).toBe(404);

    const audit = await app.inject({ method: 'GET', url: '/audit-logs?resourceType=template', headers: auth(owner) });
    expect(JSON.stringify(audit.json())).toContain('template.deleted');

    const bound = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(owner),
      payload: { templateCode: 'BOUND_TPL', name: 'Bound', engine: 'RAW_TEXT', content: '{{label}}' },
    });
    const boundId = (bound.json() as { id: string }).id;
    const profiles = (await app.inject({ method: 'GET', url: '/api/v1/paper-profiles', headers: auth(owner) })).json() as Array<{ id: string }>;
    const binding = await app.inject({
      method: 'POST',
      url: '/api/v1/printer-template-bindings',
      headers: auth(owner),
      payload: { printerCode: 'LAB_LABEL_01', templateCode: 'BOUND_TPL', paperProfileId: profiles[0]!.id, isDefault: false, enabled: true },
    });
    expect(binding.statusCode).toBe(201);

    const refused = await app.inject({ method: 'DELETE', url: `/api/v1/templates/${boundId}`, headers: auth(owner) });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { bindings: string[] }).bindings).toContain('LAB_LABEL_01');
  });

  it('denies template delete for a viewer', async () => {
    const { app } = await buildApp();
    const owner = await login(app, 'sysadmin@printerops.local');
    const viewer = await login(app, 'viewer@printerops.local');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(owner),
      payload: { templateCode: 'VIEWER_NO_DELETE', name: 'Nope', engine: 'RAW_TEXT', content: 'x' },
    });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/templates/${id}`, headers: auth(viewer) });
    expect(res.statusCode).toBe(403);
  });
});
