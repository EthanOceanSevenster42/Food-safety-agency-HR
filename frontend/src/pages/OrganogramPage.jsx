import { useEffect, useState } from 'react';
import { api } from '../api.js';
import OrgChart from '../components/OrgChart.jsx';

// Read-only organogram available to every manager/employee. Shows a company's
// reporting structure with no editing controls (OrgChart in readOnly mode).
const noop = () => {};

export default function OrganogramPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const cos = await api.listCompanies();
        setCompanies(cos);
        if (cos[0]) setSelectedId(cos[0].id);
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setEmployees([]); return; }
    (async () => {
      try { setEmployees(await api.listEmployees(selectedId)); } catch (e) { setError(e.message); }
    })();
  }, [selectedId]);

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;
  const selected = companies.find((c) => c.id === selectedId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Organogram</h1>
          <p className="muted">Company reporting structure — who reports to whom. View only.</p>
        </div>
        {companies.length > 1 && (
          <div className="page-header-actions">
            <select value={selectedId ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} aria-label="Company">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {employees.length === 0 ? (
        <div className="empty-state">
          <p>{selected ? `No employees in ${selected.name} yet.` : 'No companies yet.'}</p>
        </div>
      ) : (
        <OrgChart employees={employees} readOnly onAddReport={noop} onEdit={noop} onDelete={noop} onMove={noop} />
      )}
    </div>
  );
}
