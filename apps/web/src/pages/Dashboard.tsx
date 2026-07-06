export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
        {[
          { label: 'Printers Online', value: '—' },
          { label: 'Jobs Today', value: '—' },
          { label: 'Active Runners', value: '—' },
          { label: 'Failed Jobs', value: '—' },
        ].map((card) => (
          <div key={card.label} style={{ background: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase' }}>{card.label}</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '0.5rem' }}>{card.value}</div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: '2rem', color: '#888' }}>Connect API to populate real-time stats.</p>
    </div>
  );
}
