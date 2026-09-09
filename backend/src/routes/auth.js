import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { parsePermissions, isFullAccessRow, fullAccessMap } from '../middleware/access.js';

// Shape the client-facing user object. Super admins (and legacy admin/user rows
// with no stored permission map) are surfaced with full access — including the
// Users page. Managers/employees carry their granted segment map on top of their
// built-in reviews + organogram base.
function publicUser(row) {
  const full = isFullAccessRow(row);
  return {
    id: row.Id,
    email: row.Email,
    displayName: row.DisplayName,
    role: full ? 'superadmin' : row.Role,
    permissions: full ? fullAccessMap() : parsePermissions(row.Permissions),
  };
}

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('email', sql.NVarChar(255), email)
      .query(
        'SELECT Id, Email, PasswordHash, DisplayName, Role, Permissions, IsActive FROM dbo.Users WHERE Email = @email'
      );

    const user = result.recordset[0];
    if (!user || !user.IsActive) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { sub: user.Id, email: user.Email, role: user.Role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, req.user.sub)
      .query(
        'SELECT Id, Email, DisplayName, Role, Permissions FROM dbo.Users WHERE Id = @id AND IsActive = 1'
      );
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/invite/:token — validate a set-password link and return
// who it's for (so the set-password page can greet them). Public.
router.get('/invite/:token', async (req, res) => {
  const token = req.params.token || '';
  try {
    const pool = await getPool();
    const r = await pool.request().input('t', sql.NVarChar(64), token).query(`
      SELECT Email, DisplayName FROM dbo.Users
      WHERE InviteToken = @t AND (InviteExpires IS NULL OR InviteExpires > SYSUTCDATETIME())
    `);
    const u = r.recordset[0];
    if (!u) return res.status(404).json({ error: 'This link is invalid or has expired.' });
    res.json({ email: u.Email, displayName: u.DisplayName });
  } catch (err) {
    console.error('[auth/invite]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/set-password { token, password } — consume a one-time
// invite token, set the password, and sign the user in. Public.
router.post('/set-password', async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('t', sql.NVarChar(64), token).query(`
      SELECT Id, Email, DisplayName, Role, Permissions FROM dbo.Users
      WHERE InviteToken = @t AND (InviteExpires IS NULL OR InviteExpires > SYSUTCDATETIME())
    `);
    const u = r.recordset[0];
    if (!u) return res.status(400).json({ error: 'This link is invalid or has expired.' });

    const hash = await bcrypt.hash(String(password), 10);
    await pool.request()
      .input('id', sql.Int, u.Id)
      .input('ph', sql.NVarChar(255), hash)
      .query(`UPDATE dbo.Users
              SET PasswordHash = @ph, InviteToken = NULL, InviteExpires = NULL,
                  IsActive = 1, UpdatedAt = SYSUTCDATETIME()
              WHERE Id = @id`);

    const jwtToken = jwt.sign(
      { sub: u.Id, email: u.Email, role: u.Role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({ token: jwtToken, user: publicUser(u) });
  } catch (err) {
    console.error('[auth/set-password]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
