import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface PaperProfile {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
}

export default function PaperProfiles() {
  const [profiles, setProfiles] = useState<PaperProfile[]>([]);
  const [form, setForm] = useState({ code: '', name: '', widthMm: 100, heightMm: 50, dpi: 203 });
  const load = () => apiFetch<PaperProfile[]>('/v1/paper-profiles').then(setProfiles).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function create() {
    await apiFetch('/v1/paper-profiles', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        marginTopMm: 2,
        marginRightMm: 2,
        marginBottomMm: 2,
        marginLeftMm: 2,
        orientation: 'portrait',
        unit: 'mm',
      }),
    });
    setForm({ ...form, code: '', name: '' });
    load();
  }

  return (
    <div>
      <h1>Paper Profiles</h1>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Create Paper / Label Size</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          <input placeholder="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input type="number" value={form.widthMm} onChange={(e) => setForm({ ...form, widthMm: Number(e.target.value) })} />
          <input type="number" value={form.heightMm} onChange={(e) => setForm({ ...form, heightMm: Number(e.target.value) })} />
          <button onClick={() => void create()}>Create</button>
        </div>
      </section>
      <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Code', 'Name', 'Size', 'DPI'].map((h) => <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 10, fontFamily: 'monospace' }}>{p.code}</td>
                <td style={{ padding: 10 }}>{p.name}</td>
                <td style={{ padding: 10 }}>{p.widthMm} x {p.heightMm} mm</td>
                <td style={{ padding: 10 }}>{p.dpi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
