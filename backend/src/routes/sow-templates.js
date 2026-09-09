import { Router } from 'express';
import path from 'node:path';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';
import { buildSowPdfBuffer } from '../sow-pdf.js';

const UPLOAD_DIR = path.resolve('uploads');

const router = Router();
router.use(requireAuth);
router.use(requireSegments('procurement', 'hr_projects'));

// Helper: serialise / deserialise the shared-with array stored as JSON.
function parseShared(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => Number.isFinite(x)) : [];
  } catch { return []; }
}

// Parse the rich NextStepsJson column. If it's missing (older row),
// fall back to the legacy NextTemplateIdsJson and synthesize the same
// shape so the rest of the app sees a single uniform array.
function parseNextSteps(stepsJson, legacyIdsJson) {
  if (stepsJson) {
    try {
      const v = JSON.parse(stepsJson);
      if (Array.isArray(v)) {
        return v
          .map(sanitiseStep)
          .filter(Boolean);
      }
    } catch { /* fall through to legacy */ }
  }
  return parseShared(legacyIdsJson).map((id) => ({ templateId: id }));
}

function sanitiseStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Template step — { templateId: number }. Label property ignored when
  // a templateId is present so a step is always exactly one kind.
  if (raw.templateId != null) {
    const tid = parseInt(raw.templateId, 10);
    return Number.isFinite(tid) ? { templateId: tid } : null;
  }
  // Free-text label step — { label: string }. Trimmed; empty strings
  // are dropped entirely so we don't render empty ghost cards.
  if (typeof raw.label === 'string') {
    const trimmed = raw.label.trim();
    if (!trimmed) return null;
    return { label: trimmed.slice(0, 255) };
  }
  return null;
}

function mapRow(r) {
  const nextSteps = parseNextSteps(r.NextStepsJson, r.NextTemplateIdsJson);
  return {
    id: r.Id,
    ownerCompanyId: r.OwnerCompanyId,
    name: r.Name,
    description: r.Description,
    isDefault: !!r.IsDefault,
    // Workspace this template lives in — 'Procurement' for legacy rows,
    // 'Human Resources' for HR-page templates. Each workspace's library
    // filters by this column so templates don't bleed across pages.
    department: r.Department || 'Procurement',
    // Task kind — drives which modal opens when a process is created
    // from this template. 'sow' (default), 'kpa' (KPA-formulation),
    // 'jd' (Job Description), 'edp' (EDP Alignment Notes).
    kind: (r.Kind === 'kpa' || r.Kind === 'jd' || r.Kind === 'edp' || r.Kind === 'kpidoc' || r.Kind === 'pack') ? r.Kind : 'sow',
    data: r.DataJson ? safeParse(r.DataJson) : null,
    sharedWith: parseShared(r.SharedWithCompanyIdsJson),
    // Rich ordered list of "next task" steps. Each entry is either
    // `{ templateId }` (resolves to a template) or `{ label }` (free-text
    // placeholder for a step whose template doesn't exist yet).
    nextSteps,
    // Legacy mirror — kept for any older client that still reads it. New
    // clients should prefer `nextSteps`.
    nextTemplateIds: nextSteps.filter((s) => s.templateId != null).map((s) => s.templateId),
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    createdBy: r.CreatedBy,
  };
}

// Coerce a request body's `nextTemplateIds` into a clean integer array.
function sanitiseNextIds(raw) {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));
}

