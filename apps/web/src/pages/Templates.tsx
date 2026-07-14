import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';

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
  const { t } = useLocale();
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
      <h1>{t('page.templates.title')}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.templates.createTemplate')}</h2>
          {(['templateCode', 'name', 'paperProfileId'] as const).map((key) => (
            <input key={key} placeholder={key} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8 }} />
          ))}
          <select value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} style={{ width: '100%', marginBottom: 8, padding: 8 }}>
            {['RAW_TEXT', 'ZPL', 'TSPL', 'HTML', 'JSON_LAYOUT'].map((e) => <option key={e}>{e}</option>)}
          </select>
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={7} style={{ width: '100%', marginBottom: 8, padding: 8 }} />
          <button onClick={() => void create()}>{t('common.create')}</button>
        </section>

        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>{t('page.templates.preview')}</h2>
          <div dangerouslySetInnerHTML={{ __html: preview || `<p>${t('page.templates.selectPreview')}</p>` }} />
        </section>
      </div>

      <div style={{ marginTop: '1rem', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{[t('page.templates.code'), t('page.templates.name'), t('page.templates.engine'), t('page.templates.version'), t('page.templates.status'), t('page.templates.actions')].map((h) => <th key={h} style={{ padding: 10, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {templates.map((tpl) => (
              <tr key={tpl.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 10, fontFamily: 'monospace' }}>{tpl.templateCode}</td>
                <td style={{ padding: 10 }}>{tpl.name}</td>
                <td style={{ padding: 10 }}>{tpl.engine}</td>
                <td style={{ padding: 10 }}>{tpl.version}</td>
                <td style={{ padding: 10 }}>{tpl.status}</td>
                <td style={{ padding: 10 }}>
                  <button onClick={() => void render(tpl.id)}>{t('common.preview')}</button>{' '}
                  <button onClick={() => void publish(tpl.id)}>{t('common.publish')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
