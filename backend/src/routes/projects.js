import { Router } from 'express';
import { getPool, sql, rerunRuntimeMigrations } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';
import { generateSowPdf, buildSowPdfBuffer, DEFAULT_SIG_ROWS } from '../sow-pdf.js';
import { deleteUpload, upload, uploadDoc, UPLOAD_DIR } from '../upload.js';
import path from 'node:path';

// Compute the next document version from the previously-saved one. First
// save → "1.0". Every subsequent save increments the minor digit by 1
// (1.0 → 1.1 → 1.2 → … → 1.9 → 1.10 → …). The major number is preserved
// from the previous save, so an admin can bump it by manually editing the
// JSON if they ever need a "2.0".  Unknown / malformed previous versions
// fall back to "1.0" so the version sequence stays predictable.
function nextSowVersion(previousVersion) {
  if (!previousVersion) return '1.0';
  const cleaned = String(previousVersion).trim().replace(/^[Vv]/, '');
  const m = cleaned.match(/^(\d+)\.(\d+)/);
  if (!m) return '1.0';
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10) + 1;
  return `${major}.${minor}`;
}

// Look up the company-level Service Provider defaults (Name & Surname /
// Post Designation / Location) for a given process. Wrapped in try/catch so
// the route still works against an older database that doesn't yet have the
// new SowProviderName / SowProviderDesignation / SowProviderLocation columns
// — the auto-migration in db.js adds them on first connect, but if the DB
// user lacks ALTER TABLE permission this fallback prevents a 500.
async function loadProviderDefaults(pool, processId, baseRow) {
  try {
    const r = await pool
      .request()
      .input('id', sql.Int, processId)
      .query(`
        SELECT c.SowProviderName, c.SowProviderDesignation, c.SowProviderLocation
        FROM dbo.ProjectProcesses pp
        INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
        INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
        WHERE pp.Id = @id;
      `);
    if (r.recordset[0]) return { ...baseRow, ...r.recordset[0] };
  } catch (err) {
    // Column missing (e.g. migration blocked) — fall back to no defaults.
    console.warn('[sow] provider-defaults lookup skipped:', err.message);
  }
  return baseRow;
}

// Map the per-company "service provider" defaults (name / designation /
// location) onto the matching rows of the provider-kind signature party.
// The defaults only apply when a row's value is blank — anything the SOW
// author has typed in always wins. Used by both the save endpoint and the
// live preview so previews and saved PDFs stay byte-identical.
//
// Handles three legacy shapes the editor may submit:
//   1) `signatures.parties = [...]` (new) → find / inject the provider-kind
//      entry and fill its rows.
//   2) `signatures.provider = {...}` (older) → migrate to a parties list
//      with Client + Provider and fall through to (1).
//   3) Flat-field shape (no parties, no provider object) → seed a default
//      parties list.
function applyProviderDefaults(signatures, row) {
  const sigs = signatures && typeof signatures === 'object' ? { ...signatures } : {};

  // Promote legacy shapes to a parties array so the rest of this function
  // can work uniformly. The downstream PDF generator also accepts these
  // shapes — this normalisation is just to make the row-fill logic
  // simpler here.
  let parties;
  if (Array.isArray(sigs.parties)) {
    parties = sigs.parties.map((p) => ({ ...p, rows: Array.isArray(p.rows) ? p.rows.map((r) => ({ ...r })) : [] }));
  } else if (sigs.client || sigs.provider) {
    parties = [
      { kind: 'client',   title: 'Client',           company: sigs.client?.company   || sigs.clientCompany   || '', rows: Array.isArray(sigs.client?.rows)   ? sigs.client.rows.map((r) => ({ ...r }))   : [] },
      { kind: 'provider', title: 'Service Provider', company: sigs.provider?.company || sigs.providerCompany || '', rows: Array.isArray(sigs.provider?.rows) ? sigs.provider.rows.map((r) => ({ ...r })) : [] },
    ];
  } else {
    parties = [
      { kind: 'client',   title: 'Client',           company: '', rows: DEFAULT_SIG_ROWS.map(({ label }) => ({ label, value: '' })) },
      { kind: 'provider', title: 'Service Provider', company: '', rows: DEFAULT_SIG_ROWS.map(({ label }) => ({ label, value: '' })) },
    ];
  }

  // Find the first provider-kind party. If none exists (author removed it)
  // we don't inject — respect the author's choice and just leave the list
  // as-is. Provider defaults only matter when a provider party is present.
  const provider = parties.find((p) => p.kind === 'provider');
  if (provider) {
    if (!Array.isArray(provider.rows) || provider.rows.length === 0) {
      provider.rows = DEFAULT_SIG_ROWS.map(({ label }) => ({ label, value: '' }));
    }
    const fillIfBlank = (label, defaultValue) => {
      if (!defaultValue) return;
      const target = provider.rows.find((r) => (r.label || '').toLowerCase() === label.toLowerCase());
      if (target && !target.value) target.value = defaultValue;
    };
    fillIfBlank('Name & Surname',  row.SowProviderName);
    fillIfBlank('Post Designation', row.SowProviderDesignation);
    fillIfBlank('Location',         row.SowProviderLocation);
    if (!provider.company) provider.company = row.CompanyName || '';
  }

  // Drop the legacy keys so the SOW JSON saved going forward is a single
  // canonical shape.
  return { parties };
}

