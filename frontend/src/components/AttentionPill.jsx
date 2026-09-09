// Shared two-state "needs attention" toggle used by every template
// editor across the system (SOW, JD, …). One click flips the flag on
// or off; in read-only contexts the pill is only shown when the flag
// is set, with no interactive surface.
//
// Backwards-compatible with the legacy SOW shape: a stored value of
// 'attention' or 'needs-attention' both count as flagged on read. New
// saves always write 'needs-attention' so the value is unified across
// document kinds going forward. Any other value (including the older
// SOW 'standard' marker) is treated as not flagged.

const FLAGGED_VALUE = 'needs-attention';

export function isFlagged(status) {
  return status === 'attention' || status === 'needs-attention';
}

export default function AttentionPill({ status, editable = true, onChange }) {
  const flagged = isFlagged(status);

  if (!editable) {
    if (!flagged) return null;
    return (
      <span
        className="attention-pill is-on attention-pill-readonly"
        title="This section needs review for this role."
      >
        ⚠ Needs attention
      </span>
    );
  }

  return (
    <button
      type="button"
      className={'attention-pill' + (flagged ? ' is-on' : '')}
      aria-pressed={flagged}
      onClick={() => onChange?.(flagged ? null : FLAGGED_VALUE)}
      title={flagged
        ? 'Flagged for attention. Click to clear.'
        : 'Mark this section as needing attention. Authors filling out a task built from this template will see the warning.'}
    >
      {flagged ? '⚠ Needs attention' : 'Flag for attention'}
    </button>
  );
}
