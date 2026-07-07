import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

async function login(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'dev-password' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe('Template management, sandbox, and dynamic intake', () => {
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

  it('allows sysadmin sandbox access and denies normal user sandbox', async () => {
    const { app } = await buildApp();
    const owner = await login(app, 'sysadmin@printerops.local');
    const user = await login(app, 'user@printerops.local');

    const ok = await app.inject({ method: 'GET', url: '/api/v1/sandbox/templates', headers: auth(owner) });
    expect(ok.statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/api/v1/sandbox/templates', headers: auth(user) });
    expect(denied.statusCode).toBe(403);
  });

  it('accepts dynamic intake, resolves static route, populates job metadata, trace, audit, and duplicate response', async () => {
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

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/intake/dev-intake',
      payload: { request_id: 'INTAKE-001', type: 'lab_label', label: 'Tube A', barcode: 'ABC123', hn: 'HN001' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect((duplicate.json() as { duplicate?: boolean }).duplicate).toBe(true);
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
});
