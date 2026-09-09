// Loads the FSA HR module content (db/fsa-hr-content.js) into Postgres.
//
// Non-destructive by default: a table that already holds rows is left alone,
// so leave decisions, checklist sign-offs, template toggles and pipeline moves
// survive a re-run. Pass --force to wipe and reload every content table.
//
// Usage (from backend/):
//   node scripts/seed-fsa-hr.js [--force]
import 'dotenv/config';
import { getPool, sql } from '../src/db.js';
import * as C from '../db/fsa-hr-content.js';

const force = process.argv.includes('--force');
const pool = await getPool();

let loaded = 0;
let skipped = 0;

async function count(table) {
  const r = await pool.request().query(`SELECT COUNT(*) AS RowTally FROM dbo.${table}`);
  // Read positionally: a count must never come back NaN and silently defeat
  // the "already populated" guard below.
  const row = r.recordset[0] || {};
  return Number(row.RowTally ?? Object.values(row)[0] ?? 0);
}

// Runs `fill` only when the table is empty (or --force was passed).
async function seed(table, fill) {
  const existing = await count(table);
  if (existing > 0 && !force) {
    console.log(`  ${table.padEnd(24)} ${String(existing).padStart(4)} rows — left alone`);
    skipped++;
    return;
  }
  if (existing > 0) await pool.request().query(`DELETE FROM dbo.${table}`);
  await fill();
  const now = await count(table);
  console.log(`  ${table.padEnd(24)} ${String(now).padStart(4)} rows — loaded`);
  loaded++;
}

const req = () => pool.request();

// --- directory & site placements -----------------------------------------
await seed('FsaStaff', async () => {
  for (let i = 0; i < C.STAFF.length; i++) {
    const [no, name, role, service, site, reg, kind, contract] = C.STAFF[i];
    // The expiry is embedded in the display text ("Valid to 2027-04-30"), so
    // lift it into its own column instead of re-parsing it on every render.
    const expiry = (reg.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
    await req()
      .input('no', sql.NVarChar(20), no)
      .input('name', sql.NVarChar(255), name)
      .input('role', sql.NVarChar(255), role)
      .input('service', sql.NVarChar(50), service)
      .input('site', sql.NVarChar(255), site)
      .input('reg', sql.NVarChar(100), reg)
      .input('kind', sql.NVarChar(10), kind)
      .input('contract', sql.NVarChar(50), contract)
      .input('expiry', sql.Date, expiry)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaStaff
                (StaffNo, Name, Role, Service, Site, Registration, RegKind, Contract, RegExpiry, SortOrder)
              VALUES (@no, @name, @role, @service, @site, @reg, @kind, @contract, @expiry, @sort)`);
  }
});

// --- competence matrix ----------------------------------------------------
await seed('FsaCompetence', async () => {
  for (let i = 0; i < C.COMPETENCE.length; i++) {
    const [name, site, dal, ante, cls, haccp, med] = C.COMPETENCE[i];
    await req()
      .input('name', sql.NVarChar(255), name)
      .input('site', sql.NVarChar(255), site)
      .input('dt', sql.NVarChar(50), dal[0]).input('dk', sql.NVarChar(10), dal[1])
      .input('at', sql.NVarChar(50), ante[0]).input('ak', sql.NVarChar(10), ante[1])
      .input('ct', sql.NVarChar(50), cls[0]).input('ck', sql.NVarChar(10), cls[1])
      .input('ht', sql.NVarChar(50), haccp[0]).input('hk', sql.NVarChar(10), haccp[1])
      .input('mt', sql.NVarChar(50), med[0]).input('mk', sql.NVarChar(10), med[1])
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaCompetence
                (Name, Site, DalrrdText, DalrrdKind, AntePostText, AntePostKind,
                 ClassificationText, ClassificationKind, HaccpText, HaccpKind,
                 MedicalText, MedicalKind, SortOrder)
              VALUES (@name, @site, @dt, @dk, @at, @ak, @ct, @ck, @ht, @hk, @mt, @mk, @sort)`);
  }
});

