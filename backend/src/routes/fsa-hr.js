// FSA HR module — the People & management hub screens.
//
// One GET per screen, plus the mutations the screens actually offer: leave
// decisions, a new role requisition, moving a candidate along the pipeline,
// signing off a Red-to-Green activity, and turning a department template
// activity on or off.
import express from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Every screen here is internal HR data — a valid token is required, and
// req.user is what stamps leave decisions and requisitions.
router.use(requireAuth);

// Phase labels used across the onboarding screens.
// These vocabularies live in FsaLookups. They are read once and cached for the
// process: they change when someone edits the reference data, not per request.
// Previously each was an array literal here, so renaming a phase or adding a
// pipeline column meant a code change and a deploy.
let lookupCache = null;

async function lookups(pool) {
  if (lookupCache) return lookupCache;
  const r = await pool.request().query(
    `SELECT Domain, Code, Label, Kind, Detail, Route, SortOrder
     FROM dbo.FsaLookups ORDER BY Domain, SortOrder`
  );
  const byDomain = new Map();
  for (const row of r.recordset) {
    if (!byDomain.has(row.Domain)) byDomain.set(row.Domain, []);
    byDomain.get(row.Domain).push(row);
  }
  lookupCache = byDomain;
  return lookupCache;
}

// A domain as a plain list of labels, indexed by its numeric code — the shape
// the old array constants had.
async function labelsByCode(pool, domain) {
  const rows = (await lookups(pool)).get(domain) || [];
  const out = [];
  for (const row of rows) out[Number(row.Code)] = row.Label;
  return out;
}

// A lookup domain in the shape the screens consume it. Sending the vocabulary
// with the data is what lets a component render a stage or a document state
// without keeping its own copy of the list.
async function vocab(pool, domain) {
  return ((await lookups(pool)).get(domain) || []).map((x) => ({
    code: x.Code, label: x.Label, kind: x.Kind,
  }));
}

async function settings(pool) {
  const r = await pool.request().query('SELECT SettingKey, Value FROM dbo.FsaSettings');
  return Object.fromEntries(r.recordset.map((x) => [x.SettingKey, x.Value]));
}

const asBool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// --- stat tiles -----------------------------------------------------------
// A tile used to be a stored number, so "214 employees on register" could sit
// above a register holding nine people and nothing would notice. Every figure
// the registers can answer is now counted at request time; FsaStats.Derived
// names which one, and the stored Value is only the fallback.
//
// A percentage is rounded to one decimal and carries its own sign so the tile
// component keeps rendering a plain string.
const pct = (n) => (n === null ? null : `${Math.round(Number(n) * 10) / 10}%`);
const int = (n) => (n === null ? null : String(Number(n)));

const METRICS = {
  'staff.headcount': (m) => int(m.StaffHeadcount),
  'staff.sites': (m) => int(m.StaffSites),
  'leave.pending': (m) => int(m.LeavePending),
  // Counted per person, not per cell: someone whose DALRRD and classification
  // both lapse on the same date is one registration problem to chase, and the
  // alert beside this tile names people.
  'competence.expiringPeople': (m) => int(m.CompetenceExpiringPeople),
  // A lapsed DALRRD registration is what suspends a placement. An overdue
  // medical is chased separately and does not block, so it is not counted here.
  'competence.blocked': (m) => int(m.CompetenceBlocked),
  // Share of the registrations that actually apply — "not required" cells are
  // left out of both halves rather than counted as valid.
  'competence.validPct': (m) =>
    (Number(m.CompetenceApplicableCells) > 0
      ? pct((Number(m.CompetenceOkCells) * 100) / Number(m.CompetenceApplicableCells))
      : null),
  'coverage.pct': (m) => pct(m.CoveragePct),
  'r2g.total': (m) => int(m.R2gTotal),
  'r2g.atRisk': (m) => int(m.R2gAtRisk),
  'r2g.awaitingSignOff': (m) => int(m.R2gAwaitingSignOff),
  'docs.total': (m) => int(m.DocsTotal),
  'docs.reviewDue': (m) => int(m.DocsReviewDue),
  'docs.overdue': (m) => int(m.DocsOverdue),
  'docs.ackPct': (m) => pct(m.DocsAckPct),
};

// One round trip for every tile on every screen. The competence percentage
// needs the five registration columns as rows, hence the UNION ALL.
const COMPETENCE_CELLS = `
  SELECT DalrrdKind AS Kind FROM dbo.FsaCompetence
  UNION ALL SELECT AntePostKind FROM dbo.FsaCompetence
  UNION ALL SELECT ClassificationKind FROM dbo.FsaCompetence
  UNION ALL SELECT HaccpKind FROM dbo.FsaCompetence
  UNION ALL SELECT MedicalKind FROM dbo.FsaCompetence`;

