// Creates (or resets) super-admin accounts, printing each password once.
//
// scripts/seed.js creates role 'admin'; this one creates 'superadmin', which is
// the only role that can manage users. Permissions is left NULL — a superadmin
// has full access and the per-page grid does not apply to them.
//
//   node scripts/seed-superadmins.js "Name <email>" "Name <email>" ...
//
// Passwords are generated here and shown once. Re-running for an address that
// already exists resets that account's password and re-enables it.
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../src/db.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/seed-superadmins.js "Full Name <email@example.com>" ...');
  process.exit(1);
}

// Ambiguous characters left out so these can be read off a screen and typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function newPassword(len = 16) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// "Full Name <email>" generates a password. A password may be given after the
// address instead, so the same credentials can be set on more than one
// environment rather than issuing a person two sets.
const people = args.map((raw) => {
  const m = raw.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*(.*)$/);
  if (!m) {
    console.error(`Could not read "${raw}" — expected: "Full Name <email@example.com> [password]"`);
    process.exit(1);
  }
  const given = m[3].trim();
  if (given && given.length < 6) {
    console.error(`Password for ${m[2]} is too short — 6 characters minimum`);
    process.exit(1);
  }
  return { name: m[1], email: m[2].toLowerCase(), given: given || null };
});

const pool = await getPool();
const created = [];

for (const p of people) {
  const password = p.given || newPassword();
  const hash = await bcrypt.hash(password, 12);

  const existing = await pool
    .request()
    .input('email', sql.NVarChar(255), p.email)
    .query('SELECT Id, Role FROM dbo.Users WHERE Email = @email');
  const already = existing.recordset[0];

  if (already) {
    await pool
      .request()
      .input('email', sql.NVarChar(255), p.email)
      .input('hash', sql.NVarChar(255), hash)
      .input('name', sql.NVarChar(255), p.name)
      .query(`UPDATE dbo.Users
              SET PasswordHash = @hash,
                  DisplayName  = @name,
                  Role         = 'superadmin',
                  Permissions  = NULL,
                  IsActive     = 1,
                  UpdatedAt    = SYSUTCDATETIME()
              WHERE Email = @email`);
  } else {
    await pool
      .request()
      .input('email', sql.NVarChar(255), p.email)
      .input('hash', sql.NVarChar(255), hash)
      .input('name', sql.NVarChar(255), p.name)
      .query(`INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, Permissions, IsActive)
              VALUES (@email, @hash, @name, 'superadmin', NULL, 1)`);
  }

  created.push({
    ...p,
    password,
    action: `${already ? `reset (was ${already.Role})` : 'created'}${p.given ? ', password as given' : ''}`,
  });
}

const width = Math.max(...created.map((c) => c.email.length));
console.log('');
console.log('  Super-admin accounts — copy these now, they are not stored anywhere:');
console.log('');
for (const c of created) {
  console.log(`    ${c.email.padEnd(width)}   ${c.password}    (${c.action})`);
}
console.log('');
console.log('  Each should change their password after signing in.');

const all = await pool
  .request()
  .query("SELECT Email, DisplayName, Role, IsActive FROM dbo.Users WHERE Role = 'superadmin' ORDER BY Email");
console.log(`\n  Super admins on this system now: ${all.recordset.length}`);
for (const u of all.recordset) {
  console.log(`    ${u.Email}  ·  ${u.DisplayName || '(no name)'}${u.IsActive ? '' : '  [disabled]'}`);
}
process.exit(0);
