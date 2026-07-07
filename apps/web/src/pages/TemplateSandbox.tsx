import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';

interface Template { id: string; templateCode: string; name: string }
interface Paper { id: string; code: string; name: string; widthMm: number; heightMm: number }
interface Preview { renderedPreview: string; renderedPrintPayload: string; warnings: string[]; renderTimeMs: number }

export default function TemplateSandbox() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [paperProfileId, setPaperProfileId] = useState('');
  const [payload, setPayload] = useState('{"label":"Test Label","barcode":"ABC123","hn_masked":"HN***"}');
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    void Promise.all([
      apiFetch<Template[]>('/v1/sandbox/templates').then(setTemplates),
      apiFetch<Paper[]>('/v1/paper-profiles').then(setPapers),
    ]);
  }, []);

  async function render() {
    setPreview(await apiFetch<Preview>('/v1/sandbox/render-preview', {
      method: 'POST',
      body: JSON.stringify({ templateId, paperProfileId, samplePayload: JSON.parse(payload) as Record<string, unknown> }),
    }));
  }

  async function testPrint() {
    await apiFetch('/v1/sandbox/test-print', { method: 'POST', body: JSON.stringify({ templateId, paperProfileId }) });
  }

  return (
    <div>
      <h1>Template Preview Sandbox</h1>
      <p style={{ color: '#666' }}>Visible to Sysadmin/Owner only. Generated print payload is shown here for inspection.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1rem' }}>
        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <label>Template</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
            <option value="">Select template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.templateCode}</option>)}
          </select>
          <label>Paper</label>
          <select value={paperProfileId} onChange={(e) => setPaperProfileId(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
            <option value="">Template default</option>
            {papers.map((p) => <option key={p.id} value={p.id}>{p.code} ({p.widthMm}x{p.heightMm})</option>)}
          </select>
          <label>Sample Payload</label>
          <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={9} style={{ width: '100%', fontFamily: 'monospace' }} />
          <button onClick={() => void render()} style={{ marginTop: 8 }}>Render Preview</button>{' '}
          <button onClick={() => void testPrint()} style={{ marginTop: 8 }}>Send Test Print</button>
        </section>
        <section style={{ background: '#fff', padding: '1rem', borderRadius: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Preview</h2>
          {preview && (
            <>
              <div dangerouslySetInnerHTML={{ __html: preview.renderedPreview }} />
              <p>Render: {preview.renderTimeMs}ms</p>
              {preview.warnings.length > 0 && <pre>{preview.warnings.join('\n')}</pre>}
              <h3 style={{ fontSize: '0.9rem' }}>Generated Print Payload</h3>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{preview.renderedPrintPayload}</pre>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
