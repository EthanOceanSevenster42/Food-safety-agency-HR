import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../src/db.js';

const email = process.argv[2];
const password = process.argv[3];
const displayName = process.argv[4] ?? null;

if (!email || !password) {
  console.error('Usage: npm run seed -- <email> <password> [displayName]');
  process.exit(1);
}

const pool = await getPool();
const hash = await bcrypt.hash(password, 12);

await pool
  .request()
  .input('email', sql.NVarChar(255), email)
  .input('hash', sql.NVarChar(255), hash)
  .input('name', sql.NVarChar(255), displayName)
  .query(`
    INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, IsActive)
    VALUES (@email, @hash, @name, 'admin', 1) AS new
    ON DUPLICATE KEY UPDATE
      PasswordHash = new.PasswordHash,
      DisplayName  = new.DisplayName,
      IsActive     = 1,
      UpdatedAt    = SYSUTCDATETIME()
  `);

const result = await pool
  .request()
  .input('email', sql.NVarChar(255), email)
  .query('SELECT Id, Email, Role FROM dbo.Users WHERE Email = @email');

console.log(result.recordset[0]);
process.exit(0);