// --- role requisitions ----------------------------------------------------
await seed('FsaRequisitions', async () => {
  for (const [ref, role, dept, site, contract, posts, by, start, reason, stage, packs] of C.REQUISITIONS) {
    await req()
      .input('ref', sql.NVarChar(20), ref)
      .input('role', sql.NVarChar(255), role)
      .input('dept', sql.NVarChar(100), dept)
      .input('site', sql.NVarChar(255), site)
      .input('contract', sql.NVarChar(50), contract)
      .input('posts', sql.NVarChar(10), posts)
      .input('by', sql.NVarChar(255), by)
      .input('start', sql.NVarChar(50), start)
      .input('reason', sql.NVarChar(255), reason)
      .input('stage', sql.Int, stage)
      .input('ijd', sql.Bit, packs[0] ? 1 : 0)
      .input('kpi', sql.Bit, packs[1] ? 1 : 0)
      .input('edp', sql.Bit, packs[2] ? 1 : 0)
      .query(`INSERT INTO dbo.FsaRequisitions
                (Ref, Role, Dept, Site, Contract, Posts, RequestedBy, TargetStart,
                 Reason, Stage, PackIjd, PackKpi, PackEdp)
              VALUES (@ref, @role, @dept, @site, @contract, @posts, @by, @start,
                      @reason, @stage, @ijd, @kpi, @edp)`);
  }
});

// --- recruitment pipeline -------------------------------------------------
await seed('FsaCandidates', async () => {
  for (let i = 0; i < C.CANDIDATES.length; i++) {
    const [ref, role, site, tag, kind, stage] = C.CANDIDATES[i];
    await req()
      .input('ref', sql.NVarChar(20), ref)
      .input('role', sql.NVarChar(255), role)
      .input('site', sql.NVarChar(255), site)
      .input('tag', sql.NVarChar(100), tag)
      .input('kind', sql.NVarChar(10), kind)
      .input('stage', sql.Int, stage)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaCandidates (Ref, Role, Site, Tag, TagKind, Stage, SortOrder)
              VALUES (@ref, @role, @site, @tag, @kind, @stage, @sort)`);
  }
});

// --- Red to Green programmes + notes -------------------------------------
await seed('FsaProgrammes', async () => {
  for (let i = 0; i < C.PROGRAMMES.length; i++) {
    const [code, name, role, dept, site, start, mentor, phase, day, p, status, kind, gate] =
      C.PROGRAMMES[i];
    const inserted = await req()
      .input('code', sql.NVarChar(20), code)
      .input('name', sql.NVarChar(255), name)
      .input('role', sql.NVarChar(255), role)
      .input('dept', sql.NVarChar(100), dept)
      .input('site', sql.NVarChar(255), site)
      .input('start', sql.Date, start)
      .input('mentor', sql.NVarChar(255), mentor)
      .input('phase', sql.Int, phase)
      .input('day', sql.NVarChar(50), day)
      .input('p1', sql.Int, p[0]).input('p2', sql.Int, p[1]).input('p3', sql.Int, p[2])
      .input('status', sql.NVarChar(50), status)
      .input('kind', sql.NVarChar(10), kind)
      .input('gate', sql.NVarChar(100), gate)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaProgrammes
                (Code, Name, Role, Dept, Site, StartDate, Mentor, Phase, DayLabel,
                 P1, P2, P3, Status, StatusKind, Gate, SortOrder)
              OUTPUT INSERTED.Id
              VALUES (@code, @name, @role, @dept, @site, @start, @mentor, @phase, @day,
                      @p1, @p2, @p3, @status, @kind, @gate, @sort)`);

    const notes = C.PROGRAMME_NOTES[code] || [];
    for (const [date, author, body] of notes) {
      await req()
        .input('pid', sql.Int, inserted.recordset[0].Id)
        .input('date', sql.Date, date)
        .input('author', sql.NVarChar(255), author)
        .input('body', sql.NVarChar(sql.MAX), body)
        .query(`INSERT INTO dbo.FsaProgrammeNotes (ProgrammeId, NoteDate, Author, Body)
                VALUES (@pid, @date, @author, @body)`);
    }
  }
});

