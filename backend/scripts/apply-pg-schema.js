// Creates the PostgreSQL database and the app login (DB_USER/DB_PASSWORD from
// .env), then applies db/schema-postgres.sql. Idempotent — safe to re-run.
//
// Usage (from backend/):  node scripts/apply-pg-schema.js
// Provisioning connects as a superuser; override with
// PG_SUPER_USER / PG_SUPER_PASSWORD (defaults: postgres / postgres).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const host = (process.env.DB_SERVER || 'localhost').split('\\')[0];
const port = Number(process.env.DB_PORT || 5432);
const appUser = process.env.DB_USER || 'fsa_hr';
const appPassword = process.env.DB_PASSWORD;
const database = process.env.DB_DATABASE || 'fsa_hr';

if (!appPassword) {
  console.error('DB_PASSWORD is not set in .env');
  process.exit(1);
}

const superUser = process.env.PG_SUPER_USER || 'postgres';
const superPassword = process.env.PG_SUPER_PASSWORD || 'postgres';

// --- provision role + database (connect to the always-present 'postgres' db)
const admin = new pg.Client({
  host,
  port,
  user: superUser,
  password: superPassword,
  database: 'postgres',
});
await admin.connect();

// Neither identifiers nor CREATE/ALTER ROLE passwords can be bind parameters,
// so both are escaped into the statement text.
const roleIdent = `"${appUser.replace(/"/g, '""')}"`;
const passwordLiteral = admin.escapeLiteral(appPassword);

const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
if (roleExists.rowCount === 0) {
  await admin.query(`CREATE ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
  console.log(`[schema] role "${appUser}" created`);
} else {
  await admin.query(`ALTER ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
  console.log(`[schema] role "${appUser}" already existed — password synced with .env`);
}

const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
if (dbExists.rowCount === 0) {
  await admin.query(`CREATE DATABASE "${database}" OWNER ${roleIdent} ENCODING 'UTF8'`);
  console.log(`[schema] database "${database}" created`);
} else {
  console.log(`[schema] database "${database}" already exists`);
}

await admin.end();

// --- apply the schema as the app user (it owns the database) --------------
const app = new pg.Client({
  host,
  port,
  user: appUser,
  password: appPassword,
  database,
});
await app.connect();

// schema-postgres.sql holds the tables inherited from the asset/KPI side;
// schema-fsa-hr.sql adds the FSA HR module. Both are idempotent.
for (const file of ['schema-postgres.sql', 'schema-fsa-hr.sql']) {
  const schemaPath = path.resolve(import.meta.dirname, '..', 'db', file);
  if (!fs.existsSync(schemaPath)) {
    console.warn(`[schema] skipping missing db/${file}`);
    continue;
  }
  // No bind parameters, so each file can go over as one simple query —
  // Postgres runs the whole script in a single implicit transaction.
  await app.query(fs.readFileSync(schemaPath, 'utf8'));
  console.log(`[schema] applied db/${file}`);
}

const tables = await app.query(
  "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
);
console.log(`[schema] ${tables.rows[0].n} tables present`);

await app.end();
