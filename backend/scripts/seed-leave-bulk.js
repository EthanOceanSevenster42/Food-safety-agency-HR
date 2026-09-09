// Generates a realistic volume of leave requests so the leave queue can be
// exercised at the scale the agency actually runs at (~5 000 employees), and
// tops the site-coverage register up to match.
//
// The three requests from the design canvas are left in place — this only adds
// generated rows, marked with a StaffNo in the FSA-9xxxx range so they are easy
// to tell apart and to remove again.
//
// Usage (from backend/):
//   node scripts/seed-leave-bulk.js            # 5000 requests
//   node scripts/seed-leave-bulk.js 20000      # a heavier run
//   node scripts/seed-leave-bulk.js --clear    # remove generated rows only
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import { LEAVE_TYPES } from '../db/fsa-hr-content.js';

const args = process.argv.slice(2);
const clearOnly = args.includes('--clear');
const count = Number(args.find((a) => /^\d+$/.test(a)) || 5000);

// Generated rows are tagged by their staff number so they can be removed
// without touching the canvas rows.
const GEN_PREFIX = 'FSA-9';

const SURNAMES = [
  'Mokoena', 'Pretorius', 'Dlamini', 'van Wyk', 'Naidoo', 'Sithole', 'Botha',
  'Mahlangu', 'September', 'Nkosi', 'du Plessis', 'Khumalo', 'Adams', 'Mthembu',
  'Pillay', 'Wessels', 'Mabaso', 'Jacobs', 'Nel', 'Streicher', 'Visagie', 'Smit',
  'Maluleke', 'Coetzee', 'Ndlovu', 'Fourie', 'Zulu', 'Meyer', 'Molefe', 'Steyn',
  'Ngcobo', 'Venter', 'Mashaba', 'Kruger', 'Sibanda', 'Joubert', 'Radebe',
  'Erasmus', 'Tshabalala', 'Bezuidenhout',
];
const INITIALS = 'ABCDEFGHJKLMNPRSTVWZ'.split('');

const SERVICES = [
  ['IMI', ['Meat inspector', 'Senior classifier', 'Classifier', 'Assistant manager']],
  ['APS', ['Product inspector', 'Egg grading verifier', 'Compositional inspector']],
  ['Lab', ['Laboratory technologist', 'Laboratory assistant', 'Analyst']],
  ['Auditing', ['Lead auditor', 'Auditor', 'Audit technician']],
  ['Vet', ['Veterinarian', 'Veterinary technician']],
  ['Training', ['Training facilitator', 'Assessor']],
];

// ~40 placements, so filtering by site is a real filter rather than a token one.
const SITES = [
  ['Cato Ridge abattoir', 'IMI'], ['Bethlehem abattoir', 'IMI'],
  ['Rustenburg abattoir', 'IMI'], ['Brits abattoir', 'IMI'],
  ['Krugersdorp abattoir', 'IMI'], ['Vryburg abattoir', 'IMI'],
  ['Estcourt abattoir', 'IMI'], ['Bloemfontein abattoir', 'IMI'],
  ['Kokstad abattoir', 'IMI'], ['Standerton abattoir', 'IMI'],
  ['Mossel Bay abattoir', 'IMI'], ['Ladysmith abattoir', 'IMI'],
  ['Ceres packhouse', 'APS'], ['Paarl grading station', 'APS'],
  ['Grabouw packhouse', 'APS'], ['Citrusdal packhouse', 'APS'],
  ['Tzaneen packhouse', 'APS'], ['Hoedspruit packhouse', 'APS'],
  ['Nelspruit packhouse', 'APS'], ['Musina packhouse', 'APS'],
  ['Wellington egg packhouse', 'APS'], ['Delmas egg packhouse', 'APS'],
  ['Lynnwood laboratory', 'Lab'], ['Stellenbosch laboratory', 'Lab'],
  ['Pietermaritzburg laboratory', 'Lab'], ['Port Elizabeth laboratory', 'Lab'],
  ['Regional — Gauteng', 'Auditing'], ['Regional — Western Cape', 'Auditing'],
  ['Regional — KwaZulu-Natal', 'Auditing'], ['Regional — Free State', 'Vet'],
  ['Regional — Limpopo', 'Vet'], ['Regional — Mpumalanga', 'Vet'],
  ['Regional — North West', 'Vet'], ['Regional — Eastern Cape', 'Auditing'],
  ['Regional — Northern Cape', 'Vet'],
  ['FSA Academy, Pretoria', 'Training'], ['FSA Academy, Cape Town', 'Training'],
  ['Head office, Pretoria', 'Training'],
];

// A deterministic generator: the same run produces the same data, so a slow
// query can be investigated against the rows that produced it.
let seed = 20260909;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const dayWord = (n) => `${n % 1 === 0 ? n : n.toFixed(1)} ${n === 1 ? 'day' : 'days'}`;

const IMPACT = {
  ok: (site) => `No effect on coverage — ${site} stays fully staffed for the period.`,
  warn: (site) => `${site} runs one short for part of the period. Cover is available from the regional pool.`,
  bad: (site) => `${site} drops below its minimum for at least one operating day. Relief cover must be arranged before this is approved.`,
};

const pool = await getPool();

// --- clear generated rows -------------------------------------------------
const cleared = await pool
  .request()
  .input('prefix', sql.NVarChar(20), `${GEN_PREFIX}%`)
  .query('DELETE FROM dbo.FsaLeaveRequests WHERE StaffNo LIKE @prefix');
console.log(`[bulk] removed ${cleared.rowsAffected[0] ?? 0} previously generated rows`);

if (clearOnly) {
  console.log('[bulk] --clear only, nothing generated');
  process.exit(0);
}

