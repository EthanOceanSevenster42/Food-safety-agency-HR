// Loads the monthly management report and the performance packs.
//
//   node scripts/seed-fsa-perf.js            # only fills empty tables
//   node scripts/seed-fsa-perf.js --force    # wipe and reload
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import * as R from '../db/fsa-report-content.js';
import * as P from '../db/fsa-perf-content.js';

const force = process.argv.includes('--force');
const pool = await getPool();
const req = () => pool.request();

async function count(table) {
  const r = await pool.request().query(`SELECT COUNT(*) AS Tally FROM dbo.${table}`);
  return Number(Object.values(r.recordset[0])[0]);
}

let loaded = 0;
let skipped = 0;

async function seed(table, fill) {
  const existing = await count(table);
  if (existing > 0 && !force) {
    console.log(`  ${table.padEnd(26)} ${String(existing).padStart(4)} rows — left alone`);
    skipped++;
    return false;
  }
  if (existing > 0) await pool.request().query(`DELETE FROM dbo.${table}`);
  await fill();
  console.log(`  ${table.padEnd(26)} ${String(await count(table)).padStart(4)} rows — loaded`);
  loaded++;
  return true;
}

// ---------------------------------------------------------------------------
// Monthly management report. The child tables cascade from FsaReports, so the
// parent is cleared last-in/first-out by deleting it.
// ---------------------------------------------------------------------------
let reportId = null;

await seed('FsaReports', async () => {
  const r = await req()
    .input('period', sql.NVarChar(7), R.REPORT.period)
    .input('label', sql.NVarChar(80), R.REPORT.periodLabel)
    .input('pos', sql.NVarChar(sql.MAX), R.REPORT.positionStatement)
    .input('src', sql.NVarChar(200), R.REPORT.sourceNote)
    .input('cb', sql.NVarChar(120), R.REPORT.compiledBy)
    .input('ca', sql.Date, R.REPORT.compiledAt)
    .input('rb', sql.NVarChar(120), R.REPORT.reviewedBy)
    .input('ra', sql.Date, R.REPORT.reviewedAt)
    .input('ab', sql.NVarChar(120), R.REPORT.acceptedBy)
    .input('aa', sql.Date, R.REPORT.acceptedAt)
    .query(`INSERT INTO dbo.FsaReports
              (Period, PeriodLabel, PositionStatement, SourceNote,
               CompiledBy, CompiledAt, ReviewedBy, ReviewedAt, AcceptedBy, AcceptedAt)
            OUTPUT INSERTED.Id
            VALUES (@period, @label, @pos, @src, @cb, @ca, @rb, @ra, @ab, @aa)`);
  reportId = r.recordset[0].Id;
});

if (reportId == null) {
  const r = await pool.request()
    .input('period', sql.NVarChar(7), R.REPORT.period)
    .query('SELECT Id FROM dbo.FsaReports WHERE Period = @period');
  reportId = r.recordset[0]?.Id ?? null;
}

