import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Template {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  version: number;
  content: string;
  paperProfileId?: string;
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ templateCode: '', name: '', engine: 'RAW_TEXT', content: 'TEST {{label}}\\n{{barcode}}', paperProfileId: '' });
  const [preview, setPreview] = useState<string>('');

  const load = () => apiFetch<Template[]>('/v1/templates').then(setTemplates).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function create() {
    await apiFetch('/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ ...form, paperProfileId: form.paperProfileId || undefined }),
    });
    setForm({ ...form, templateCode: '', name: '' });
    load();
  }

  async function publish(id: string) {
    await apiFetch(`/v1/templates/${id}/publish`, { method: 'POST' });
    load();
  }

  async function render(id: string) {
    const res = await apiFetch<{ renderedPreview: string }>(`/v1/templates/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ samplePayload: { label: 'Test Label', barcode: 'ABC123', hn_masked: 'HN***' } }),
    });
    setPreview(res.renderedPreview);
  }

  return (
    <div>
      <h1>Templates</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Create Template</h2>
          {(['templateCode', 'name', 'paperProfileId'] as const).map((key) => (
            <input key={key} placeholder={key} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8 }} />
          ))}
          <select value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8 }}>
            {['RAW_TEXT', 'ZPL', 'TSPL', 'HTML', 'JSON_LAYOUT'].map((e) => <option key={e}>{e}</option>)}
          </select>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={7} style={{ width: '100%', marginBottom: 8, padding: 8 }} />
          <button onClick={() => void create()}>Create</button>
        </section>

        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Preview</h2>
          <div dangerouslySetInnerHTML={{ __html: preview || '<p>Select Preview on a template.</p>' }} />
        </section>
      </div>

      <div style={{ marginTop: '1rem', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Code', 'Name', 'Engine', 'Version', 'Status', 'Actions'].map((h) => <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 10, fontFamily: 'monospace' }}>{t.templateCode}</td>
                <td style={{ padding: 10 }}>{t.name}</td>
                <td style={{ padding: 10 }}>{t.engine}</td>
                <td style={{ padding: 10 }}>{t.version}</td>
                <td style={{ padding: 10 }}>{t.status}</td>
                <td style={{ padding: 10 }}>
                  <button onClick={() => void render(t.id)}>Preview</button>{' '}
                  <button onClick={() => void publish(t.id)}>Publish</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
