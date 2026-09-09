import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import AttentionPill from './AttentionPill.jsx';
import { api } from '../api.js';

// Read-only viewer for a single saved JD version. Renders the snapshot
// in the same field-by-section layout the editor uses, but with plain
// text instead of inputs and no save button.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function JdVersionViewModal({ processId, versionId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.getJdVersion(processId, versionId)
      .then((res) => { if (!cancelled) setSnapshot(res); })
      .catch((e)   => { if (!cancelled) setErr(e.message); })
      .finally(()  => { if (!cancelled) setLoading(false); });
  }, [processId, versionId]);

  const d = snapshot?.data || {};
  const status = d.sectionStatus || {};
  return (
    <Modal
      title={snapshot ? `Job Description — V${snapshot.version}` : 'JD version'}
      onClose={onClose}
    >
      {loading ? (
        <div className="muted">Loading…</div>
      ) : err ? (
        <div className="error">{err}</div>
      ) : snapshot ? (
        <div className="jd-version-view">
          <div className="muted small">
            Saved {formatWhen(snapshot.createdAt)}
            {snapshot.createdBy && <> by {snapshot.createdBy}</>}
          </div>

          <Section title="Role" statusValue={status.role}>
            <KV label="Title"     value={d.title} />
            <KV label="Location"  value={d.location} />
            <KV label="Working hours" value={d.hoursDescription} />
            <KV label="Hours / week"  value={d.hoursPerWeek} />
            <KV label="Work mode" value={formatWorkMode(d.workMode, d.hybridDays)} />
            <KV label="Compensation" value={d.compensation} multiline />
          </Section>

          <Section title="About the company" statusValue={status.aboutCompany}>
            <Paragraph value={d.aboutCompany} />
          </Section>

          <Section title="Job overview" statusValue={status.jobOverview}>
            <Paragraph value={d.jobOverview} />
          </Section>

          <Section title="Qualifications & skills" statusValue={status.qualifications}>
            {Array.isArray(d.qualifications) && d.qualifications.filter(Boolean).length > 0 ? (
              <ul className="jd-version-list">
                {d.qualifications.filter(Boolean).map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            ) : <span className="muted">—</span>}
          </Section>

          <Section title="Why join us?" statusValue={status.whyJoinUs}>
            <Paragraph value={d.whyJoinUs} />
          </Section>

          <Section title="How to apply" statusValue={status.howToApply}>
            <Paragraph value={d.howToApply} />
          </Section>
        </div>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function Section({ title, statusValue, children }) {
  return (
    <>
      <div className="modal-section-title jd-section-head">
        <span>{title}</span>
        <AttentionPill status={statusValue} editable={false} />
      </div>
      {children}
    </>
  );
}

function KV({ label, value, multiline }) {
  if (value == null || value === '') return null;
  return (
    <div className={'jd-version-kv' + (multiline ? ' is-multiline' : '')}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Paragraph({ value }) {
  if (!value) return <span className="muted">—</span>;
  return <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 12px' }}>{value}</p>;
}

function formatWorkMode(mode, days) {
  if (mode === 'office')  return 'Office-based';
  if (mode === 'remote')  return 'Fully remote';
  if (mode === 'hybrid') {
    const ds = Array.isArray(days) ? days : [];
    const ordered = DAY_LABELS.filter((d) => ds.includes(d));
    return ordered.length ? `Hybrid · ${ordered.join(', ')}` : 'Hybrid';
  }
  return '';
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', ' ·');
}
