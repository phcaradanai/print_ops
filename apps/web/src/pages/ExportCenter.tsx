export default function ExportCenter() {
  return (
    <div>
      <h1>Export Center</h1>
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
        <a href="/api/exports/jobs.csv" style={{ background: '#a6e3a1', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', textDecoration: 'none', color: '#000' }}>
          Download Jobs CSV
        </a>
        <a href="/api/exports/jobs.json" style={{ background: '#89b4fa', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', textDecoration: 'none', color: '#000' }}>
          Download Jobs JSON
        </a>
      </div>
    </div>
  );
}