async function metrics(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.FsaStaff) AS StaffHeadcount,
      (SELECT COUNT(DISTINCT Site) FROM dbo.FsaStaff) AS StaffSites,
      (SELECT COUNT(*) FROM dbo.FsaLeaveRequests WHERE Status = 'pending') AS LeavePending,
      (SELECT COUNT(*) FROM dbo.FsaCompetence
        WHERE 'warn' IN (DalrrdKind, AntePostKind, ClassificationKind,
                         HaccpKind, MedicalKind)) AS CompetenceExpiringPeople,
      (SELECT COUNT(*) FROM dbo.FsaCompetence WHERE DalrrdKind = 'bad') AS CompetenceBlocked,
      (SELECT COUNT(*) FROM (${COMPETENCE_CELLS}) okc
        WHERE Kind = 'ok') AS CompetenceOkCells,
      (SELECT COUNT(*) FROM (${COMPETENCE_CELLS}) appc
        WHERE Kind <> 'na') AS CompetenceApplicableCells,
      (SELECT AVG(Pct) FROM dbo.FsaSiteCoverage) AS CoveragePct,
      (SELECT COUNT(*) FROM dbo.FsaProgrammes) AS R2gTotal,
      (SELECT COUNT(*) FROM dbo.FsaProgrammes WHERE StatusKind = 'bad') AS R2gAtRisk,
      (SELECT COUNT(*) FROM dbo.FsaProgrammes
        WHERE LOWER(Status) LIKE '%sign-off%') AS R2gAwaitingSignOff,
      (SELECT COUNT(*) FROM dbo.FsaDocuments) AS DocsTotal,
      (SELECT COUNT(*) FROM dbo.FsaDocuments WHERE StatusKind = 'warn') AS DocsReviewDue,
      (SELECT COUNT(*) FROM dbo.FsaDocuments WHERE StatusKind = 'bad') AS DocsOverdue,
      (SELECT AVG(Pct) FROM dbo.FsaAcknowledgements) AS DocsAckPct
  `);
  return r.recordset[0];
}

async function statsFor(pool, screen, live) {
  const r = await pool
    .request()
    .input('screen', sql.NVarChar(30), screen)
    .query(`SELECT Value, Label, Note, Derived FROM dbo.FsaStats
            WHERE Screen = @screen ORDER BY SortOrder`);

  const m = live || (await metrics(pool));
  return r.recordset.map((row) => {
    const fn = row.Derived ? METRICS[row.Derived] : null;
    const value = fn ? fn(m) : null;
    // Fall back to the stored number if the metric is unknown or came back
    // empty, so a tile never renders blank.
    const { Derived, ...tile } = row;
    return value === null ? tile : { ...tile, Value: value };
  });
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  };
}

// --- HR home --------------------------------------------------------------
router.get('/home', wrap(async (_req, res) => {
  const pool = await getPool();
  const live = await metrics(pool);
  const [stats, alerts, notices, week] = await Promise.all([
    statsFor(pool, 'home', live),
    pool.request().query(`SELECT Kind, Title, Body, Action, Ref, Route FROM dbo.FsaAlerts ORDER BY SortOrder`),
    pool.request().query(`SELECT NoticeDate, Title, Body FROM dbo.FsaNotices ORDER BY SortOrder`),
    pool.request().query(`SELECT DayLabel, Body FROM dbo.FsaWeekItems ORDER BY SortOrder`),
  ]);

  const pending = Number(live.LeavePending);

  const [quick, kinds, cfg] = await Promise.all([
    pool.request().query(`SELECT Route, Icon, Title, Sub, CountKey, CountOne, CountMany, CountZero
                          FROM dbo.FsaQuickActions WHERE IsActive = 1 ORDER BY SortOrder`),
    lookups(pool),
    settings(pool),
  ]);

  // Live figures a quick action's subtitle can be built from.
  const counts = { pending };

  const expiring = Number(live.CompetenceExpiringPeople) || 0;

  res.json({
    stats,
    alerts: alerts.recordset,
    notices: notices.recordset,
    week: week.recordset,
    pending,
    // The greeting screen's tiles and severity wording, so neither is compiled
    // into the component.
    quickActions: quick.recordset.map((q) => {
      const n = q.CountKey ? counts[q.CountKey] : undefined;
      let sub = q.Sub;
      if (q.CountKey && n !== undefined) {
        const tpl = n === 0 ? q.CountZero : n === 1 ? q.CountOne : q.CountMany;
        if (tpl) sub = tpl.replace('{n}', String(n));
      }
      return { route: q.Route, icon: q.Icon, title: q.Title, sub };
    }),
    alertKinds: (kinds.get('alert_kind') || []).map((k) => ({
      code: k.Code, label: k.Label, kind: k.Kind, detail: k.Detail,
    })),
    standing: {
      pending,
      expiring,
      blocking: alerts.recordset.filter((a) => a.Kind === 'Finding').length,
    },
    org: { handling: cfg['org.handling'] ?? null },
  });
}));

// --- Directory & site placements -----------------------------------------
// The register is a work list, not an alphabetical roll: by default the people
// whose registration has lapsed or is about to come first.
const STAFF_SORTS = {
  attention: `CASE RegKind WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END,
              RegExpiry NULLS LAST, Name`,
  name: 'Name',
  site: 'Site, Name',
  service: 'Service, Name',
  expiry: 'RegExpiry NULLS LAST, Name',
};

router.get('/staff', wrap(async (req, res) => {
  const pool = await getPool();
  const service = (req.query.service || 'All').toString();
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const sort = STAFF_SORTS[req.query.sort] ? req.query.sort : 'attention';

  const r = await pool
    .request()
    .query(`SELECT StaffNo, Name, Role, Service, Site, Registration, RegKind, Contract, RegExpiry
            FROM dbo.FsaStaff ORDER BY ${STAFF_SORTS[sort]}`);

  const all = r.recordset;
  const rows = all.filter(
    (p) =>
      (service === 'All' || p.Service === service) &&
      (!q || `${p.Name}${p.Role}${p.Site}${p.Service}${p.StaffNo}`.toLowerCase().includes(q))
  );

  // Which services carry site placements is reference data (FsaLookups, kind
  // 'field'), not a set literal in the React component.
  const lk = await lookups(pool);
  const depts = lk.get('department') || [];

  res.json({
    rows,
    total: all.length,
    services: ['All', ...[...new Set(all.map((p) => p.Service))]],
    // Both the short code and the full label, so a match works whichever of
    // the two service vocabularies a row happens to use.
    fieldServices: depts
      .filter((x) => x.Kind === 'field')
      .flatMap((x) => [x.Code, x.Label]),
    sorts: (lk.get('staff_sort') || []).map((x) => ({ key: x.Code, label: x.Label })),
    sort,
    // Counted over the whole register, not the filtered view — otherwise
    // filtering would hide the very thing this is meant to surface.
    attention: {
      expired: all.filter((p) => p.RegKind === 'bad').length,
      expiring: all.filter((p) => p.RegKind === 'warn').length,
    },
  });
}));

// --- Competence & registrations ------------------------------------------
router.get('/competence', wrap(async (_req, res) => {
  const pool = await getPool();
  const [stats, matrix] = await Promise.all([
    statsFor(pool, 'competence'),
    pool.request().query(`SELECT Name, Site,
              DalrrdText, DalrrdKind, AntePostText, AntePostKind,
              ClassificationText, ClassificationKind, HaccpText, HaccpKind,
              MedicalText, MedicalKind
            FROM dbo.FsaCompetence ORDER BY SortOrder`),
  ]);
  res.json({
    stats,
    columns: [
      'DALRRD registration',
      'Ante/post-mortem',
      'Classification',
      'HACCP',
      'Medical surveillance',
    ],
    rows: matrix.recordset.map((r) => ({
      Name: r.Name,
      Site: r.Site,
      cells: [
        { text: r.DalrrdText, kind: r.DalrrdKind },
        { text: r.AntePostText, kind: r.AntePostKind },
        { text: r.ClassificationText, kind: r.ClassificationKind },
        { text: r.HaccpText, kind: r.HaccpKind },
        { text: r.MedicalText, kind: r.MedicalKind },
      ],
    })),
  });
}));

// --- Role requisitions ----------------------------------------------------
router.get('/requisitions', wrap(async (_req, res) => {
  const pool = await getPool();
  const reqStages = await labelsByCode(pool, 'req_stage');
  const r = await pool.request().query(`SELECT Id, Ref, Role, Dept, Site, Contract, Posts,
              RequestedBy, TargetStart, Reason, Stage, PackIjd, PackKpi, PackEdp
            FROM dbo.FsaRequisitions ORDER BY Ref DESC`);

  const rows = r.recordset.map((x) => ({
    ...x,
    StageLabel: reqStages[x.Stage] || 'Requested',
    Blocked: !(x.PackIjd && x.PackKpi && x.PackEdp),
  }));
  const stageCount = (n) => rows.filter((x) => x.Stage === n).length;
  res.json({
    rows,
    method: [
      { n: '1', title: 'Requested', owner: 'Department manager', body: 'Role, site, contract, posts, target start and the operational reason for the request.', count: `${stageCount(1)} open` },
      { n: '2', title: 'Employee pack', owner: 'Human Resources', body: 'IJD, KPI and KPA schedule, and the employee development plan mapped to Red to Green.', count: `${stageCount(2)} in development` },
      { n: '3', title: 'Publication', owner: 'Marketing', body: 'Advertised on the website, LinkedIn, industry groups and the Academy alumni list.', count: `${stageCount(3)} with marketing` },
      { n: '4', title: 'Recruitment', owner: 'HR and the manager', body: 'Applicants count towards this requisition’s buckets, through to onboarding and Red to Green.', count: `${stageCount(4)} live` },
    ],
    channels: ['www.foodsafetyagency.co.za', 'LinkedIn', 'Industry WhatsApp groups', 'Academy alumni list'],
    departments: ((await lookups(pool)).get('department') || []).map((x) => x.Label),
    contracts: ['Permanent', 'Fixed term', 'Relief'],
    reasons: ['New post — growth', 'Replacement — resignation', 'Replacement — end of contract', 'Ends reliance on relief cover'],
  });
}));

router.post('/requisitions', wrap(async (req, res) => {
  const { role, dept, site, contract, posts, targetStart, reason, motivation } = req.body ?? {};
  if (!role?.trim() || !site?.trim()) {
    return res.status(400).json({ error: 'Add a role title and a site or region before sending.' });
  }

  const pool = await getPool();
  // Next reference in the REQ-#### series.
  const max = await pool.request().query(
    `SELECT Ref FROM dbo.FsaRequisitions ORDER BY Ref DESC`
  );
  const highest = max.recordset.reduce((acc, r) => {
    const n = parseInt(String(r.Ref).replace(/\D/g, ''), 10) || 0;
    return Math.max(acc, n);
  }, 0);
  const ref = `REQ-${String(highest + 1).padStart(4, '0')}`;

  const inserted = await pool
    .request()
    .input('ref', sql.NVarChar(20), ref)
    .input('role', sql.NVarChar(255), role.trim())
    .input('dept', sql.NVarChar(100), dept || 'APS')
    .input('site', sql.NVarChar(255), site.trim())
    .input('contract', sql.NVarChar(50), contract || 'Permanent')
    .input('posts', sql.NVarChar(10), String(posts || '1'))
    .input('by', sql.NVarChar(255), req.user?.email || 'HR')
    .input('start', sql.NVarChar(50), targetStart || 'To be confirmed')
    .input('reason', sql.NVarChar(255), reason || 'New post — growth')
    .input('motivation', sql.NVarChar(sql.MAX), motivation || null)
    .query(`INSERT INTO dbo.FsaRequisitions
              (Ref, Role, Dept, Site, Contract, Posts, RequestedBy, TargetStart, Reason, Motivation, Stage)
            OUTPUT INSERTED.Id, INSERTED.Ref
            VALUES (@ref, @role, @dept, @site, @contract, @posts, @by, @start, @reason, @motivation, 1)`);

  res.status(201).json({
    ...inserted.recordset[0],
    message: `${ref} sent to HR.`,
  });
}));

// Advance a requisition, or tick off one of its three pack documents.
router.patch('/requisitions/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { stage, packIjd, packKpi, packEdp } = req.body ?? {};

  const pool = await getPool();
  const sets = [];
  const request = pool.request().input('id', sql.Int, id);
  if (stage !== undefined) {
    const s = parseInt(stage, 10);
    if (!(s >= 1 && s <= 4)) return res.status(400).json({ error: 'stage must be 1–4' });
    sets.push('Stage = @stage');
    request.input('stage', sql.Int, s);
  }
  for (const [key, col] of [['packIjd', 'PackIjd'], ['packKpi', 'PackKpi'], ['packEdp', 'PackEdp']]) {
    if (req.body?.[key] !== undefined) {
      sets.push(`${col} = @${key}`);
      request.input(key, sql.Bit, asBool(req.body[key]) ? 1 : 0);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  const r = await request.query(`UPDATE dbo.FsaRequisitions SET ${sets.join(', ')}
            OUTPUT INSERTED.Id, INSERTED.Ref, INSERTED.Stage,
                   INSERTED.PackIjd, INSERTED.PackKpi, INSERTED.PackEdp
            WHERE Id = @id`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Requisition not found' });
  res.json(r.recordset[0]);
}));

// --- Recruitment pipeline -------------------------------------------------
router.get('/pipeline', wrap(async (_req, res) => {
  const pool = await getPool();
  const pipelineStages = await labelsByCode(pool, 'pipeline_stage');
  const r = await pool.request().query(`SELECT Id, Ref, Role, Site, Tag, TagKind, Stage
            FROM dbo.FsaCandidates ORDER BY SortOrder`);
  res.json({
    stages: pipelineStages.map((label, i) => ({
      label,
      cards: r.recordset.filter((c) => c.Stage === i),
    })),
  });
}));

router.patch('/pipeline/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stage = parseInt(req.body?.stage, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const pool0 = await getPool();
  const pipelineStages = await labelsByCode(pool0, 'pipeline_stage');
  if (!(stage >= 0 && stage < pipelineStages.length)) {
    return res.status(400).json({ error: `stage must be 0–${pipelineStages.length - 1}` });
  }

  const pool = await getPool();
  const r = await pool
    .request()
    .input('id', sql.Int, id)
    .input('stage', sql.Int, stage)
    .query(`UPDATE dbo.FsaCandidates SET Stage = @stage
            OUTPUT INSERTED.Id, INSERTED.Ref, INSERTED.Stage
            WHERE Id = @id`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Candidate not found' });
  res.json(r.recordset[0]);
}));

// --- Red to Green ---------------------------------------------------------
// The activity list for a department and phase: the locked group method plus
// that department's own additions, ordered by week.
async function activitiesFor(pool, dept, phase) {
  const r = await pool
    .request()
    .input('dept', sql.NVarChar(100), dept)
    .input('phase', sql.Int, phase)
    .query(`SELECT Id, Dept, Week, Body, Owner, IsMaster, Enabled
            FROM dbo.FsaTemplateActivities
            WHERE Phase = @phase AND (Dept = '*' OR Dept = @dept)
            ORDER BY Week, IsMaster DESC, SortOrder`);
  return r.recordset;
}

router.get('/r2g', wrap(async (_req, res) => {
  const pool = await getPool();
  const phaseNames = await labelsByCode(pool, 'phase');
  const [stats, cohort] = await Promise.all([
    statsFor(pool, 'r2g'),
    pool.request().query(`SELECT Id, Code, Name, Role, Dept, Site, StartDate, Mentor, Phase,
                DayLabel, P1, P2, P3, Status, StatusKind, Gate
              FROM dbo.FsaProgrammes ORDER BY SortOrder`),
  ]);

  res.json({
    stats,
    cohort: cohort.recordset.map((c) => ({
      ...c,
      PhaseLabel: phaseNames[c.Phase],
      Pct: Math.round((c.P1 + c.P2 + c.P3) / 3),
    })),
    method: [
      { phase: 'Before day one', title: 'Arrival checklist', body: 'Contract, packs, equipment, payroll, access and introductions — signed off by Admin, HR, Finance and the department manager.', gate: 'Gate: all items closed before Phase 1 starts' },
      { phase: 'Month one', title: 'Phase 1 — Red', body: 'Legislation, responsibilities, common violations and reporting. Accompanied practical work, then supervised independent work.', gate: 'Gate: written test, minimum 60%' },
      { phase: 'Month two', title: 'Phase 2 — Orange', body: 'The approval process end to end, monitored work across every mandated commodity, then independent practice with reports reviewed.', gate: 'Gate: phase signed off by the manager' },
      { phase: 'Month three', title: 'Phase 3 — Green', body: 'Volume targets, supervised approval, case study review of five facilities, and the competence decision.', gate: 'Gate: final test 80% and green sign-off' },
    ],
  });
}));

router.get('/r2g/:code', wrap(async (req, res) => {
  const pool = await getPool();
  const phaseNames = await labelsByCode(pool, 'phase');
  const p = await pool
    .request()
    .input('code', sql.NVarChar(20), req.params.code)
    .query(`SELECT Id, Code, Name, Role, Dept, Site, StartDate, Mentor, Phase, DayLabel,
                   P1, P2, P3, Status, StatusKind, Gate, TemplateSnapshotAt
            FROM dbo.FsaProgrammes WHERE Code = @code`);
  const person = p.recordset[0];
  if (!person) return res.status(404).json({ error: 'Programme not found' });

  const [notes, checks, snapshot] = await Promise.all([
    pool.request().input('pid', sql.Int, person.Id)
      .query(`SELECT NoteDate, Author, Body FROM dbo.FsaProgrammeNotes
              WHERE ProgrammeId = @pid ORDER BY NoteDate DESC`),
    pool.request().input('pid', sql.Int, person.Id)
      .query('SELECT ActivityId, Done FROM dbo.FsaProgrammeChecks WHERE ProgrammeId = @pid'),
    // The checklist this programme started on. A later template edit does not
    // reach in-flight programmes, which is what the templates screen promises.
    pool.request().input('pid', sql.Int, person.Id)
      .query(`SELECT a.Id, a.Week, a.Body, a.Owner, a.IsMaster, a.Dept, pa.Phase, pa.SortOrder
              FROM dbo.FsaProgrammeActivities pa
              INNER JOIN dbo.FsaTemplateActivities a ON a.Id = pa.ActivityId
              WHERE pa.ProgrammeId = @pid
              ORDER BY pa.Phase, pa.SortOrder`),
  ]);

  const done = new Map(checks.recordset.map((c) => [c.ActivityId, c.Done]));
  const progress = [0, person.P1, person.P2, person.P3];

  const phases = [0, 1, 2, 3].map((ph) => {
    const items = snapshot.recordset.filter((a) => a.Phase === ph);
    return {
      phase: ph,
      title: phaseNames[ph],
      meta: ph === 0 ? 'Before the programme starts' : `Month ${ph}`,
      state: ph === 0 || ph < person.Phase ? 'done' : ph === person.Phase ? 'current' : 'future',
      items: items.map((it, i) => {
        const stored = done.get(it.Id);
        // With nothing recorded yet, fall back to how far the phase has run.
        const auto =
          ph === 0 || ph < person.Phase
            ? true
            : ph === person.Phase
              ? i / Math.max(1, items.length) < progress[person.Phase] / 100
              : false;
        return {
          ActivityId: it.Id,
          Week: it.Week,
          Body: it.Body,
          Owner: it.Owner,
          IsMaster: it.IsMaster,
          Done: stored === undefined ? auto : stored,
        };
      }),
    };
  });

  res.json({
    person: {
      ...person,
      PhaseLabel: phaseNames[person.Phase],
      Pct: Math.round((person.P1 + person.P2 + person.P3) / 3),
    },
    phases,
    notes: notes.recordset,
    gates: [
      { label: 'Phase 1 test', value: person.Phase > 1 ? '68% — passed' : 'Scheduled 2026-09-25', tag: person.Phase > 1 ? 'Passed' : 'Pending' },
      { label: 'Phase 2 sign-off', value: person.Phase > 2 ? 'Signed 2026-08-28' : 'Not reached', tag: person.Phase > 2 ? 'Signed' : 'Pending' },
      { label: 'Final test — 80%', value: person.Phase === 3 ? 'Booked 2026-09-29' : 'Not reached', tag: person.Phase === 3 ? 'Booked' : 'Pending' },
      { label: 'Green clearance', value: 'Requires both gates', tag: 'Locked' },
    ],
  });
}));

// Sign an activity off (or un-sign it). Keyed by activity, not by position in
// the list — a positional key silently reassigned sign-offs when a template
// changed.
router.put('/r2g/:code/checks', wrap(async (req, res) => {
  const activityId = parseInt(req.body?.activityId, 10);
  if (Number.isNaN(activityId)) {
    return res.status(400).json({ error: 'activityId is required' });
  }

  const pool = await getPool();
  const p = await pool
    .request()
    .input('code', sql.NVarChar(20), req.params.code)
    .query('SELECT Id FROM dbo.FsaProgrammes WHERE Code = @code');
  if (!p.recordset[0]) return res.status(404).json({ error: 'Programme not found' });
  const programmeId = p.recordset[0].Id;

  // The activity has to be part of this programme's own checklist.
  const owned = await pool
    .request()
    .input('pid', sql.Int, programmeId)
    .input('aid', sql.Int, activityId)
    .query(`SELECT Phase FROM dbo.FsaProgrammeActivities
            WHERE ProgrammeId = @pid AND ActivityId = @aid`);
  if (!owned.recordset[0]) {
    return res.status(409).json({ error: 'That activity is not on this programme’s checklist' });
  }

  const done = asBool(req.body?.done);
  await pool
    .request()
    .input('pid', sql.Int, programmeId)
    .input('aid', sql.Int, activityId)
    .input('phase', sql.Int, owned.recordset[0].Phase)
    .input('done', sql.Bit, done ? 1 : 0)
    .query(`INSERT INTO dbo.FsaProgrammeChecks (ProgrammeId, ActivityId, Phase, ItemIndex, Done)
            VALUES (@pid, @aid, @phase, 0, @done) AS new
            ON DUPLICATE KEY UPDATE Done = new.Done`);

  res.json({ activityId, done });
}));

// --- Department method templates -----------------------------------------
// The group method (Dept '*') is locked. A department only owns the activities
// it adds on top, so the screen leads with those and keeps the locked ones
// available but out of the way.

// Activity owners come from FsaLookups (domain 'owner').

async function templateDepartments(pool) {
  const r = await pool.request().query(
    `SELECT DISTINCT Dept FROM dbo.FsaTemplateActivities WHERE Dept <> '*' ORDER BY Dept`
  );
  return r.recordset.map((d) => d.Dept);
}

router.get('/templates', wrap(async (req, res) => {
  const pool = await getPool();
  const phaseNames = await labelsByCode(pool, 'phase');
  const owners = ((await lookups(pool)).get('owner') || []).map((x) => x.Label);
  const departments = await templateDepartments(pool);
  const dept = departments.includes(String(req.query.dept)) ? String(req.query.dept) : departments[0];

  const [all, targets, running] = await Promise.all([
    pool.request().input('dept', sql.NVarChar(100), dept)
      .query(`SELECT Id, Dept, Phase, Week, Body, Owner, IsMaster, Enabled
              FROM dbo.FsaTemplateActivities
              WHERE Dept = '*' OR Dept = @dept
              ORDER BY Phase, Week, IsMaster DESC, SortOrder`),
    pool.request().input('dept', sql.NVarChar(100), dept)
      .query(`SELECT Id, Label, Value FROM dbo.FsaPhaseTargets
              WHERE Dept = @dept ORDER BY SortOrder, Id`),
    // How many people are mid-programme on this department's method — the
    // blast radius of an edit, which is none, but worth saying plainly.
    pool.request().input('dept', sql.NVarChar(100), dept)
      .query(`SELECT COUNT(*) AS RowTally FROM dbo.FsaProgrammes WHERE Dept = @dept`),
  ]);

  const rows = all.recordset;
  const phases = [0, 1, 2, 3].map((ph) => {
    const items = rows.filter((r) => r.Phase === ph);
    const own = items.filter((r) => !r.IsMaster);
    return {
      phase: ph,
      title: phaseNames[ph],
      own,
      locked: items.filter((r) => r.IsMaster),
      ownCount: own.length,
      ownActive: own.filter((r) => r.Enabled).length,
      lockedCount: items.filter((r) => r.IsMaster).length,
    };
  });

  res.json({
    dept,
    departments,
    owners,
    phases,
    targets: targets.recordset,
    totals: {
      own: rows.filter((r) => !r.IsMaster).length,
      ownActive: rows.filter((r) => !r.IsMaster && r.Enabled).length,
      locked: rows.filter((r) => r.IsMaster).length,
      inChecklist: rows.filter((r) => r.IsMaster || r.Enabled).length,
      runningProgrammes: Number(running.recordset[0].RowTally),
    },
    locked: [
      { label: 'Phases', value: 'Arrival checklist, then Red, Orange, Green' },
      { label: 'Duration', value: 'One month per phase, five weeks where additional training is needed' },
      { label: 'Pass marks', value: 'Phase 1 test 60% · final test 80%' },
      { label: 'Clearance', value: 'A green inspector signs off every phase' },
    ],
  });
}));

// Add an activity to one department's method.
router.post('/templates', wrap(async (req, res) => {
  const dept = String(req.body?.dept || '').trim();
  const body = String(req.body?.body || '').trim();
  const owner = String(req.body?.owner || '').trim();
  const phase = parseInt(req.body?.phase, 10);
  const week = parseInt(req.body?.week, 10) || 1;

  if (!dept || dept === '*') return res.status(400).json({ error: 'A department is required' });
  if (!body) return res.status(400).json({ error: 'Describe the activity' });
  if (!(phase >= 0 && phase <= 3)) return res.status(400).json({ error: 'phase must be 0–3' });
  if (!(week >= 1 && week <= 5)) return res.status(400).json({ error: 'week must be 1–5' });

  const pool = await getPool();
  const r = await pool
    .request()
    .input('dept', sql.NVarChar(100), dept)
    .input('phase', sql.Int, phase)
    .input('week', sql.Int, week)
    .input('body', sql.NVarChar(500), body)
    .input('owner', sql.NVarChar(100), owner || 'Manager')
    .query(`INSERT INTO dbo.FsaTemplateActivities
              (Dept, Phase, Week, Body, Owner, IsMaster, Enabled, SortOrder)
            OUTPUT INSERTED.Id, INSERTED.Dept, INSERTED.Phase, INSERTED.Week,
                   INSERTED.Body, INSERTED.Owner, INSERTED.IsMaster, INSERTED.Enabled
            VALUES (@dept, @phase, @week, @body, @owner, 0, 1,
                    (SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM dbo.FsaTemplateActivities))`);

  res.status(201).json(r.recordset[0]);
}));

// Edit or turn off one department activity. The group method is locked.
router.patch('/templates/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Id, IsMaster FROM dbo.FsaTemplateActivities WHERE Id = @id');
  if (!existing.recordset[0]) return res.status(404).json({ error: 'Activity not found' });
  if (existing.recordset[0].IsMaster) {
    return res.status(409).json({ error: 'The group method is locked and cannot be changed per department.' });
  }

  const sets = [];
  const request = pool.request().input('id', sql.Int, id);

  if (req.body?.enabled !== undefined) {
    sets.push('Enabled = @enabled');
    request.input('enabled', sql.Bit, asBool(req.body.enabled) ? 1 : 0);
  }
  if (req.body?.body !== undefined) {
    const body = String(req.body.body).trim();
    if (!body) return res.status(400).json({ error: 'Describe the activity' });
    sets.push('Body = @body');
    request.input('body', sql.NVarChar(500), body);
  }
  if (req.body?.owner !== undefined) {
    sets.push('Owner = @owner');
    request.input('owner', sql.NVarChar(100), String(req.body.owner).trim() || 'Manager');
  }
  if (req.body?.week !== undefined) {
    const week = parseInt(req.body.week, 10);
    if (!(week >= 1 && week <= 5)) return res.status(400).json({ error: 'week must be 1–5' });
    sets.push('Week = @week');
    request.input('week', sql.Int, week);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  const r = await request.query(`UPDATE dbo.FsaTemplateActivities SET ${sets.join(', ')}
            OUTPUT INSERTED.Id, INSERTED.Phase, INSERTED.Week, INSERTED.Body,
                   INSERTED.Owner, INSERTED.Enabled
            WHERE Id = @id`);
  res.json(r.recordset[0]);
}));

// Remove a department activity outright. Programmes that already started keep
// it, because they hold their own snapshot.
router.delete('/templates/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Id, IsMaster FROM dbo.FsaTemplateActivities WHERE Id = @id');
  if (!existing.recordset[0]) return res.status(404).json({ error: 'Activity not found' });
  if (existing.recordset[0].IsMaster) {
    return res.status(409).json({ error: 'The group method is locked and cannot be removed.' });
  }

  const used = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS RowTally FROM dbo.FsaProgrammeActivities WHERE ActivityId = @id');
  if (Number(used.recordset[0].RowTally) > 0) {
    return res.status(409).json({
      error: 'Programmes already running include this activity. Turn it off instead — '
        + 'it will drop off for new starters and stay on theirs.',
    });
  }

  await pool.request().input('id', sql.Int, id)
    .query('DELETE FROM dbo.FsaTemplateActivities WHERE Id = @id');
  res.json({ Id: id, removed: true });
}));

// --- Phase 3 volume targets ----------------------------------------------
router.post('/templates/targets', wrap(async (req, res) => {
  const dept = String(req.body?.dept || '').trim();
  const label = String(req.body?.label || '').trim();
  const value = String(req.body?.value || '').trim();
  if (!dept) return res.status(400).json({ error: 'A department is required' });
  if (!label) return res.status(400).json({ error: 'Name the target' });
  if (!value) return res.status(400).json({ error: 'Give the target a number' });

  const pool = await getPool();
  const r = await pool
    .request()
    .input('dept', sql.NVarChar(100), dept)
    .input('label', sql.NVarChar(255), label)
    .input('value', sql.NVarChar(20), value)
    .query(`INSERT INTO dbo.FsaPhaseTargets (Dept, Label, Value, SortOrder)
            OUTPUT INSERTED.Id, INSERTED.Label, INSERTED.Value
            VALUES (@dept, @label, @value,
                    (SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM dbo.FsaPhaseTargets))`);
  res.status(201).json(r.recordset[0]);
}));

router.patch('/templates/targets/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const sets = [];
  const pool = await getPool();
  const request = pool.request().input('id', sql.Int, id);
  if (req.body?.label !== undefined) {
    const label = String(req.body.label).trim();
    if (!label) return res.status(400).json({ error: 'Name the target' });
    sets.push('Label = @label');
    request.input('label', sql.NVarChar(255), label);
  }
  if (req.body?.value !== undefined) {
    const value = String(req.body.value).trim();
    if (!value) return res.status(400).json({ error: 'Give the target a number' });
    sets.push('Value = @value');
    request.input('value', sql.NVarChar(20), value);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  const r = await request.query(`UPDATE dbo.FsaPhaseTargets SET ${sets.join(', ')}
            OUTPUT INSERTED.Id, INSERTED.Label, INSERTED.Value WHERE Id = @id`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Target not found' });
  res.json(r.recordset[0]);
}));

router.delete('/templates/targets/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const pool = await getPool();
  const r = await pool.request().input('id', sql.Int, id)
    .query('DELETE FROM dbo.FsaPhaseTargets OUTPUT DELETED.Id WHERE Id = @id');
  if (!r.recordset[0]) return res.status(404).json({ error: 'Target not found' });
  res.json({ Id: id, removed: true });
}));

// --- Leave & site coverage -----------------------------------------------
// A work queue, not a list: with thousands of employees the pending pile runs
// to hundreds, so filtering, sorting and paging all happen in Postgres and the
// client only ever holds one page.

// Performance ratings run 1-5 with "Meets" at 3. Anything below it is a
// shortfall, and a shortfall is what an EDP goal is derived from.
const PERF_MEETS = 3;
const PERF_GOAL_ROUTES = {
  'Reporting deadlines met': ['Complete the Academy record-keeping and reporting refresher.', 'FSA Academy, Pretoria'],
  'Registration currency': ['Attend the booked re-certification and lodge the renewed registration.', 'DALRRD'],
  'Re-inspection closure': ['Complete the corrective-action follow-up module.', 'FSA Academy, Pretoria'],
  'Sampling volumes met': ['Complete sampling-plan coaching with the area manager.', 'Area manager'],
  'Classification accuracy': ['Attend classification calibration with a senior classifier.', 'FSA Academy, Pretoria'],
};
const PERF_GOAL_FALLBACK = ['Agree a development action with the line manager for this area.', 'Line manager'];

const LEAVE_PAGE_SIZES = [25, 50, 100];

// Whitelisted so a sort parameter can never reach the SQL as text.
const LEAVE_SORTS = {
  // The default: the requests that could leave a site short, soonest first.
  urgent: `CASE CoverageKind WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, StartDate, Id`,
  soonest: 'StartDate, Id',
  latest: 'StartDate DESC, Id DESC',
  longest: 'Days DESC, StartDate, Id',
  name: 'Name, StartDate, Id',
  site: 'Site, StartDate, Id',
};

router.get('/leave', wrap(async (req, res) => {
  const pool = await getPool();

  const status = String(req.query.status || 'pending');
  const site = String(req.query.site || 'All');
  const service = String(req.query.service || 'All');
  const type = String(req.query.type || 'All');
  const coverage = String(req.query.coverage || 'All');
  const q = String(req.query.q || '').trim().toLowerCase();
  const sortKey = LEAVE_SORTS[String(req.query.sort || 'urgent')] ? String(req.query.sort || 'urgent') : 'urgent';

  const pageSize = LEAVE_PAGE_SIZES.includes(Number(req.query.pageSize))
    ? Number(req.query.pageSize)
    : 25;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  // Build the predicate once and reuse it for the page and its count.
  const where = [];
  const bind = (request) => {
    if (status !== 'All') request.input('status', sql.NVarChar(20), status);
    if (site !== 'All') request.input('site', sql.NVarChar(255), site);
    if (service !== 'All') request.input('service', sql.NVarChar(50), service);
    if (type !== 'All') request.input('type', sql.NVarChar(100), type);
    if (coverage !== 'All') request.input('coverage', sql.NVarChar(10), coverage);
    if (q) request.input('q', sql.NVarChar(255), `%${q}%`);
    return request;
  };
  if (status !== 'All') where.push('Status = @status');
  if (site !== 'All') where.push('Site = @site');
  if (service !== 'All') where.push('Service = @service');
  if (type !== 'All') where.push('LeaveType = @type');
  if (coverage !== 'All') where.push('CoverageKind = @coverage');
  if (q) where.push('(LOWER(Name) LIKE @q OR LOWER(Site) LIKE @q OR LOWER(StaffNo) LIKE @q)');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [pageRows, filtered, counts, sites, services, types] = await Promise.all([
    bind(pool.request())
      .input('off', sql.Int, (page - 1) * pageSize)
      .input('lim', sql.Int, pageSize)
      .query(`SELECT Id, StaffNo, Name, Role, Service, Site, LeaveType,
                     StartDate, EndDate, Days, BalanceDays, Dates, BalanceAfter,
                     CoverageKind, Impact, Status, DecidedBy, DecidedAt
              FROM dbo.FsaLeaveRequests
              ${clause}
              ORDER BY ${LEAVE_SORTS[sortKey]}
              OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`),

    bind(pool.request()).query(`SELECT COUNT(*) AS RowTally FROM dbo.FsaLeaveRequests ${clause}`),

    // Status tallies ignore the status filter (they are the tabs) but respect
    // every other filter, so the numbers match what the tabs would show.
    (() => {
      const otherWhere = where.filter((w) => w !== 'Status = @status');
      const otherClause = otherWhere.length ? `WHERE ${otherWhere.join(' AND ')}` : '';
      const r = pool.request();
      if (site !== 'All') r.input('site', sql.NVarChar(255), site);
      if (service !== 'All') r.input('service', sql.NVarChar(50), service);
      if (type !== 'All') r.input('type', sql.NVarChar(100), type);
      if (coverage !== 'All') r.input('coverage', sql.NVarChar(10), coverage);
      if (q) r.input('q', sql.NVarChar(255), `%${q}%`);
      return r.query(`
        SELECT
          COUNT(*) AS AllCount,
          SUM(CASE WHEN Status = 'pending'  THEN 1 ELSE 0 END) AS PendingCount,
          SUM(CASE WHEN Status = 'approved' THEN 1 ELSE 0 END) AS ApprovedCount,
          SUM(CASE WHEN Status = 'declined' THEN 1 ELSE 0 END) AS DeclinedCount,
          SUM(CASE WHEN Status = 'pending' AND CoverageKind = 'bad' THEN 1 ELSE 0 END) AS AtRiskCount
        FROM dbo.FsaLeaveRequests ${otherClause}`);
    })(),

    pool.request().query('SELECT DISTINCT Site FROM dbo.FsaLeaveRequests ORDER BY Site'),
    pool.request().query('SELECT DISTINCT Service FROM dbo.FsaLeaveRequests WHERE Service IS NOT NULL ORDER BY Service'),
    pool.request().query('SELECT DISTINCT LeaveType FROM dbo.FsaLeaveRequests ORDER BY LeaveType'),
  ]);

  const total = Number(filtered.recordset[0].RowTally);
  const c = counts.recordset[0];

  res.json({
    rows: pageRows.recordset,
    page,
    pageSize,
    pageSizes: LEAVE_PAGE_SIZES,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort: sortKey,
    counts: {
      all: Number(c.AllCount || 0),
      pending: Number(c.PendingCount || 0),
      approved: Number(c.ApprovedCount || 0),
      declined: Number(c.DeclinedCount || 0),
      atRisk: Number(c.AtRiskCount || 0),
    },
    filters: {
      sites: ['All', ...sites.recordset.map((r) => r.Site)],
      services: ['All', ...services.recordset.map((r) => r.Service)],
      types: ['All', ...types.recordset.map((r) => r.LeaveType)],
    },
  });
}));

// Site coverage, worst first — at nearly forty placements the ones in trouble
// are the only ones worth putting at the top.
router.get('/leave/coverage', wrap(async (req, res) => {
  const pool = await getPool();
  const q = String(req.query.q || '').trim().toLowerCase();
  const riskOnly = String(req.query.risk || '') === 'true';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 8));

  const where = [];
  const request = pool.request();
  if (q) { where.push('LOWER(Site) LIKE @q'); request.input('q', sql.NVarChar(255), `%${q}%`); }
  if (riskOnly) where.push("Kind IN ('bad','warn')");
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, tally] = await Promise.all([
    request
      .input('lim', sql.Int, limit)
      .query(`SELECT Site, Pct, Badge, Kind, Detail
              FROM dbo.FsaSiteCoverage
              ${clause}
              ORDER BY CASE Kind WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, Pct, Site
              OFFSET 0 ROWS FETCH NEXT @lim ROWS ONLY`),
    pool.request().query(`
      SELECT
        COUNT(*) AS AllCount,
        SUM(CASE WHEN Kind = 'bad'  THEN 1 ELSE 0 END) AS AtRiskCount,
        SUM(CASE WHEN Kind = 'warn' THEN 1 ELSE 0 END) AS WatchCount
      FROM dbo.FsaSiteCoverage`),
  ]);

  const t = tally.recordset[0];
  res.json({
    rows: rows.recordset,
    sites: Number(t.AllCount || 0),
    atRisk: Number(t.AtRiskCount || 0),
    watch: Number(t.WatchCount || 0),
  });
}));

router.post('/leave/:id/decision', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const decision = String(req.body?.decision || '');
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!['approved', 'declined', 'pending'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved, declined or pending' });
  }

  const pool = await getPool();
  // Reopening clears the stamp — a pending request has not been decided by
  // anyone, and leaving the previous decider on it misreads as an audit trail.
  const reopening = decision === 'pending';
  const r = await pool
    .request()
    .input('id', sql.Int, id)
    .input('status', sql.NVarChar(20), decision)
    .input('by', sql.NVarChar(255), reopening ? null : (req.user?.email || null))
    .query(`UPDATE dbo.FsaLeaveRequests
              SET Status = @status,
                  DecidedBy = @by,
                  DecidedAt = ${reopening ? 'NULL' : 'SYSUTCDATETIME()'}
            OUTPUT INSERTED.Id, INSERTED.Status, INSERTED.DecidedBy
            WHERE Id = @id`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Request not found' });
  res.json(r.recordset[0]);
}));

// Deciding a page's worth one at a time is the slow part of the job, so the
// queue can act on a selection in one request.
router.post('/leave/bulk-decision', wrap(async (req, res) => {
  const decision = String(req.body?.decision || '');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n) => parseInt(n, 10)) : [];

  if (!['approved', 'declined', 'pending'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved, declined or pending' });
  }
  const clean = ids.filter((n) => Number.isInteger(n));
  if (!clean.length) return res.status(400).json({ error: 'No requests selected' });
  if (clean.length > 200) {
    return res.status(400).json({ error: 'Select at most 200 requests at a time' });
  }

  const pool = await getPool();
  const reopening = decision === 'pending';
  const request = pool
    .request()
    .input('status', sql.NVarChar(20), decision)
    .input('by', sql.NVarChar(255), reopening ? null : (req.user?.email || null));

  const placeholders = clean.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });

  const r = await request.query(`UPDATE dbo.FsaLeaveRequests
       SET Status = @status,
           DecidedBy = @by,
           DecidedAt = ${reopening ? 'NULL' : 'SYSUTCDATETIME()'}
     OUTPUT INSERTED.Id
     WHERE Id IN (${placeholders.join(', ')})`);

  res.json({ decision, updated: r.recordset.length, ids: r.recordset.map((x) => x.Id) });
}));

// --- Document depository --------------------------------------------------
router.get('/documents', wrap(async (req, res) => {
  const pool = await getPool();
  const library = (req.query.library || 'All documents').toString();
  const q = (req.query.q || '').toString().trim().toLowerCase();

  const [stats, libs, docs, acks] = await Promise.all([
    statsFor(pool, 'docs'),
    pool.request().query(`SELECT Id, Name FROM dbo.FsaDocumentLibraries ORDER BY SortOrder`),
    pool.request().query(`SELECT Id, Name, Ref, Kind, Version, Owner, NextReview, Status, StatusKind, Library
              FROM dbo.FsaDocuments ORDER BY SortOrder`),
    pool.request().query(`SELECT DocName, Detail, Pct FROM dbo.FsaAcknowledgements ORDER BY SortOrder`),
  ]);

  const all = docs.recordset;
  const rows = all.filter(
    (d) =>
      (library === 'All documents' || d.Library === library) &&
      (!q || `${d.Name}${d.Ref}${d.Owner}${d.Kind}`.toLowerCase().includes(q))
  );

  res.json({
    stats,
    libraries: [
      { Id: null, Name: 'All documents', Count: all.length },
      ...libs.recordset.map((l) => ({
        Id: l.Id,
        Name: l.Name,
        Count: all.filter((d) => d.Library === l.Name).length,
      })),
    ],
    rows,
    total: all.length,
    acknowledgements: acks.recordset,
  });
}));

router.post('/documents/libraries', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A library name is required' });

  const pool = await getPool();
  const dup = await pool
    .request()
    .input('name', sql.NVarChar(255), name)
    .query('SELECT Id FROM dbo.FsaDocumentLibraries WHERE Name = @name');
  if (dup.recordset[0]) return res.status(409).json({ error: 'That library already exists' });

  const r = await pool
    .request()
    .input('name', sql.NVarChar(255), name)
    .query(`INSERT INTO dbo.FsaDocumentLibraries (Name, SortOrder)
            OUTPUT INSERTED.Id, INSERTED.Name
            VALUES (@name, (SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM dbo.FsaDocumentLibraries))`);
  res.status(201).json(r.recordset[0]);
}));

router.patch('/documents/libraries/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body?.name || '').trim();
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!name) return res.status(400).json({ error: 'A library name is required' });

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Name FROM dbo.FsaDocumentLibraries WHERE Id = @id');
  if (!existing.recordset[0]) return res.status(404).json({ error: 'Library not found' });

  const from = existing.recordset[0].Name;
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar(255), name)
    .query('UPDATE dbo.FsaDocumentLibraries SET Name = @name WHERE Id = @id');
  // Keep the documents pointing at their library.
  await pool
    .request()
    .input('from', sql.NVarChar(255), from)
    .input('to', sql.NVarChar(255), name)
    .query('UPDATE dbo.FsaDocuments SET Library = @to WHERE Library = @from');

  res.json({ Id: id, Name: name, movedFrom: from });
}));

// --- Management dashboard -------------------------------------------------
router.get('/dashboard', wrap(async (_req, res) => {
  const pool = await getPool();
  const [stats, services, watch, decisions, cfg] = await Promise.all([
    statsFor(pool, 'dash'),
    pool.request().query(`SELECT Name, Staff, Vacancies, Utilisation, Pct
              FROM dbo.FsaServiceStats ORDER BY SortOrder`),
    pool.request().query(`SELECT Title, Body, Tag, TagKind FROM dbo.FsaWatchItems ORDER BY SortOrder`),
    pool.request().query(`SELECT Title, Body, Detail,
                                 AgainstLabel, AgainstValue, AgainstBasis,
                                 ForLabel, ForValue, ForBasis
                          FROM dbo.FsaDecisions
                          WHERE Screen = 'dash' AND IsActive = 1
                          ORDER BY SortOrder`),
    settings(pool),
  ]);

  const d = decisions.recordset[0] || null;

  res.json({
    stats,
    services: services.recordset,
    watch: watch.recordset,
    // Reporting scope and the utilisation thresholds are configuration, not
    // constants compiled into the page.
    period: cfg['dash.period'] ?? null,
    thresholds: {
      utilGood: Number(cfg['dash.utilGood'] ?? 90),
      utilFair: Number(cfg['dash.utilFair'] ?? 85),
    },
    org: {
      legalName: cfg['org.legalName'] ?? null,
      directors: cfg['org.directors'] ?? null,
      email: cfg['org.email'] ?? null,
      phone: cfg['org.phone'] ?? null,
      handling: cfg['org.handling'] ?? null,
    },
    decision: d && {
      title: d.Title,
      body: d.Body,
      detail: d.Detail,
      // Real columns, so the client no longer parses the amounts back out of
      // the prose with a regular expression.
      against: d.AgainstValue ? { label: d.AgainstLabel, value: d.AgainstValue, basis: d.AgainstBasis } : null,
      for: d.ForValue ? { label: d.ForLabel, value: d.ForValue, basis: d.ForBasis } : null,
    },
  });
}));

// Nav counts, so the sidebar badges match the registers.
router.get('/nav-counts', wrap(async (_req, res) => {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.FsaLeaveRequests WHERE Status = 'pending') AS LeavePending,
      (SELECT COUNT(*) FROM dbo.FsaRequisitions WHERE Stage < 3) AS ReqsOpen,
      (SELECT COUNT(*) FROM dbo.FsaCompetence
        WHERE DalrrdKind IN ('warn','bad')) AS CompetenceFlags,
      (SELECT COUNT(*) FROM dbo.FsaProgrammes WHERE StatusKind = 'bad') AS ProgrammesAtRisk
  `);
  res.json(r.recordset[0]);
}));


