// Shared building blocks for the FSA HR screens, in the APS visual language.
import { useEffect, useState } from 'react';

// Status kinds used across the registers: ok | warn | bad | na | info.
export const KIND_CLASS = {
  ok: 'aps-badge--ok',
  warn: 'aps-badge--warn',
  bad: 'aps-badge--bad',
  na: 'aps-badge--na',
  info: 'aps-badge--info',
  // pipeline card kinds from the design
  g: 'aps-badge--ok',
  w: 'aps-badge--warn',
  t: 'aps-badge--info',
  n: 'aps-badge--na',
};

export const KIND_COLOR = {
  ok: '#059669',
  warn: '#b45309',
  bad: '#dc2626',
  na: '#9ca3af',
  info: '#007890',
};

// Phase colours for the Red to Green programme.
export const PHASE_COLOR = ['#727376', '#ed3237', '#b06a00', '#1f7a52'];

export function Badge({ kind = 'na', children }) {
  return <span className={`aps-badge ${KIND_CLASS[kind] || KIND_CLASS.na}`}>{children}</span>;
}

export function PageHead({ crumb, title, sub, actions }) {
  return (
    <div className="aps-page-head">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          {crumb && <div className="aps-crumb">{crumb}</div>}
          <h1 className="aps-page-title">{title}</h1>
          {sub && <p className="aps-page-sub">{sub}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}

export function Card({ title, note, children, flush = false }) {
  return (
    <section className="aps-card">
      {title && (
        <div className="aps-card-head">
          <h3>{title}</h3>
          {note && <span className="aps-card-head-note">{note}</span>}
        </div>
      )}
      <div className={flush ? 'aps-card-body--flush' : 'aps-card-body'}>{children}</div>
    </section>
  );
}

export function Stat({ value, label, note, icon = 'fas fa-chart-simple', kind = 'info' }) {
  const tint = {
    ok: 'rgba(16,185,129,0.12)',
    warn: '#fef3c7',
    bad: 'rgba(239,68,68,0.12)',
    na: '#f3f4f6',
    info: '#e0f2f5',
  }[kind];
  return (
    <div className="aps-stat">
      <div className="aps-stat-top">
        <span className="aps-stat-label">{label}</span>
        <div className="aps-stat-icon" style={{ background: tint }}>
          <i className={icon} style={{ color: KIND_COLOR[kind] }} />
        </div>
      </div>
      <div className="aps-stat-value">{value}</div>
      {note && <div className="aps-stat-note">{note}</div>}
    </div>
  );
}

export function StatRow({ stats, icons = [] }) {
  if (!stats?.length) return null;
  return (
    <div className="aps-stats">
      {stats.map((s, i) => (
        <Stat
          key={s.Label}
          value={s.Value}
          label={s.Label}
          note={s.Note}
          icon={icons[i] || 'fas fa-chart-simple'}
        />
      ))}
    </div>
  );
}

export function Bar({ pct, color = '#007890' }) {
  return (
    <span className="aps-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </span>
  );
}

export function Table({ columns, children, empty = 'Nothing to show yet.', isEmpty = false }) {
  return (
    <div className="aps-table-wrap">
      <table className="aps-table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr><td className="aps-table-empty" colSpan={columns.length}>{empty}</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
      <div
        style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '2px solid rgba(0,120,144,0.2)', borderTopColor: '#007890',
          animation: 'aps-spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes aps-spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="aps-card" style={{ padding: 20, borderLeft: '3px solid #dc2626' }}>
      <div style={{ fontWeight: 600, color: '#111827', marginBottom: 4 }}>Could not load this screen</div>
      <div className="aps-note">{String(error.message || error)}</div>
      {onRetry && (
        <button className="aps-btn aps-btn--ghost" style={{ marginTop: 12 }} onClick={onRetry}>
          <i className="fas fa-rotate-right" /> Try again
        </button>
      )}
    </div>
  );
}

// Runs a loader (an api.fsa* call) and re-fetches when `deps` change.
// Returns `reload` so a screen can refresh itself after a mutation.
export function useFsa(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.resolve()
      .then(loader)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e) => { if (live) setError(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
