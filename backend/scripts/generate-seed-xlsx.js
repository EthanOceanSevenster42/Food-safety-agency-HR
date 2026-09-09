// Generates backend/db/seed.xlsx — a workbook containing the rows a backend
// developer should INSERT into a fresh database after running db/schema.sql.
// Pulls values straight from the live DB so the file always matches reality.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { getPool, sql } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '..', 'db', 'seed.xlsx');

const BRAND   = 'FF2E6F81';
const BORDER  = 'FFE4E8EB';
const NOTE_BG = 'FFFAF6E6';

function styleHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

function styleDataRows(sheet, fromRow = 2) {
  for (let r = fromRow; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top:    { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        left:   { style: 'thin', color: { argb: BORDER } },
        right:  { style: 'thin', color: { argb: BORDER } },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }
}

const pool = await getPool();

const usersResult = await pool.request().query(`
  SELECT Email, PasswordHash, DisplayName, Role, IsActive
  FROM dbo.Users
  ORDER BY Id;
`);
const users = usersResult.recordset;

const settingsResult = await pool.request().query(`
  SELECT SettingKey, SettingValue FROM dbo.AppSettings ORDER BY SettingKey;
`);
const settings = settingsResult.recordset;

// Hardcoded recommended defaults if AppSettings was wiped — the dev should
// still seed the coordinator pointing at the only known user.
if (settings.length === 0 && users.length > 0) {
  const u = users[0];
  settings.push(
    { SettingKey: 'RepairCoordinatorEmail', SettingValue: u.Email.toLowerCase() },
    { SettingKey: 'RepairCoordinatorName',  SettingValue: u.DisplayName || '' },
  );
}

// ---------------- Build workbook ----------------
const wb = new ExcelJS.Workbook();
wb.creator = 'LANCorp Asset Control';
wb.created = new Date();

// README sheet
const readme = wb.addWorksheet('README', { properties: { tabColor: { argb: BRAND } } });
readme.columns = [{ width: 18 }, { width: 110 }];
const readmeRows = [
  ['LANCorp Asset Control — Seed Data', ''],
  ['', ''],
  ['Purpose',          'Initial rows the backend developer should insert into a fresh database after applying db/schema.sql.'],
  ['Schema script',    'backend/db/schema.sql — idempotent; safe to re-run. Creates all tables and column migrations.'],
  ['Wipe script',      'backend/db/wipe-demo-data.sql — clears all demo data while keeping Users + schema intact.'],
  ['',''],
  ['Sheets',           ''],
  ['  Users',          'One row per login account. PasswordHash is bcrypt(12 rounds). Insert directly into dbo.Users.'],
  ['  AppSettings',    'Optional key/value config. Insert into dbo.AppSettings — controls things like the repair coordinator address.'],
  ['',''],
  ['Re-hashing',       'If you reset a password, hash with bcryptjs at 12 rounds: bcrypt.hash(plain, 12). The existing hash in this sheet is valid for the password the user already knows.'],
  ['SMTP / Graph',     'Email transport is configured via .env (SMTP_* or GRAPH_* variables). Not seeded into the database.'],
];
for (const r of readmeRows) {
  const row = readme.addRow(r);
  if (r[0] && r[0].endsWith(':')) row.font = { bold: true };
}
const readmeTitle = readme.getRow(1);
readmeTitle.font = { bold: true, size: 14, color: { argb: BRAND } };
readme.getColumn(1).font = { bold: true };

// Users sheet
const usersSheet = wb.addWorksheet('Users', { views: [{ state: 'frozen', ySplit: 1 }] });
usersSheet.columns = [
  { header: 'Email',        key: 'email',       width: 36 },
  { header: 'PasswordHash', key: 'hash',        width: 64 },
  { header: 'DisplayName',  key: 'displayName', width: 26 },
  { header: 'Role',         key: 'role',        width: 12 },
  { header: 'IsActive',     key: 'isActive',    width: 10 },
];
styleHeaderRow(usersSheet.getRow(1));
for (const u of users) {
  usersSheet.addRow({
    email:       u.Email,
    hash:        u.PasswordHash,
    displayName: u.DisplayName ?? '',
    role:        u.Role,
    isActive:    u.IsActive ? 1 : 0,
  });
}
styleDataRows(usersSheet);
usersSheet.getColumn('hash').font = { name: 'Consolas', size: 10 };

// Settings sheet
const settingsSheet = wb.addWorksheet('AppSettings', { views: [{ state: 'frozen', ySplit: 1 }] });
settingsSheet.columns = [
  { header: 'SettingKey',   key: 'k', width: 28 },
  { header: 'SettingValue', key: 'v', width: 50 },
  { header: 'Notes',        key: 'n', width: 60 },
];
styleHeaderRow(settingsSheet.getRow(1));
const settingNotes = {
  RepairCoordinatorEmail: 'Single point-of-contact email printed on every repair docket as "Notify on updates".',
  RepairCoordinatorName:  'Display name printed alongside the coordinator email on the docket.',
};
for (const s of settings) {
  settingsSheet.addRow({ k: s.SettingKey, v: s.SettingValue, n: settingNotes[s.SettingKey] || '' });
}
styleDataRows(settingsSheet);

// Seed-SQL convenience sheet — drop-in INSERT statements
const sqlSheet = wb.addWorksheet('Seed SQL', { views: [{ state: 'frozen', ySplit: 1 }] });
sqlSheet.columns = [
  { header: '#',         key: 'n',   width: 5 },
  { header: 'Statement', key: 'sql', width: 130 },
];
styleHeaderRow(sqlSheet.getRow(1));

const sqlLines = [];
sqlLines.push('-- Run db/schema.sql first to create the tables, then run these INSERTs.');
sqlLines.push('USE lancorp;');
for (const u of users) {
  const esc = (v) => (v == null ? 'NULL' : "N'" + String(v).replace(/'/g, "''") + "'");
  sqlLines.push(
    `INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, IsActive) VALUES (` +
    `${esc(u.Email)}, ${esc(u.PasswordHash)}, ${esc(u.DisplayName)}, ${esc(u.Role)}, ${u.IsActive ? 1 : 0});`,
  );
}
for (const s of settings) {
  const esc = (v) => (v == null ? 'NULL' : "N'" + String(v).replace(/'/g, "''") + "'");
  sqlLines.push(
    `INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (${esc(s.SettingKey)}, ${esc(s.SettingValue)});`,
  );
}
sqlLines.forEach((line, i) => sqlSheet.addRow({ n: i + 1, sql: line }));
styleDataRows(sqlSheet);
sqlSheet.getColumn('sql').font = { name: 'Consolas', size: 10 };
sqlSheet.eachRow({ includeEmpty: false }, (row, idx) => {
  if (idx === 1) return;
  row.eachCell((cell) => { cell.alignment = { vertical: 'middle', wrapText: false }; });
});

await wb.xlsx.writeFile(OUT_PATH);
console.log('Seed workbook written:', OUT_PATH);
console.log('Sheets: README, Users (' + users.length + '), AppSettings (' + settings.length + '), Seed SQL');
process.exit(0);