// --- department method templates -----------------------------------------
// The group method is stored once under Dept '*'; each department's own
// activities are stored against its own name.
await seed('FsaTemplateActivities', async () => {
  let sort = 0;
  for (const phase of [0, 1, 2, 3]) {
    for (const [week, body, owner] of C.MASTER[phase]) {
      await req()
        .input('dept', sql.NVarChar(100), '*')
        .input('phase', sql.Int, phase)
        .input('week', sql.Int, week)
        .input('body', sql.NVarChar(500), body)
        .input('owner', sql.NVarChar(100), owner)
        .input('master', sql.Bit, 1)
        .input('sort', sql.Int, sort++)
        .query(`INSERT INTO dbo.FsaTemplateActivities
                  (Dept, Phase, Week, Body, Owner, IsMaster, SortOrder)
                VALUES (@dept, @phase, @week, @body, @owner, @master, @sort)`);
    }
  }
  for (const [dept, phases] of Object.entries(C.EXTRAS)) {
    for (const [phase, items] of Object.entries(phases)) {
      for (const [body, owner, week] of items) {
        await req()
          .input('dept', sql.NVarChar(100), dept)
          .input('phase', sql.Int, Number(phase))
          .input('week', sql.Int, week)
          .input('body', sql.NVarChar(500), body)
          .input('owner', sql.NVarChar(100), owner)
          .input('master', sql.Bit, 0)
          .input('sort', sql.Int, sort++)
          .query(`INSERT INTO dbo.FsaTemplateActivities
                    (Dept, Phase, Week, Body, Owner, IsMaster, SortOrder)
                  VALUES (@dept, @phase, @week, @body, @owner, @master, @sort)`);
      }
    }
  }
});

// Snapshot each programme's checklist. This runs after the templates exist,
// and is what keeps a template edit from reaching someone mid-programme.
async function snapshotProgrammes() {
  const programmes = await req().query(
    'SELECT Id, Dept FROM dbo.FsaProgrammes ORDER BY Id'
  );

  let taken = 0;
  for (const p of programmes.recordset) {
    const already = await req()
      .input('pid', sql.Int, p.Id)
      .query('SELECT COUNT(*) AS RowTally FROM dbo.FsaProgrammeActivities WHERE ProgrammeId = @pid');
    if (Number(already.recordset[0].RowTally) > 0) continue;

    const acts = await req()
      .input('dept', sql.NVarChar(100), p.Dept)
      .query(`SELECT Id, Phase, Week, IsMaster, SortOrder
              FROM dbo.FsaTemplateActivities
              WHERE Enabled = 1 AND (Dept = '*' OR Dept = @dept)
              ORDER BY Phase, Week, IsMaster DESC, SortOrder`);

    for (let i = 0; i < acts.recordset.length; i++) {
      const a = acts.recordset[i];
      await req()
        .input('pid', sql.Int, p.Id)
        .input('aid', sql.Int, a.Id)
        .input('phase', sql.Int, a.Phase)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaProgrammeActivities (ProgrammeId, ActivityId, Phase, SortOrder)
                VALUES (@pid, @aid, @phase, @sort)`);
    }
    await req()
      .input('pid', sql.Int, p.Id)
      .query('UPDATE dbo.FsaProgrammes SET TemplateSnapshotAt = SYSUTCDATETIME() WHERE Id = @pid');
    taken++;
  }
  console.log(`  ${'FsaProgrammeActivities'.padEnd(24)} ${String(taken).padStart(4)} programmes snapshotted`);
}

await seed('FsaPhaseTargets', async () => {
  for (const [dept, rows] of Object.entries(C.TARGETS)) {
    for (let i = 0; i < rows.length; i++) {
      await req()
        .input('dept', sql.NVarChar(100), dept)
        .input('label', sql.NVarChar(255), rows[i][0])
        .input('value', sql.NVarChar(20), rows[i][1])
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaPhaseTargets (Dept, Label, Value, SortOrder)
                VALUES (@dept, @label, @value, @sort)`);
    }
  }
});