const router = Router();
router.use(requireAuth);
router.use(requireSegments('procurement', 'hr_projects'));

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function mapProject(r) {
  return {
    id: r.Id,
    companyId: r.CompanyId,
    name: r.Name,
    description: r.Description,
    color: r.Color,
    // Workspace this project lives in — 'Procurement' (default) for
    // existing rows, 'Human Resources' for HR-page projects.
    department: r.Department || 'Procurement',
    // Null while the project is active; an ISO timestamp once it's been
    // marked complete. The frontend uses presence to bucket projects
    // into "Active" / "Completed" lists.
    completedAt: r.CompletedAt ?? null,
    createdBy: r.CreatedBy ?? null,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}

router.get('/', async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  // `status` selects between the two buckets — defaults to active so
  // the procurement page doesn't show completed projects unless the
  // user explicitly switches the tab.
  const status = (req.query.status || 'active').toString().toLowerCase();
  let whereExtra = ' AND CompletedAt IS NULL';
  if (status === 'completed') whereExtra = ' AND CompletedAt IS NOT NULL';
  else if (status === 'all')   whereExtra = '';

  // `department` scopes the list to one workspace (Procurement / HR /
  // …). Default to Procurement so older callers keep working. Pass an
  // empty string or `all` to skip the filter and see every project.
  const rawDept = req.query.department;
  const department = typeof rawDept === 'string' ? rawDept.trim() : '';
  const filterByDept = department && department.toLowerCase() !== 'all';

  try {
    const pool = await getPool();
    const request = pool.request().input('cid', sql.Int, companyId);
    if (filterByDept) request.input('dept', sql.NVarChar(50), department);
    const result = await request.query(`
        SELECT Id, CompanyId, Name, Description, Color, Department,
               CompletedAt, CreatedBy, CreatedAt, UpdatedAt
        FROM dbo.Projects
        WHERE CompanyId = @cid${filterByDept ? ' AND Department = @dept' : ''}${whereExtra}
        ORDER BY ${status === 'completed' ? 'CompletedAt DESC, ' : ''}Name;
      `);
    res.json(result.recordset.map(mapProject));
  } catch (err) {
    console.error('[projects/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { companyId, name, description, color, department } = req.body ?? {};
  if (!companyId || !name?.trim()) {
    return res.status(400).json({ error: 'companyId and name are required' });
  }
  const safeColor = color && HEX_RE.test(color) ? color : null;
  // Default to Procurement when the client doesn't specify (older
  // callers). The column has a server-side default of 'Procurement'
  // too, but passing the parameter keeps the SQL explicit.
  const safeDepartment = typeof department === 'string' && department.trim()
    ? department.trim().slice(0, 50)
    : 'Procurement';

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('cid', sql.Int, companyId)
      .input('name', sql.NVarChar(255), name.trim())
      .input('desc', sql.NVarChar(sql.MAX), description?.trim() || null)
      .input('color', sql.NVarChar(20), safeColor)
      .input('dept',  sql.NVarChar(50), safeDepartment)
      .input('createdBy', sql.NVarChar(255), req.user?.email || null)
      .query(`
        INSERT INTO dbo.Projects (CompanyId, Name, Description, Color, Department, CreatedBy)
        OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Description, INSERTED.Color,
               INSERTED.Department, INSERTED.CompletedAt, INSERTED.CreatedBy, INSERTED.CreatedAt, INSERTED.UpdatedAt
        VALUES (@cid, @name, @desc, @color, @dept, @createdBy);
      `);
    res.status(201).json(mapProject(result.recordset[0]));
  } catch (err) {
    console.error('[projects/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, description, color } = req.body ?? {};
  const safeColor = color === '' ? null : (color && HEX_RE.test(color) ? color : undefined);

  try {
    const pool = await getPool();
    const reqQ = pool.request().input('id', sql.Int, id);
    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];

    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      reqQ.input('name', sql.NVarChar(255), name.trim());
      setParts.push('Name = @name');
    }
    if (description !== undefined) {
      reqQ.input('desc', sql.NVarChar(sql.MAX), description?.trim() || null);
      setParts.push('Description = @desc');
    }
    if (safeColor !== undefined) {
      reqQ.input('color', sql.NVarChar(20), safeColor);
      setParts.push('Color = @color');
    }

    const result = await reqQ.query(`
      UPDATE dbo.Projects SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Description, INSERTED.Color, INSERTED.Department, INSERTED.CompletedAt, INSERTED.CreatedBy, INSERTED.CreatedAt, INSERTED.UpdatedAt
      WHERE Id = @id;
    `);
    if (!result.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapProject(result.recordset[0]));
  } catch (err) {
    console.error('[projects/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle a project's completion state. POST to /:id/complete sets
// CompletedAt = now; POST to /:id/reopen clears it. Returns the
// updated project so the client can replace its row without a refetch.
router.post('/:id/complete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.Projects
        SET CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Description, INSERTED.Color,
               INSERTED.Department, INSERTED.CompletedAt, INSERTED.CreatedBy, INSERTED.CreatedAt, INSERTED.UpdatedAt
        WHERE Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapProject(r.recordset[0]));
  } catch (err) {
    console.error('[projects/complete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/reopen', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.Projects
        SET CompletedAt = NULL, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Description, INSERTED.Color,
               INSERTED.Department, INSERTED.CompletedAt, INSERTED.CreatedBy, INSERTED.CreatedAt, INSERTED.UpdatedAt
        WHERE Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapProject(r.recordset[0]));
  } catch (err) {
    console.error('[projects/reopen]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.Projects WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[projects/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============== Processes (whiteboard tasks within a project) ===============

function mapProcess(r) {
  // hasSow: true once the task has either a saved SOW PDF *or* a seeded
  // SOW JSON snapshot (e.g. from a template applied on creation). The
  // whiteboard uses this flag to decide whether to render the SOW editor
  // button and the version-history card — replaces the older hardcoded
  // `name === 'Scope of Service'` check.
  const hasSowData = r.HasSowData === 1 || r.HasSowData === true;
  // Task "kind" — drives which editor the frontend opens.
  //   'sow' — existing SOW editor (default).
  //   'kpa' — KPA-formulation editor (employee + weighted KPA list).
  //   'jd'  — Job Description editor (title, hours, qualifications, etc.).
  //   'edp' — EDP Alignment Notes editor (multiple EDPs each with WIG + lead measures).
  //   'kpidoc' — KPI Document editor (formal review document pulled from KPA).
  //   'pack' — Role/KPI/EDP Pack (combined PDF of JD + KPI Doc + EDP for the project).
  const kind = (r.Kind === 'kpa' || r.Kind === 'jd' || r.Kind === 'edp' || r.Kind === 'kpidoc' || r.Kind === 'pack') ? r.Kind : 'sow';
  const hasKpaData    = r.HasKpaData    === 1 || r.HasKpaData    === true;
  const hasJdData     = r.HasJdData     === 1 || r.HasJdData     === true;
  const hasEdpData    = r.HasEdpData    === 1 || r.HasEdpData    === true;
  const hasKpidocData = r.HasKpidocData === 1 || r.HasKpidocData === true;
  return {
    id: r.Id,
    projectId: r.ProjectId,
    name: r.Name,
    description: r.Description,
    color: r.Color,
    x: r.PositionX,
    y: r.PositionY,
    sowDocUrl: r.SowDocFile ? `/uploads/${r.SowDocFile}` : null,
    hasSow: hasSowData || !!r.SowDocFile,
    kind,
    employeeId: Number.isFinite(r.EmployeeId) ? r.EmployeeId : null,
    hasKpa: hasKpaData,
    hasJd:  hasJdData,
    hasEdp: hasEdpData,
    hasKpidoc: hasKpidocData,
    // The template this process was seeded from (null if blank). The
    // whiteboard uses it to look up the template's nextTemplateIds and
    // render ghost successor cards branching off this task.
    sourceTemplateId: Number.isFinite(r.SourceTemplateId) ? r.SourceTemplateId : null,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
  };
}

// Coerce KPA data from storage (JSON string) or a request body into the
// canonical shape:
//   { employeeId: number|null,
//     kpas: [{ name, weight, coreValues, kpi, measures }] }
// Strings are trimmed and length-capped; weights clamped to [0, 100];
// both the row list and the per-row arrays are capped so the JSON blob
// can't be abused. Rows with no signal in any field are dropped.
//
// Older rows that pre-date the multi-field shape (those with a flat
// `department` field) still round-trip — the parser accepts and preserves
// `department` so editing them doesn't silently lose data.
function parseKpaPayload(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  if (!obj || typeof obj !== 'object') return { employeeId: null, kpas: [] };
  const employeeId = Number.isFinite(obj.employeeId) ? obj.employeeId
    : (Number.isFinite(parseInt(obj.employeeId, 10)) ? parseInt(obj.employeeId, 10) : null);
  const rawList = Array.isArray(obj.kpas) ? obj.kpas : [];
  const cleanString = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const cleanStringList = (v, max, cap) => (Array.isArray(v)
    ? v.map((x) => cleanString(x, max)).filter(Boolean).slice(0, cap)
    : []);
  // Parse the per-KPA `kpis` sub-array. Each KPI has a description and
  // its own list of measures. The top-level KPA used to carry a single
  // `kpi` + `measures` pair; older rows in that shape are promoted to a
  // single-element kpis array on read so the editor sees a uniform shape.
  function parseKpisArray(row) {
    if (Array.isArray(row.kpis)) {
      return row.kpis
        .map((k) => {
          if (!k || typeof k !== 'object') return null;
          const description = cleanString(k.description, 2000);
          const measures = cleanStringList(k.measures, 500, 50);
          if (!description && measures.length === 0) return null;
          return { description, measures };
        })
        .filter(Boolean)
        .slice(0, 50);
    }
    // Legacy shape — { kpi, measures } at the KPA level. Promote into
    // a single-element kpis[] entry so the rest of the app only has to
    // handle the nested shape.
    const description = cleanString(row.kpi, 2000);
    const measures = cleanStringList(row.measures, 500, 50);
    if (!description && measures.length === 0) return [];
    return [{ description, measures }];
  }

  const kpas = rawList
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const name = cleanString(row.name, 255);
      const department = cleanString(row.department, 255); // legacy field
      const w = Number(row.weight);
      const weight = Number.isFinite(w) ? Math.min(100, Math.max(0, w)) : 0;
      const coreValues = cleanStringList(row.coreValues, 255, 50);
      const kpis = parseKpisArray(row);
      const hasSignal = name || department || weight || coreValues.length || kpis.length;
      if (!hasSignal) return null;
      const out = { name, weight, coreValues, kpis };
      // Preserve legacy `department` so saved-then-edited tasks keep it.
      if (department) out.department = department;
      return out;
    })
    .filter(Boolean)
    .slice(0, 50);
  return { employeeId, kpas };
}

router.get('/:id/processes', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('pid', sql.Int, id)
      .query(`
        SELECT Id, ProjectId, Name, Description, Color, PositionX, PositionY, SowDocFile,
               CASE WHEN SowDataJson IS NULL THEN 0 ELSE 1 END AS HasSowData,
               Kind, EmployeeId,
               CASE WHEN KpaDataJson IS NULL THEN 0 ELSE 1 END AS HasKpaData,
               CASE WHEN JdDataJson    IS NULL THEN 0 ELSE 1 END AS HasJdData,
               CASE WHEN EdpDataJson   IS NULL THEN 0 ELSE 1 END AS HasEdpData,
               CASE WHEN KpidocDataJson IS NULL THEN 0 ELSE 1 END AS HasKpidocData,
               SourceTemplateId,
               CreatedAt, UpdatedAt
        FROM dbo.ProjectProcesses
        WHERE ProjectId = @pid
        ORDER BY CreatedAt;
      `);
    res.json(result.recordset.map(mapProcess));
  } catch (err) {
    console.error('[projects/processes/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/processes', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, description, color, x, y, sowTemplateId, employeeId } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const safeColor = color && HEX_RE.test(color) ? color : null;

  // Parse optional employee binding — used by KPA-kind tasks so reporting
  // can group weighted KPAs by employee later. Silently ignored when null
  // or non-numeric.
  const empIdParsed = parseInt(employeeId, 10);
  const safeEmployeeId = Number.isFinite(empIdParsed) ? empIdParsed : null;

  try {
    const pool = await getPool();

    // Optional template snapshot. If `sowTemplateId` is supplied AND the
    // template exists, copy its DataJson into the new process's SowDataJson
    // so the SOW editor opens pre-filled. The copy is independent of the
    // template — later edits to the template don't propagate. We also read
    // the template's Kind so the new process inherits 'sow' or 'kpa'.
    let sowSnapshot    = null;
    let jdSnapshot     = null;
    let edpSnapshot    = null;
    let kpidocSnapshot = null;
    let resolvedTemplateId = null;
    let resolvedKind = 'sow';
    if (sowTemplateId) {
      const tid = parseInt(sowTemplateId, 10);
      if (Number.isFinite(tid)) {
        const t = await pool.request().input('tid', sql.Int, tid)
          .query('SELECT DataJson, Kind FROM dbo.SowTemplates WHERE Id = @tid');
        if (t.recordset[0]) {
          // Resolve the id even if the template carries no data — knowing
          // the source still drives ghost-successor rendering on the
          // whiteboard.
          resolvedTemplateId = tid;
          const tKind = t.recordset[0].Kind;
          if (tKind === 'kpa' || tKind === 'jd' || tKind === 'edp' || tKind === 'kpidoc' || tKind === 'pack') resolvedKind = tKind;
          // Snapshot the template's body into the corresponding kind-
          // specific column. KPA tasks never carry a template body —
          // they capture fresh data per task.
          if (resolvedKind === 'sow'    && t.recordset[0].DataJson) sowSnapshot    = t.recordset[0].DataJson;
          if (resolvedKind === 'jd'     && t.recordset[0].DataJson) jdSnapshot     = t.recordset[0].DataJson;
          if (resolvedKind === 'edp'    && t.recordset[0].DataJson) edpSnapshot    = t.recordset[0].DataJson;
          if (resolvedKind === 'kpidoc' && t.recordset[0].DataJson) kpidocSnapshot = t.recordset[0].DataJson;
        }
      }
    }

    const result = await pool
      .request()
      .input('pid', sql.Int, id)
      .input('name', sql.NVarChar(255), name.trim())
      .input('desc', sql.NVarChar(sql.MAX), description?.trim() || null)
      .input('color', sql.NVarChar(20), safeColor)
      .input('x', sql.Float, Number.isFinite(Number(x)) ? Number(x) : 0)
      .input('y', sql.Float, Number.isFinite(Number(y)) ? Number(y) : 0)
      .input('sowJson', sql.NVarChar(sql.MAX), sowSnapshot)
      .input('jdJson',  sql.NVarChar(sql.MAX), jdSnapshot)
      .input('edpJson', sql.NVarChar(sql.MAX), edpSnapshot)
      .input('kpidocJson', sql.NVarChar(sql.MAX), kpidocSnapshot)
      .input('srcTpl', sql.Int, resolvedTemplateId)
      .input('kind', sql.NVarChar(20), resolvedKind)
      .input('emp', sql.Int, resolvedKind === 'kpa' ? safeEmployeeId : null)
      .query(`
        INSERT INTO dbo.ProjectProcesses (ProjectId, Name, Description, Color, PositionX, PositionY, SowDataJson, JdDataJson, EdpDataJson, KpidocDataJson, SourceTemplateId, Kind, EmployeeId)
        OUTPUT INSERTED.Id, INSERTED.ProjectId, INSERTED.Name, INSERTED.Description, INSERTED.Color,
               INSERTED.PositionX, INSERTED.PositionY, INSERTED.SowDocFile,
               CASE WHEN INSERTED.SowDataJson    IS NULL THEN 0 ELSE 1 END AS HasSowData,
               INSERTED.Kind, INSERTED.EmployeeId,
               CASE WHEN INSERTED.KpaDataJson    IS NULL THEN 0 ELSE 1 END AS HasKpaData,
               CASE WHEN INSERTED.JdDataJson     IS NULL THEN 0 ELSE 1 END AS HasJdData,
               CASE WHEN INSERTED.EdpDataJson    IS NULL THEN 0 ELSE 1 END AS HasEdpData,
               CASE WHEN INSERTED.KpidocDataJson IS NULL THEN 0 ELSE 1 END AS HasKpidocData,
               INSERTED.SourceTemplateId,
               INSERTED.CreatedAt, INSERTED.UpdatedAt
        VALUES (@pid, @name, @desc, @color, @x, @y, @sowJson, @jdJson, @edpJson, @kpidocJson, @srcTpl, @kind, @emp);
      `);
    res.status(201).json(mapProcess(result.recordset[0]));
  } catch (err) {
    console.error('[projects/processes/create]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/processes/:processId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, description, color, x, y } = req.body ?? {};
  const safeColor = color === '' ? null : (color && HEX_RE.test(color) ? color : undefined);

  try {
    const pool = await getPool();
    const reqQ = pool.request().input('id', sql.Int, id);
    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];

    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      reqQ.input('name', sql.NVarChar(255), name.trim());
      setParts.push('Name = @name');
    }
    if (description !== undefined) {
      reqQ.input('desc', sql.NVarChar(sql.MAX), description?.trim() || null);
      setParts.push('Description = @desc');
    }
    if (safeColor !== undefined) {
      reqQ.input('color', sql.NVarChar(20), safeColor);
      setParts.push('Color = @color');
    }
    if (x !== undefined && Number.isFinite(Number(x))) {
      reqQ.input('x', sql.Float, Number(x));
      setParts.push('PositionX = @x');
    }
    if (y !== undefined && Number.isFinite(Number(y))) {
      reqQ.input('y', sql.Float, Number(y));
      setParts.push('PositionY = @y');
    }

    const result = await reqQ.query(`
      UPDATE dbo.ProjectProcesses SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id, INSERTED.ProjectId, INSERTED.Name, INSERTED.Description, INSERTED.Color,
             INSERTED.PositionX, INSERTED.PositionY, INSERTED.SowDocFile,
             CASE WHEN INSERTED.SowDataJson IS NULL THEN 0 ELSE 1 END AS HasSowData,
             INSERTED.Kind, INSERTED.EmployeeId,
             CASE WHEN INSERTED.KpaDataJson IS NULL THEN 0 ELSE 1 END AS HasKpaData,
             CASE WHEN INSERTED.JdDataJson     IS NULL THEN 0 ELSE 1 END AS HasJdData,
             CASE WHEN INSERTED.EdpDataJson    IS NULL THEN 0 ELSE 1 END AS HasEdpData,
             CASE WHEN INSERTED.KpidocDataJson IS NULL THEN 0 ELSE 1 END AS HasKpidocData,
             INSERTED.SourceTemplateId,
             INSERTED.CreatedAt, INSERTED.UpdatedAt
      WHERE Id = @id;
    `);
    if (!result.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapProcess(result.recordset[0]));
  } catch (err) {
    console.error('[projects/processes/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============== KPA-formulation task data ===============
// Lives on the same ProjectProcesses row as the SOW form, but in a
// dedicated `KpaDataJson` column + an `EmployeeId` foreign-key-style column.
// Kept on its own routes (parallel to /sow) so the SOW editor doesn't have
// to know about KPA-kind tasks and vice-versa.
router.get('/processes/:processId/kpa', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`
        SELECT pp.Name AS ProcessName, pp.Kind, pp.EmployeeId, pp.KpaDataJson,
               p.CompanyId
        FROM dbo.ProjectProcesses pp
        INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
        WHERE pp.Id = @id;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    if (row.Kind !== 'kpa') return res.status(400).json({ error: 'Not a KPA-kind process' });
    // Reuse the same parser the PUT uses so storage shape and response
    // shape are identical — the editor can mount its rows directly.
    const parsed = parseKpaPayload({ employeeId: row.EmployeeId, kpas: row.KpaDataJson ? JSON.parse(row.KpaDataJson) : [] });
    res.json({
      processName: row.ProcessName,
      companyId: row.CompanyId,
      ...parsed,
    });
  } catch (err) {
    console.error('[projects/processes/kpa/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/processes/:processId/kpa', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const payload = parseKpaPayload(req.body ?? {});
  try {
    const pool = await getPool();
    // Make sure the process exists and is KPA-kind. We refuse to write KPA
    // data onto a SOW process so the two editors stay strictly separate.
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT Kind FROM dbo.ProjectProcesses WHERE Id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });
    if (existing.recordset[0].Kind !== 'kpa') {
      return res.status(400).json({ error: 'Not a KPA-kind process' });
    }
    const jsonString = payload.kpas.length ? JSON.stringify(payload.kpas) : null;
    await pool.request()
      .input('id', sql.Int, id)
      .input('emp', sql.Int, payload.employeeId)
      .input('json', sql.NVarChar(sql.MAX), jsonString)
      .query(`
        UPDATE dbo.ProjectProcesses
          SET EmployeeId = @emp, KpaDataJson = @json, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id;
      `);

    // Append an immutable version row so the whiteboard can show history
    // for this KPA the same way it does for SOWs. Auto-increments the
    // minor version off whatever the last saved one was (defaulting to
    // 1.0 if this is the first save). Wrapped in try/catch so a missing
    // KpaVersions table doesn't fail the main UPDATE.
    try {
      const prev = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 Version FROM dbo.KpaVersions
        WHERE ProcessId = @id ORDER BY CreatedAt DESC, Id DESC;
      `);
      const computedVersion = nextSowVersion(prev.recordset[0]?.Version);
      await pool.request()
        .input('id',      sql.Int,            id)
        .input('version', sql.NVarChar(50),   computedVersion)
        .input('json',    sql.NVarChar(sql.MAX), jsonString)
        .input('emp',     sql.Int,            payload.employeeId)
        .input('actor',   sql.NVarChar(255),  req.user?.email || null)
        .query(`
          INSERT INTO dbo.KpaVersions (ProcessId, Version, KpaDataJson, EmployeeId, CreatedBy)
          VALUES (@id, @version, @json, @emp, @actor);
        `);
    } catch (err) {
      console.warn('[kpa/put] could not append version history:', err.message);
    }
    res.json(payload);
  } catch (err) {
    console.error('[projects/processes/kpa/put]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// List every saved version of a KPA task (newest first).
router.get('/processes/:processId/kpa/versions', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT v.Id, v.Version, v.EmployeeId, v.CreatedAt, v.CreatedBy,
             e.Name AS EmployeeName
      FROM dbo.KpaVersions v
      LEFT JOIN dbo.Employees e ON e.Id = v.EmployeeId
      WHERE v.ProcessId = @id
      ORDER BY v.CreatedAt DESC, v.Id DESC;
    `);
    res.json(r.recordset.map((v) => ({
      id:           v.Id,
      version:      v.Version,
      employeeId:   v.EmployeeId,
      employeeName: v.EmployeeName,
      createdAt:    v.CreatedAt,
      createdBy:    v.CreatedBy,
    })));
  } catch (err) {
    console.error('[kpa/versions list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Full read-only snapshot of one saved version. Used by the version-view
// modal to render the KPAs / KPIs / measures as they were at save time.
router.get('/processes/:processId/kpa/versions/:versionId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(id) || Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id',  sql.Int, id)
      .input('vid', sql.Int, versionId)
      .query(`
        SELECT v.Id, v.Version, v.KpaDataJson, v.EmployeeId, v.CreatedAt, v.CreatedBy,
               e.Name AS EmployeeName
        FROM dbo.KpaVersions v
        LEFT JOIN dbo.Employees e ON e.Id = v.EmployeeId
        WHERE v.ProcessId = @id AND v.Id = @vid;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const v = r.recordset[0];
    // Reuse the same parser the live GET uses so the snapshot is
    // sanitised identically to a live read.
    const parsed = parseKpaPayload({
      employeeId: v.EmployeeId,
      kpas: v.KpaDataJson ? JSON.parse(v.KpaDataJson) : [],
    });
    res.json({
      id:           v.Id,
      version:      v.Version,
      employeeId:   v.EmployeeId,
      employeeName: v.EmployeeName,
      kpas:         parsed.kpas,
      createdAt:    v.CreatedAt,
      createdBy:    v.CreatedBy,
    });
  } catch (err) {
    console.error('[kpa/versions get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// =============== JD (Job Description) task data ===============
// Lives in `JdDataJson` on the same ProjectProcesses row. Routes mirror
// the KPA pair. The GET also resolves the first KPA-kind process in the
// same project so the editor can pull Key Responsibilities from there
// without a separate round-trip.
router.get('/processes/:processId/jd', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.Kind, pp.JdDataJson, pp.ProjectId,
             p.CompanyId, c.Name AS CompanyName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p  ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    if (row.Kind !== 'jd') return res.status(400).json({ error: 'Not a JD-kind process' });

    let data = null;
    try { data = row.JdDataJson ? JSON.parse(row.JdDataJson) : null; } catch {}

    // Resolve the first KPA-kind process in the same project so the
    // editor can render its KPAs/KPIs as Key Responsibilities.
    let kpaProcess = null;
    try {
      const k = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
        SELECT TOP 1 pp.Id, pp.Name, pp.KpaDataJson, pp.EmployeeId,
               e.Name AS EmployeeName
        FROM dbo.ProjectProcesses pp
        LEFT JOIN dbo.Employees e ON e.Id = pp.EmployeeId
        WHERE pp.ProjectId = @pid AND pp.Kind = 'kpa' AND pp.KpaDataJson IS NOT NULL
        ORDER BY pp.CreatedAt;
      `);
      if (k.recordset[0]) {
        let kpas = [];
        try { kpas = k.recordset[0].KpaDataJson ? JSON.parse(k.recordset[0].KpaDataJson) : []; } catch {}
        kpaProcess = {
          id: k.recordset[0].Id,
          name: k.recordset[0].Name,
          employeeId: k.recordset[0].EmployeeId,
          employeeName: k.recordset[0].EmployeeName,
          kpas: Array.isArray(kpas) ? kpas : [],
        };
      }
    } catch (err) {
      console.warn('[jd/get] could not resolve sibling KPA process:', err.message);
    }

    res.json({
      processName: row.ProcessName,
      companyId: row.CompanyId,
      companyName: row.CompanyName,
      data,
      kpaProcess,
    });
  } catch (err) {
    console.error('[projects/processes/jd/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/processes/:processId/jd', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT Kind FROM dbo.ProjectProcesses WHERE Id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });
    if (existing.recordset[0].Kind !== 'jd') {
      return res.status(400).json({ error: 'Not a JD-kind process' });
    }
    const jsonString = data ? JSON.stringify(data) : null;
    await pool.request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), jsonString)
      .query(`
        UPDATE dbo.ProjectProcesses
          SET JdDataJson = @json, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id;
      `);

    // Append an immutable version row so the whiteboard can show JD
    // history alongside SOW and KPA. Auto-bumps the minor version off
    // whatever the last saved one was. Wrapped in try/catch so a missing
    // JdVersions table doesn't fail the main UPDATE.
    try {
      const prev = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 Version FROM dbo.JdVersions
        WHERE ProcessId = @id ORDER BY CreatedAt DESC, Id DESC;
      `);
      const computedVersion = nextSowVersion(prev.recordset[0]?.Version);
      await pool.request()
        .input('id',      sql.Int,            id)
        .input('version', sql.NVarChar(50),   computedVersion)
        .input('json',    sql.NVarChar(sql.MAX), jsonString)
        .input('actor',   sql.NVarChar(255),  req.user?.email || null)
        .query(`
          INSERT INTO dbo.JdVersions (ProcessId, Version, JdDataJson, CreatedBy)
          VALUES (@id, @version, @json, @actor);
        `);
    } catch (err) {
      console.warn('[jd/put] could not append version history:', err.message);
    }

    res.json({ data });
  } catch (err) {
    console.error('[projects/processes/jd/put]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// List every saved JD version (newest first).
// Live preview — generates the JD PDF in memory using the same branding
// pipeline the SOW uses and streams the bytes back so the editor can
// render the preview inline. Pull-through Key Responsibilities are
// resolved server-side from the first KPA-kind process in the same
// project (same rule the GET /jd endpoint uses).
router.post('/processes/:processId/jd/preview-pdf', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};
  try {
    const pool = await getPool();
    const lookup = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.ProjectId,
             c.Name AS CompanyName, c.RegistrationNumber,
             c.SowHeaderFile, c.SowFooterFile,
             c.SowFontFamily, c.SowBodyFontSize,
             c.SowHeading1FontSize, c.SowHeading2FontSize, c.SowHeading3FontSize,
             c.DocH1AllCaps, c.DocH2AllCaps, c.DocH3AllCaps,
             c.DocHeaderSideMargin, c.DocFooterSideMargin
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!lookup.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = lookup.recordset[0];

    // Sibling KPA payload for the responsibilities pull-through.
    let kpaProcess = null;
    try {
      const k = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
        SELECT TOP 1 KpaDataJson FROM dbo.ProjectProcesses
        WHERE ProjectId = @pid AND Kind = 'kpa' AND KpaDataJson IS NOT NULL
        ORDER BY CreatedAt;
      `);
      if (k.recordset[0]?.KpaDataJson) {
        try { kpaProcess = { kpas: JSON.parse(k.recordset[0].KpaDataJson) }; } catch {}
      }
    } catch (err) {
      console.warn('[jd/preview-pdf] could not resolve sibling KPA:', err.message);
    }

    // Resolve the chosen reportTo employee's name for the meta block.
    let reportToName = '';
    const reportToId = parseInt(data.reportToEmployeeId, 10);
    if (Number.isFinite(reportToId)) {
      try {
        const e = await pool.request().input('eid', sql.Int, reportToId)
          .query('SELECT Name, Title FROM dbo.Employees WHERE Id = @eid');
        if (e.recordset[0]) {
          reportToName = e.recordset[0].Name + (e.recordset[0].Title ? ` · ${e.recordset[0].Title}` : '');
        }
      } catch (err) { /* fall back to blank */ }
    }

    const { buildJdPdfBuffer } = await import('../jd-pdf.js');
    const buffer = await buildJdPdfBuffer({
      data,
      kpaProcess,
      reportToName,
      branding: {
        headerPath: row.SowHeaderFile ? path.join(UPLOAD_DIR, row.SowHeaderFile) : null,
        footerPath: row.SowFooterFile ? path.join(UPLOAD_DIR, row.SowFooterFile) : null,
        headerSideMargin: !!row.DocHeaderSideMargin,
        footerSideMargin: !!row.DocFooterSideMargin,
      },
      issuer: {
        name: row.CompanyName || '',
        registrationNumber: row.RegistrationNumber || '',
      },
      typography: {
        fontFamily:   row.SowFontFamily       || 'Arial',
        bodyFontSize: row.SowBodyFontSize     || 12,
        h1FontSize:   row.SowHeading1FontSize || 18,
        h2FontSize:   row.SowHeading2FontSize || 14,
        h3FontSize:   row.SowHeading3FontSize || 12,
        h1AllCaps:    !!row.DocH1AllCaps,
        h2AllCaps:    !!row.DocH2AllCaps,
        h3AllCaps:    !!row.DocH3AllCaps,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="jd-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[jd/preview-pdf]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/jd/versions', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, Version, CreatedAt, CreatedBy
      FROM dbo.JdVersions WHERE ProcessId = @id
      ORDER BY CreatedAt DESC, Id DESC;
    `);
    res.json(r.recordset.map((v) => ({
      id: v.Id, version: v.Version, createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    })));
  } catch (err) {
    console.error('[jd/versions list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/jd/versions/:versionId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(id) || Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id).input('vid', sql.Int, versionId)
      .query(`
        SELECT Id, Version, JdDataJson, CreatedAt, CreatedBy
        FROM dbo.JdVersions
        WHERE ProcessId = @id AND Id = @vid;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const v = r.recordset[0];
    let parsed = null;
    try { parsed = v.JdDataJson ? JSON.parse(v.JdDataJson) : null; } catch {}
    res.json({
      id: v.Id, version: v.Version, data: parsed,
      createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    });
  } catch (err) {
    console.error('[jd/versions get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// =============== EDP (Quarterly Development Focus) task data ===============
// Lives in `EdpDataJson` on the same ProjectProcesses row. Same routing
// pattern as JD — GET returns the full payload, PUT replaces it and
// appends a version row.
router.get('/processes/:processId/edp', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.Kind, pp.EdpDataJson,
             p.CompanyId, c.Name AS CompanyName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p  ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    if (row.Kind !== 'edp') return res.status(400).json({ error: 'Not an EDP-kind process' });
    let data = null;
    try { data = row.EdpDataJson ? JSON.parse(row.EdpDataJson) : null; } catch {}
    res.json({
      processName: row.ProcessName,
      companyId: row.CompanyId,
      companyName: row.CompanyName,
      data,
    });
  } catch (err) {
    console.error('[projects/processes/edp/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/processes/:processId/edp', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT Kind FROM dbo.ProjectProcesses WHERE Id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });
    if (existing.recordset[0].Kind !== 'edp') {
      return res.status(400).json({ error: 'Not an EDP-kind process' });
    }
    const jsonString = data ? JSON.stringify(data) : null;
    await pool.request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), jsonString)
      .query(`
        UPDATE dbo.ProjectProcesses
          SET EdpDataJson = @json, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id;
      `);
    try {
      const prev = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 Version FROM dbo.EdpVersions
        WHERE ProcessId = @id ORDER BY CreatedAt DESC, Id DESC;
      `);
      const computedVersion = nextSowVersion(prev.recordset[0]?.Version);
      await pool.request()
        .input('id',      sql.Int,            id)
        .input('version', sql.NVarChar(50),   computedVersion)
        .input('json',    sql.NVarChar(sql.MAX), jsonString)
        .input('actor',   sql.NVarChar(255),  req.user?.email || null)
        .query(`
          INSERT INTO dbo.EdpVersions (ProcessId, Version, EdpDataJson, CreatedBy)
          VALUES (@id, @version, @json, @actor);
        `);
    } catch (err) {
      console.warn('[edp/put] could not append version history:', err.message);
    }
    res.json({ data });
  } catch (err) {
    console.error('[projects/processes/edp/put]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/edp/versions', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, Version, CreatedAt, CreatedBy
      FROM dbo.EdpVersions WHERE ProcessId = @id
      ORDER BY CreatedAt DESC, Id DESC;
    `);
    res.json(r.recordset.map((v) => ({
      id: v.Id, version: v.Version, createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    })));
  } catch (err) {
    console.error('[edp/versions list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/edp/versions/:versionId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(id) || Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id).input('vid', sql.Int, versionId)
      .query(`
        SELECT Id, Version, EdpDataJson, CreatedAt, CreatedBy
        FROM dbo.EdpVersions
        WHERE ProcessId = @id AND Id = @vid;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const v = r.recordset[0];
    let parsed = null;
    try { parsed = v.EdpDataJson ? JSON.parse(v.EdpDataJson) : null; } catch {}
    res.json({
      id: v.Id, version: v.Version, data: parsed,
      createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    });
  } catch (err) {
    console.error('[edp/versions get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// =============== KPI Document task data ===============
// Lives in `KpidocDataJson` on the same ProjectProcesses row. The GET
// resolves the project's first KPA-kind process so the editor can pull
// the static columns (KPA / Core Value / KPI / How we measure / Weight)
// directly; only the editable review fields (Data Source, Data Result,
// Status, Score, Comments) are persisted here.
router.get('/processes/:processId/kpidoc', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.Kind, pp.KpidocDataJson, pp.ProjectId,
             p.CompanyId, c.Name AS CompanyName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p  ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    if (row.Kind !== 'kpidoc') return res.status(400).json({ error: 'Not a KPI-Doc-kind process' });
    let data = null;
    try { data = row.KpidocDataJson ? JSON.parse(row.KpidocDataJson) : null; } catch {}

    // Resolve sibling KPA task — same rule as JD's pull-through.
    let kpaProcess = null;
    try {
      const k = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
        SELECT TOP 1 pp.Id, pp.Name, pp.KpaDataJson, pp.EmployeeId,
               e.Name AS EmployeeName, e.Title AS EmployeeTitle
        FROM dbo.ProjectProcesses pp
        LEFT JOIN dbo.Employees e ON e.Id = pp.EmployeeId
        WHERE pp.ProjectId = @pid AND pp.Kind = 'kpa' AND pp.KpaDataJson IS NOT NULL
        ORDER BY pp.CreatedAt;
      `);
      if (k.recordset[0]) {
        let kpas = [];
        try { kpas = k.recordset[0].KpaDataJson ? JSON.parse(k.recordset[0].KpaDataJson) : []; } catch {}
        kpaProcess = {
          id: k.recordset[0].Id,
          name: k.recordset[0].Name,
          employeeId: k.recordset[0].EmployeeId,
          employeeName: k.recordset[0].EmployeeName,
          employeeTitle: k.recordset[0].EmployeeTitle,
          kpas: Array.isArray(kpas) ? kpas : [],
        };
      }
    } catch (err) {
      console.warn('[kpidoc/get] could not resolve sibling KPA:', err.message);
    }

    // Resolve sibling JD process so the editor can auto-fill the Job
    // Title field from the project's Job Description task (instead of
    // making the user retype it). Same rule: first JD-kind process in
    // the project, ordered by CreatedAt.
    let jdTitle = '';
    try {
      const j = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
        SELECT TOP 1 JdDataJson FROM dbo.ProjectProcesses
        WHERE ProjectId = @pid AND Kind = 'jd' AND JdDataJson IS NOT NULL
        ORDER BY CreatedAt;
      `);
      if (j.recordset[0]?.JdDataJson) {
        try {
          const jd = JSON.parse(j.recordset[0].JdDataJson);
          jdTitle = (jd?.title || '').toString();
        } catch { /* malformed JD payload — fall through */ }
      }
    } catch (err) {
      console.warn('[kpidoc/get] could not resolve sibling JD title:', err.message);
    }

    res.json({
      processName: row.ProcessName,
      companyId: row.CompanyId,
      companyName: row.CompanyName,
      data,
      kpaProcess,
      jdTitle,
    });
  } catch (err) {
    console.error('[projects/processes/kpidoc/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/processes/:processId/kpidoc', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT Kind FROM dbo.ProjectProcesses WHERE Id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });
    if (existing.recordset[0].Kind !== 'kpidoc') {
      return res.status(400).json({ error: 'Not a KPI-Doc-kind process' });
    }
    const jsonString = data ? JSON.stringify(data) : null;
    await pool.request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), jsonString)
      .query(`
        UPDATE dbo.ProjectProcesses
          SET KpidocDataJson = @json, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id;
      `);
    try {
      const prev = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 Version FROM dbo.KpidocVersions
        WHERE ProcessId = @id ORDER BY CreatedAt DESC, Id DESC;
      `);
      const computedVersion = nextSowVersion(prev.recordset[0]?.Version);
      await pool.request()
        .input('id',      sql.Int,            id)
        .input('version', sql.NVarChar(50),   computedVersion)
        .input('json',    sql.NVarChar(sql.MAX), jsonString)
        .input('actor',   sql.NVarChar(255),  req.user?.email || null)
        .query(`
          INSERT INTO dbo.KpidocVersions (ProcessId, Version, KpidocDataJson, CreatedBy)
          VALUES (@id, @version, @json, @actor);
        `);
    } catch (err) {
      console.warn('[kpidoc/put] could not append version history:', err.message);
    }
    res.json({ data });
  } catch (err) {
    console.error('[projects/processes/kpidoc/put]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/kpidoc/versions', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, Version, CreatedAt, CreatedBy
      FROM dbo.KpidocVersions WHERE ProcessId = @id
      ORDER BY CreatedAt DESC, Id DESC;
    `);
    res.json(r.recordset.map((v) => ({
      id: v.Id, version: v.Version, createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    })));
  } catch (err) {
    console.error('[kpidoc/versions list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/processes/:processId/kpidoc/versions/:versionId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(id) || Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id).input('vid', sql.Int, versionId)
      .query(`
        SELECT Id, Version, KpidocDataJson, CreatedAt, CreatedBy
        FROM dbo.KpidocVersions
        WHERE ProcessId = @id AND Id = @vid;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const v = r.recordset[0];
    let parsed = null;
    try { parsed = v.KpidocDataJson ? JSON.parse(v.KpidocDataJson) : null; } catch {}
    res.json({
      id: v.Id, version: v.Version, data: parsed,
      createdAt: v.CreatedAt, createdBy: v.CreatedBy,
    });
  } catch (err) {
    console.error('[kpidoc/versions get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// =============== Role / KPI / EDP Pack ===============
// Pack tasks don't store their own data — they're a render-time
// composition of the project's JD + KPI Doc + EDP siblings. The GET
// endpoint reports which siblings exist (so the editor can show a
// "what's in the pack" summary); the preview-pdf endpoint pulls all
// three payloads and renders them into one combined PDF.

router.get('/processes/:processId/pack', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.Kind, pp.ProjectId,
             p.CompanyId, c.Name AS CompanyName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p  ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    if (row.Kind !== 'pack') return res.status(400).json({ error: 'Not a Pack-kind process' });

    // Discover the sibling source tasks for the editor's status panel.
    // First JD-kind / kpidoc-kind / edp-kind process in the project,
    // ordered by CreatedAt. Each is reported with id + name so the
    // editor can hyperlink back to the source task if needed.
    const sib = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
      SELECT Id, Name, Kind,
             CASE WHEN JdDataJson     IS NULL THEN 0 ELSE 1 END AS HasJd,
             CASE WHEN KpidocDataJson IS NULL THEN 0 ELSE 1 END AS HasKpidoc,
             CASE WHEN EdpDataJson    IS NULL THEN 0 ELSE 1 END AS HasEdp
      FROM dbo.ProjectProcesses
      WHERE ProjectId = @pid AND Kind IN ('jd','kpidoc','edp')
      ORDER BY CreatedAt;
    `);
    const firstByKind = { jd: null, kpidoc: null, edp: null };
    for (const x of sib.recordset) {
      if (!firstByKind[x.Kind]) {
        firstByKind[x.Kind] = {
          id: x.Id,
          name: x.Name,
          hasData: x.Kind === 'jd' ? !!x.HasJd
                  : x.Kind === 'kpidoc' ? !!x.HasKpidoc
                  : !!x.HasEdp,
        };
      }
    }

    res.json({
      processName: row.ProcessName,
      companyId: row.CompanyId,
      companyName: row.CompanyName,
      sources: firstByKind,
    });
  } catch (err) {
    console.error('[projects/processes/pack/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Live Pack PDF — pulls JD + KPI Doc + EDP data for the project and
// emits one branded PDF with three sections.
router.post('/processes/:processId/pack/preview-pdf', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const lookup = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.ProjectId, pp.Kind,
             c.Name AS CompanyName, c.RegistrationNumber,
             c.SowHeaderFile, c.SowFooterFile,
             c.DocHeaderSideMargin, c.DocFooterSideMargin,
             c.SowFontFamily
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!lookup.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = lookup.recordset[0];
    if (row.Kind !== 'pack') return res.status(400).json({ error: 'Not a Pack-kind process' });

    // Pull every sibling payload — same "first by kind" rule as the
    // GET endpoint, plus the KPA task (KPI Doc needs it for its
    // pull-through data).
    const sib = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
      SELECT pp.Id, pp.Name, pp.Kind,
             pp.JdDataJson, pp.KpidocDataJson, pp.EdpDataJson,
             pp.KpaDataJson, pp.EmployeeId,
             e.Name AS EmployeeName, e.Title AS EmployeeTitle
      FROM dbo.ProjectProcesses pp
      LEFT JOIN dbo.Employees e ON e.Id = pp.EmployeeId
      WHERE pp.ProjectId = @pid AND pp.Kind IN ('jd','kpidoc','edp','kpa')
      ORDER BY pp.CreatedAt;
    `);
    let jdData = null, kpidocData = null, edpData = null, kpaProcess = null;
    let employeeName = '', employeeTitle = '';
    for (const x of sib.recordset) {
      if (x.Kind === 'jd' && jdData == null && x.JdDataJson) {
        try { jdData = JSON.parse(x.JdDataJson); } catch {}
      } else if (x.Kind === 'kpidoc' && kpidocData == null && x.KpidocDataJson) {
        try { kpidocData = JSON.parse(x.KpidocDataJson); } catch {}
      } else if (x.Kind === 'edp' && edpData == null && x.EdpDataJson) {
        try { edpData = JSON.parse(x.EdpDataJson); } catch {}
      } else if (x.Kind === 'kpa' && kpaProcess == null && x.KpaDataJson) {
        let kpas = [];
        try { kpas = JSON.parse(x.KpaDataJson); } catch {}
        kpaProcess = {
          name: x.Name,
          employeeName: x.EmployeeName,
          employeeTitle: x.EmployeeTitle,
          kpas: Array.isArray(kpas) ? kpas : [],
        };
        if (!employeeName)  employeeName  = x.EmployeeName  || '';
        if (!employeeTitle) employeeTitle = x.EmployeeTitle || '';
      }
    }
    // Fall back to JD title for the cover when no KPA-linked employee
    // exists yet (e.g. the user hasn't run KPA Capture).
    const jdTitle = (jdData?.title || '').toString();

    // Resolve the JD's reports-to employee so the embedded JD section's
    // meta block shows the correct value (the standalone JD preview
    // route does this same lookup).
    let reportToName = '';
    const reportToId = parseInt(jdData?.reportToEmployeeId, 10);
    if (Number.isFinite(reportToId)) {
      try {
        const e = await pool.request().input('eid', sql.Int, reportToId)
          .query('SELECT Name, Title FROM dbo.Employees WHERE Id = @eid');
        if (e.recordset[0]) {
          reportToName = e.recordset[0].Name + (e.recordset[0].Title ? ` · ${e.recordset[0].Title}` : '');
        }
      } catch { /* fall back to blank */ }
    }

    const { buildPackPdfBuffer, packDocTitle } = await import('../pack-pdf.js');
    const buffer = await buildPackPdfBuffer({
      jdData,
      kpidocData,
      edpData,
      kpaProcess,
      employeeName,
      employeeTitle,
      jdTitle,
      reportToName,
      branding: {
        headerPath: row.SowHeaderFile ? path.join(UPLOAD_DIR, row.SowHeaderFile) : null,
        footerPath: row.SowFooterFile ? path.join(UPLOAD_DIR, row.SowFooterFile) : null,
        headerSideMargin: !!row.DocHeaderSideMargin,
        footerSideMargin: !!row.DocFooterSideMargin,
      },
      issuer: {
        name: row.CompanyName || '',
        registrationNumber: row.RegistrationNumber || '',
      },
      typography: {
        fontFamily:   row.SowFontFamily || 'Arial',
        bodyFontSize: 10,
        h1FontSize:   18,
        h2FontSize:   13,
        h3FontSize:   11,
      },
    });

    // Descriptive filename that matches the PDF's own title — reflects the
    // person and which parts are included (e.g. "Role, KPI & EDP Pack —
    // Ethan Sevenster · Magnum Opus Consultants.pdf"). filename* carries the
    // full unicode name; the ASCII filename is a legacy fallback.
    const docTitle = packDocTitle({
      haveJd: !!jdData,
      haveKpiDoc: !!(kpaProcess && Array.isArray(kpaProcess.kpas) && kpaProcess.kpas.length),
      haveEdp: !!edpData,
      employeeName,
      issuerName: row.CompanyName || '',
    });
    const cleanTitle = docTitle.replace(/[\\/:*?"<>|]/g, '-');
    const asciiName = (cleanTitle.replace(/[—–]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || 'Document Pack') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(cleanTitle + '.pdf')}`);
    res.send(buffer);
  } catch (err) {
    console.error('[pack/preview-pdf]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Live KPI Document PDF preview — branded letterhead + the data layout
// from the reference Bernadette spreadsheet (rating scale, main review
// table, declaration block).
router.post('/processes/:processId/kpidoc/preview-pdf', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};
  try {
    const pool = await getPool();
    const lookup = await pool.request().input('id', sql.Int, id).query(`
      SELECT pp.Name AS ProcessName, pp.ProjectId,
             c.Name AS CompanyName, c.RegistrationNumber,
             c.SowHeaderFile, c.SowFooterFile,
             c.DocHeaderSideMargin, c.DocFooterSideMargin,
             c.SowFontFamily
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
      INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
      WHERE pp.Id = @id;
    `);
    if (!lookup.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = lookup.recordset[0];

    // Resolve sibling KPA payload + employee
    let kpaProcess = null;
    try {
      const k = await pool.request().input('pid', sql.Int, row.ProjectId).query(`
        SELECT TOP 1 pp.Name, pp.KpaDataJson, pp.EmployeeId,
               e.Name AS EmployeeName, e.Title AS EmployeeTitle
        FROM dbo.ProjectProcesses pp
        LEFT JOIN dbo.Employees e ON e.Id = pp.EmployeeId
        WHERE pp.ProjectId = @pid AND pp.Kind = 'kpa' AND pp.KpaDataJson IS NOT NULL
        ORDER BY pp.CreatedAt;
      `);
      if (k.recordset[0]) {
        let kpas = [];
        try { kpas = k.recordset[0].KpaDataJson ? JSON.parse(k.recordset[0].KpaDataJson) : []; } catch {}
        kpaProcess = {
          employeeName: k.recordset[0].EmployeeName,
          employeeTitle: k.recordset[0].EmployeeTitle,
          kpas: Array.isArray(kpas) ? kpas : [],
        };
      }
    } catch (err) { /* no KPA sibling → empty doc */ }

    const { buildKpidocPdfBuffer } = await import('../kpidoc-pdf.js');
    const buffer = await buildKpidocPdfBuffer({
      data,
      kpaProcess,
      branding: {
        // Full-width company banner header + footer — mirrors the JD
        // / SOW / EDP pipeline so the KPI Document looks like part of
        // the same branded family.
        headerPath: row.SowHeaderFile ? path.join(UPLOAD_DIR, row.SowHeaderFile) : null,
        footerPath: row.SowFooterFile ? path.join(UPLOAD_DIR, row.SowFooterFile) : null,
        headerSideMargin: !!row.DocHeaderSideMargin,
        footerSideMargin: !!row.DocFooterSideMargin,
      },
      issuer: {
        name: row.CompanyName || '',
        registrationNumber: row.RegistrationNumber || '',
      },
      typography: {
        // KPI Document deliberately ignores the company's branded font
        // SIZES — the 9-column landscape table is space-constrained
        // and the company's SOW sizes bloat it past one page. Font
        // FAMILY still flows through so the typeface stays consistent
        // with every other branded doc. The MAIN REVIEW TABLE shrinks
        // further still (7pt body / 6pt headers) — tuned inside
        // kpidoc-pdf.js — but the intro paragraph, rating-scale legend
        // and declaration block read at the values below.
        fontFamily:   row.SowFontFamily || 'Arial',
        bodyFontSize: 9,
        h1FontSize:   14,
        h2FontSize:   11,
        h3FontSize:   10,
        h1AllCaps:    false,
        h2AllCaps:    false,
        h3AllCaps:    false,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="kpi-document-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[kpidoc/preview-pdf]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// SOW form data — stored as JSON on the process. PUT regenerates the docx.
router.get('/processes/:processId/sow', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .query('SELECT SowDataJson, SowDocFile FROM dbo.ProjectProcesses WHERE Id = @id');
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.recordset[0];
    let data = null;
    try { data = row.SowDataJson ? JSON.parse(row.SowDataJson) : null; } catch {}
    res.json({
      data,
      docUrl: row.SowDocFile ? `/uploads/${row.SowDocFile}` : null,
    });
  } catch (err) {
    console.error('[sow/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/processes/:processId/sow', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};

  try {
    const pool = await getPool();

    // Look up the previous filename + JSON + the owning company's branding so
    // the generator can stamp banners and we can derive the next version.
    const prev = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT pp.SowDocFile,
               pp.SowDataJson,
               pp.Name AS ProcessName,
               c.Name AS CompanyName,
               c.RegistrationNumber,
               c.SowHeaderFile, c.SowFooterFile,
               c.DocLandscapeHeaderFile, c.DocLandscapeFooterFile,
               c.SowFontFamily, c.SowBodyFontSize,
               c.SowHeading1FontSize, c.SowHeading2FontSize, c.SowHeading3FontSize,
               c.DocH1AllCaps, c.DocH2AllCaps, c.DocH3AllCaps,
               c.DocHeaderSideMargin, c.DocFooterSideMargin, c.DocSectionSeparator,
               c.DocPageNumberPosition, c.DocFooterPlacement, c.DocHeaderPlacement
        FROM dbo.ProjectProcesses pp
        INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
        INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
        WHERE pp.Id = @id;
      `);
    if (!prev.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = await loadProviderDefaults(pool, id, prev.recordset[0]);

    // Auto-version: V1.0 on the first save, then 1.1, 1.2, 1.3, … on every
    // re-save. The user can't override it from the editor — the cover.version
    // field is read-only client-side and the server overwrites whatever's
    // submitted with the computed next-version value.
    let previousVersion = null;
    if (row.SowDataJson) {
      try {
        const parsed = JSON.parse(row.SowDataJson);
        previousVersion = parsed?.cover?.version || null;
      } catch { /* ignore — fall back to 1.0 */ }
    }
    const computedVersion = nextSowVersion(previousVersion);
    // Stamp today's date on every save so the cover's "Date of submission"
    // tracks the version bump (1.0 / 1.1 / 1.2 each carry the date the user
    // saved). The submitted value is ignored — like the version field, the
    // client-side date input is read-only and the server is the source of
    // truth here.
    const todayIso = new Date().toISOString().slice(0, 10);
    data.cover = { ...(data.cover || {}), version: computedVersion, dateOfSubmission: todayIso };

    // Merge the company's default Service Provider name/designation/location
    // into the signatures payload before generating the document so blank
    // provider rows pick up the branding defaults.
    const mergedSignatures = applyProviderDefaults(data.signatures, row);

    // Generate the new document on disk
    const filename = await generateSowPdf({
      ...data,
      documentName: row.ProcessName || '',
      signatures: mergedSignatures,
      branding: {
        headerPath:          row.SowHeaderFile           ? path.join(UPLOAD_DIR, row.SowHeaderFile)           : null,
        footerPath:          row.SowFooterFile           ? path.join(UPLOAD_DIR, row.SowFooterFile)           : null,
        landscapeHeaderPath: row.DocLandscapeHeaderFile  ? path.join(UPLOAD_DIR, row.DocLandscapeHeaderFile)  : null,
        landscapeFooterPath: row.DocLandscapeFooterFile  ? path.join(UPLOAD_DIR, row.DocLandscapeFooterFile)  : null,
        headerSideMargin:    !!row.DocHeaderSideMargin,
        footerSideMargin:    !!row.DocFooterSideMargin,
        // Default to true so SOWs against companies whose row hasn't
        // been migrated yet still render with the existing line style.
        sectionSeparator:    row.DocSectionSeparator == null ? true : !!row.DocSectionSeparator,
        pageNumberPosition:  row.DocPageNumberPosition === 'top' ? 'top' : 'bottom',
        headerPlacement:     row.DocHeaderPlacement || 'first',
        footerPlacement:     row.DocFooterPlacement || 'all',
      },
      issuer: {
        name: row.CompanyName || '',
        registrationNumber: row.RegistrationNumber || '',
      },
      typography: {
        fontFamily:    row.SowFontFamily       || 'Arial',
        bodyFontSize:  row.SowBodyFontSize     || 12,
        h1FontSize:    row.SowHeading1FontSize || 14,
        h2FontSize:    row.SowHeading2FontSize || 13,
        h3FontSize:    row.SowHeading3FontSize || 12,
        h1AllCaps:     !!row.DocH1AllCaps,
        h2AllCaps:     !!row.DocH2AllCaps,
        h3AllCaps:     !!row.DocH3AllCaps,
      },
    });

    // Versioning: KEEP every previously-generated PDF on disk so the
    // whiteboard's version history can offer downloads for older versions.
    // The ProjectProcesses.SowDocFile column always points at the latest PDF.

    const dataJson = JSON.stringify(data);
    await pool
      .request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), dataJson)
      .input('file', sql.NVarChar(500), filename)
      .query(`
        UPDATE dbo.ProjectProcesses
        SET SowDataJson = @json,
            SowDocFile  = @file,
            UpdatedAt   = SYSUTCDATETIME()
        WHERE Id = @id;
      `);

    // Append an immutable history row so the whiteboard can list every save.
    // Wrapped in try/catch so a missing SowVersions table (e.g. migration not
    // yet applied) doesn't fail the whole save — the main UPDATE has already
    // succeeded.
    try {
      await pool.request()
        .input('id',      sql.Int,            id)
        .input('version', sql.NVarChar(50),   computedVersion)
        .input('json',    sql.NVarChar(sql.MAX), dataJson)
        .input('file',    sql.NVarChar(500),  filename)
        .input('actor',   sql.NVarChar(255),  req.user?.email || null)
        .query(`
          INSERT INTO dbo.SowVersions (ProcessId, Version, SowDataJson, SowDocFile, CreatedBy)
          VALUES (@id, @version, @json, @file, @actor);
        `);
    } catch (err) {
      console.warn('[sow/put] could not append version history:', err.message);
    }

    res.json({ data, docUrl: `/uploads/${filename}` });
  } catch (err) {
    console.error('[sow/put]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Live preview — generates the PDF in memory and streams the raw bytes back
// so the frontend can render them in an <iframe>. The preview is byte-identical
// to the saved/downloaded artefact, so what you see is exactly what you'll get.
router.post('/processes/:processId/sow/preview-pdf', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const data = req.body?.data ?? {};

  try {
    const pool = await getPool();
    const lookup = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT pp.Name AS ProcessName,
               c.Name AS CompanyName, c.RegistrationNumber,
               c.SowHeaderFile, c.SowFooterFile,
               c.DocLandscapeHeaderFile, c.DocLandscapeFooterFile,
               c.SowFontFamily, c.SowBodyFontSize,
               c.SowHeading1FontSize, c.SowHeading2FontSize, c.SowHeading3FontSize,
               c.DocH1AllCaps, c.DocH2AllCaps, c.DocH3AllCaps,
               c.DocHeaderSideMargin, c.DocFooterSideMargin, c.DocSectionSeparator,
               c.DocPageNumberPosition, c.DocFooterPlacement, c.DocHeaderPlacement
        FROM dbo.ProjectProcesses pp
        INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
        INNER JOIN dbo.Companies c ON c.Id = p.CompanyId
        WHERE pp.Id = @id;
      `);
    if (!lookup.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const row = await loadProviderDefaults(pool, id, lookup.recordset[0]);

    const mergedSignatures = applyProviderDefaults(data.signatures, row);

    const buffer = await buildSowPdfBuffer({
      ...data,
      documentName: row.ProcessName || '',
      signatures: mergedSignatures,
      branding: {
        headerPath:          row.SowHeaderFile          ? path.join(UPLOAD_DIR, row.SowHeaderFile)          : null,
        footerPath:          row.SowFooterFile          ? path.join(UPLOAD_DIR, row.SowFooterFile)          : null,
        landscapeHeaderPath: row.DocLandscapeHeaderFile ? path.join(UPLOAD_DIR, row.DocLandscapeHeaderFile) : null,
        landscapeFooterPath: row.DocLandscapeFooterFile ? path.join(UPLOAD_DIR, row.DocLandscapeFooterFile) : null,
        headerSideMargin:    !!row.DocHeaderSideMargin,
        footerSideMargin:    !!row.DocFooterSideMargin,
        // Default to true so SOWs against companies whose row hasn't
        // been migrated yet still render with the existing line style.
        sectionSeparator:    row.DocSectionSeparator == null ? true : !!row.DocSectionSeparator,
        pageNumberPosition:  row.DocPageNumberPosition === 'top' ? 'top' : 'bottom',
        headerPlacement:     row.DocHeaderPlacement || 'first',
        footerPlacement:     row.DocFooterPlacement || 'all',
      },
      issuer: {
        name: row.CompanyName || '',
        registrationNumber: row.RegistrationNumber || '',
      },
      typography: {
        fontFamily:   row.SowFontFamily       || 'Arial',
        bodyFontSize: row.SowBodyFontSize     || 12,
        h1FontSize:   row.SowHeading1FontSize || 14,
        h2FontSize:   row.SowHeading2FontSize || 13,
        h3FontSize:   row.SowHeading3FontSize || 12,
        h1AllCaps:    !!row.DocH1AllCaps,
        h2AllCaps:    !!row.DocH2AllCaps,
        h3AllCaps:    !!row.DocH3AllCaps,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[sow/preview-pdf]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Manually re-run the runtime migrations. Used as a self-service "Fix it"
// button on the whiteboard when the auto-migration on first connect didn't
// reach the database (e.g. the backend was running before the new
// migrations were added — `getPool()` only runs them once per process).
router.post('/admin/run-migrations', async (req, res) => {
  try {
    const results = await rerunRuntimeMigrations();

    // One-shot backfill: if a process already has SowDataJson but no
    // SowVersions rows (because every save before the migration ran went
    // through the silent try/catch in PUT /sow), seed the history with the
    // current saved state so the user sees their work in the history list
    // instead of an empty card.
    let backfilled = 0;
    try {
      const pool = await getPool();
      const r = await pool.request().query(`
        INSERT INTO dbo.SowVersions (ProcessId, Version, SowDataJson, SowDocFile, CreatedAt)
        OUTPUT INSERTED.Id
        SELECT pp.Id,
               COALESCE(JSON_VALUE(pp.SowDataJson, '$.cover.version'), '1.0'),
               pp.SowDataJson,
               pp.SowDocFile,
               pp.UpdatedAt
        FROM dbo.ProjectProcesses pp
        WHERE pp.SowDataJson IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.SowVersions sv WHERE sv.ProcessId = pp.Id);
      `);
      backfilled = r.recordset?.length || 0;
    } catch (err) {
      // Backfill is best-effort; if it fails, the user can re-save to populate.
      console.warn('[admin/run-migrations] backfill skipped:', err.message);
    }

    res.json({ results, backfilled });
  } catch (err) {
    console.error('[admin/run-migrations]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// List every saved version of a SOW (newest first). Used by the process
// card on the whiteboard to render the version history strip.
router.get('/processes/:processId/sow/versions', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, Version, SowDocFile, SignedDocFile, CreatedAt, CreatedBy
      FROM dbo.SowVersions
      WHERE ProcessId = @id
      ORDER BY CreatedAt DESC, Id DESC;
    `);
    res.json(r.recordset.map((v) => ({
      id:           v.Id,
      version:      v.Version,
      docUrl:       v.SowDocFile     ? `/uploads/${v.SowDocFile}`     : null,
      signedDocUrl: v.SignedDocFile  ? `/uploads/${v.SignedDocFile}`  : null,
      createdAt:    v.CreatedAt,
      createdBy:    v.CreatedBy,
    })));
  } catch (err) {
    console.error('[sow/versions list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Fetch the full data snapshot for a single saved version. The frontend
// pulls the current version + the previous one together when expanding a
// row in the version history so it can render an inline diff.
router.get('/processes/:processId/sow/versions/:versionId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  const versionId = parseInt(req.params.versionId, 10);
  if (Number.isNaN(id) || Number.isNaN(versionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id',   sql.Int, id)
      .input('vid',  sql.Int, versionId)
      .query(`
        SELECT Id, Version, SowDataJson, SowDocFile, SignedDocFile, CreatedAt, CreatedBy
        FROM dbo.SowVersions
        WHERE ProcessId = @id AND Id = @vid;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const v = r.recordset[0];
    let parsed = null;
    try { parsed = v.SowDataJson ? JSON.parse(v.SowDataJson) : null; } catch {}
    res.json({
      id:           v.Id,
      version:      v.Version,
      data:         parsed,
      docUrl:       v.SowDocFile     ? `/uploads/${v.SowDocFile}`     : null,
      signedDocUrl: v.SignedDocFile  ? `/uploads/${v.SignedDocFile}`  : null,
      createdAt:    v.CreatedAt,
      createdBy:    v.CreatedBy,
    });
  } catch (err) {
    console.error('[sow/versions get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Upload a signed copy of a specific SOW version. The frontend attaches a
// scanned / counter-signed PDF (or image) against the version row so the
// version history shows the artefact that was actually signed alongside
// the auto-generated PDF. The file is stored under UPLOAD_DIR; the row's
// previous signed file (if any) is removed from disk so we don't pile up
// orphaned uploads.
router.post(
  '/processes/:processId/sow/versions/:versionId/signed',
  uploadDoc.single('signed'),
  async (req, res) => {
    const id = parseInt(req.params.processId, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (Number.isNaN(id) || Number.isNaN(versionId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (!req.file) return res.status(400).json({ error: 'Signed document is required' });
    try {
      const pool = await getPool();
      const before = await pool.request()
        .input('id',  sql.Int, id)
        .input('vid', sql.Int, versionId)
        .query(`SELECT SignedDocFile FROM dbo.SowVersions WHERE ProcessId = @id AND Id = @vid;`);
      if (!before.recordset[0]) {
        // Version doesn't exist for this process — clean up the just-uploaded
        // file and return 404 so the client sees a clear error.
        deleteUpload(req.file.filename);
        return res.status(404).json({ error: 'Version not found' });
      }
      const oldFile = before.recordset[0].SignedDocFile;
      await pool.request()
        .input('id',   sql.Int, id)
        .input('vid',  sql.Int, versionId)
        .input('file', sql.NVarChar(500), req.file.filename)
        .query(`UPDATE dbo.SowVersions SET SignedDocFile = @file WHERE ProcessId = @id AND Id = @vid;`);
      if (oldFile && oldFile !== req.file.filename) deleteUpload(oldFile);
      res.status(201).json({
        filename:     req.file.filename,
        signedDocUrl: `/uploads/${req.file.filename}`,
      });
    } catch (err) {
      // Clean up the orphan upload if the DB write failed.
      try { deleteUpload(req.file.filename); } catch {}
      console.error('[sow/versions/signed]', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  },
);

// Remove an uploaded signed copy from a version row. Detaches the
// filename from the DB and deletes the on-disk file so the version
// history goes back to showing only the auto-generated PDF.
router.delete(
  '/processes/:processId/sow/versions/:versionId/signed',
  async (req, res) => {
    const id = parseInt(req.params.processId, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (Number.isNaN(id) || Number.isNaN(versionId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const pool = await getPool();
      const before = await pool.request()
        .input('id',  sql.Int, id)
        .input('vid', sql.Int, versionId)
        .query(`SELECT SignedDocFile FROM dbo.SowVersions WHERE ProcessId = @id AND Id = @vid;`);
      if (!before.recordset[0]) return res.status(404).json({ error: 'Version not found' });
      const oldFile = before.recordset[0].SignedDocFile;
      await pool.request()
        .input('id',  sql.Int, id)
        .input('vid', sql.Int, versionId)
        .query(`UPDATE dbo.SowVersions SET SignedDocFile = NULL WHERE ProcessId = @id AND Id = @vid;`);
      if (oldFile) deleteUpload(oldFile);
      res.json({ ok: true });
    } catch (err) {
      console.error('[sow/versions/signed delete]', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  },
);

// Per-SOW signature image upload. The frontend uploads a single image, the
// route saves it under /uploads and returns the stored filename — the
// SowEditorModal then stores that filename on the row's `signatureFile`
// field. Storing per-SOW (rather than per-company) means each Statement of
// Work can carry its own signed image without overwriting the company's
// brand assets.
router.post(
  '/processes/:processId/sow/signature',
  upload.single('signature'),
  async (req, res) => {
    const id = parseInt(req.params.processId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!req.file) return res.status(400).json({ error: 'Signature image is required' });
    res.status(201).json({
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
    });
  }
);

router.delete('/processes/:processId', async (req, res) => {
  const id = parseInt(req.params.processId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const before = await pool
      .request()
      .input('id', sql.Int, id)
      .query('SELECT SowDocFile FROM dbo.ProjectProcesses WHERE Id = @id');
    const r = await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.ProjectProcesses WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    if (before.recordset[0]?.SowDocFile) deleteUpload(before.recordset[0].SowDocFile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[projects/processes/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
