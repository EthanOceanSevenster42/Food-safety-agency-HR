// Creates the lancorp MySQL database, the app login (DB_USER/DB_PASSWORD
// from .env), and applies db/schema-mysql.sql. Idempotent — safe to re-run.
//
// Usage (from backend/):  node scripts/apply-mysql-schema.js
// Connects as root to provision; override with MYSQL_ROOT_USER / MYSQL_ROOT_PASSWORD.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const host = (process.env.DB_SERVER || 'localhost').split('\\')[0];
const port = Number(process.env.DB_PORT || 3306);
const appUser = process.env.DB_USER || 'lancorp';
const appPassword = process.env.DB_PASSWORD;
const database = process.env.DB_DATABASE || 'lancorp';

if (!appPassword) {
  console.error('DB_PASSWORD is not set in .env');
  process.exit(1);
}

const root = await mysql.createConnection({
  host,
  port,
  user: process.env.MYSQL_ROOT_USER || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD || '',
  multipleStatements: false,
});

await root.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
for (const h of ['localhost', '127.0.0.1']) {
  await root.query(`CREATE USER IF NOT EXISTS '${appUser}'@'${h}' IDENTIFIED BY ?`, [appPassword]);
  await root.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${appUser}'@'${h}'`);
}
await root.query('FLUSH PRIVILEGES');
console.log(`[schema] database "${database}" and user "${appUser}" ready`);

const schemaPath = path.resolve(import.meta.dirname, '..', 'db', 'schema-mysql.sql');
const raw = fs.readFileSync(schemaPath, 'utf8');
const statements = raw
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

for (const stmt of statements) {
  await root.query(stmt);
}
console.log(`[schema] applied ${statements.length} statements from db/schema-mysql.sql`);

await root.end();