// --- leave & coverage -----------------------------------------------------
// Display strings are derived from the typed fields so the two cannot drift.
const dayWord = (n) => `${n % 1 === 0 ? n : n.toFixed(1)} ${n === 1 ? 'day' : 'days'}`;

await seed('FsaLeaveRequests', async () => {
  for (let i = 0; i < C.LEAVE.length; i++) {
    const r = C.LEAVE[i];
    await req()
      .input('staffNo', sql.NVarChar(20), r.staffNo)
      .input('name', sql.NVarChar(255), r.name)
      .input('role', sql.NVarChar(255), r.role)
      .input('service', sql.NVarChar(50), r.service)
      .input('site', sql.NVarChar(255), r.site)
      .input('type', sql.NVarChar(100), r.type)
      .input('start', sql.Date, r.start)
      .input('end', sql.Date, r.end)
      .input('days', sql.Decimal(4, 1), r.days)
      .input('balanceDays', sql.Decimal(5, 1), r.balanceDays)
      .input('dates', sql.NVarChar(100), `${r.start} → ${r.end}`)
      .input('balance', sql.NVarChar(50), dayWord(r.balanceDays))
      .input('kind', sql.NVarChar(10), r.coverageKind)
      .input('impact', sql.NVarChar(sql.MAX), r.impact)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaLeaveRequests
                (StaffNo, Name, Role, Service, Site, LeaveType, StartDate, EndDate,
                 Days, BalanceDays, Dates, BalanceAfter, CoverageKind, Impact,
                 SubmittedAt, SortOrder)
              VALUES (@staffNo, @name, @role, @service, @site, @type, @start, @end,
                      @days, @balanceDays, @dates, @balance, @kind, @impact,
                      SYSUTCDATETIME(), @sort)`);
  }
});

await seed('FsaSiteCoverage', async () => {
  for (let i = 0; i < C.COVERAGE.length; i++) {
    const [site, pct, badge, kind, detail] = C.COVERAGE[i];
    await req()
      .input('site', sql.NVarChar(255), site)
      .input('pct', sql.Int, pct)
      .input('badge', sql.NVarChar(50), badge)
      .input('kind', sql.NVarChar(10), kind)
      .input('detail', sql.NVarChar(255), detail)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaSiteCoverage (Site, Pct, Badge, Kind, Detail, SortOrder)
              VALUES (@site, @pct, @badge, @kind, @detail, @sort)`);
  }
});

// --- document depository --------------------------------------------------
await seed('FsaDocumentLibraries', async () => {
  for (let i = 0; i < C.LIBRARIES.length; i++) {
    await req()
      .input('name', sql.NVarChar(255), C.LIBRARIES[i])
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaDocumentLibraries (Name, SortOrder) VALUES (@name, @sort)`);
  }
});

await seed('FsaDocuments', async () => {
  for (let i = 0; i < C.DOCUMENTS.length; i++) {
    const [name, ref, kind, version, owner, review, status, statusKind, library] = C.DOCUMENTS[i];
    await req()
      .input('name', sql.NVarChar(255), name)
      .input('ref', sql.NVarChar(50), ref)
      .input('kind', sql.NVarChar(50), kind)
      .input('version', sql.NVarChar(20), version)
      .input('owner', sql.NVarChar(255), owner)
      .input('review', sql.NVarChar(50), review)
      .input('status', sql.NVarChar(50), status)
      .input('skind', sql.NVarChar(10), statusKind)
      .input('lib', sql.NVarChar(255), library)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaDocuments
                (Name, Ref, Kind, Version, Owner, NextReview, Status, StatusKind, Library, SortOrder)
              VALUES (@name, @ref, @kind, @version, @owner, @review, @status, @skind, @lib, @sort)`);
  }
});

