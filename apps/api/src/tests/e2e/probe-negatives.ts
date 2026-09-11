/**
 * Focused probe for the two anomalies the main harness surfaced on
 * POST /api/v1/print-jobs:
 *   - an unknown template_code is accepted with 201
 *   - a negative `copies` value is accepted with 201
 * Determines what those jobs actually DO once the local worker picks them up.
 */
process.env['NODE_ENV'] = 'test';
process.env['DB_MODE'] = 'memory';
process.env['JWT_SECRET'] = 'e2e-harness-secret-not-a-real-credential';
process.env['PRINTOPS_LOCAL_WORKER'] = 'true';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { buildApp } = await import('../../app.js');
  const built = await buildApp();
  const app = built.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  const BASE = `http://127.0.0.1:${port}`;
  const key = built.DEV_API_KEY;

  const post = async (path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, body: parsed };
  };
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': key } });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };

  const stamp = Date.now();
  const cases = [
    { name: 'unknown template_code', body: { request_id: `p-tpl-${stamp}`, source_system: 'probe', printer_code: 'OFFICE_LASER_01', template_code: 'TOTALLY_MADE_UP', payload: { a: 1 }, copies: 1 } },
    { name: 'negative copies', body: { request_id: `p-neg-${stamp}`, source_system: 'probe', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: { a: 1 }, copies: -5 } },
    { name: 'zero copies', body: { request_id: `p-zero-${stamp}`, source_system: 'probe', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: { a: 1 }, copies: 0 } },
    { name: 'huge copies', body: { request_id: `p-huge-${stamp}`, source_system: 'probe', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: { a: 1 }, copies: 100000 } },
    { name: 'fractional copies', body: { request_id: `p-frac-${stamp}`, source_system: 'probe', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: { a: 1 }, copies: 2.7 } },
  ];

  const out: Record<string, unknown>[] = [];
  for (const c of cases) {
    const res = await post('/api/v1/print-jobs', c.body);
    out.push({ name: c.name, acceptStatus: res.status, acceptBody: res.body });
  }

  await sleep(6000);

  for (const row of out) {
    const rid = (cases.find((c) => c.name === row['name'])!).body.request_id;
    const job = await get(`/api/v1/print-jobs/by-request-id/${encodeURIComponent(rid)}?source_system=probe`) as Record<string, unknown>;
    row['finalStatus'] = job?.['status'];
    row['copiesPersisted'] = job?.['copies'];
    row['templateCode'] = job?.['templateCode'];
    row['errorMessage'] = job?.['errorMessage'] ?? job?.['error'];
  }

  console.log(JSON.stringify(out, null, 2));
  await app.close();
  process.exit(0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
