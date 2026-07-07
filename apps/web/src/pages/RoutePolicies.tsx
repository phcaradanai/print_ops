import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Policy { id: string; policyCode: string; name: string; enabled: boolean }

const DEFAULT_POLICY = `{
  "policyCode": "lab-label-static-2",
  "name": "Lab Label Static",
  "matchRules": { "when": [{ "field": "type", "op": "eq", "value": "lab_label" }] },
  "printerMapping": { "strategy": "static", "printer_code": "LAB_LABEL_01" },
  "templateMapping": { "strategy": "static", "template_code": "LAB_LABEL_DEFAULT" },
  "payloadMapping": { "barcode": "$.barcode", "label": "$.label", "hn_masked": "$.hn" },
  "priorityMapping": { "strategy": "static", "priority": "normal" },
  "enabled": true
}`;

export default function RoutePolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [raw, setRaw] = useState(DEFAULT_POLICY);
  const load = () => apiFetch<Policy[]>('/v1/webhook-route-policies').then(setPolicies).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function create() {
    await apiFetch('/v1/webhook-route-policies', { method: 'POST', body: raw });
    load();
  }

  return (
    <div>
      <h1>Route Policies</h1>
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Policy JSON</h2>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace' }} />
          <button onClick={() => void create()}>Create Policy</button>
        </div>
        <div style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Policies</h2>
          {policies.map((p) => <p key={p.id}><code>{p.policyCode}</code> {p.name} {p.enabled ? 'enabled' : 'disabled'}</p>)}
        </div>
      </section>
    </div>
  );
}