await seed('FsaAcknowledgements', async () => {
  for (let i = 0; i < C.ACKNOWLEDGEMENTS.length; i++) {
    const [doc, detail, pct] = C.ACKNOWLEDGEMENTS[i];
    await req()
      .input('doc', sql.NVarChar(255), doc)
      .input('detail', sql.NVarChar(255), detail)
      .input('pct', sql.Int, pct)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaAcknowledgements (DocName, Detail, Pct, SortOrder)
              VALUES (@doc, @detail, @pct, @sort)`);
  }
});

// --- HR home --------------------------------------------------------------
await seed('FsaAlerts', async () => {
  for (let i = 0; i < C.ALERTS.length; i++) {
    const [kind, title, body, action, ref, route] = C.ALERTS[i];
    await req()
      .input('kind', sql.NVarChar(30), kind)
      .input('title', sql.NVarChar(255), title)
      .input('body', sql.NVarChar(sql.MAX), body)
      .input('action', sql.NVarChar(255), action)
      .input('ref', sql.NVarChar(50), ref)
      .input('route', sql.NVarChar(120), route ?? null)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaAlerts (Kind, Title, Body, Action, Ref, Route, SortOrder)
              VALUES (@kind, @title, @body, @action, @ref, @route, @sort)`);
  }
});

await seed('FsaNotices', async () => {
  for (let i = 0; i < C.NOTICES.length; i++) {
    const [date, title, body] = C.NOTICES[i];
    await req()
      .input('date', sql.Date, date)
      .input('title', sql.NVarChar(255), title)
      .input('body', sql.NVarChar(sql.MAX), body)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaNotices (NoticeDate, Title, Body, SortOrder)
              VALUES (@date, @title, @body, @sort)`);
  }
});

await seed('FsaWeekItems', async () => {
  for (let i = 0; i < C.WEEK.length; i++) {
    await req()
      .input('day', sql.NVarChar(10), C.WEEK[i][0])
      .input('body', sql.NVarChar(255), C.WEEK[i][1])
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaWeekItems (DayLabel, Body, SortOrder)
              VALUES (@day, @body, @sort)`);
  }
});

