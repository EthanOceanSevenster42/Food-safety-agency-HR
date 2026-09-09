// Per-segment access control for the FSA HR API.
//
// Account types (Users.Role):
//   'superadmin'          — full access to every segment AND the only accounts
//                           that can reach the Users page. Permissions = NULL.
//                           May still be linked to an employee (org placement).
//   'manager' | 'employee' — base capability is their own/team KPI reviews plus a
//                           read-only organogram (handled in routes/kpi.js by
//                           ownership checks, and by companies being world-
//                           readable below). ON TOP of that base they may be
//                           granted any of the segments below, stored in
//                           Users.Permissions.
//
// A segment grant is 'read' (safe GET/HEAD only) or 'write' (full CRUD). Absent =
// no access. Permissions resolve from the DB on EVERY request, so changes take
// effect immediately (no re-login).

import { getPool, sql } from '../db.js';

// The grantable per-tab segments, grouped (for the UI) by the page they live in.
export const SEGMENTS = [
  'asset_analytics', 'asset_allocated', 'asset_all', 'asset_repairs', // Asset Control
  'procurement',                                                      // Procurement
  'hr_kpi', 'hr_projects', 'hr_analysis',                            // Human Resources
  'companies',                                                        // Companies (cross-cutting)
];
export const LEVELS = ['read', 'write'];

export const STAFF_ROLES = new Set(['manager', 'employee']);
export const ACCOUNT_TYPES = new Set(['superadmin', 'manager', 'employee']);

const rank = (lvl) => (lvl === 'write' ? 2 : lvl === 'read' ? 1 : 0);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const FULL_ACCESS = Object.fromEntries(SEGMENTS.map((s) => [s, 'write']));
export function fullAccessMap() { return { ...FULL_ACCESS }; }

// Rows that get full access (incl. Users): explicit super admins, plus pre-RBAC
// 'admin'/'user' rows with no stored permission map (so they aren't locked out).
export function isFullAccessRow(row) {
  return row.Role === 'superadmin'
    || ((row.Role === 'admin' || row.Role === 'user') && !row.Permissions);
}

// Parse stored permissions JSON into a clean { segment: 'read'|'write' } map.
export function parsePermissions(raw) {
  if (!raw) return {};
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return {}; } }
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const s of SEGMENTS) if (obj[s] === 'read' || obj[s] === 'write') out[s] = obj[s];
  }
  return out;
}

// Highest level held across a set of segments.
export function maxLevel(perms, segs) {
  let best = 'none';
  for (const s of segs) if (rank(perms[s]) > rank(best)) best = perms[s] || 'none';
  return best;
}

async function loadAccess(req) {
  if (req._access) return req._access;
  const pool = await getPool();
  const r = await pool.request().input('id', sql.Int, req.user?.sub)
    .query('SELECT Role, Permissions, IsActive FROM dbo.Users WHERE Id = @id');
  const row = r.recordset[0];
  let ctx;
  if (!row || !row.IsActive) {
    ctx = { role: row?.Role ?? null, active: false, full: false, perms: {} };
  } else {
    const full = isFullAccessRow(row);
    ctx = { role: row.Role, active: true, full, perms: full ? { ...FULL_ACCESS } : parsePermissions(row.Permissions) };
  }
  req._access = ctx;
  return ctx;
}

function enforce(level, method, res, next) {
  if (level === 'none') return res.status(403).json({ error: 'You do not have access to this area.' });
  if (level === 'read' && !READ_METHODS.has(method)) {
    return res.status(403).json({ error: 'You have view-only access to this area.' });
  }
  return next();
}

// Require access to ANY of the given segments (level = the highest held).
export function requireSegments(...segs) {
  return async (req, res, next) => {
    try {
      const ctx = await loadAccess(req);
      if (!ctx.active) return res.status(403).json({ error: 'Your account is inactive.' });
      if (ctx.full) return next();
      return enforce(maxLevel(ctx.perms, segs), req.method, res, next);
    } catch (err) {
      console.error('[access] requireSegments', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Companies are world-readable (needed for the organogram every account can
// see); editing company records needs the 'companies' segment at write.
export function requireCompanies() {
  return async (req, res, next) => {
    try {
      const ctx = await loadAccess(req);
      if (!ctx.active) return res.status(403).json({ error: 'Your account is inactive.' });
      if (ctx.full || READ_METHODS.has(req.method)) return next();
      if (ctx.perms.companies === 'write') return next();
      return res.status(403).json({ error: 'You have view-only access to companies.' });
    } catch (err) {
      console.error('[access] requireCompanies', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Super-admin-only (the Users page).
export function requireSuperAdmin() {
  return async (req, res, next) => {
    try {
      const ctx = await loadAccess(req);
      if (ctx.active && ctx.full) return next();
      return res.status(403).json({ error: 'Only super admins can do this.' });
    } catch (err) {
      console.error('[access] requireSuperAdmin', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Can the caller manage/oversee the KPI tracker (create reviews for anyone,
// sessions, act on any review)? = write on the KPI Tracker segment (or full).
export async function hasKpiManage(req) {
  const ctx = await loadAccess(req);
  if (!ctx.active) return false;
  return ctx.full || ctx.perms.hr_kpi === 'write';
}
