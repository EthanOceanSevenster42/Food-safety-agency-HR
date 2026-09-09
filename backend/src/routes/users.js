import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  requireSuperAdmin, SEGMENTS, STAFF_ROLES, ACCOUNT_TYPES,
  parsePermissions, isFullAccessRow, fullAccessMap,
} from '../middleware/access.js';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin()); // Only super admins can manage users.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Only super admins skip the segment grid (implicit full access). Managers and
// employees have a base (reviews + organogram) plus whatever segments they're granted.
const NO_GRID_TYPES = new Set(['superadmin']);

// Keep only valid { segment: 'read'|'write' } entries.
function cleanPermissions(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const seg of SEGMENTS) {
      if (raw[seg] === 'read' || raw[seg] === 'write') out[seg] = raw[seg];
    }
  }
  return out;
}

function normaliseType(raw, { fallback } = {}) {
  const type = (raw ?? fallback ?? '').trim();
  if (!type) return { error: 'An account type is required' };
  if (!ACCOUNT_TYPES.has(type)) return { error: `Account type must be one of: ${[...ACCOUNT_TYPES].join(', ')}` };
  return { type };
}

// Resolve an incoming employeeId (null to unlink). Confirms the employee exists
// and isn't already linked to another user. Returns { value } | { error }.
async function resolveEmployeeLink(pool, raw, { forUserId = null } = {}) {
  if (raw === null || raw === '' || raw === undefined) return { value: null };
  const employeeId = parseInt(raw, 10);
  if (Number.isNaN(employeeId)) return { error: 'Invalid employee link' };
  const emp = await pool.request().input('eid', sql.Int, employeeId)
    .query('SELECT Id FROM dbo.Employees WHERE Id = @eid');
  if (!emp.recordset[0]) return { error: 'Linked employee not found' };
  const clash = await pool.request()
    .input('eid', sql.Int, employeeId)
    .input('uid', sql.Int, forUserId ?? -1)
    .query('SELECT Id FROM dbo.Users WHERE EmployeeId = @eid AND Id <> @uid');
  if (clash.recordset[0]) return { error: 'That employee is already linked to another user' };
  return { value: employeeId };
}

const SELECT_COLS = `
  u.Id, u.Email, u.DisplayName, u.Role, u.Permissions, u.IsActive, u.EmployeeId,
  e.Name AS EmployeeName, u.CreatedAt, u.UpdatedAt`;

function mapUser(u) {
  const full = isFullAccessRow(u);
  return {
    id: u.Id,
    email: u.Email,
    displayName: u.DisplayName,
    accountType: full ? 'superadmin' : u.Role,
    permissions: full ? fullAccessMap() : parsePermissions(u.Permissions),
    isActive: !!u.IsActive,
    employeeId: u.EmployeeId ?? null,
    employeeName: u.EmployeeName ?? null,
    createdAt: u.CreatedAt,
    updatedAt: u.UpdatedAt,
  };
}

async function fetchUser(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT ${SELECT_COLS} FROM dbo.Users u
    LEFT JOIN dbo.Employees e ON e.Id = u.EmployeeId WHERE u.Id = @id;`);
  return r.recordset[0] ? mapUser(r.recordset[0]) : null;
}

router.get('/', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ${SELECT_COLS}
      FROM dbo.Users u
      LEFT JOIN dbo.Employees e ON e.Id = u.EmployeeId
      ORDER BY u.Email;
    `);
    res.json(result.recordset.map(mapUser));
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { email, displayName, password, accountType, permissions, employeeId } = req.body ?? {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const typeCheck = normaliseType(accountType, { fallback: 'employee' });
  if (typeCheck.error) return res.status(400).json({ error: typeCheck.error });
  const perms = NO_GRID_TYPES.has(typeCheck.type) ? null : cleanPermissions(permissions);

  try {
    const pool = await getPool();
    const dup = await pool.request().input('email', sql.NVarChar(255), email)
      .query('SELECT Id FROM dbo.Users WHERE Email = @email');
    if (dup.recordset[0]) return res.status(409).json({ error: 'A user with that email already exists' });

    const link = await resolveEmployeeLink(pool, employeeId);
    if (link.error) return res.status(400).json({ error: link.error });

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool
      .request()
      .input('email', sql.NVarChar(255), email)
      .input('hash', sql.NVarChar(255), hash)
      .input('display', sql.NVarChar(255), displayName?.trim() || null)
      .input('role', sql.NVarChar(50), typeCheck.type)
      .input('perms', sql.NVarChar(sql.MAX), perms ? JSON.stringify(perms) : null)
      .input('employeeId', sql.Int, link.value)
      .query(`
        INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, Permissions, IsActive, EmployeeId)
        OUTPUT INSERTED.Id
        VALUES (@email, @hash, @display, @role, @perms, 1, @employeeId);
      `);
    res.status(201).json(await fetchUser(pool, inserted.recordset[0].Id));
  } catch (err) {
    console.error('[users/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update display name, account type, permissions, password, active flag, employee
// link (any subset). Email is immutable for now.
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { displayName, accountType, permissions, password, isActive, employeeId } = req.body ?? {};
  const isSelf = id === req.user?.sub;

  try {
    const pool = await getPool();
    const reqQ = pool.request().input('id', sql.Int, id);
    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];

    let nextType;
    if (accountType !== undefined) {
      const typeCheck = normaliseType(accountType);
      if (typeCheck.error) return res.status(400).json({ error: typeCheck.error });
      nextType = typeCheck.type;
      // A super admin editing themselves must stay a super admin — otherwise
      // they'd lock themselves out of the Users page.
      if (isSelf && nextType !== 'superadmin') {
        return res.status(400).json({ error: 'You cannot change your own account away from Super admin.' });
      }
      reqQ.input('role', sql.NVarChar(50), nextType);
      setParts.push('Role = @role');
    }
    // Rewrite the permission map when supplied or the type changes. Super admins
    // store NULL (full access); managers/employees store their segment grid.
    if (permissions !== undefined || nextType !== undefined) {
      const noGrid = nextType !== undefined && NO_GRID_TYPES.has(nextType);
      const perms = noGrid ? null : cleanPermissions(permissions ?? {});
      reqQ.input('perms', sql.NVarChar(sql.MAX), perms ? JSON.stringify(perms) : null);
      setParts.push('Permissions = @perms');
    }
    if (displayName !== undefined) {
      reqQ.input('display', sql.NVarChar(255), displayName?.trim() || null);
      setParts.push('DisplayName = @display');
    }
    if (isActive !== undefined) {
      if (isSelf && !isActive) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      reqQ.input('active', sql.Bit, isActive ? 1 : 0);
      setParts.push('IsActive = @active');
    }
    if (employeeId !== undefined) {
      const link = await resolveEmployeeLink(pool, employeeId, { forUserId: id });
      if (link.error) return res.status(400).json({ error: link.error });
      reqQ.input('employeeId', sql.Int, link.value);
      setParts.push('EmployeeId = @employeeId');
    }
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const hash = await bcrypt.hash(password, 10);
      reqQ.input('hash', sql.NVarChar(255), hash);
      setParts.push('PasswordHash = @hash');
    }

    const upd = await reqQ.query(`
      UPDATE dbo.Users SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id WHERE Id = @id;`);
    if (!upd.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json(await fetchUser(pool, id));
  } catch (err) {
    console.error('[users/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user?.sub) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.Users WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
