import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Binding { id: string; printerCode: string; templateCode: string; paperProfileId: string; isDefault: boolean; enabled: boolean }

export default function PrinterBindings() {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [form, setForm] = useState({ printerCode: 'LAB_LABEL_01', templateCode: 'LAB_LABEL_DEFAULT', paperProfileId: '', isDefault: true });
  const load = () => apiFetch<Binding[]>('/v1/printer-template-bindings').then(setBindings).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function create() {
    await apiFetch('/v1/printer-template-bindings', { method: 'POST', body: JSON.stringify({ ...form, enabled: true }) });
    load();
  }

  return (
    <div>
      <h1>Printer Binding</h1>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {(['printerCode', 'templateCode', 'paperProfileId'] as const).map((key) => <input key={key} placeholder={key} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />)}
          <label><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Default</label>
          <button onClick={() => void create()}>Bind</button>
        </div>
      </section>
      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Printer', 'Template', 'Paper', 'Default', 'Enabled'].map((h) => <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>{bindings.map((b) => <tr key={b.id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 10 }}>{b.printerCode}</td><td style={{ padding: 10 }}>{b.templateCode}</td><td style={{ padding: 10 }}>{b.paperProfileId.slice(0, 8)}</td><td style={{ padding: 10 }}>{String(b.isDefault)}</td><td style={{ padding: 10 }}>{String(b.enabled)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