// Coerce a request body's `nextSteps` array into the canonical
// `{ templateId } | { label }` step shape. Filters out anything that
// doesn't parse cleanly so junk entries never reach the DB.
function sanitiseNextSteps(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map(sanitiseStep).filter(Boolean);
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Live preview for the template editor — generates a PDF using the
// template's owner company branding so the author can see exactly what a
// SOW built from this template will look like. Mirrors the per-process
// `/processes/:id/sow/preview-pdf` route but takes `companyId` directly
// (templates aren't tied to a process).
router.post('/preview-pdf', async (req, res) => {
  const companyId = parseInt(req.body?.companyId, 10);
  if (Number.isNaN(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const data = req.body?.data ?? {};
  // Document name for the PDF metadata title (browser viewer tab). The
  // frontend passes the current template name when previewing from the
  // template editor. Falls back to an empty string — the generator's
  // helper then uses the legacy "Statement of Work" wording.
  const documentName = typeof req.body?.documentName === 'string' ? req.body.documentName : '';
  try {
    const pool = await getPool();
    const lookup = await pool.request().input('cid', sql.Int, companyId).query(`
      SELECT Name AS CompanyName, RegistrationNumber,
             SowHeaderFile, SowFooterFile,
             DocLandscapeHeaderFile, DocLandscapeFooterFile,
             SowFontFamily, SowBodyFontSize,
             SowHeading1FontSize, SowHeading2FontSize, SowHeading3FontSize,
             DocH1AllCaps, DocH2AllCaps, DocH3AllCaps,
             DocHeaderSideMargin, DocFooterSideMargin, DocSectionSeparator,
             DocPageNumberPosition, DocFooterPlacement, DocHeaderPlacement,
             SowProviderName, SowProviderDesignation, SowProviderLocation
      FROM dbo.Companies WHERE Id = @cid;
    `);
    if (!lookup.recordset[0]) return res.status(404).json({ error: 'Company not found' });
    const row = lookup.recordset[0];

    // Same provider-default + applyProviderDefaults pattern as the per-SOW
    // preview, just stripped of the process-lookup hop.
    const mergedSignatures = applyProviderDefaultsForTemplate(data.signatures, row);

    const buffer = await buildSowPdfBuffer({
      ...data,
      documentName,
      signatures: mergedSignatures,
      branding: {
        headerPath:          row.SowHeaderFile          ? path.join(UPLOAD_DIR, row.SowHeaderFile)          : null,
        footerPath:          row.SowFooterFile          ? path.join(UPLOAD_DIR, row.SowFooterFile)          : null,
        landscapeHeaderPath: row.DocLandscapeHeaderFile ? path.join(UPLOAD_DIR, row.DocLandscapeHeaderFile) : null,
        landscapeFooterPath: row.DocLandscapeFooterFile ? path.join(UPLOAD_DIR, row.DocLandscapeFooterFile) : null,
        headerSideMargin:    !!row.DocHeaderSideMargin,
        footerSideMargin:    !!row.DocFooterSideMargin,
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
    res.setHeader('Content-Disposition', 'inline; filename="template-preview.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[sow-templates/preview-pdf]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Lightweight clone of projects.js' `applyProviderDefaults` — fills the
// provider-kind signature party's blank rows with the company's default
// name / designation / location. Kept local so the templates router has no
// cross-router import.
function applyProviderDefaultsForTemplate(signatures, row) {
  const sigs = signatures && typeof signatures === 'object' ? { ...signatures } : {};
  const defaultRows = () => [
    { label: 'Name & Surname',  value: '' },
    { label: 'Post Designation', value: '' },
    { label: 'Signature',        value: '' },
    { label: 'Date',             value: '' },
    { label: 'Location',         value: '' },
  ];

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
      { kind: 'client',   title: 'Client',           company: '', rows: defaultRows() },
      { kind: 'provider', title: 'Service Provider', company: '', rows: defaultRows() },
    ];
  }

  const provider = parties.find((p) => p.kind === 'provider');
  if (provider) {
    if (!Array.isArray(provider.rows) || provider.rows.length === 0) provider.rows = defaultRows();
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

  return { parties };
}

// List templates accessible to a company: ones they OWN + ones shared with
// them. `?companyId=` selects which company's perspective to use.
// `?department=` scopes the list to one workspace (Procurement / HR / …)
// — defaults to Procurement so existing callers keep their original
// view; pass `all` to bypass the filter.
router.get('/', async (req, res) => {
  const companyId = parseInt(req.query.companyId, 10);
  if (Number.isNaN(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const rawDept = req.query.department;
  const department = typeof rawDept === 'string' ? rawDept.trim() : '';
  const filterByDept = department && department.toLowerCase() !== 'all';
  try {
    const pool = await getPool();
    const request = pool.request().input('cid', sql.Int, companyId);
    if (filterByDept) request.input('dept', sql.NVarChar(50), department);
    const r = await request.query(`
        SELECT t.*, c.Name AS OwnerCompanyName
        FROM dbo.SowTemplates t
        INNER JOIN dbo.Companies c ON c.Id = t.OwnerCompanyId
        WHERE (t.OwnerCompanyId = @cid
           OR (t.SharedWithCompanyIdsJson IS NOT NULL
               AND JSON_VALID(t.SharedWithCompanyIdsJson)
               AND JSON_CONTAINS(t.SharedWithCompanyIdsJson, CAST(@cid AS JSON))))${filterByDept ? ' AND t.Department = @dept' : ''}
        ORDER BY t.IsDefault DESC, t.Name;
      `);
    res.json(r.recordset.map((row) => ({
      ...mapRow(row),
      ownerCompanyName: row.OwnerCompanyName,
      isOwned: row.OwnerCompanyId === companyId,
    })));
  } catch (err) {
    console.error('[sow-templates/list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT t.*, c.Name AS OwnerCompanyName
      FROM dbo.SowTemplates t
      INNER JOIN dbo.Companies c ON c.Id = t.OwnerCompanyId
      WHERE t.Id = @id;
    `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ...mapRow(r.recordset[0]), ownerCompanyName: r.recordset[0].OwnerCompanyName });
  } catch (err) {
    console.error('[sow-templates/get]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { ownerCompanyId, name, description = '', data = null, isDefault = false, nextTemplateIds, nextSteps, department, kind } = req.body ?? {};
  const cid = parseInt(ownerCompanyId, 10);
  if (Number.isNaN(cid)) return res.status(400).json({ error: 'ownerCompanyId is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  // Default to Procurement so older callers keep working. The schema's
  // server-side default is the same, but specifying it explicitly
  // keeps the SQL self-documenting.
  const safeDept = typeof department === 'string' && department.trim()
    ? department.trim().slice(0, 50)
    : 'Procurement';
  // Whitelist the template kind so a bad body can't smuggle an unknown
  // value into the DB.
  const safeKind = (kind === 'kpa' || kind === 'jd' || kind === 'edp' || kind === 'kpidoc' || kind === 'pack') ? kind : 'sow';
  // Prefer the new `nextSteps` array; fall back to the legacy `nextTemplateIds`.
  const cleanedSteps = sanitiseNextSteps(nextSteps)
    ?? (sanitiseNextIds(nextTemplateIds) || []).map((id) => ({ templateId: id }));
  // Mirror template-id-only steps into the legacy column so older clients
  // still see the data the new shape carries.
  const legacyIds = cleanedSteps.filter((s) => s.templateId != null).map((s) => s.templateId);
  try {
    const pool = await getPool();
    // If marking default, clear any existing default for this company first.
    if (isDefault) {
      await pool.request().input('cid', sql.Int, cid)
        .query('UPDATE dbo.SowTemplates SET IsDefault = 0 WHERE OwnerCompanyId = @cid AND IsDefault = 1');
    }
    const r = await pool.request()
      .input('cid',  sql.Int, cid)
      .input('name', sql.NVarChar(255), name.trim())
      .input('desc', sql.NVarChar(sql.MAX), description?.trim() || null)
      .input('json', sql.NVarChar(sql.MAX), data ? JSON.stringify(data) : null)
      .input('def',  sql.Bit, isDefault ? 1 : 0)
      .input('dept', sql.NVarChar(50), safeDept)
      .input('kind', sql.NVarChar(20), safeKind)
      .input('next', sql.NVarChar(sql.MAX), legacyIds.length ? JSON.stringify(legacyIds) : null)
      .input('steps', sql.NVarChar(sql.MAX), cleanedSteps.length ? JSON.stringify(cleanedSteps) : null)
      .input('by',   sql.NVarChar(255), req.user?.email || null)
      .query(`
        INSERT INTO dbo.SowTemplates (OwnerCompanyId, Name, Description, IsDefault, DataJson, Department, Kind, NextTemplateIdsJson, NextStepsJson, CreatedBy)
        OUTPUT INSERTED.*
        VALUES (@cid, @name, @desc, @def, @json, @dept, @kind, @next, @steps, @by);
      `);
    res.status(201).json(mapRow(r.recordset[0]));
  } catch (err) {
    console.error('[sow-templates/create]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, description, data, isDefault, sharedWith } = req.body ?? {};
  try {
    const pool = await getPool();

    // Look up the owner so the default-flip is scoped correctly.
    const owner = await pool.request().input('id', sql.Int, id)
      .query('SELECT OwnerCompanyId FROM dbo.SowTemplates WHERE Id = @id');
    if (!owner.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const cid = owner.recordset[0].OwnerCompanyId;

    if (isDefault === true) {
      await pool.request().input('cid', sql.Int, cid).input('id', sql.Int, id)
        .query('UPDATE dbo.SowTemplates SET IsDefault = 0 WHERE OwnerCompanyId = @cid AND Id <> @id');
    }

    const req2 = pool.request().input('id', sql.Int, id);
    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];
    if (name !== undefined) {
      if (!name?.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      req2.input('name', sql.NVarChar(255), name.trim());
      setParts.push('Name = @name');
    }
    if (description !== undefined) {
      req2.input('desc', sql.NVarChar(sql.MAX), description?.trim() || null);
      setParts.push('Description = @desc');
    }
    if (data !== undefined) {
      req2.input('json', sql.NVarChar(sql.MAX), data ? JSON.stringify(data) : null);
      setParts.push('DataJson = @json');
    }
    if (isDefault !== undefined) {
      req2.input('def', sql.Bit, isDefault ? 1 : 0);
      setParts.push('IsDefault = @def');
    }
    if (sharedWith !== undefined) {
      const list = Array.isArray(sharedWith)
        ? sharedWith.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x !== cid)
        : [];
      req2.input('shared', sql.NVarChar(sql.MAX), list.length ? JSON.stringify(list) : null);
      setParts.push('SharedWithCompanyIdsJson = @shared');
    }
    // Handle the rich `nextSteps` array first; if the client only sent
    // the legacy `nextTemplateIds`, promote it to the new shape so the
    // two columns stay in sync.
    let nextStepsToWrite = null;
    if (req.body?.nextSteps !== undefined) {
      nextStepsToWrite = sanitiseNextSteps(req.body.nextSteps) || [];
    } else if (req.body?.nextTemplateIds !== undefined) {
      nextStepsToWrite = (sanitiseNextIds(req.body.nextTemplateIds) || []).map((tid) => ({ templateId: tid }));
    }
    if (nextStepsToWrite !== null) {
      // A template can't be its own successor — drop self-references on
      // the template-id steps. Label steps are kept as-is.
      const filtered = nextStepsToWrite.filter((s) => s.templateId !== id);
      const legacyIds = filtered.filter((s) => s.templateId != null).map((s) => s.templateId);
      req2.input('nextIds',   sql.NVarChar(sql.MAX), legacyIds.length ? JSON.stringify(legacyIds) : null);
      req2.input('nextSteps', sql.NVarChar(sql.MAX), filtered.length ? JSON.stringify(filtered)  : null);
      setParts.push('NextTemplateIdsJson = @nextIds');
      setParts.push('NextStepsJson = @nextSteps');
    }
    const r = await req2.query(`
      UPDATE dbo.SowTemplates SET ${setParts.join(', ')}
      OUTPUT INSERTED.*
      WHERE Id = @id;
    `);
    res.json(mapRow(r.recordset[0]));
  } catch (err) {
    console.error('[sow-templates/update]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, ownerCompanyId } = req.body ?? {};
  try {
    const pool = await getPool();
    const src = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM dbo.SowTemplates WHERE Id = @id');
    if (!src.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const s = src.recordset[0];
    const newOwner = parseInt(ownerCompanyId, 10);
    const useOwner = Number.isFinite(newOwner) ? newOwner : s.OwnerCompanyId;
    const r = await pool.request()
      .input('cid',  sql.Int, useOwner)
      .input('name', sql.NVarChar(255), (name?.trim() || `${s.Name} (copy)`).slice(0, 255))
      .input('desc', sql.NVarChar(sql.MAX), s.Description)
      .input('json', sql.NVarChar(sql.MAX), s.DataJson)
      // Preserve the source template's department so a duplicated
      // template lands in the same workspace as the original.
      .input('dept', sql.NVarChar(50), s.Department || 'Procurement')
      // Preserve the source template's kind so duplicating doesn't
      // silently change the editor opened for the new template.
      .input('kind', sql.NVarChar(20), (s.Kind === 'kpa' || s.Kind === 'jd' || s.Kind === 'edp' || s.Kind === 'kpidoc' || s.Kind === 'pack') ? s.Kind : 'sow')
      .input('by',   sql.NVarChar(255), req.user?.email || null)
      .query(`
        INSERT INTO dbo.SowTemplates (OwnerCompanyId, Name, Description, IsDefault, DataJson, Department, Kind, CreatedBy)
        OUTPUT INSERTED.*
        VALUES (@cid, @name, @desc, 0, @json, @dept, @kind, @by);
      `);
    res.status(201).json(mapRow(r.recordset[0]));
  } catch (err) {
    console.error('[sow-templates/duplicate]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.SowTemplates WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[sow-templates/delete]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
