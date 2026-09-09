// Loads FSA equipment into dbo.Assets, matched to the employees already in
// dbo.Employees by name.
//
//   node scripts/seed-fsa-assets.js            # only if the table is empty
//   node scripts/seed-fsa-assets.js --force    # wipe FSA-tagged rows and reload
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import { ASSETS } from '../db/fsa-assets-content.js';

const force = process.argv.includes('--force');
const pool = await getPool();

// FSA is the only company in this database; assets hang off it.
const co = await pool.request().query('SELECT Id, Name FROM dbo.Companies ORDER BY Id LIMIT 1');
if (!co.recordset[0]) {
  console.error('[seed:assets] no company found — nothing to attach assets to');
  process.exit(1);
}
const companyId = co.recordset[0].Id;

// Employees, by name, so the content file can refer to people rather than ids.
const emps = await pool
  .request()
  .input('cid', sql.Int, companyId)
  .query('SELECT Id, Name FROM dbo.Employees WHERE CompanyId = @cid');
const byName = new Map(emps.recordset.map((e) => [e.Name, e.Id]));

const existing = await pool
  .request()
  .input('cid', sql.Int, companyId)
  .query("SELECT COUNT(*) AS n FROM dbo.Assets WHERE CompanyId = @cid AND AssetTag LIKE 'FSA-%'");
const already = Number(Object.values(existing.recordset[0])[0]);

if (already > 0 && !force) {
  console.log(`[seed:assets] ${already} FSA assets already present — pass --force to reload`);
  process.exit(0);
}
if (already > 0) {
  // Only the rows this script owns, identified by their FSA asset tag.
  const del = await pool
    .request()
    .input('cid', sql.Int, companyId)
    .query("DELETE FROM dbo.Assets WHERE CompanyId = @cid AND AssetTag LIKE 'FSA-%'");
  console.log(`[seed:assets] removed ${del.rowsAffected} existing FSA assets`);
}

let inserted = 0;
const missing = new Set();

for (const row of ASSETS) {
  const [owner, category, type, name, serial, tag, date, value, dep, life, notes, repair] = row;

  let assignedId = null;
  if (owner) {
    assignedId = byName.get(owner) ?? null;
    if (assignedId == null) missing.add(owner);
  }

  const [stage, problem, supplier, bookedIn] = repair || [null, null, null, null];

  await pool
    .request()
    .input('cid', sql.Int, companyId)
    .input('category', sql.NVarChar(100), category)
    .input('type', sql.NVarChar(100), type)
    .input('name', sql.NVarChar(255), name)
    .input('serial', sql.NVarChar(100), serial)
    .input('tag', sql.NVarChar(100), tag)
    .input('date', sql.Date, date)
    .input('value', sql.Decimal(18, 2), value)
    .input('dep', sql.Decimal(9, 4), dep)
    .input('life', sql.Int, life)
    .input('notes', sql.NVarChar(sql.MAX), notes)
    .input('assigned', sql.Int, assignedId)
    .input('inRepairs', sql.Bit, repair ? 1 : 0)
    .input('stage', sql.NVarChar(50), stage)
    .input('problem', sql.NVarChar(sql.MAX), problem)
    .input('supplier', sql.NVarChar(255), supplier)
    .input('bookedIn', sql.DateTime2, bookedIn)
    .query(`INSERT INTO dbo.Assets
              (CompanyId, Category, Type, Name, SerialNumber, AssetTag,
               PurchaseDate, PurchaseValue, DepreciationPercentPerYear, UsefulLifeYears,
               Notes, AssignedEmployeeId, IsInRepairs, RepairStage, RepairProblem,
               RepairSupplier, RepairBookedInAt)
            VALUES
              (@cid, @category, @type, @name, @serial, @tag,
               @date, @value, @dep, @life,
               @notes, @assigned, @inRepairs, @stage, @problem,
               @supplier, @bookedIn)`);
  inserted++;
}

const summary = await pool
  .request()
  .input('cid', sql.Int, companyId)
  .query(`SELECT COUNT(*) AS Total,
                 COUNT(AssignedEmployeeId) AS Allocated,
                 SUM(CASE WHEN IsInRepairs = 1 THEN 1 ELSE 0 END) AS InRepairs,
                 SUM(PurchaseValue) AS Spend,
                 COUNT(DISTINCT Category) AS Categories
          FROM dbo.Assets WHERE CompanyId = @cid`);
const s = summary.recordset[0];

console.log(`[seed:assets] ${inserted} assets loaded for "${co.recordset[0].Name}"`);
console.log(`              ${s.Allocated} allocated · ${Number(s.Total) - Number(s.Allocated)} in storage · ${s.InRepairs} in repairs`);
console.log(`              ${s.Categories} categories · original spend R ${Number(s.Spend).toLocaleString('en-ZA')}`);
if (missing.size) {
  console.log(`[seed:assets] no employee matched, left in storage: ${[...missing].join(', ')}`);
}
process.exit(0);