// --- Monthly management report (§5.3) -------------------------------------
// A document for the directors' meeting. Every figure is stored against a
// stated period with a source line, so the report can be re-opened later and
// still say what it said on the day.
router.get('/report', wrap(async (req, res) => {
  const pool = await getPool();
  const period = (req.query.period || '').toString().trim();

  // Branch rather than `WHERE (@period IS NULL OR Period = @period)`: Postgres
  // cannot infer a bind parameter's type from `$1 IS NULL` and rejects the
  // statement outright.
  const cols = `SELECT Id, Period, PeriodLabel, PositionStatement, SourceNote,
                       CompiledBy, CompiledAt, ReviewedBy, ReviewedAt, AcceptedBy, AcceptedAt
                FROM dbo.FsaReports`;
  const head = period
    ? await pool.request().input('period', sql.NVarChar(7), period)
        .query(`${cols} WHERE Period = @period LIMIT 1`)
    : await pool.request().query(`${cols} ORDER BY Period DESC LIMIT 1`);
  const report = head.recordset[0];
  if (!report) return res.status(404).json({ error: 'No report for that period' });

  const [indicators, findings, actions, decisions, periods] = await Promise.all([
    pool.request().input('rid', sql.Int, report.Id)
      .query(`SELECT Name, Actual, Target, StatusKind, Note
              FROM dbo.FsaReportIndicators WHERE ReportId = @rid ORDER BY SortOrder`),
    pool.request().input('rid', sql.Int, report.Id)
      .query(`SELECT Kind, Ref, Title, Evidence, CorrectiveAction, Owner, DueDate
              FROM dbo.FsaReportFindings WHERE ReportId = @rid ORDER BY SortOrder`),
    pool.request().input('rid', sql.Int, report.Id)
      .query(`SELECT Id, Section, Body, Owner, DueDate, State, Ticked, TickedBy, TickedAt
              FROM dbo.FsaReportActions WHERE ReportId = @rid ORDER BY Section, SortOrder`),
    pool.request().input('rid', sql.Int, report.Id)
      .query(`SELECT Title, Body FROM dbo.FsaReportDecisions WHERE ReportId = @rid ORDER BY SortOrder`),
    pool.request().query('SELECT Period, PeriodLabel FROM dbo.FsaReports ORDER BY Period DESC'),
  ]);

  const all = actions.recordset;
  const commitments = all.filter((a) => a.Section === 'commitment');

  res.json({
    report,
    indicators: indicators.recordset,
    findings: findings.recordset,
    priorActions: all.filter((a) => a.Section === 'prior'),
    commitments,
    decisions: decisions.recordset,
    periods: periods.recordset,
    // Derived, so the summary can never disagree with the table under it.
    summary: {
      indicators: indicators.recordset.length,
      onTarget: indicators.recordset.filter((i) => i.StatusKind === 'ok').length,
      observations: indicators.recordset.filter((i) => i.StatusKind === 'observation').length,
      findingsCount: indicators.recordset.filter((i) => i.StatusKind === 'finding').length,
      commitmentsTicked: commitments.filter((c) => c.Ticked).length,
      commitmentsTotal: commitments.length,
    },
  });
}));