if (reportId != null) {
  await seed('FsaReportIndicators', async () => {
    for (let i = 0; i < R.INDICATORS.length; i++) {
      const [name, actual, target, kind, note] = R.INDICATORS[i];
      await req()
        .input('rid', sql.Int, reportId)
        .input('name', sql.NVarChar(160), name)
        .input('actual', sql.NVarChar(40), actual)
        .input('target', sql.NVarChar(40), target)
        .input('kind', sql.NVarChar(20), kind)
        .input('note', sql.NVarChar(300), note)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaReportIndicators
                  (ReportId, Name, Actual, Target, StatusKind, Note, SortOrder)
                VALUES (@rid, @name, @actual, @target, @kind, @note, @sort)`);
    }
  });

  await seed('FsaReportFindings', async () => {
    for (let i = 0; i < R.FINDINGS.length; i++) {
      const [kind, ref, title, evidence, action, owner, due] = R.FINDINGS[i];
      await req()
        .input('rid', sql.Int, reportId)
        .input('kind', sql.NVarChar(20), kind)
        .input('ref', sql.NVarChar(40), ref)
        .input('title', sql.NVarChar(255), title)
        .input('ev', sql.NVarChar(sql.MAX), evidence)
        .input('act', sql.NVarChar(sql.MAX), action)
        .input('owner', sql.NVarChar(120), owner)
        .input('due', sql.Date, due)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaReportFindings
                  (ReportId, Kind, Ref, Title, Evidence, CorrectiveAction, Owner, DueDate, SortOrder)
                VALUES (@rid, @kind, @ref, @title, @ev, @act, @owner, @due, @sort)`);
    }
  });

  await seed('FsaReportActions', async () => {
    for (let i = 0; i < R.ACTIONS.length; i++) {
      const [section, body, owner, due, state] = R.ACTIONS[i];
      await req()
        .input('rid', sql.Int, reportId)
        .input('sec', sql.NVarChar(12), section)
        .input('body', sql.NVarChar(sql.MAX), body)
        .input('owner', sql.NVarChar(120), owner)
        .input('due', sql.Date, due)
        .input('state', sql.NVarChar(20), state)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaReportActions
                  (ReportId, Section, Body, Owner, DueDate, State, SortOrder)
                VALUES (@rid, @sec, @body, @owner, @due, @state, @sort)`);
    }
  });

  await seed('FsaReportDecisions', async () => {
    for (let i = 0; i < R.DECISIONS.length; i++) {
      const [title, body] = R.DECISIONS[i];
      await req()
        .input('rid', sql.Int, reportId)
        .input('title', sql.NVarChar(255), title)
        .input('body', sql.NVarChar(sql.MAX), body)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaReportDecisions (ReportId, Title, Body, SortOrder)
                VALUES (@rid, @title, @body, @sort)`);
    }
  });
}

// ---------------------------------------------------------------------------
// Role templates, then a pack per employee built from its template.
// ---------------------------------------------------------------------------
const templateIds = new Map();

