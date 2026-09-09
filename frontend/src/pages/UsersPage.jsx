import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { isSuperAdmin, SEGMENT_GROUPS, SEGMENTS } from '../roles.js';
import Modal from '../components/Modal.jsx';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import { confirmDialog } from '../confirm.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const LEVEL_OPTS = [
  { value: 'none',  label: 'None' },
  { value: 'read',  label: 'View' },
  { value: 'write', label: 'Edit' },
];

const ACCOUNT_TYPES = [
  { value: 'superadmin', label: 'Super admin', hint: 'Everything, including managing users.' },
  { value: 'manager',    label: 'Manager',     hint: 'Own and team KPI reviews, plus the organogram.' },
  { value: 'employee',   label: 'Employee',    hint: 'Own KPI reviews and the organogram.' },
];
const typeLabel = (t) => ACCOUNT_TYPES.find((a) => a.value === t)?.label || t;
const NO_GRID = new Set(['superadmin']);
// Flat segment label lookup for the access chips.
const SEG_LABEL = Object.fromEntries(SEGMENT_GROUPS.flatMap((g) => g.segments.map((s) => [s.key, s.label])));

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

// Compact chips summarising a manager/employee's granted segments.
function AccessChips({ user }) {
  if (user.accountType === 'superadmin') return <span className="seg-chip seg-write">Everything</span>;
  const granted = SEGMENTS.filter((s) => user.permissions?.[s] === 'read' || user.permissions?.[s] === 'write');
  if (granted.length === 0) return <span className="muted small">Reviews only</span>;
  return (
    <span className="seg-chip-row">
      {granted.map((s) => (
        <span key={s} className={'seg-chip seg-' + user.permissions[s]} title={user.permissions[s] === 'write' ? 'Edit' : 'View'}>
          {SEG_LABEL[s]}{user.permissions[s] === 'write' ? ' ✎' : ''}
        </span>
      ))}
    </span>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const me = auth.getUser();
  const canManage = isSuperAdmin(me); // only super admins reach this page

  async function load() {
    setLoading(true);
    setError('');
    try { setUsers(await api.listUsers()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleDelete(u) {
    if (u.id === me?.id) { setError('You cannot delete your own account.'); return; }
    if (!(await confirmDialog({
      title: `Delete "${u.email}"?`,
      body: 'They will no longer be able to sign in.',
      tone: 'danger',
      confirmLabel: 'Delete user',
    }))) return;
    try { await api.deleteUser(u.id); await load(); } catch (e) { setError(e.message); }
  }
  async function handleToggleActive(u) {
    try { await api.updateUser(u.id, { isActive: !u.isActive }); await load(); } catch (e) { setError(e.message); }
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;

  return (
    <div className="page users-page">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">People who can sign in, their account type, and the pages/features they can use.</p>
        </div>
      </header>

      {canManage && (
        <div className="page-toolbar">
          <button className="btn-primary" onClick={() => setModal({ mode: 'create' })}>+ Add user</button>
        </div>
      )}

      {!canManage && <ReadOnlyBanner label="Users" />}
      {error && <div className="error">{error}</div>}

      {users.length === 0 ? (
        <div className="empty-state"><p>No users yet.</p></div>
      ) : (
        <div className="analytics-card analytics-card-flush">
          <table className="analytics-table users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th>Access (extra pages &amp; features)</th>
                <th>Person</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'is-inactive'}>
                  <td>
                    <div className="strong">
                      {u.displayName || <span className="muted">—</span>}
                      {u.id === me?.id && <span className="muted small"> (you)</span>}
                    </div>
                  </td>
                  <td className="mono">{u.email}</td>
                  <td><span className={'role-tag role-' + u.accountType}>{typeLabel(u.accountType)}</span></td>
                  <td className="access-cell"><AccessChips user={u} /></td>
                  <td>{u.employeeName || <span className="muted">—</span>}</td>
                  <td>
                    <span className={'pill ' + (u.isActive ? 'pill-success' : 'pill-muted')}>
                      {u.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="row-actions">
                      <button className="btn-ghost" onClick={() => setModal({ mode: 'edit', user: u })}>Edit</button>
                      <button className="btn-ghost" onClick={() => handleToggleActive(u)} disabled={u.id === me?.id}>
                        {u.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn-ghost danger" onClick={() => handleDelete(u)} disabled={u.id === me?.id}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.user}
          isSelf={modal.user?.id === me?.id}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await load(); }}
        />
      )}
    </div>
  );
}

// Sentinel for the Linked person field: create a new employee record instead
// of picking one that already exists.
const NEW_PERSON = '__new__';

function UserModal({ mode, user, isSelf, onClose, onSaved }) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState(user?.accountType ?? 'employee');
  const [permissions, setPermissions] = useState(() => {
    const base = {};
    for (const s of SEGMENTS) base[s] = user?.permissions?.[s] || 'none';
    return base;
  });
  const [employeeId, setEmployeeId] = useState(user?.employeeId ? String(user.employeeId) : '');
  // NEW_PERSON in the Linked person field opens an inline form that creates the
  // employee record and links this account to it in one save. Employees used to
  // be addable only from the org chart, so there was no way to bring a new
  // person into the system from here at all.
  const [newPerson, setNewPerson] = useState({ companyId: '', name: '', title: '', department: '', managerId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [companies, setCompanies] = useState([]);
  const [empLoading, setEmpLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cos = await api.listCompanies();
        const groups = await Promise.all(
          cos.map((c) => api.listEmployees(c.id)
            .then((es) => ({ id: c.id, name: c.name, employees: es }))
            .catch(() => ({ id: c.id, name: c.name, employees: [] })))
        );
        if (alive) {
          setCompanies(groups);
          // Default the new-person form to the only company, when there is one.
          if (groups.length === 1) {
            setNewPerson((p) => ({ ...p, companyId: String(groups[0].id) }));
          }
        }
      } catch { /* leave empty */ } finally {
        if (alive) setEmpLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const showGrid = !NO_GRID.has(accountType);
  const setLevel = (key, value) => setPermissions((prev) => ({ ...prev, [key]: value }));
  const typeOptions = isSelf && user?.accountType === 'superadmin'
    ? ACCOUNT_TYPES.filter((a) => a.value === 'superadmin')
    : ACCOUNT_TYPES;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (mode === 'create' && !EMAIL_RE.test(email.trim())) { setErr('Enter a valid email address'); return; }
    if (mode === 'create' && password.length < 6) { setErr('Password must be at least 6 characters'); return; }
    if (mode === 'edit' && password && password.length < 6) { setErr('New password must be at least 6 characters'); return; }
    const creatingPerson = employeeId === NEW_PERSON;
    if (creatingPerson) {
      if (!newPerson.name.trim()) { setErr('Enter the new person’s name'); return; }
      if (!newPerson.companyId) { setErr('Choose which company the new person belongs to'); return; }
    }
    let employeeIdValue = creatingPerson ? null : (employeeId ? parseInt(employeeId, 10) : null);
    const permPayload = {};
    for (const s of SEGMENTS) if (permissions[s] !== 'none') permPayload[s] = permissions[s];

    setBusy(true);
    try {
      // The person has to exist before the account can point at them.
      if (creatingPerson) {
        const created = await api.createEmployee({
          companyId: parseInt(newPerson.companyId, 10),
          name: newPerson.name.trim(),
          title: newPerson.title.trim() || null,
          department: newPerson.department.trim() || null,
          email: (mode === 'create' ? email : user?.email || '').trim() || null,
          managerId: newPerson.managerId ? parseInt(newPerson.managerId, 10) : null,
        });
        employeeIdValue = created.id;
      }
      const common = { accountType, permissions: permPayload, employeeId: employeeIdValue };
      if (mode === 'create') {
        await api.createUser({ email: email.trim(), displayName: displayName.trim() || null, password, ...common });
      } else {
        const payload = { displayName: displayName.trim() || null, ...common };
        if (password) payload.password = password;
        await api.updateUser(user.id, payload);
      }
      onSaved();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  const accountHint = ACCOUNT_TYPES.find((a) => a.value === accountType)?.hint;

  return (
    <Modal
      title={mode === 'edit' ? 'Edit user' : 'Add user'}
      onClose={onClose}
      cardClassName="modal-form-2col"
    >
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        <div className="user-form-grid">
          <div>
            <div className="user-form-col-title">Account</div>

        <div className="field">
          <label htmlFor="u-email">Email <span className="req">required</span></label>
          <input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required disabled={mode === 'edit'} autoFocus={mode === 'create'} />
          {mode === 'edit' && <small className="muted">Email cannot be changed.</small>}
        </div>

        <div className="field">
          <label htmlFor="u-name">Display name</label>
          <input id="u-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Thandi Mokoena" />
        </div>

        <div className="field">
          <label htmlFor="u-type">Account type</label>
          <select id="u-type" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {typeOptions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          {accountHint && <small className="muted">{accountHint}</small>}
        </div>

        <div className="field">
          <label htmlFor="u-emp">Linked person {accountType === 'superadmin' ? '(optional)' : ''}</label>
          <select id="u-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={empLoading}>
            <option value="">{empLoading ? 'Loading people…' : '— Not linked —'}</option>
            {!empLoading && <option value={NEW_PERSON}>＋ Add a new person…</option>}
            {companies.filter((g) => g.employees.length > 0).map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </optgroup>
            ))}
          </select>
          {employeeId !== NEW_PERSON && (
            <small className="muted">
              {accountType === 'superadmin'
                ? 'Optional — places them in the org chart.'
                : 'Links their KPI reviews and their place in the org chart.'}
            </small>
          )}
        </div>


        <div className="field">
          <label htmlFor="u-pass">
            {mode === 'edit' ? 'New password' : 'Password'}
            {mode === 'create' && <span className="req">required</span>}
          </label>
          <input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'edit' ? 'Leave blank to keep current' : 'Minimum 6 characters'}
            required={mode === 'create'} autoComplete="new-password" />
        </div>

          </div>

          <div>
            <div className="user-form-col-title">What they can open</div>
        {showGrid ? (
          <div className="field">
            <small className="muted" style={{ marginBottom: 8, display: 'block' }}>
              Everyone gets their own KPI reviews and the organogram. Add pages here —
              <strong> View</strong> to read, <strong>Edit</strong> to change.
            </small>
            <div className="perm-groups">
              {SEGMENT_GROUPS.map((g) => (
                <div className="perm-group" key={g.page}>
                  <div className="perm-group-title">{g.label}</div>
                  {g.segments.map((s) => (
                    <div className="perm-row" key={s.key} title={s.hint || undefined}>
                      <div className="perm-row-label">
                        <span className="perm-row-name">{s.label}</span>
                      </div>
                      <div className="seg" role="group" aria-label={`${s.label} access`}>
                        {LEVEL_OPTS.map((opt) => (
                          <button type="button" key={opt.value}
                            className={'seg-btn' + (permissions[s.key] === opt.value ? ' is-active' : '')}
                            onClick={() => setLevel(s.key, opt.value)}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

          </div>
        ) : (
          <div className="field">
            <div className="perm-note">Super admins have full access to every page and are the only accounts that can manage users.</div>
          </div>
        )}

          </div>

        {/* Creating the person here rather than sending the user to the org
            chart and back. Saving creates the employee record and links this
            account to it in one go. */}
        {employeeId === NEW_PERSON && (
          <div className="new-person-block">
            <div className="new-person-head">New person</div>

            {/* Its own grid. Reusing .user-form-grid here nested the modal's
                272px/1fr outer split inside the 272px column, which squeezed
                the inputs down to a few pixels. */}
            <div className="new-person-grid">
              <div className="field">
                <label htmlFor="np-name">Full name <span className="req">required</span></label>
                <input
                  id="np-name"
                  value={newPerson.name}
                  autoFocus
                  onChange={(e) => setNewPerson((v) => ({ ...v, name: e.target.value }))}
                  placeholder="e.g. Thandi Mokoena"
                />
              </div>

              <div className="field">
                <label htmlFor="np-title">Job title</label>
                <input
                  id="np-title"
                  value={newPerson.title}
                  onChange={(e) => setNewPerson((v) => ({ ...v, title: e.target.value }))}
                  placeholder="e.g. Meat inspector"
                />
              </div>

              <div className="field">
                <label htmlFor="np-dept">Department</label>
                <input
                  id="np-dept"
                  value={newPerson.department}
                  onChange={(e) => setNewPerson((v) => ({ ...v, department: e.target.value }))}
                  placeholder="e.g. IMI &amp; Classification"
                />
              </div>

              <div className="field">
                <label htmlFor="np-co">Company <span className="req">required</span></label>
                <select
                  id="np-co"
                  value={newPerson.companyId}
                  onChange={(e) => setNewPerson((v) => ({ ...v, companyId: e.target.value, managerId: '' }))}
                >
                  <option value="">— Choose —</option>
                  {companies.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="field">
                <label htmlFor="np-mgr">Reports to</label>
                <select
                  id="np-mgr"
                  value={newPerson.managerId}
                  onChange={(e) => setNewPerson((v) => ({ ...v, managerId: e.target.value }))}
                  disabled={!newPerson.companyId}
                >
                  <option value="">— No manager —</option>
                  {(companies.find((g) => String(g.id) === String(newPerson.companyId))?.employees || [])
                    .map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.title ? ` · ${emp.title}` : ''}</option>)}
                </select>
              </div>
            </div>

            <small className="muted">
              This creates the person on the company and links this account to them, so their
              KPI reviews and their place in the org chart both follow.
            </small>
          </div>
        )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add user'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
