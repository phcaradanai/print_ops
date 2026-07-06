import { useEffect, useState } from 'react';

interface Printer {
  id: string;
  name: string;
  protocol: string;
  connectionUri: string;
}

export default function Printers() {
  const [printers, setPrinters] = useState<Printer[]>([]);

  useEffect(() => {
    fetch('/api/printers', { headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((data: Printer[]) => setPrinters(data))
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Printers</h1>
        <button style={{ background: '#89b4fa', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}>
          + Add Printer
        </button>
      </div>
      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Protocol</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>URI</th>
            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {printers.length === 0 && (
            <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No printers yet</td></tr>
          )}
          {printers.map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
              <td style={{ padding: '0.75rem' }}>{p.name}</td>
              <td style={{ padding: '0.75rem' }}>{p.protocol}</td>
              <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.connectionUri}</td>
              <td style={{ padding: '0.75rem' }}><a href={`/printers/${p.id}`}>View</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
