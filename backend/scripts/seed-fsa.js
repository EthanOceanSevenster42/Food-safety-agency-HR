// Seeds the FSA HR system with enough data to log in and click through:
// the Food Safety Agency company record, a super-admin login, and the staff /
// department structure taken from the FSA HR Portal design.
//
// Deliberately does NOT load db/seed-data.sql — that is LANCorp's real
// business data (live employee names, emails and password hashes) and has no
// place in this system.
//
// Idempotent — safe to re-run.
//
// Usage (from backend/):
//   node scripts/seed-fsa.js [adminEmail] [adminPassword]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../src/db.js';

const adminEmail = process.argv[2] || 'ethan.sevenster@moc-pty.com';
const adminPassword = process.argv[3] || 'fsa-dev-2026';

// A person's name reads better than a role in "Good morning, …" on HR home,
// so derive one from the address unless it is clearly not a person's.
const adminDisplayName = (() => {
  const local = adminEmail.split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2) return 'FSA Administrator';
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
})();

const COMPANY = {
  name: 'Food Safety Agency',
  brandColor: '#088298',
  registrationNumber: '2004/012345/07',
  coreValues: ['Integrity', 'Impartiality', 'Competence', 'Accountability', 'Professionalism'],
};

// Departments as they appear in the Red-to-Green programme.
const DEPARTMENTS = ['APS', 'IMI & Classification', 'Lab', 'Auditing', 'Vet Services', 'Training'];

// name, title, department, site (site lives in the title line for now — the
// schema has no placement column until the FSA modules land).
const STAFF = [
  ['H. Marais',    'Human Resources Manager',   'Human Resources',     null],
  ['T. Mokoena',   'Meat inspector',            'IMI & Classification', 'Cato Ridge abattoir'],
  ['A. Pretorius', 'Senior classifier',         'IMI & Classification', 'Bethlehem abattoir'],
  ['M. Sithole',   'Meat inspector',            'IMI & Classification', 'Rustenburg abattoir'],
  ['N. Dlamini',   'Laboratory technologist',   'Lab',                  'Lynnwood laboratory'],
  ['J. van Wyk',   'Product inspector',         'APS',                  'Ceres packhouse'],
  ['P. September', 'Egg grading verifier',      'APS',                  'Paarl grading station'],
  ['S. Naidoo',    'Lead auditor',              'Auditing',             'Regional — Gauteng'],
  ['Dr L. Botha',  'Veterinarian',              'Vet Services',         'Regional — Free State'],
  ['K. Mahlangu',  'Training facilitator',      'Training',             'FSA Academy, Pretoria'],
];

const emailFor = (name) =>
  name
    .toLowerCase()
    .replace(/^dr\s+/, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.') + '@foodsafetyagency.co.za';

const pool = await getPool();

// --- company --------------------------------------------------------------
await pool
  .request()
  .input('name', sql.NVarChar(255), COMPANY.name)
  .input('brand', sql.NVarChar(7), COMPANY.brandColor)
  .input('reg', sql.NVarChar(100), COMPANY.registrationNumber)
  .input('vals', sql.NVarChar(sql.MAX), JSON.stringify(COMPANY.coreValues))
  .query(`
    INSERT INTO dbo.Companies (Name, BrandColor, RegistrationNumber, CoreValuesJson)
    VALUES (@name, @brand, @reg, @vals) AS new
    ON DUPLICATE KEY UPDATE
      BrandColor         = new.BrandColor,
      RegistrationNumber = new.RegistrationNumber,
      CoreValuesJson     = new.CoreValuesJson
  `);

const companyRow = await pool
  .request()
  .input('name', sql.NVarChar(255), COMPANY.name)
  .query('SELECT Id FROM dbo.Companies WHERE Name = @name');
const companyId = companyRow.recordset[0].Id;
console.log(`[seed] company "${COMPANY.name}" -> Id ${companyId}`);

// --- staff ----------------------------------------------------------------
// The HR manager is inserted first so the rest can report to them.
let managerId = null;
let created = 0;
let skipped = 0;

for (const [name, title, department, site] of STAFF) {
  const existing = await pool
    .request()
    .input('cid', sql.Int, companyId)
    .input('name', sql.NVarChar(255), name)
    .query('SELECT Id FROM dbo.Employees WHERE CompanyId = @cid AND Name = @name');

  let id = existing.recordset[0]?.Id;
  if (id) {
    skipped++;
  } else {
    const inserted = await pool
      .request()
      .input('cid', sql.Int, companyId)
      .input('name', sql.NVarChar(255), name)
      .input('title', sql.NVarChar(255), site ? `${title} — ${site}` : title)
      .input('email', sql.NVarChar(255), emailFor(name))
      .input('dept', sql.NVarChar(255), department)
      .input('mgr', sql.Int, managerId)
      .query(`
        INSERT INTO dbo.Employees (CompanyId, Name, Title, Email, Department, ManagerId)
        OUTPUT INSERTED.Id
        VALUES (@cid, @name, @title, @email, @dept, @mgr)
      `);
    id = inserted.recordset[0].Id;
    created++;
  }
  if (managerId === null) managerId = id; // first row is the HR manager
}
console.log(`[seed] staff: ${created} created, ${skipped} already present (${STAFF.length} total)`);
console.log(`[seed] departments represented: ${DEPARTMENTS.join(', ')}`);

// --- super-admin login ----------------------------------------------------
const hash = await bcrypt.hash(adminPassword, 12);
await pool
  .request()
  .input('email', sql.NVarChar(255), adminEmail)
  .input('hash', sql.NVarChar(255), hash)
  .input('name', sql.NVarChar(255), adminDisplayName)
  .query(`
    INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, IsActive)
    VALUES (@email, @hash, @name, 'superadmin', 1) AS new
    ON DUPLICATE KEY UPDATE
      PasswordHash = new.PasswordHash,
      DisplayName  = new.DisplayName,
      Role         = 'superadmin',
      IsActive     = 1,
      UpdatedAt    = SYSUTCDATETIME()
  `);
console.log(`[seed] super-admin login: ${adminEmail} / ${adminPassword}`);

// --- settings -------------------------------------------------------------
for (const [key, value] of [
  ['RepairCoordinatorName', 'FSA Facilities'],
  ['RepairCoordinatorEmail', 'facilities@foodsafetyagency.co.za'],
]) {
  await pool
    .request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(500), value)
    .query(`
      INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (@k, @v) AS new
      ON DUPLICATE KEY UPDATE SettingValue = new.SettingValue, UpdatedAt = SYSUTCDATETIME()
    `);
}
console.log('[seed] app settings written');

process.exit(0);