// --- top the coverage register up to every site ---------------------------
let coverageAdded = 0;
for (let i = 0; i < SITES.length; i++) {
  const [site] = SITES[i];
  const exists = await pool
    .request()
    .input('site', sql.NVarChar(255), site)
    .query('SELECT Id FROM dbo.FsaSiteCoverage WHERE Site = @site');
  if (exists.recordset[0]) continue;

  // Mostly covered, a handful under pressure — enough for the filter to matter.
  const roll = rnd();
  const kind = roll > 0.86 ? 'bad' : roll > 0.70 ? 'warn' : 'ok';
  const pct = kind === 'bad' ? between(40, 65) : kind === 'warn' ? between(70, 85) : 100;
  const badge = kind === 'bad' ? 'At risk' : kind === 'warn' ? 'Watch' : 'Covered';
  const staffed = between(2, 8);
  const onShift = kind === 'ok' ? staffed : Math.max(1, Math.round((staffed * pct) / 100));

  await pool
    .request()
    .input('site', sql.NVarChar(255), site)
    .input('pct', sql.Int, pct)
    .input('badge', sql.NVarChar(50), badge)
    .input('kind', sql.NVarChar(10), kind)
    .input('detail', sql.NVarChar(255), `${onShift} of ${staffed} on shift`)
    .input('sort', sql.Int, 100 + i)
    .query(`INSERT INTO dbo.FsaSiteCoverage (Site, Pct, Badge, Kind, Detail, SortOrder)
            VALUES (@site, @pct, @badge, @kind, @detail, @sort)`);
  coverageAdded++;
}
console.log(`[bulk] site coverage: ${coverageAdded} added (${SITES.length} sites known)`);

// --- generate the requests ------------------------------------------------
// Multi-row INSERTs: one statement per batch rather than one per row, which is
// the difference between seconds and minutes at this volume.
const BATCH = 200;
const today = new Date('2026-09-09T00:00:00Z');
const started = Date.now();
let written = 0;

for (let offset = 0; offset < count; offset += BATCH) {
  const rows = Math.min(BATCH, count - offset);
  const request = pool.request();
  const tuples = [];

  for (let i = 0; i < rows; i++) {
    const n = offset + i;
    const [service, roles] = pick(SERVICES);
    const siteChoices = SITES.filter(([, s]) => s === service);
    const [site] = siteChoices.length ? pick(siteChoices) : pick(SITES);
    const name = `${pick(INITIALS)}. ${pick(SURNAMES)}`;
    const days = pick([1, 1, 2, 3, 3, 5, 5, 8, 10, 12, 15]);
    // A window either side of today so "upcoming" and "past" both have rows.
    const start = addDays(today, between(-45, 90));
    const end = addDays(start, days - 1);
    const balanceDays = Math.round((between(0, 25) + rnd()) * 10) / 10;

    const roll = rnd();
    const coverageKind = roll > 0.88 ? 'bad' : roll > 0.66 ? 'warn' : 'ok';
    // Most of the queue is still to be decided; the rest gives the filters and
    // the "decided" tabs something to show.
    const sRoll = rnd();
    const status = sRoll > 0.45 ? 'pending' : sRoll > 0.15 ? 'approved' : 'declined';

    const p = (k, type, v) => { request.input(`${k}${n}`, type, v); return `@${k}${n}`; };
    tuples.push(
      '(' + [
        p('sn', sql.NVarChar(20), `${GEN_PREFIX}${String(10000 + n).slice(-4)}${n > 9999 ? n : ''}`),
        p('nm', sql.NVarChar(255), name),
        p('ro', sql.NVarChar(255), pick(roles)),
        p('sv', sql.NVarChar(50), service),
        p('si', sql.NVarChar(255), site),
        p('lt', sql.NVarChar(100), pick(LEAVE_TYPES)),
        p('sd', sql.Date, iso(start)),
        p('ed', sql.Date, iso(end)),
        p('dy', sql.Decimal(4, 1), days),
        p('bd', sql.Decimal(5, 1), balanceDays),
        p('ds', sql.NVarChar(100), `${iso(start)} → ${iso(end)}`),
        p('ba', sql.NVarChar(50), dayWord(balanceDays)),
        p('ck', sql.NVarChar(10), coverageKind),
        p('im', sql.NVarChar(sql.MAX), IMPACT[coverageKind](site)),
        p('st', sql.NVarChar(20), status),
        p('so', sql.Int, 1000 + n),
      ].join(', ') + ')'
    );
  }

  await request.query(`
    INSERT INTO dbo.FsaLeaveRequests
      (StaffNo, Name, Role, Service, Site, LeaveType, StartDate, EndDate,
       Days, BalanceDays, Dates, BalanceAfter, CoverageKind, Impact, Status, SortOrder)
    VALUES ${tuples.join(', ')}
  `);
  written += rows;
  if (written % 1000 === 0) console.log(`[bulk] ${written} / ${count}`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);

const totals = await pool.request().query(`
  SELECT Status, COUNT(*) AS RowTally FROM dbo.FsaLeaveRequests GROUP BY Status ORDER BY Status
`);
const grand = await pool.request().query('SELECT COUNT(*) AS RowTally FROM dbo.FsaLeaveRequests');

console.log(`\n[bulk] wrote ${written} requests in ${secs}s`);
console.log(`[bulk] table now holds ${grand.recordset[0].RowTally} rows:`);
for (const r of totals.recordset) console.log(`         ${r.Status.padEnd(9)} ${r.RowTally}`);
console.log('[bulk] remove them again with: node scripts/seed-leave-bulk.js --clear');

process.exit(0);