// --- management dashboard -------------------------------------------------
await seed('FsaServiceStats', async () => {
  for (let i = 0; i < C.SERVICES.length; i++) {
    const [name, staff, vac, util, pct] = C.SERVICES[i];
    await req()
      .input('name', sql.NVarChar(100), name)
      .input('staff', sql.NVarChar(10), staff)
      .input('vac', sql.NVarChar(10), vac)
      .input('util', sql.NVarChar(10), util)
      .input('pct', sql.Int, pct)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaServiceStats (Name, Staff, Vacancies, Utilisation, Pct, SortOrder)
              VALUES (@name, @staff, @vac, @util, @pct, @sort)`);
  }
});

await seed('FsaWatchItems', async () => {
  for (let i = 0; i < C.WATCH.length; i++) {
    const [title, body, tag, kind] = C.WATCH[i];
    await req()
      .input('title', sql.NVarChar(255), title)
      .input('body', sql.NVarChar(sql.MAX), body)
      .input('tag', sql.NVarChar(50), tag)
      .input('kind', sql.NVarChar(10), kind)
      .input('sort', sql.Int, i)
      .query(`INSERT INTO dbo.FsaWatchItems (Title, Body, Tag, TagKind, SortOrder)
              VALUES (@title, @body, @tag, @kind, @sort)`);
  }
});

await seed('FsaStats', async () => {
  for (const [screen, rows] of Object.entries(C.STATS)) {
    for (let i = 0; i < rows.length; i++) {
      const [value, label, note] = rows[i];
      await req()
        .input('screen', sql.NVarChar(30), screen)
        .input('value', sql.NVarChar(20), value)
        .input('label', sql.NVarChar(100), label)
        .input('note', sql.NVarChar(255), note)
        .input('sort', sql.Int, i)
        .query(`INSERT INTO dbo.FsaStats (Screen, Value, Label, Note, SortOrder)
                VALUES (@screen, @value, @label, @note, @sort)`);
    }
  }
});

// --- reference layer ------------------------------------------------------
// These replace constants that used to live in route files and components.
await seed('FsaSettings', async () => {
  for (const [key, value, note] of C.SETTINGS) {
    await req()
      .input('k', sql.NVarChar(60), key)
      .input('v', sql.NVarChar(sql.MAX), value)
      .input('n', sql.NVarChar(255), note ?? null)
      .query(`INSERT INTO dbo.FsaSettings (SettingKey, Value, Note)
              VALUES (@k, @v, @n)`);
  }
});

await seed('FsaLookups', async () => {
  for (const [domain, code, label, kind, detail, route, sort] of C.LOOKUPS) {
    await req()
      .input('d', sql.NVarChar(40), domain)
      .input('c', sql.NVarChar(60), code)
      .input('l', sql.NVarChar(160), label)
      .input('k', sql.NVarChar(10), kind ?? null)
      .input('t', sql.NVarChar(400), detail ?? null)
      .input('r', sql.NVarChar(120), route ?? null)
      .input('s', sql.Int, sort)
      .query(`INSERT INTO dbo.FsaLookups (Domain, Code, Label, Kind, Detail, Route, SortOrder)
              VALUES (@d, @c, @l, @k, @t, @r, @s)`);
  }
});

await seed('FsaQuickActions', async () => {
  for (const [route, icon, title, sub, countKey, one, many, zero, sort] of C.QUICK_ACTIONS) {
    await req()
      .input('r', sql.NVarChar(120), route)
      .input('i', sql.NVarChar(60), icon)
      .input('t', sql.NVarChar(80), title)
      .input('u', sql.NVarChar(160), sub)
      .input('ck', sql.NVarChar(40), countKey ?? null)
      .input('c1', sql.NVarChar(80), one ?? null)
      .input('cn', sql.NVarChar(80), many ?? null)
      .input('c0', sql.NVarChar(80), zero ?? null)
      .input('s', sql.Int, sort)
      .query(`INSERT INTO dbo.FsaQuickActions
                (Route, Icon, Title, Sub, CountKey, CountOne, CountMany, CountZero, SortOrder)
              VALUES (@r, @i, @t, @u, @ck, @c1, @cn, @c0, @s)`);
  }
});

await seed('FsaDecisions', async () => {
  for (const d of C.DECISIONS) {
    const [screen, title, body, detail, aLabel, aValue, aBasis, fLabel, fValue, fBasis, sort] = d;
    await req()
      .input('sc', sql.NVarChar(30), screen)
      .input('t', sql.NVarChar(120), title)
      .input('b', sql.NVarChar(sql.MAX), body)
      .input('dt', sql.NVarChar(sql.MAX), detail ?? null)
      .input('al', sql.NVarChar(80), aLabel ?? null)
      .input('av', sql.NVarChar(40), aValue ?? null)
      .input('ab', sql.NVarChar(200), aBasis ?? null)
      .input('fl', sql.NVarChar(80), fLabel ?? null)
      .input('fv', sql.NVarChar(40), fValue ?? null)
      .input('fb', sql.NVarChar(200), fBasis ?? null)
      .input('s', sql.Int, sort)
      .query(`INSERT INTO dbo.FsaDecisions
                (Screen, Title, Body, Detail, AgainstLabel, AgainstValue, AgainstBasis,
                 ForLabel, ForValue, ForBasis, SortOrder)
              VALUES (@sc, @t, @b, @dt, @al, @av, @ab, @fl, @fv, @fb, @s)`);
  }
});

// Positional sign-offs cannot be mapped onto activity ids, and they were only
// ever demo data — clear them rather than leave rows pointing at nothing.
if (force) {
  await pool.request().query('DELETE FROM dbo.FsaProgrammeActivities');
  await pool.request().query('DELETE FROM dbo.FsaProgrammeChecks');
}
await snapshotProgrammes();

console.log(`\n[seed:hr] ${loaded} tables loaded, ${skipped} left alone`);
if (skipped && !force) console.log('[seed:hr] pass --force to wipe and reload everything');
process.exit(0);
