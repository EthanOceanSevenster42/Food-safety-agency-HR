// Generates backend/db/seed-data.sql — a full data dump of the live database,
// as INSERT statements in FK-parent-first order. Run AFTER db/schema.sql to
// populate a fresh database with the current dataset. Pulls straight from the
// live DB, so re-run it (npm run seed:data) whenever you want to refresh.
//
// The generated script is idempotent: in one transaction it clears every target
// table (child → parent) then re-inserts (parent → child). The table order
// satisfies every FK (the only self-reference, Employees.ManagerId, resolves
// within its single multi-row INSERT), so no constraint-disabling is needed.
// Because it preserves identity values (rows reference each other by Id), it
// uses SET IDENTITY_INSERT — which needs ALTER rights — so run it as a
// privileged login, the same way db/schema.sql is applied:
//   sqlcmd -S localhost -d lancorp -E -i db/seed-data.sql

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '..', 'db', 'seed-data.sql');

// Parent → child order (so inserts satisfy FKs; deletes run in reverse).
const TABLES = [
  'Companies', 'Employees', 'Users', 'AppSettings', 'CategoryDefaults',
  'Assets', 'AssetImages',
  'RepairStageHistory', 'RepairHistory', 'RepairHistoryNotes', 'RepairHistoryStages',
  'RepairNotes', 'RepairRecipients',
  'Projects', 'ProjectProcesses',
  'JdVersions', 'KpidocVersions', 'EdpVersions', 'KpaVersions', 'SowVersions', 'SowTemplates',
  'KpiSessions', 'KpiReviews',
];

// Format one JS value (as returned by the mssql driver) as a T-SQL literal.
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex');
  if (v instanceof Date) return `'${v.toISOString().replace('Z', '')}'`;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return `N'${String(v).replace(/'/g, "''")}'`;
}

const pool = await getPool();

// Pull insertable column metadata (skip computed + rowversion columns).
async function columnsOf(table) {
  const r = await pool.request().input('t', `dbo.${table}`).query(`
    SELECT c.name AS col, c.is_identity AS isIdentity, t.name AS typeName
    FROM sys.columns c
    JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(@t) AND c.is_computed = 0
      AND t.name NOT IN ('timestamp', 'rowversion')
    ORDER BY c.column_id;
  `);
  return r.recordset;
}

const out = [];
out.push('/* ------------------------------------------------------------------');
out.push('   LANCorp seed data — generated from the live DB by');
out.push('   backend/scripts/generate-seed-data.js  (npm run seed:data)');
out.push('');
out.push('   Run AFTER db/schema.sql, as a privileged login (SET IDENTITY_INSERT');
out.push('   needs ALTER rights), the same way schema.sql is applied:');
out.push('     sqlcmd -S localhost -d lancorp -E -i db/seed-data.sql');
out.push('');
out.push('   Idempotent: clears every target table (child -> parent), then');
out.push('   re-inserts (parent -> child).');
out.push('   ------------------------------------------------------------------ */');
out.push('SET NOCOUNT ON;');
out.push('SET XACT_ABORT ON;');
out.push('BEGIN TRANSACTION;');
out.push('');

// 1. Clear existing rows, child → parent.
out.push('-- Clear existing rows (child → parent)');
for (const t of [...TABLES].reverse()) out.push(`DELETE FROM dbo.${t};`);
out.push('');

// 2. Insert, parent → child.
let grand = 0;
const summary = [];
for (const table of TABLES) {
  const cols = await columnsOf(table);
  if (cols.length === 0) continue;
  const colNames = cols.map((c) => c.col);
  const hasIdentity = cols.some((c) => c.isIdentity);
  const idCol = cols.find((c) => c.isIdentity)?.col;

  const selectList = colNames.map((c) => `[${c}]`).join(', ');
  const orderBy = idCol ? `ORDER BY [${idCol}]` : '';
  const rowsRes = await pool.request().query(`SELECT ${selectList} FROM dbo.${table} ${orderBy};`);
  const rows = rowsRes.recordset;
  summary.push(`${String(rows.length).padStart(5)}  ${table}`);
  grand += rows.length;
  if (rows.length === 0) continue;

  out.push(`-- dbo.${table} (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  if (hasIdentity) out.push(`SET IDENTITY_INSERT dbo.${table} ON;`);
  out.push(`INSERT INTO dbo.${table} (${colNames.map((c) => `[${c}]`).join(', ')}) VALUES`);
  const valueLines = rows.map((row) => '  (' + colNames.map((c) => lit(row[c])).join(', ') + ')');
  out.push(valueLines.join(',\n') + ';');
  if (hasIdentity) out.push(`SET IDENTITY_INSERT dbo.${table} OFF;`);
  out.push('');
}

out.push('COMMIT;');
out.push("PRINT 'LANCorp seed data loaded.';");
out.push('');

fs.writeFileSync(OUT_PATH, out.join('\n'), 'utf8');
console.log('Wrote', OUT_PATH);
console.log(summary.join('\n'));
console.log('------');
console.log(`${String(grand).padStart(5)}  TOTAL rows`);
process.exit(0);