await seed('FsaRoleTemplates', async () => {
  for (let i = 0; i < P.ROLE_TEMPLATES.length; i++) {
    const [role, service, mandate, reportsTo, regType] = P.ROLE_TEMPLATES[i];
    const r = await req()
      .input('role', sql.NVarChar(160), role)
      .input('svc', sql.NVarChar(50), service)
      .input('man', sql.NVarChar(sql.MAX), mandate)
      .input('rep', sql.NVarChar(160), reportsTo)
      .input('reg', sql.NVarChar(120), regType)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaRoleTemplates (Role, Service, Mandate, ReportsTo, RegType, SortOrder)
              OUTPUT INSERTED.Id
              VALUES (@role, @svc, @man, @rep, @reg, @sort)`);
    templateIds.set(role, r.recordset[0].Id);
  }
});

// Templates may already have been present; make sure the map is populated.
if (templateIds.size === 0) {
  const r = await pool.request().query('SELECT Id, Role FROM dbo.FsaRoleTemplates');
  for (const row of r.recordset) templateIds.set(row.Role, row.Id);
}

await seed('FsaRoleTemplateItems', async () => {
  const perRole = new Map();
  for (const [role, part, area, detail, weight, target] of P.ROLE_ITEMS) {
    const key = `${role}|${part}`;
    const n = perRole.get(key) ?? 0;
    perRole.set(key, n + 1);
    const tid = templateIds.get(role);
    if (tid == null) continue;
    await req()
      .input('tid', sql.Int, tid)
      .input('part', sql.NVarChar(10), part)
      .input('area', sql.NVarChar(160), area)
      .input('detail', sql.NVarChar(sql.MAX), detail)
      .input('weight', sql.Int, weight)
      .input('target', sql.NVarChar(80), target)
      .input('sort', sql.Int, n)
      .query(`INSERT INTO dbo.FsaRoleTemplateItems (TemplateId, Part, Area, Detail, Weight, Target, SortOrder)
              VALUES (@tid, @part, @area, @detail, @weight, @target, @sort)`);
  }
});

// Packs, their KRAs and measures, and the EDP goals derived from shortfalls.
const CYCLE = 2026;

await seed('FsaPerfPacks', async () => {
  for (const [staffNo, role, stage, jd, kpi, edp] of P.PACKS) {
    const tpl = P.ROLE_TEMPLATES.find((t) => t[0] === role) || [];
    await req()
      .input('sn', sql.NVarChar(20), staffNo)
      .input('cy', sql.Int, CYCLE)
      .input('stage', sql.NVarChar(20), stage)
      .input('role', sql.NVarChar(160), role)
      .input('tid', sql.Int, templateIds.get(role) ?? null)
      .input('jd', sql.NVarChar(20), jd)
      .input('kpi', sql.NVarChar(20), kpi)
      .input('edp', sql.NVarChar(20), edp)
      .input('man', sql.NVarChar(sql.MAX), tpl[2] ?? null)
      .input('rep', sql.NVarChar(160), tpl[3] ?? null)
      .input('reg', sql.NVarChar(120), tpl[4] ?? null)
      .query(`INSERT INTO dbo.FsaPerfPacks
                (StaffNo, CycleYear, Stage, Role, TemplateId, JdState, KpiState, EdpState,
                 Mandate, ReportsTo, RegType)
              VALUES (@sn, @cy, @stage, @role, @tid, @jd, @kpi, @edp, @man, @rep, @reg)`);
  }
});

const packRows = await pool.request().query(
  'SELECT Id, StaffNo, Role FROM dbo.FsaPerfPacks WHERE CycleYear = ' + CYCLE
);
const packs = packRows.recordset;

await seed('FsaPerfKras', async () => {
  for (const pack of packs) {
    const items = P.ROLE_ITEMS.filter((i) => i[0] === pack.Role && i[1] === 'kra');
    for (let n = 0; n < items.length; n++) {
      const [, , area, detail, weight] = items[n];
      await req()
        .input('pid', sql.Int, pack.Id)
        .input('area', sql.NVarChar(160), area)
        .input('duties', sql.NVarChar(sql.MAX), detail)
        .input('weight', sql.Int, weight)
        .input('sort', sql.Int, n)
        .query(`INSERT INTO dbo.FsaPerfKras (PackId, Area, Duties, Weight, SortOrder)
                VALUES (@pid, @area, @duties, @weight, @sort)`);
    }
  }
});

await seed('FsaPerfMeasures', async () => {
  for (const pack of packs) {
    const ratings = (P.PACKS.find((p) => p[0] === pack.StaffNo) || [])[6] || null;
    const items = P.ROLE_ITEMS.filter((i) => i[0] === pack.Role && i[1] === 'measure');
    for (let n = 0; n < items.length; n++) {
      const [, , area, detail, weight, target] = items[n];
      await req()
        .input('pid', sql.Int, pack.Id)
        .input('area', sql.NVarChar(160), area)
        .input('detail', sql.NVarChar(sql.MAX), detail)
        .input('target', sql.NVarChar(80), target)
        .input('weight', sql.Int, weight)
        .input('rating', sql.Int, ratings ? (ratings[area] ?? null) : null)
        .input('sort', sql.Int, n)
        .query(`INSERT INTO dbo.FsaPerfMeasures (PackId, Area, Detail, Target, Weight, Rating, SortOrder)
                VALUES (@pid, @area, @detail, @target, @weight, @rating, @sort)`);
    }
  }
});

// The EDP is not typed in: every measure rated below "Meets" produces a goal.
await seed('FsaPerfGoals', async () => {
  const rated = await pool.request().query(
    `SELECT m.Id, m.PackId, m.Area, m.Rating
     FROM dbo.FsaPerfMeasures m
     INNER JOIN dbo.FsaPerfPacks p ON p.Id = m.PackId
     WHERE m.Rating IS NOT NULL AND m.Rating < ${P.RATING_MEETS}
     ORDER BY m.PackId, m.SortOrder`
  );
  const seen = new Map();
  for (const m of rated.recordset) {
    const n = seen.get(m.PackId) ?? 0;
    seen.set(m.PackId, n + 1);
    const [goal, provider] = P.GOAL_ROUTES[m.Area] || P.GOAL_FALLBACK;
    await req()
      .input('pid', sql.Int, m.PackId)
      .input('mid', sql.Int, m.Id)
      .input('goal', sql.NVarChar(sql.MAX), goal)
      .input('prov', sql.NVarChar(160), provider)
      .input('start', sql.Date, '2026-10-01')
      .input('end', sql.Date, '2027-02-28')
      .input('sort', sql.Int, n)
      .query(`INSERT INTO dbo.FsaPerfGoals (PackId, MeasureId, Goal, Provider, StartDate, EndDate, SortOrder)
              VALUES (@pid, @mid, @goal, @prov, @start, @end, @sort)`);
  }
});

console.log(`\n[seed:perf] ${loaded} tables loaded, ${skipped} left alone`);
if (skipped && !force) console.log('[seed:perf] pass --force to wipe and reload everything');
process.exit(0);
