import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Endpoint { id: string; endpointCode: string; name: string; sourceSystem: string; authMode: string; enabled: boolean; routePolicyId: string }
interface Policy { id: string; policyCode: string; name: string }

export default function Webhooks() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [form, setForm] = useState({ endpointCode: '', name: '', sourceSystem: 'integration-service', authMode: 'NONE', routePolicyId: '' });
  const load = () => {
    void apiFetch<Endpoint[]>('/v1/webhook-endpoints').then(setEndpoints);
    void apiFetch<Policy[]>('/v1/webhook-route-policies').then(setPolicies);
  };
  useEffect(load, []);

  async function create() {
    await apiFetch('/v1/webhook-endpoints', { method: 'POST', body: JSON.stringify({ ...form, enabled: true }) });
    setForm({ ...form, endpointCode: '', name: '' });
    load();
  }

  return (
    <div>
      <h1>Webhook Endpoints</h1>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          <input placeholder="endpointCode" value={form.endpointCode} onChange={(e) => setForm({ ...form, endpointCode: e.target.value })} />
          <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input value={form.sourceSystem} onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })} />
          <select value={form.routePolicyId} onChange={(e) => setForm({ ...form, routePolicyId: e.target.value })}>
            <option value="">Route policy</option>
            {policies.map((p) => <option key={p.id} value={p.id}>{p.policyCode}</option>)}
          </select>
          <button onClick={() => void create()}>Create</button>
        </div>
      </section>
      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Endpoint', 'Source', 'Auth', 'Enabled', 'Policy'].map((h) => <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>{endpoints.map((e) => <tr key={e.id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 10 }}>{e.endpointCode}</td><td style={{ padding: 10 }}>{e.sourceSystem}</td><td style={{ padding: 10 }}>{e.authMode}</td><td style={{ padding: 10 }}>{String(e.enabled)}</td><td style={{ padding: 10 }}>{e.routePolicyId.slice(0, 8)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
