import { useParams } from 'react-router-dom';

export default function PrinterDetail() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h1>Printer Detail</h1>
      <p style={{ color: '#888' }}>Printer ID: <code>{id}</code></p>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
        <button style={{ background: '#89b4fa', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>Get Status</button>
        <button style={{ background: '#a6e3a1', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>Test Print</button>
      </div>
      <p style={{ marginTop: '2rem', color: '#888' }}>Status, capabilities, and job history will appear here.</p>
    </div>
  );
}