// Ticking a commitment in the meeting — the only write on this screen.
router.post('/report/actions/:id/tick', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const ticked = asBool(req.body?.ticked);

  const pool = await getPool();
  const r = await pool
    .request()
    .input('id', sql.Int, id)
    .input('ticked', sql.Bit, ticked ? 1 : 0)
    .input('by', sql.NVarChar(255), ticked ? (req.user?.email || null) : null)
    .query(`UPDATE dbo.FsaReportActions
            SET Ticked = @ticked,
                TickedBy = @by,
                TickedAt = CASE WHEN @ticked = 1 THEN SYSUTCDATETIME() ELSE NULL END
            OUTPUT INSERTED.Id, INSERTED.Ticked, INSERTED.TickedBy, INSERTED.TickedAt
            WHERE Id = @id AND Section = 'commitment'`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Commitment not found' });
  res.json(r.recordset[0]);
}));

// --- Performance management (§5.6) ---------------------------------------
// Pack completeness across the register, then one employee's pack.
router.get('/performance', wrap(async (_req, res) => {
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT p.Id, p.StaffNo, p.CycleYear, p.Stage, p.Role,
            p.JdState, p.KpiState, p.EdpState,
            s.Name, s.Service, s.Site
     FROM dbo.FsaPerfPacks p
     LEFT JOIN dbo.FsaStaff s ON s.StaffNo = p.StaffNo
     ORDER BY s.Name`
  );

  const rows = r.recordset;
  const complete = (x) =>
    x.JdState === 'complete' && x.KpiState === 'complete' && x.EdpState === 'complete';

  res.json({
    rows,
    stages: await vocab(pool, 'perf_stage'),
    docStates: await vocab(pool, 'perf_doc_state'),
    // Pack completeness is derived, never stored (§6).
    summary: {
      total: rows.length,
      complete: rows.filter(complete).length,
      outstanding: rows.filter((x) => !complete(x)).length,
    },
  });
}));

router.get('/performance/:staffNo', wrap(async (req, res) => {
  const pool = await getPool();
  const staffNo = req.params.staffNo;

  const head = await pool
    .request()
    .input('sn', sql.NVarChar(20), staffNo)
    .query(`SELECT p.Id, p.StaffNo, p.CycleYear, p.Stage, p.Role, p.TemplateId,
                   p.JdState, p.KpiState, p.EdpState, p.Mandate, p.ReportsTo, p.RegType,
                   s.Name, s.Service, s.Site, s.Registration, s.RegKind, s.RegExpiry, s.Contract
            FROM dbo.FsaPerfPacks p
            LEFT JOIN dbo.FsaStaff s ON s.StaffNo = p.StaffNo
            WHERE p.StaffNo = @sn
            ORDER BY p.CycleYear DESC
            LIMIT 1`);
  const pack = head.recordset[0];
  if (!pack) return res.status(404).json({ error: 'No performance pack for that employee' });

  const [kras, measures, goals] = await Promise.all([
    pool.request().input('pid', sql.Int, pack.Id)
      .query(`SELECT Id, Area, Duties, Weight FROM dbo.FsaPerfKras
              WHERE PackId = @pid ORDER BY SortOrder`),
    pool.request().input('pid', sql.Int, pack.Id)
      .query(`SELECT Id, Area, Detail, Target, Weight, Rating FROM dbo.FsaPerfMeasures
              WHERE PackId = @pid ORDER BY SortOrder`),
    pool.request().input('pid', sql.Int, pack.Id)
      .query(`SELECT g.Id, g.MeasureId, g.Goal, g.Provider, g.StartDate, g.EndDate,
                     g.SignedBy, g.SignedAt, m.Area AS FromArea, m.Rating AS FromRating
              FROM dbo.FsaPerfGoals g
              LEFT JOIN dbo.FsaPerfMeasures m ON m.Id = g.MeasureId
              WHERE g.PackId = @pid ORDER BY g.SortOrder`),
  ]);

  const rated = measures.recordset.filter((m) => m.Rating != null);
  // A weighted score over the rated measures only — an unrated schedule should
  // not read as a score of zero.
  const weight = rated.reduce((n, m) => n + Number(m.Weight || 0), 0);
  const weighted = weight
    ? rated.reduce((n, m) => n + Number(m.Rating) * Number(m.Weight || 0), 0) / weight
    : null;

  res.json({
    pack,
    kras: kras.recordset,
    measures: measures.recordset,
    goals: goals.recordset,
    // The same vocabularies the list sends, so the detail view labels a stage
    // from the reference data too rather than from a copy in the component.
    stages: await vocab(pool, 'perf_stage'),
    docStates: await vocab(pool, 'perf_doc_state'),
    ratingMeets: PERF_MEETS,
    ratingLabels: Object.fromEntries(
      ((await lookups(pool)).get('perf_rating') || []).map((x) => [x.Code, x.Label])
    ),
    // Shortfalls are computed from the ratings, and they are what the EDP is
    // built from — the handoff is explicit that below-"Meets" areas are
    // computed, not entered.
    shortfalls: measures.recordset
      .filter((m) => m.Rating != null && Number(m.Rating) < PERF_MEETS)
      .map((m) => ({ id: m.Id, area: m.Area, rating: m.Rating })),
    derived: {
      ratedCount: rated.length,
      measureCount: measures.recordset.length,
      weightedScore: weighted == null ? null : Math.round(weighted * 100) / 100,
      kraWeightTotal: kras.recordset.reduce((n, k) => n + Number(k.Weight || 0), 0),
      measureWeightTotal: measures.recordset.reduce((n, m) => n + Number(m.Weight || 0), 0),
    },
  });
}));

// Rate a measure. Re-deriving the EDP is part of the same operation: a rating
// that drops below "Meets" adds its development goal, and one that recovers
// removes it, so the plan cannot drift away from the ratings that justify it.
router.patch('/performance/:staffNo/measures/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const raw = req.body?.rating;
  const rating = raw === null || raw === '' ? null : parseInt(raw, 10);
  if (rating !== null && !(rating >= 1 && rating <= 5)) {
    return res.status(400).json({ error: 'rating must be 1–5, or null to clear it' });
  }

  const pool = await getPool();
  const found = await pool
    .request()
    .input('id', sql.Int, id)
    .input('sn', sql.NVarChar(20), req.params.staffNo)
    .query(`SELECT m.Id, m.PackId, m.Area
            FROM dbo.FsaPerfMeasures m
            INNER JOIN dbo.FsaPerfPacks p ON p.Id = m.PackId
            WHERE m.Id = @id AND p.StaffNo = @sn`);
  const measure = found.recordset[0];
  if (!measure) return res.status(404).json({ error: 'Measure not found on that pack' });

  await pool.request()
    .input('id', sql.Int, id)
    .input('rating', sql.Int, rating)
    .query('UPDATE dbo.FsaPerfMeasures SET Rating = @rating WHERE Id = @id');

  const existing = await pool.request().input('mid', sql.Int, id)
    .query('SELECT Id FROM dbo.FsaPerfGoals WHERE MeasureId = @mid');

  if (rating != null && rating < PERF_MEETS) {
    if (!existing.recordset[0]) {
      const [goal, provider] = PERF_GOAL_ROUTES[measure.Area] || PERF_GOAL_FALLBACK;
      const next = await pool.request().input('pid', sql.Int, measure.PackId)
        .query('SELECT COALESCE(MAX(SortOrder), -1) + 1 AS NextSort FROM dbo.FsaPerfGoals WHERE PackId = @pid');
      await pool.request()
        .input('pid', sql.Int, measure.PackId)
        .input('mid', sql.Int, id)
        .input('goal', sql.NVarChar(sql.MAX), goal)
        .input('prov', sql.NVarChar(160), provider)
        .input('sort', sql.Int, Number(next.recordset[0].NextSort) || 0)
        .query(`INSERT INTO dbo.FsaPerfGoals (PackId, MeasureId, Goal, Provider, SortOrder)
                VALUES (@pid, @mid, @goal, @prov, @sort)`);
    }
  } else if (existing.recordset[0]) {
    // Only remove a goal that is still unsigned; a signed development action
    // stays on the record even if the rating later recovers.
    await pool.request().input('mid', sql.Int, id)
      .query('DELETE FROM dbo.FsaPerfGoals WHERE MeasureId = @mid AND SignedBy IS NULL');
  }

  res.json({ ok: true, id, rating });
}));

// Move the pack through its four-stage cycle.
router.patch('/performance/:staffNo/stage', wrap(async (req, res) => {
  const stage = (req.body?.stage || '').toString();
  const pool = await getPool();
  const allowed = ((await lookups(pool)).get('perf_stage') || []).map((x) => x.Code);
  if (!allowed.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${allowed.join(', ')}` });
  }
  const r = await pool
    .request()
    .input('sn', sql.NVarChar(20), req.params.staffNo)
    .input('stage', sql.NVarChar(20), stage)
    .query(`UPDATE dbo.FsaPerfPacks
            SET Stage = @stage, UpdatedAt = SYSUTCDATETIME()
            OUTPUT INSERTED.Id, INSERTED.StaffNo, INSERTED.Stage
            WHERE StaffNo = @sn`);
  if (!r.recordset[0]) return res.status(404).json({ error: 'Pack not found' });
  res.json(r.recordset[0]);
}));

export default router;
