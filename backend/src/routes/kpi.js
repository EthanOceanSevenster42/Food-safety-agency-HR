import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments, parsePermissions } from '../middleware/access.js';
import { uploadDoc, UPLOAD_DIR } from '../upload.js';
import { sendMail } from '../email.js';
import { renderKpiReviewEmail } from '../email-templates.js';

const router = Router();
router.use(requireAuth);

// KPI *management* endpoints (settings, sessions, create/delete review) require
// the KPI Tracker segment. Defined here (before the routes) because they're used
// as route-registration middleware. Participant endpoints stay open to the
// signed-in staff and rely on the per-review ownership checks instead.
const requireHr = requireSegments('hr_kpi');
// The analysis/scoreboard endpoints belong to the HR Analysis segment; the
// per-employee performance view is reachable from both the tracker and analysis.
const requireHrAnalysis = requireSegments('hr_analysis');
const requireHrKpiOrAnalysis = requireSegments('hr_kpi', 'hr_analysis');

const VALID_FREQUENCIES = new Set(['Quarterly', 'BiAnnually', 'Annually']);

function normaliseFrequency(value, { allowNull = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return allowNull ? null : 'Quarterly';
  const v = String(value).trim();
  if (!VALID_FREQUENCIES.has(v)) {
    const err = new Error('Frequency must be one of: Quarterly, BiAnnually, Annually');
    err.status = 400;
    throw err;
  }
  return v;
}

// GET /api/kpi/companies/:companyId/settings
router.get('/companies/:companyId/settings', requireHr, async (req, res) => {
  const id = parseInt(req.params.companyId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid companyId' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query('SELECT KpiFrequency FROM dbo.Companies WHERE Id = @id');
    if (!r.recordset[0]) return res.status(404).json({ error: 'Company not found' });
    res.json({ kpiFrequency: r.recordset[0].KpiFrequency || 'Quarterly' });
  } catch (err) {
    console.error('[kpi/company-settings/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/companies/:companyId/settings { kpiFrequency }
router.put('/companies/:companyId/settings', requireHr, async (req, res) => {
  const id = parseInt(req.params.companyId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid companyId' });
  let freq;
  try {
    freq = normaliseFrequency(req.body?.kpiFrequency);
    if (freq === undefined) freq = 'Quarterly';
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('f',  sql.NVarChar(20), freq)
      .query(`
        UPDATE dbo.Companies SET KpiFrequency = @f, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.KpiFrequency
        WHERE Id = @id;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Company not found' });
    res.json({ kpiFrequency: r.recordset[0].KpiFrequency });
  } catch (err) {
    console.error('[kpi/company-settings/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/employees/:employeeId/settings { kpiExempt, kpiFrequencyOverride }
router.put('/employees/:employeeId/settings', requireHr, async (req, res) => {
  const id = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid employeeId' });

  const kpiExempt = req.body?.kpiExempt === true || req.body?.kpiExempt === 'true' || req.body?.kpiExempt === 1;
  let override;
  try {
    override = normaliseFrequency(req.body?.kpiFrequencyOverride, { allowNull: true });
    if (override === undefined) override = null;
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('ex', sql.Bit, kpiExempt ? 1 : 0)
      .input('ov', sql.NVarChar(20), override)
      .query(`
        UPDATE dbo.Employees
        SET KpiExempt = @ex, KpiFrequencyOverride = @ov, UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.Id, INSERTED.KpiExempt, INSERTED.KpiFrequencyOverride
        WHERE Id = @id;
      `);
    if (!r.recordset[0]) return res.status(404).json({ error: 'Employee not found' });
    const row = r.recordset[0];
    res.json({
      id: row.Id,
      kpiExempt: !!row.KpiExempt,
      kpiFrequencyOverride: row.KpiFrequencyOverride,
    });
  } catch (err) {
    console.error('[kpi/employee-settings/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/employees/:employeeId/sessions
router.get('/employees/:employeeId/sessions', requireHr, async (req, res) => {
  const id = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid employeeId' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`
        SELECT Id, EmployeeId, PeriodLabel, SessionDate, DocumentFile, OriginalName,
               Notes, UploadedBy, CreatedAt, UpdatedAt
        FROM dbo.KpiSessions
        WHERE EmployeeId = @id
        ORDER BY ISNULL(SessionDate, CreatedAt) DESC, Id DESC;
      `);
    res.json(r.recordset.map((s) => ({
      id: s.Id,
      employeeId: s.EmployeeId,
      periodLabel: s.PeriodLabel,
      sessionDate: s.SessionDate,
      documentUrl: s.DocumentFile ? `/uploads/${s.DocumentFile}` : null,
      originalName: s.OriginalName,
      notes: s.Notes,
      uploadedBy: s.UploadedBy,
      createdAt: s.CreatedAt,
      updatedAt: s.UpdatedAt,
    })));
  } catch (err) {
    console.error('[kpi/sessions/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/sessions/by-company/:companyId — bulk fetch for the org-chart view
router.get('/sessions/by-company/:companyId', requireHr, async (req, res) => {
  const id = parseInt(req.params.companyId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid companyId' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id)
      .query(`
        SELECT s.Id, s.EmployeeId, s.PeriodLabel, s.SessionDate, s.DocumentFile,
               s.OriginalName, s.Notes, s.UploadedBy, s.CreatedAt
        FROM dbo.KpiSessions s
        INNER JOIN dbo.Employees e ON e.Id = s.EmployeeId
        -- Skip sessions auto-generated by a completed review: the review row
        -- itself (with its on-demand PDF) already covers them on the Tracker.
        WHERE e.CompanyId = @id
          AND NOT EXISTS (SELECT 1 FROM dbo.KpiReviews rv WHERE rv.KpiSessionId = s.Id)
        ORDER BY ISNULL(s.SessionDate, s.CreatedAt) DESC, s.Id DESC;
      `);
    res.json(r.recordset.map((s) => ({
      id: s.Id,
      employeeId: s.EmployeeId,
      periodLabel: s.PeriodLabel,
      sessionDate: s.SessionDate,
      documentUrl: s.DocumentFile ? `/uploads/${s.DocumentFile}` : null,
      originalName: s.OriginalName,
      notes: s.Notes,
      uploadedBy: s.UploadedBy,
      createdAt: s.CreatedAt,
    })));
  } catch (err) {
    console.error('[kpi/sessions/by-company]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/employees/:employeeId/sessions
// multipart/form-data: file field "document" (optional), text fields periodLabel, sessionDate, notes
function singleDoc(req, res, next) {
  uploadDoc.single('document')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large — keep KPI documents under 25 MB.'
      : (err.message || 'Upload failed');
    return res.status(400).json({ error: message });
  });
}

router.post('/employees/:employeeId/sessions', requireHr, singleDoc, async (req, res) => {
  const id = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid employeeId' });
  }
  const periodLabel = (req.body?.periodLabel || '').trim();
  if (!periodLabel) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'periodLabel is required (e.g. "Q1 2026")' });
  }
  const sessionDate = (req.body?.sessionDate || '').trim() || null;
  const notes = (req.body?.notes || '').trim() || null;
  const uploadedBy = req.user?.email || null;
  const fileName = req.file?.filename || null;
  const originalName = req.file?.originalname || null;

  try {
    const pool = await getPool();
    const exists = await pool.request().input('id', sql.Int, id)
      .query('SELECT 1 AS ok FROM dbo.Employees WHERE Id = @id');
    if (!exists.recordset[0]) {
      if (fileName) fs.unlink(path.join(UPLOAD_DIR, fileName), () => {});
      return res.status(404).json({ error: 'Employee not found' });
    }
    const r = await pool.request()
      .input('eid',          sql.Int,           id)
      .input('periodLabel',  sql.NVarChar(50),  periodLabel)
      .input('sessionDate',  sql.Date,          sessionDate)
      .input('documentFile', sql.NVarChar(500), fileName)
      .input('originalName', sql.NVarChar(500), originalName)
      .input('notes',        sql.NVarChar(sql.MAX), notes)
      .input('uploadedBy',   sql.NVarChar(255), uploadedBy)
      .query(`
        INSERT INTO dbo.KpiSessions
          (EmployeeId, PeriodLabel, SessionDate, DocumentFile, OriginalName, Notes, UploadedBy)
        OUTPUT INSERTED.Id, INSERTED.EmployeeId, INSERTED.PeriodLabel, INSERTED.SessionDate,
               INSERTED.DocumentFile, INSERTED.OriginalName, INSERTED.Notes, INSERTED.UploadedBy,
               INSERTED.CreatedAt, INSERTED.UpdatedAt
        VALUES (@eid, @periodLabel, @sessionDate, @documentFile, @originalName, @notes, @uploadedBy);
      `);
    const s = r.recordset[0];
    res.status(201).json({
      id: s.Id,
      employeeId: s.EmployeeId,
      periodLabel: s.PeriodLabel,
      sessionDate: s.SessionDate,
      documentUrl: s.DocumentFile ? `/uploads/${s.DocumentFile}` : null,
      originalName: s.OriginalName,
      notes: s.Notes,
      uploadedBy: s.UploadedBy,
      createdAt: s.CreatedAt,
      updatedAt: s.UpdatedAt,
    });
  } catch (err) {
    if (fileName) fs.unlink(path.join(UPLOAD_DIR, fileName), () => {});
    console.error('[kpi/sessions/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/sessions/:id  — replace the document or edit metadata
router.put('/sessions/:id', requireHr, singleDoc, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT DocumentFile FROM dbo.KpiSessions WHERE Id = @id');
    if (!existing.recordset[0]) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Session not found' });
    }
    const oldFile = existing.recordset[0].DocumentFile;

    const periodLabel = req.body?.periodLabel !== undefined ? String(req.body.periodLabel).trim() : undefined;
    const sessionDateRaw = req.body?.sessionDate;
    const sessionDate = sessionDateRaw === undefined ? undefined : (String(sessionDateRaw).trim() || null);
    const notesRaw = req.body?.notes;
    const notes = notesRaw === undefined ? undefined : (String(notesRaw).trim() || null);
    const replaceDoc = req.file ? true : false;
    const removeDoc = req.body?.removeDocument === 'true';

    const newFile = replaceDoc ? req.file.filename : (removeDoc ? null : oldFile);
    const newOriginal = replaceDoc ? req.file.originalname : (removeDoc ? null : undefined);

    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];
    const r = pool.request().input('id', sql.Int, id);
    if (periodLabel !== undefined) {
      if (!periodLabel) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'periodLabel cannot be empty' });
      }
      r.input('p', sql.NVarChar(50), periodLabel);
      setParts.push('PeriodLabel = @p');
    }
    if (sessionDate !== undefined) {
      r.input('sd', sql.Date, sessionDate);
      setParts.push('SessionDate = @sd');
    }
    if (notes !== undefined) {
      r.input('n', sql.NVarChar(sql.MAX), notes);
      setParts.push('Notes = @n');
    }
    if (replaceDoc || removeDoc) {
      r.input('f', sql.NVarChar(500), newFile);
      setParts.push('DocumentFile = @f');
    }
    if (newOriginal !== undefined) {
      r.input('o', sql.NVarChar(500), newOriginal);
      setParts.push('OriginalName = @o');
    }

    const upd = await r.query(`
      UPDATE dbo.KpiSessions SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id, INSERTED.EmployeeId, INSERTED.PeriodLabel, INSERTED.SessionDate,
             INSERTED.DocumentFile, INSERTED.OriginalName, INSERTED.Notes, INSERTED.UploadedBy,
             INSERTED.CreatedAt, INSERTED.UpdatedAt
      WHERE Id = @id;
    `);
    const s = upd.recordset[0];
    // Delete the displaced file *after* the update succeeds
    if (oldFile && oldFile !== newFile) fs.unlink(path.join(UPLOAD_DIR, oldFile), () => {});
    res.json({
      id: s.Id,
      employeeId: s.EmployeeId,
      periodLabel: s.PeriodLabel,
      sessionDate: s.SessionDate,
      documentUrl: s.DocumentFile ? `/uploads/${s.DocumentFile}` : null,
      originalName: s.OriginalName,
      notes: s.Notes,
      uploadedBy: s.UploadedBy,
      createdAt: s.CreatedAt,
      updatedAt: s.UpdatedAt,
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('[kpi/sessions/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/kpi/sessions/:id
router.delete('/sessions/:id', requireHr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, id)
      .query('SELECT DocumentFile FROM dbo.KpiSessions WHERE Id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const oldFile = existing.recordset[0].DocumentFile;
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.KpiSessions WHERE Id = @id');
    if (oldFile) fs.unlink(path.join(UPLOAD_DIR, oldFile), () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[kpi/sessions/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/analytics?companyId=N
// Walks every KPA-kind process for a company and aggregates two things:
//   1. focus-by-area: total weight summed across all employees per area.
//      Drives the spider chart on the HR Analysis page.
//   2. per-employee average rating: average of every rated KPI under
//      that employee's KPAs. Drives the top / lower performers lists.
// Unrated KPIs are ignored in the average (so partially-reviewed staff
// still produce a meaningful figure based on what's been scored so far).
router.get('/analytics', requireHrAnalysis, async (req, res) => {
  const companyId = parseInt(req.query.companyId, 10);
  if (Number.isNaN(companyId)) return res.status(400).json({ error: 'companyId is required' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('cid', sql.Int, companyId).query(`
      SELECT pp.Id, pp.Name, pp.EmployeeId, pp.KpaDataJson,
             e.Name AS EmployeeName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
      LEFT  JOIN dbo.Employees e ON e.Id = pp.EmployeeId
      WHERE p.CompanyId = @cid
        AND pp.Kind = 'kpa'
        AND pp.KpaDataJson IS NOT NULL;
    `);

    const focusByArea = new Map();        // area name → total weight
    const perEmployee = new Map();        // employeeId → { name, ratings: [], kpiCount, ratedCount, kpaCount }

    for (const row of r.recordset) {
      let kpas = [];
      try { kpas = JSON.parse(row.KpaDataJson || '[]'); } catch { /* skip bad JSON */ }
      if (!Array.isArray(kpas)) continue;

      const empKey = row.EmployeeId == null ? `task-${row.Id}` : `emp-${row.EmployeeId}`;
      const empName = row.EmployeeName || (row.EmployeeId == null ? `(${row.Name})` : '(unassigned)');
      let bucket = perEmployee.get(empKey);
      if (!bucket) {
        bucket = {
          employeeId: row.EmployeeId,
          employeeName: empName,
          ratings: [],
          kpiCount: 0,
          ratedCount: 0,
          kpaCount: 0,
        };
        perEmployee.set(empKey, bucket);
      }

      for (const kpa of kpas) {
        if (!kpa || typeof kpa !== 'object') continue;
        const area = (kpa.name || kpa.department || '').toString().trim();
        const weight = Number(kpa.weight);
        if (area && Number.isFinite(weight) && weight > 0) {
          focusByArea.set(area, (focusByArea.get(area) || 0) + weight);
        }
        bucket.kpaCount += 1;

        const kpis = Array.isArray(kpa.kpis) ? kpa.kpis : [];
        for (const kpi of kpis) {
          bucket.kpiCount += 1;
          const rating = Number(kpi?.rating);
          if (Number.isFinite(rating)) {
            bucket.ratings.push(Math.min(100, Math.max(0, rating)));
            bucket.ratedCount += 1;
          }
        }
      }
    }

    // Overlay KPI-review MANAGER ratings as the authoritative per-employee
    // scores (1–5 → 0–100). Latest manager-rated review per employee wins.
    // Falls through to any KPA-embedded kpi.rating when no review exists.
    const rev = await pool.request().input('cid', sql.Int, companyId).query(`
      SELECT EmployeeId, ManagerRatingsJson
      FROM dbo.KpiReviews
      WHERE CompanyId = @cid AND ManagerRatingsJson IS NOT NULL
        AND Status IN ('manager_submitted', 'unlocked', 'completed')
      ORDER BY EmployeeId, CreatedAt DESC, Id DESC;
    `);
    const overlaid = new Set();
    for (const rr of rev.recordset) {
      if (overlaid.has(rr.EmployeeId)) continue; // first row per employee = latest
      overlaid.add(rr.EmployeeId);
      let mr = [];
      try { mr = JSON.parse(rr.ManagerRatingsJson || '[]'); } catch { continue; }
      const scores = mr
        .map((x) => Number(x?.rating))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5)
        .map((n) => n * 20);
      const bucket = perEmployee.get(`emp-${rr.EmployeeId}`);
      if (bucket && scores.length) {
        bucket.ratings = scores;
        bucket.ratedCount = scores.length;
      }
    }

    const performers = [...perEmployee.values()].map((b) => {
      const avg = b.ratings.length
        ? b.ratings.reduce((s, v) => s + v, 0) / b.ratings.length
        : null;
      return {
        employeeId: b.employeeId,
        employeeName: b.employeeName,
        averageRating: avg,
        kpiCount: b.kpiCount,
        ratedCount: b.ratedCount,
        kpaCount: b.kpaCount,
      };
    });

    const focus = [...focusByArea.entries()]
      .map(([area, totalWeight]) => ({ area, totalWeight }))
      .sort((a, b) => b.totalWeight - a.totalWeight);

    res.json({
      focusByArea: focus,
      performers,
    });
  } catch (err) {
    console.error('[kpi/analytics]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/kpi/employees/:employeeId/performance
// Per-employee performance from their COMPLETED reviews: per-KPA and per-KPI
// manager AND self scores (so we can chart the perception gap), a weight-
// adjusted overall, newest first — drives the analysis charts + KPI document.
router.get('/employees/:employeeId/performance', requireHrKpiOrAnalysis, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employeeId' });
  try {
    const pool = await getPool();
    const emp = await pool.request().input('id', sql.Int, employeeId)
      .query('SELECT Name FROM dbo.Employees WHERE Id = @id');
    if (!emp.recordset[0]) return res.status(404).json({ error: 'Employee not found' });

    const r = await pool.request().input('id', sql.Int, employeeId).query(`
      SELECT rv.Id, rv.PeriodLabel, rv.CompletedAt, rv.KpiSnapshotJson,
             rv.ManagerRatingsJson, rv.EmployeeRatingsJson,
             m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      LEFT JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.EmployeeId = @id AND rv.Status = 'completed'
      ORDER BY rv.CompletedAt DESC, rv.Id DESC;
    `);

    const avgOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const toPct = (score) => (score != null ? Math.round((score / 5) * 100) : null);

    const reviews = r.recordset.map((row) => {
      let snap = [], mr = [], er = [];
      try { snap = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
      try { mr = JSON.parse(row.ManagerRatingsJson || '[]'); } catch { /* empty */ }
      try { er = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

      // Group consecutive KPIs by KPA (area + weight).
      const groups = [];
      snap.forEach((k, i) => {
        const area = k?.area || '';
        const weight = k?.weight || 0;
        const kpi = {
          description: k?.kpiDescription || '',
          rating: num(mr[i]?.rating),
          selfRating: num(er[i]?.rating),
        };
        const last = groups[groups.length - 1];
        if (last && last.area === area && last.weight === weight) last.kpis.push(kpi);
        else groups.push({ area, weight, kpis: [kpi] });
      });

      const kpas = groups.map((g) => {
        const mAvg = avgOf(g.kpis.map((x) => x.rating).filter((n) => n != null));
        const sAvg = avgOf(g.kpis.map((x) => x.selfRating).filter((n) => n != null));
        const avgPct = toPct(mAvg);
        const selfAvgPct = toPct(sAvg);
        return {
          area: g.area,
          weight: g.weight,
          avgScore: mAvg != null ? Number(mAvg.toFixed(2)) : null,
          avgPct,
          selfAvgScore: sAvg != null ? Number(sAvg.toFixed(2)) : null,
          selfAvgPct,
          gap: avgPct != null && selfAvgPct != null ? avgPct - selfAvgPct : null,
          kpis: g.kpis.map((x) => ({
            description: x.description,
            rating: x.rating,
            pct: x.rating != null ? x.rating * 20 : null,
            selfRating: x.selfRating,
            selfPct: x.selfRating != null ? x.selfRating * 20 : null,
            gap: x.rating != null && x.selfRating != null ? (x.rating - x.selfRating) * 20 : null,
          })),
        };
      });

      const mOverall = avgOf(mr.map((x) => num(x?.rating)).filter((n) => n != null));
      const sOverall = avgOf(er.map((x) => num(x?.rating)).filter((n) => n != null));
      // Weight-adjusted overall: KPAs carry their assigned weight.
      const weighted = kpas.filter((k) => k.avgPct != null && k.weight > 0);
      const wSum = weighted.reduce((s, k) => s + k.weight, 0);
      const weightedPct = wSum > 0
        ? Math.round(weighted.reduce((s, k) => s + k.weight * k.avgPct, 0) / wSum)
        : toPct(mOverall);

      return {
        id: row.Id,
        periodLabel: row.PeriodLabel,
        completedAt: row.CompletedAt,
        managerName: row.ManagerName,
        overall: mOverall != null ? Number(mOverall.toFixed(2)) : null,
        overallPct: toPct(mOverall),
        selfOverall: sOverall != null ? Number(sOverall.toFixed(2)) : null,
        selfOverallPct: toPct(sOverall),
        weightedPct,
        kpas,
      };
    });

    res.json({ employeeId, employeeName: emp.recordset[0].Name, reviews });
  } catch (err) {
    console.error('[kpi/performance]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== KPI Review workflow ====================
// A "review" freezes a chosen set of KPIs (pulled from a project's KPA
// task) into KpiReviews.KpiSnapshotJson so ratings stay stable even if the
// source KPA is later edited. Slice 1 = admin starts a review + the KPIs
// pull through to the Tracker. Employee/manager assessment + the password-
// gated joint session land in later slices.

// Flatten a KPA-task payload (KpaDataJson = array of KPAs) into an ordered
// list of KPI rows, matching the order the KPI document renders them. Each
// entry is a self-contained snapshot row.
function flattenKpis(kpaArray) {
  const out = [];
  const kpas = Array.isArray(kpaArray) ? kpaArray : [];
  for (const kpa of kpas) {
    if (!kpa || typeof kpa !== 'object') continue;
    const area = (kpa.name || kpa.department || '').toString();
    const weight = Number.isFinite(Number(kpa.weight)) ? Number(kpa.weight) : 0;
    const coreValues = Array.isArray(kpa.coreValues) ? kpa.coreValues.filter(Boolean) : [];
    const kpis = Array.isArray(kpa.kpis) ? kpa.kpis : [];
    for (const kpi of kpis) {
      const description = (kpi?.description || '').toString();
      const measures = Array.isArray(kpi?.measures) ? kpi.measures.filter(Boolean) : [];
      if (!description && measures.length === 0) continue;
      out.push({ area, weight, coreValues, kpiDescription: description, measures });
    }
  }
  return out;
}

function snapshotCount(json) {
  try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a.length : 0; } catch { return 0; }
}

function mapReviewRow(row) {
  return {
    id: row.Id,
    companyId: row.CompanyId,
    employeeId: row.EmployeeId,
    employeeName: row.EmployeeName,
    managerId: row.ManagerId,
    managerName: row.ManagerName,
    periodLabel: row.PeriodLabel,
    status: row.Status,
    kpiCount: snapshotCount(row.KpiSnapshotJson),
    employeeSubmittedAt: row.EmployeeSubmittedAt,
    managerSubmittedAt: row.ManagerSubmittedAt,
    completedAt: row.CompletedAt,
    createdAt: row.CreatedAt,
  };
}

// Ensure a staff member has a login (auto-provisioned when a review reaches
// them). Returns { setPasswordToken } — a one-time token when the account
// still needs a password set (brand-new, or existing-but-never-activated),
// else null. Also back-fills Users.EmployeeId so the login resolves to the
// Employee record. No-op without an email.
async function ensureUserLogin(pool, { email, name, employeeId, role = 'employee' }) {
  if (!email) return { setPasswordToken: null };
  const found = await pool.request()
    .input('eid', sql.Int, employeeId)
    .input('em', sql.NVarChar(255), email)
    .query(`SELECT TOP 1 Id, EmployeeId, InviteToken
            FROM dbo.Users WHERE EmployeeId = @eid OR Email = @em ORDER BY Id`);
  const existing = found.recordset[0];
  const token = crypto.randomBytes(24).toString('hex'); // 48 chars, fits NVARCHAR(64)
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  if (existing) {
    const needsPassword = !!existing.InviteToken; // still pending activation
    if (needsPassword || existing.EmployeeId == null) {
      await pool.request()
        .input('id', sql.Int, existing.Id)
        .input('eid', sql.Int, employeeId)
        .input('tok', sql.NVarChar(64), needsPassword ? token : null)
        .input('exp', sql.DateTime2, needsPassword ? expires : null)
        .query(`UPDATE dbo.Users SET
                  EmployeeId    = COALESCE(EmployeeId, @eid),
                  InviteToken   = CASE WHEN @tok IS NULL THEN InviteToken   ELSE @tok END,
                  InviteExpires = CASE WHEN @tok IS NULL THEN InviteExpires ELSE @exp END,
                  UpdatedAt     = SYSUTCDATETIME()
                WHERE Id = @id`);
    }
    return { setPasswordToken: needsPassword ? token : null };
  }

  // Brand-new pending account — placeholder hash keeps PasswordHash NOT NULL
  // and can never match a real password until they set one.
  const placeholder = bcrypt.hashSync(crypto.randomBytes(18).toString('hex'), 10);
  await pool.request()
    .input('em', sql.NVarChar(255), email)
    .input('ph', sql.NVarChar(255), placeholder)
    .input('dn', sql.NVarChar(255), name || null)
    .input('role', sql.NVarChar(50), role)
    .input('eid', sql.Int, employeeId)
    .input('tok', sql.NVarChar(64), token)
    .input('exp', sql.DateTime2, expires)
    .query(`INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, IsActive, EmployeeId, InviteToken, InviteExpires)
            VALUES (@em, @ph, @dn, @role, 1, @eid, @tok, @exp)`);
  return { setPasswordToken: token };
}

// Resolve the logged-in user's linked EmployeeId, account type and effective HR
// permission from their Users row. `canManageHr` (write on the HR page) means the
// caller can oversee & act on ANY review; everyone else must be the review's own
// employee or its manager (checked per-endpoint below).
async function actorContext(pool, req) {
  const r = await pool.request().input('id', sql.Int, req.user?.sub)
    .query('SELECT EmployeeId, Role, Permissions FROM dbo.Users WHERE Id = @id');
  const row = r.recordset[0] || {};
  const role = row.Role || req.user?.role || 'employee';
  // Super admins (and un-migrated legacy admins) keep full KPI oversight; anyone
  // else needs write on the KPI Tracker segment to oversee/act on any review.
  const full = role === 'superadmin' || ((role === 'admin' || role === 'user') && !row.Permissions);
  const perms = parsePermissions(row.Permissions);
  const canManageHr = full || perms.hr_kpi === 'write';
  return { employeeId: row.EmployeeId ?? null, role, canManageHr };
}

// Resolve the company letterhead branding for the review PDF from a joined
// Companies row (mirrors the SOW/pack branding resolution in projects.js).
function reviewBranding(row) {
  return {
    headerPath: row.SowHeaderFile ? path.join(UPLOAD_DIR, row.SowHeaderFile) : null,
    footerPath: row.SowFooterFile ? path.join(UPLOAD_DIR, row.SowFooterFile) : null,
    headerSideMargin: !!row.DocHeaderSideMargin,
    footerSideMargin: !!row.DocFooterSideMargin,
  };
}

// Build a review email link — a set-password invite when the account still
// needs activating, otherwise a direct link to the review. `manager` picks
// the manager review route vs the employee self-assessment route.
function reviewEmailLink(setPasswordToken, reviewId, { manager = false } = {}) {
  const base = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
  const path = manager ? `/team-review/${reviewId}` : `/kpi-review/${reviewId}`;
  return setPasswordToken
    ? `${base}/set-password?token=${setPasswordToken}&next=${encodeURIComponent(path)}`
    : `${base}${path}`;
}

// GET /api/kpi/kpa-sources?companyId=&employeeId=
// Lists the KPA tasks in the company's projects (optionally just one
// employee's) with their flattened KPI list, so an admin can pick which
// KPIs a review pulls through.
router.get('/kpa-sources', requireHr, async (req, res) => {
  const companyId = parseInt(req.query.companyId, 10);
  if (Number.isNaN(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const employeeId = parseInt(req.query.employeeId, 10);
  try {
    const pool = await getPool();
    const r = pool.request().input('cid', sql.Int, companyId);
    let where = `p.CompanyId = @cid AND pp.Kind = 'kpa' AND pp.KpaDataJson IS NOT NULL`;
    if (Number.isFinite(employeeId)) { r.input('eid', sql.Int, employeeId); where += ' AND pp.EmployeeId = @eid'; }
    const rows = await r.query(`
      SELECT pp.Id, pp.Name AS ProcessName, pp.EmployeeId, pp.KpaDataJson,
             p.Id AS ProjectId, p.Name AS ProjectName
      FROM dbo.ProjectProcesses pp
      INNER JOIN dbo.Projects p ON p.Id = pp.ProjectId
      WHERE ${where}
      ORDER BY pp.Id DESC;
    `);
    const sources = rows.recordset.map((row) => {
      let kpas = [];
      try { kpas = JSON.parse(row.KpaDataJson || '[]'); } catch { /* skip bad JSON */ }
      const kpis = flattenKpis(kpas);
      return {
        processId: row.Id,
        processName: row.ProcessName,
        projectId: row.ProjectId,
        projectName: row.ProjectName,
        employeeId: row.EmployeeId,
        kpiCount: kpis.length,
        kpis,
      };
    }).filter((s) => s.kpiCount > 0);
    res.json(sources);
  } catch (err) {
    console.error('[kpi/kpa-sources]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews?companyId=N — list reviews for a company (Tracker).
router.get('/reviews', requireHr, async (req, res) => {
  const companyId = parseInt(req.query.companyId, 10);
  if (Number.isNaN(companyId)) return res.status(400).json({ error: 'companyId is required' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('cid', sql.Int, companyId).query(`
      SELECT rv.Id, rv.CompanyId, rv.EmployeeId, rv.ManagerId, rv.PeriodLabel, rv.Status,
             rv.KpiSnapshotJson, rv.EmployeeSubmittedAt, rv.ManagerSubmittedAt,
             rv.CompletedAt, rv.CreatedAt,
             e.Name AS EmployeeName, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.CompanyId = @cid
      ORDER BY rv.CreatedAt DESC, rv.Id DESC;
    `);
    res.json(r.recordset.map(mapReviewRow));
  } catch (err) {
    console.error('[kpi/reviews/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/mine — the logged-in employee's own reviews.
// (Defined before /reviews/:id so "mine" isn't captured as an id.)
router.get('/reviews/mine', async (req, res) => {
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    if (!actor.employeeId) return res.json([]);
    const r = await pool.request().input('eid', sql.Int, actor.employeeId).query(`
      SELECT rv.Id, rv.CompanyId, rv.EmployeeId, rv.ManagerId, rv.PeriodLabel, rv.Status,
             rv.KpiSnapshotJson, rv.EmployeeSubmittedAt, rv.ManagerSubmittedAt, rv.CompletedAt, rv.CreatedAt,
             e.Name AS EmployeeName, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.EmployeeId = @eid
      ORDER BY rv.CreatedAt DESC, rv.Id DESC;
    `);
    res.json(r.recordset.map(mapReviewRow));
  } catch (err) {
    console.error('[kpi/reviews/mine]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/team — reviews for the logged-in manager's direct
// reports. (Defined before /reviews/:id so "team" isn't captured as an id.)
router.get('/reviews/team', async (req, res) => {
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    if (!actor.employeeId) return res.json([]);
    // A manager sees: every review they conduct (rv.ManagerId = me, all
    // statuses), plus the COMPLETED reviews of anyone they're an allocated
    // manager of — primary (Employees.ManagerId) or additional
    // (EmployeeManagers) — even when a different manager conducted it.
    const r = await pool.request().input('mid', sql.Int, actor.employeeId).query(`
      SELECT rv.Id, rv.CompanyId, rv.EmployeeId, rv.ManagerId, rv.PeriodLabel, rv.Status,
             rv.KpiSnapshotJson, rv.EmployeeSubmittedAt, rv.ManagerSubmittedAt, rv.CompletedAt, rv.CreatedAt,
             e.Name AS EmployeeName, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.ManagerId = @mid
         OR (rv.Status = 'completed' AND rv.EmployeeId IN (
              SELECT Id FROM dbo.Employees WHERE ManagerId = @mid
              UNION
              SELECT EmployeeId FROM dbo.EmployeeManagers WHERE ManagerId = @mid
            ))
      ORDER BY rv.CreatedAt DESC, rv.Id DESC;
    `);
    res.json(r.recordset.map(mapReviewRow));
  } catch (err) {
    console.error('[kpi/reviews/team]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/:id/employee-assessment — snapshot + the employee's
// own ratings, for the self-assessment form. Owner (or admin) only.
router.get('/reviews/:id/employee-assessment', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.EmployeeId) {
      return res.status(403).json({ error: 'This review is not assigned to you.' });
    }
    let kpis = [], ratings = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    try { ratings = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
    res.json({
      id: row.Id,
      periodLabel: row.PeriodLabel,
      status: row.Status,
      employeeName: row.EmployeeName,
      managerName: row.ManagerName,
      kpis,
      ratings,
      editable: row.Status === 'employee_pending',
      submittedAt: row.EmployeeSubmittedAt,
    });
  } catch (err) {
    console.error('[kpi/employee-assessment/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/reviews/:id/employee-assessment  { ratings:[{rating,comment}], submit }
// Save draft (submit=false) or submit (submit=true → status employee_submitted,
// notify + provision the manager). Owner (or admin) only.
router.put('/reviews/:id/employee-assessment', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const submit = req.body?.submit === true;
  const ratingsIn = Array.isArray(req.body?.ratings) ? req.body.ratings : [];
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName,
             m.Id AS MgrId, m.Name AS ManagerName, m.Email AS ManagerEmail
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.EmployeeId) {
      return res.status(403).json({ error: 'This review is not assigned to you.' });
    }
    if (row.Status !== 'employee_pending') {
      return res.status(409).json({ error: 'This assessment has already been submitted.' });
    }

    let snapshot = [];
    try { snapshot = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    const clean = snapshot.map((_, i) => {
      const src = ratingsIn[i] || {};
      const rating = Number(src.rating);
      return {
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
        comment: typeof src.comment === 'string' ? src.comment.slice(0, 4000) : '',
        // Data For Review — the evidence/metrics that substantiate the score.
        data: typeof src.data === 'string' ? src.data.slice(0, 4000) : '',
      };
    });
    if (submit && clean.some((c) => c.rating == null)) {
      return res.status(400).json({ error: 'Please rate every KPI before submitting.' });
    }

    const newStatus = submit ? 'employee_submitted' : 'employee_pending';
    await pool.request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(clean))
      .input('st', sql.NVarChar(30), newStatus)
      .input('sub', sql.Bit, submit ? 1 : 0)
      .query(`UPDATE dbo.KpiReviews SET
                EmployeeRatingsJson = @json,
                Status = @st,
                EmployeeSubmittedAt = CASE WHEN @sub = 1 THEN SYSUTCDATETIME() ELSE EmployeeSubmittedAt END,
                UpdatedAt = SYSUTCDATETIME()
              WHERE Id = @id`);

    // On submit, provision + notify the manager (their review UI lands in a
    // later slice; this readies their account and tells them it's coming).
    if (submit && row.ManagerEmail) {
      let setPwToken = null;
      try {
        const prov = await ensureUserLogin(pool, {
          email: row.ManagerEmail, name: row.ManagerName, employeeId: row.MgrId, role: 'manager',
        });
        setPwToken = prov.setPasswordToken;
      } catch (e) { console.error('[kpi/provision-manager]', e.message); }
      const tpl = renderKpiReviewEmail({
        kind: 'manager_ready',
        employeeName: row.EmployeeName,
        managerName: row.ManagerName,
        periodLabel: row.PeriodLabel,
        link: reviewEmailLink(setPwToken, id, { manager: true }),
      });
      sendMail({ to: row.ManagerEmail, subject: tpl.subject, text: tpl.text, html: tpl.html })
        .catch((e) => console.error('[kpi/manager-email]', e.message));
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[kpi/employee-assessment/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/:id/manager-assessment — snapshot + the EMPLOYEE's
// answers (visible to the manager) + the manager's own ratings. Manager
// (of this review) or admin only.
router.get('/reviews/:id/manager-assessment', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.ManagerId) {
      return res.status(403).json({ error: 'You are not the manager for this review.' });
    }
    let kpis = [], employeeRatings = [], managerRatings = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    try { employeeRatings = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
    try { managerRatings = JSON.parse(row.ManagerRatingsJson || '[]'); } catch { /* empty */ }
    res.json({
      id: row.Id,
      periodLabel: row.PeriodLabel,
      status: row.Status,
      employeeName: row.EmployeeName,
      managerName: row.ManagerName,
      kpis,
      employeeRatings,   // read-only for the manager
      managerRatings,    // the manager's own inputs
      // The employee must have submitted before the manager can act; not
      // re-editable once the manager has submitted.
      editable: row.Status === 'employee_submitted',
      employeeSubmittedAt: row.EmployeeSubmittedAt,
      managerSubmittedAt: row.ManagerSubmittedAt,
      hasSessionPassword: !!row.SessionPasswordHash,
    });
  } catch (err) {
    console.error('[kpi/manager-assessment/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/reviews/:id/manager-assessment  { ratings, submit, sessionPassword }
// Save draft (submit=false) or submit (submit=true → status manager_submitted,
// set the joint-session password, notify the employee it's locked). Manager
// (of this review) or admin only.
router.put('/reviews/:id/manager-assessment', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const submit = req.body?.submit === true;
  const ratingsIn = Array.isArray(req.body?.ratings) ? req.body.ratings : [];
  const sessionPassword = typeof req.body?.sessionPassword === 'string' ? req.body.sessionPassword : '';
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, e.Email AS EmployeeEmail, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.ManagerId) {
      return res.status(403).json({ error: 'You are not the manager for this review.' });
    }
    if (row.Status !== 'employee_submitted') {
      const msg = row.Status === 'employee_pending'
        ? 'The employee has not submitted their self-assessment yet.'
        : 'This review has already been submitted.';
      return res.status(409).json({ error: msg });
    }

    let snapshot = [];
    try { snapshot = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    const clean = snapshot.map((_, i) => {
      const src = ratingsIn[i] || {};
      const rating = Number(src.rating);
      return {
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
        comment: typeof src.comment === 'string' ? src.comment.slice(0, 4000) : '',
        // Data For Review — the evidence/metrics that substantiate the score.
        data: typeof src.data === 'string' ? src.data.slice(0, 4000) : '',
      };
    });
    if (submit) {
      if (clean.some((c) => c.rating == null)) {
        return res.status(400).json({ error: 'Please rate every KPI before submitting.' });
      }
      if (sessionPassword.length < 4) {
        return res.status(400).json({ error: 'Set a session password of at least 4 characters to share with the employee.' });
      }
    }

    const newStatus = submit ? 'manager_submitted' : 'employee_submitted';
    const passwordHash = submit ? await bcrypt.hash(sessionPassword, 10) : null;
    const req2 = pool.request()
      .input('id', sql.Int, id)
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(clean))
      .input('st', sql.NVarChar(30), newStatus)
      .input('sub', sql.Bit, submit ? 1 : 0);
    req2.input('pw', sql.NVarChar(255), passwordHash);
    await req2.query(`UPDATE dbo.KpiReviews SET
        ManagerRatingsJson = @json,
        Status = @st,
        ManagerSubmittedAt = CASE WHEN @sub = 1 THEN SYSUTCDATETIME() ELSE ManagerSubmittedAt END,
        SessionPasswordHash = CASE WHEN @sub = 1 THEN @pw ELSE SessionPasswordHash END,
        UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id`);

    // On submit, tell the employee the session is ready but locked — the
    // manager shares the password out-of-band (joint session lands in the
    // next slice; point them at their list for now).
    if (submit && row.EmployeeEmail) {
      const base = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
      const tpl = renderKpiReviewEmail({
        kind: 'employee_locked',
        employeeName: row.EmployeeName,
        managerName: row.ManagerName,
        periodLabel: row.PeriodLabel,
        link: `${base}/review-session/${id}`,
      });
      sendMail({ to: row.EmployeeEmail, subject: tpl.subject, text: tpl.text, html: tpl.html })
        .catch((e) => console.error('[kpi/employee-locked-email]', e.message));
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('[kpi/manager-assessment/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/reviews/:id/unlock  { password }
// The employee enters the manager's session password to open the combined
// review. Manager/admin never need it (they authored it). Idempotent once
// unlocked/completed.
router.post('/reviews/:id/unlock', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id)
      .query('SELECT Id, EmployeeId, ManagerId, Status, SessionPasswordHash FROM dbo.KpiReviews WHERE Id = @id');
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    const isParty = actor.employeeId === row.EmployeeId || actor.employeeId === row.ManagerId;
    if (!actor.canManageHr && !isParty) return res.status(403).json({ error: 'This review is not yours.' });
    if (row.Status === 'unlocked' || row.Status === 'completed') return res.json({ ok: true, status: row.Status });
    if (row.Status !== 'manager_submitted') return res.status(409).json({ error: 'This review is not ready for a session yet.' });
    if (!row.SessionPasswordHash) return res.status(409).json({ error: 'No session password has been set.' });
    const ok = await bcrypt.compare(password, row.SessionPasswordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect session password.' });
    await pool.request().input('id', sql.Int, id)
      .query(`UPDATE dbo.KpiReviews SET Status = 'unlocked', UnlockedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
              WHERE Id = @id AND Status = 'manager_submitted'`);
    res.json({ ok: true, status: 'unlocked' });
  } catch (err) {
    console.error('[kpi/unlock]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/:id/session — the combined employee-vs-manager view.
// Manager/admin see it any time; the employee is locked out until they
// unlock with the session password (returns { locked:true } in that case).
router.get('/reviews/:id/session', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, m.Name AS ManagerName, c.Name AS CompanyName,
             ks.DocumentFile AS SessionDocFile
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      LEFT  JOIN dbo.Companies c ON c.Id = rv.CompanyId
      LEFT  JOIN dbo.KpiSessions ks ON ks.Id = rv.KpiSessionId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    const isManager = actor.employeeId === row.ManagerId;
    const isEmployee = actor.employeeId === row.EmployeeId;
    const isAdmin = actor.canManageHr;
    if (!isManager && !isEmployee && !isAdmin) return res.status(403).json({ error: 'This review is not yours.' });

    const meta = {
      id: row.Id, periodLabel: row.PeriodLabel, status: row.Status,
      employeeName: row.EmployeeName, managerName: row.ManagerName,
      viewerIsManager: isManager || isAdmin,
    };
    if (!['manager_submitted', 'unlocked', 'completed'].includes(row.Status)) {
      return res.json({ ...meta, notReady: true });
    }
    // Employee stays locked out of the combined view until they unlock.
    if (isEmployee && !isAdmin && !isManager && row.Status === 'manager_submitted') {
      return res.json({ ...meta, locked: true });
    }

    let kpis = [], er = [], mr = [], sessionNotes = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    try { er = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
    try { mr = JSON.parse(row.ManagerRatingsJson || '[]'); } catch { /* empty */ }
    try { sessionNotes = JSON.parse(row.SessionNotesJson || '[]'); } catch { /* empty */ }
    const scores = mr.map((x) => Number(x?.rating)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
    const overall = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;

    const openForAck = ['manager_submitted', 'unlocked'].includes(row.Status);
    const bothAcknowledged = !!row.ManagerAckAt && !!row.EmployeeAckAt;

    res.json({
      ...meta,
      locked: false,
      kpis,
      employeeRatings: er,
      managerRatings: mr,
      sessionNotes,
      overall: overall != null ? Number(overall.toFixed(2)) : null,
      overallPct: overall != null ? Math.round((overall / 5) * 100) : null,
      // Two-party sign-off: both must confirm the feedback was discussed
      // before the manager can finalise.
      managerAckAt: row.ManagerAckAt || null,
      employeeAckAt: row.EmployeeAckAt || null,
      bothAcknowledged,
      canAckManager: (isManager || isAdmin) && openForAck && !row.ManagerAckAt,
      canAckEmployee: (isEmployee || isAdmin) && openForAck && !row.EmployeeAckAt,
      // Role/status eligibility; the UI keeps the button disabled until both
      // parties have acknowledged (bothAcknowledged), which the complete
      // endpoint also enforces server-side.
      canFinalize: (isManager || isAdmin) && openForAck,
      // The manager/admin can add discussion notes while the session is open.
      canEditNotes: (isManager || isAdmin) && openForAck,
      completedDocumentUrl: row.Status === 'completed' && row.SessionDocFile ? `/uploads/${row.SessionDocFile}` : null,
    });
  } catch (err) {
    console.error('[kpi/session]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi/reviews/:id/session-notes  { notes: [string] }
// The manager/admin adds per-KPI discussion notes live during the joint
// session (agreed outcomes). Notes are aligned to the KPI snapshot index.
router.put('/reviews/:id/session-notes', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const notesIn = Array.isArray(req.body?.notes) ? req.body.notes : [];
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id)
      .query('SELECT ManagerId, Status, KpiSnapshotJson FROM dbo.KpiReviews WHERE Id = @id');
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.ManagerId) {
      return res.status(403).json({ error: 'Only the manager can add session notes.' });
    }
    if (!['manager_submitted', 'unlocked'].includes(row.Status)) {
      return res.status(409).json({ error: 'Notes can only be added during an open review session.' });
    }
    let snapshot = [];
    try { snapshot = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    const clean = snapshot.map((_, i) => (typeof notesIn[i] === 'string' ? notesIn[i].slice(0, 4000) : ''));
    await pool.request().input('id', sql.Int, id).input('json', sql.NVarChar(sql.MAX), JSON.stringify(clean))
      .query('UPDATE dbo.KpiReviews SET SessionNotesJson = @json, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
    res.json({ ok: true });
  } catch (err) {
    console.error('[kpi/session-notes]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/reviews/:id/acknowledge  { party?: 'manager' | 'employee' }
// Joint-session sign-off. The manager confirms they communicated the feedback;
// the employee confirms they received it. Both are required before the manager
// can finalise. A party may only confirm their own side (admin can do either).
router.post('/reviews/:id/acknowledge', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const wantParty = req.body?.party;
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id)
      .query('SELECT EmployeeId, ManagerId, Status, ManagerAckAt, EmployeeAckAt FROM dbo.KpiReviews WHERE Id = @id');
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    const isManager = actor.employeeId === row.ManagerId;
    const isEmployee = actor.employeeId === row.EmployeeId;
    const isAdmin = actor.canManageHr;
    if (!isManager && !isEmployee && !isAdmin) return res.status(403).json({ error: 'This review is not yours.' });
    if (!['manager_submitted', 'unlocked'].includes(row.Status)) {
      return res.status(409).json({ error: 'The session must be open to confirm the discussion.' });
    }

    // Resolve which side is being confirmed: explicit body wins, else infer
    // from the actor's own role.
    let party = (wantParty === 'manager' || wantParty === 'employee') ? wantParty : null;
    if (!party) {
      if (isManager && !isEmployee) party = 'manager';
      else if (isEmployee && !isManager) party = 'employee';
    }
    if (!party) return res.status(400).json({ error: 'Specify which party is confirming (manager or employee).' });
    if (!isAdmin) {
      if (party === 'manager' && !isManager) return res.status(403).json({ error: 'Only the manager can confirm the manager side.' });
      if (party === 'employee' && !isEmployee) return res.status(403).json({ error: 'Only the employee can confirm the employee side.' });
    }

    const col = party === 'manager' ? 'ManagerAckAt' : 'EmployeeAckAt';
    await pool.request().input('id', sql.Int, id)
      .query(`UPDATE dbo.KpiReviews SET ${col} = COALESCE(${col}, SYSUTCDATETIME()), UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`);
    const upd = await pool.request().input('id', sql.Int, id)
      .query('SELECT ManagerAckAt, EmployeeAckAt FROM dbo.KpiReviews WHERE Id = @id');
    const u = upd.recordset[0];
    res.json({
      ok: true, party,
      managerAckAt: u.ManagerAckAt || null,
      employeeAckAt: u.EmployeeAckAt || null,
      bothAcknowledged: !!u.ManagerAckAt && !!u.EmployeeAckAt,
    });
  } catch (err) {
    console.error('[kpi/acknowledge]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/reviews/:id/complete — finalise: render the review PDF,
// store it as a KpiSession under the employee, mark completed, email both.
// Manager (of this review) or admin only.
router.post('/reviews/:id/complete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, e.Email AS EmployeeEmail,
             m.Name AS ManagerName, m.Email AS ManagerEmail, c.Name AS CompanyName,
             c.SowHeaderFile, c.SowFooterFile, c.DocHeaderSideMargin, c.DocFooterSideMargin, c.SowFontFamily
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      LEFT  JOIN dbo.Companies c ON c.Id = rv.CompanyId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    if (!actor.canManageHr && actor.employeeId !== row.ManagerId) {
      return res.status(403).json({ error: 'Only the manager can finalise this review.' });
    }
    if (row.Status === 'completed') return res.status(409).json({ error: 'This review is already completed.' });
    if (!['manager_submitted', 'unlocked'].includes(row.Status)) {
      return res.status(409).json({ error: 'The manager must submit their assessment before finalising.' });
    }
    if (!row.ManagerAckAt || !row.EmployeeAckAt) {
      return res.status(409).json({ error: 'Both the manager and the employee must confirm the feedback was discussed before finalising.' });
    }

    let kpis = [], er = [], mr = [], sn = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    try { er = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
    try { mr = JSON.parse(row.ManagerRatingsJson || '[]'); } catch { /* empty */ }
    try { sn = JSON.parse(row.SessionNotesJson || '[]'); } catch { /* empty */ }

    const { buildKpiReviewPdfBuffer } = await import('../kpi-review-pdf.js');
    const buf = await buildKpiReviewPdfBuffer({
      employeeName: row.EmployeeName, managerName: row.ManagerName, periodLabel: row.PeriodLabel,
      companyName: row.CompanyName, kpis, employeeRatings: er, managerRatings: mr, sessionNotes: sn,
      branding: reviewBranding(row), typography: { fontFamily: row.SowFontFamily || 'Arial' },
    });
    const fileName = `kpi-review-${id}-${Date.now()}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buf);
    const originalName = `KPI Review ${row.PeriodLabel || ''}`.trim() + '.pdf';

    const scores = mr.map((x) => Number(x?.rating)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
    const overallPct = scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) / 5 * 100) : null;
    const notes = `Completed KPI review${overallPct != null ? ` — overall ${overallPct}%` : ''}.`;

    const sess = await pool.request()
      .input('eid', sql.Int, row.EmployeeId)
      .input('pl', sql.NVarChar(50), row.PeriodLabel)
      .input('df', sql.NVarChar(500), fileName)
      .input('on', sql.NVarChar(500), originalName)
      .input('nt', sql.NVarChar(sql.MAX), notes)
      .input('by', sql.NVarChar(255), req.user?.email || null)
      .query(`INSERT INTO dbo.KpiSessions (EmployeeId, PeriodLabel, SessionDate, DocumentFile, OriginalName, Notes, UploadedBy)
              OUTPUT INSERTED.Id
              VALUES (@eid, @pl, CAST(SYSUTCDATETIME() AS DATE), @df, @on, @nt, @by)`);
    const sessionId = sess.recordset[0].Id;

    await pool.request().input('id', sql.Int, id).input('sid', sql.Int, sessionId)
      .query(`UPDATE dbo.KpiReviews SET Status = 'completed', CompletedAt = SYSUTCDATETIME(),
                KpiSessionId = @sid, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`);

    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    const recipients = [row.EmployeeEmail, row.ManagerEmail].filter(Boolean);
    if (recipients.length) {
      const tpl = renderKpiReviewEmail({
        kind: 'completed',
        employeeName: row.EmployeeName, managerName: row.ManagerName,
        periodLabel: row.PeriodLabel, link: `${baseUrl}/review-session/${id}`,
      });
      sendMail({ to: recipients, subject: tpl.subject, text: tpl.text, html: tpl.html })
        .catch((e) => console.error('[kpi/complete-email]', e.message));
    }

    res.json({ ok: true, status: 'completed', documentUrl: `/uploads/${fileName}` });
  } catch (err) {
    console.error('[kpi/complete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/:id/document-pdf — regenerate the branded, signature-
// controlled KPI review document on demand and stream it inline. Available to
// a party (employee/manager) or admin once the manager has submitted.
router.get('/reviews/:id/document-pdf', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const actor = await actorContext(pool, req);
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, m.Name AS ManagerName, c.Name AS CompanyName,
             c.SowHeaderFile, c.SowFooterFile, c.DocHeaderSideMargin, c.DocFooterSideMargin, c.SowFontFamily
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      LEFT  JOIN dbo.Companies c ON c.Id = rv.CompanyId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    const isParty = actor.employeeId === row.EmployeeId || actor.employeeId === row.ManagerId;
    if (!actor.canManageHr && !isParty) return res.status(403).json({ error: 'This review is not yours.' });
    if (!['manager_submitted', 'unlocked', 'completed'].includes(row.Status)) {
      return res.status(409).json({ error: 'The document is available once the manager has submitted their assessment.' });
    }

    let kpis = [], er = [], mr = [], sn = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* empty */ }
    try { er = JSON.parse(row.EmployeeRatingsJson || '[]'); } catch { /* empty */ }
    try { mr = JSON.parse(row.ManagerRatingsJson || '[]'); } catch { /* empty */ }
    try { sn = JSON.parse(row.SessionNotesJson || '[]'); } catch { /* empty */ }

    const { buildKpiReviewPdfBuffer } = await import('../kpi-review-pdf.js');
    const buf = await buildKpiReviewPdfBuffer({
      employeeName: row.EmployeeName, managerName: row.ManagerName, periodLabel: row.PeriodLabel,
      companyName: row.CompanyName, kpis, employeeRatings: er, managerRatings: mr, sessionNotes: sn,
      branding: reviewBranding(row), typography: { fontFamily: row.SowFontFamily || 'Arial' },
    });

    const bits = ['KPI Review'];
    if (row.EmployeeName) bits.push(row.EmployeeName);
    if (row.PeriodLabel) bits.push(row.PeriodLabel);
    const niceName = `${bits.join(' — ')}.pdf`;
    const asciiName = niceName.replace(/[^\x20-\x7E]/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(niceName)}`);
    res.send(buf);
  } catch (err) {
    console.error('[kpi/document-pdf]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/kpi/reviews/:id — one review with its frozen KPI snapshot.
router.get('/reviews/:id', requireHr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.*, e.Name AS EmployeeName, e.Email AS EmployeeEmail, m.Name AS ManagerName
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });
    let kpis = [];
    try { kpis = JSON.parse(row.KpiSnapshotJson || '[]'); } catch { /* keep empty */ }
    res.json({
      ...mapReviewRow(row),
      employeeEmail: row.EmployeeEmail,
      sourceProcessId: row.SourceProcessId,
      kpis,
    });
  } catch (err) {
    console.error('[kpi/reviews/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/reviews/:id/resend  { party: 'employee' | 'manager' }
// Re-send the review link to a party (e.g. they lost the email or their
// account was never activated). Re-provisions the login if needed and mails
// them a fresh set-password / review link.
router.post('/reviews/:id/resend', requireHr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const party = req.body?.party === 'manager' ? 'manager' : 'employee';
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT rv.PeriodLabel, rv.KpiSnapshotJson,
             e.Id AS EmpId, e.Name AS EmployeeName, e.Email AS EmployeeEmail,
             m.Id AS MgrId, m.Name AS ManagerName, m.Email AS ManagerEmail
      FROM dbo.KpiReviews rv
      INNER JOIN dbo.Employees e ON e.Id = rv.EmployeeId
      LEFT  JOIN dbo.Employees m ON m.Id = rv.ManagerId
      WHERE rv.Id = @id;
    `);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });

    const target = party === 'manager'
      ? { email: row.ManagerEmail, name: row.ManagerName, employeeId: row.MgrId, role: 'manager' }
      : { email: row.EmployeeEmail, name: row.EmployeeName, employeeId: row.EmpId, role: 'employee' };
    if (party === 'manager' && !row.MgrId) {
      return res.status(400).json({ error: 'This employee has no manager on file.' });
    }
    if (!target.email) {
      return res.status(400).json({ error: `No email address on file for the ${party}.` });
    }

    let setPwToken = null;
    try {
      const prov = await ensureUserLogin(pool, target);
      setPwToken = prov.setPasswordToken;
    } catch (e) { console.error('[kpi/resend-provision]', e.message); }

    const tpl = renderKpiReviewEmail({
      kind: party === 'manager' ? 'manager_ready' : 'employee_start',
      employeeName: row.EmployeeName,
      managerName: row.ManagerName,
      periodLabel: row.PeriodLabel,
      kpiCount: snapshotCount(row.KpiSnapshotJson),
      link: reviewEmailLink(setPwToken, id, { manager: party === 'manager' }),
    });
    const result = await sendMail({ to: target.email, subject: tpl.subject, text: tpl.text, html: tpl.html });
    res.json({ ok: true, party, emailedTo: target.email, sent: result?.sent !== false });
  } catch (err) {
    console.error('[kpi/reviews/resend]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/kpi/reviews/:id — remove a review cycle (e.g. one started by
// mistake). Does NOT touch a completed review's stored PDF (that's a
// KpiSession document, managed separately from the KPIs panel).
router.delete('/reviews/:id', requireHr, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const found = await pool.request().input('id', sql.Int, id)
      .query('SELECT Id FROM dbo.KpiReviews WHERE Id = @id');
    if (!found.recordset[0]) return res.status(404).json({ error: 'Review not found' });
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.KpiReviews WHERE Id = @id');
    res.json({ ok: true });
  } catch (err) {
    console.error('[kpi/reviews/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi/reviews
// Body: { employeeId, sourceProcessId, periodLabel, selectedKpiIndices? }
// Snapshots the chosen KPIs, creates the review in 'employee_pending', and
// emails the employee a link to complete their self-assessment.
router.post('/reviews', requireHr, async (req, res) => {
  const employeeId = parseInt(req.body?.employeeId, 10);
  const sourceProcessId = parseInt(req.body?.sourceProcessId, 10);
  const periodLabel = (req.body?.periodLabel || '').trim();
  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'employeeId is required' });
  if (!Number.isFinite(sourceProcessId)) return res.status(400).json({ error: 'sourceProcessId is required' });
  if (!periodLabel) return res.status(400).json({ error: 'periodLabel is required (e.g. "Q1 2026")' });
  const selectedIndices = Array.isArray(req.body?.selectedKpiIndices)
    ? req.body.selectedKpiIndices.map((n) => parseInt(n, 10)).filter(Number.isFinite)
    : null;

  try {
    const pool = await getPool();
    const emp = await pool.request().input('eid', sql.Int, employeeId).query(`
      SELECT e.Id, e.Name, e.Email, e.CompanyId, e.ManagerId,
             m.Name AS ManagerName, m.Email AS ManagerEmail
      FROM dbo.Employees e
      LEFT JOIN dbo.Employees m ON m.Id = e.ManagerId
      WHERE e.Id = @eid;
    `);
    const employee = emp.recordset[0];
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // One review per employee per period, regardless of which manager conducts it.
    const dupe = await pool.request()
      .input('eid', sql.Int, employee.Id)
      .input('period', sql.NVarChar(50), periodLabel)
      .query('SELECT TOP 1 Id FROM dbo.KpiReviews WHERE EmployeeId = @eid AND PeriodLabel = @period;');
    if (dupe.recordset[0]) {
      return res.status(409).json({ error: `A review already exists for ${employee.Name} for "${periodLabel}".` });
    }

    // Resolve the conducting manager: any of the employee's allocated managers
    // (primary Employees.ManagerId + additional EmployeeManagers). Defaults to
    // the primary manager. The picked manager is snapshotted onto the review.
    let managerId = employee.ManagerId || null;
    let managerName = employee.ManagerName || null;
    const requestedManagerId = parseInt(req.body?.managerId, 10);
    if (Number.isInteger(requestedManagerId) && requestedManagerId !== managerId) {
      const alloc = await pool.request().input('eid', sql.Int, employee.Id)
        .query('SELECT ManagerId FROM dbo.EmployeeManagers WHERE EmployeeId = @eid;');
      const allocated = new Set(alloc.recordset.map((x) => x.ManagerId));
      if (employee.ManagerId) allocated.add(employee.ManagerId);
      if (!allocated.has(requestedManagerId)) {
        return res.status(400).json({ error: "The chosen manager is not one of this employee's managers." });
      }
      const mrow = await pool.request().input('mid', sql.Int, requestedManagerId)
        .query('SELECT Name FROM dbo.Employees WHERE Id = @mid;');
      managerId = requestedManagerId;
      managerName = mrow.recordset[0]?.Name || null;
    }

    const src = await pool.request().input('pid', sql.Int, sourceProcessId).query(`
      SELECT Id, KpaDataJson FROM dbo.ProjectProcesses WHERE Id = @pid AND Kind = 'kpa';
    `);
    if (!src.recordset[0]) return res.status(404).json({ error: 'Source KPA task not found' });
    let kpas = [];
    try { kpas = JSON.parse(src.recordset[0].KpaDataJson || '[]'); } catch { /* handled below */ }
    let snapshot = flattenKpis(kpas);
    if (selectedIndices && selectedIndices.length) {
      const keep = new Set(selectedIndices);
      snapshot = snapshot.filter((_, i) => keep.has(i));
    }
    if (snapshot.length === 0) return res.status(400).json({ error: 'The selected KPA has no KPIs to review' });

    const ins = await pool.request()
      .input('cid',    sql.Int, employee.CompanyId)
      .input('eid',    sql.Int, employee.Id)
      .input('mid',    sql.Int, managerId)
      .input('spid',   sql.Int, sourceProcessId)
      .input('period', sql.NVarChar(50), periodLabel)
      .input('snap',   sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
      .input('by',     sql.NVarChar(255), req.user?.email || null)
      .query(`
        INSERT INTO dbo.KpiReviews
          (CompanyId, EmployeeId, ManagerId, SourceProcessId, PeriodLabel, KpiSnapshotJson, Status, CreatedBy)
        OUTPUT INSERTED.Id, INSERTED.Status, INSERTED.CreatedAt
        VALUES (@cid, @eid, @mid, @spid, @period, @snap, 'employee_pending', @by);
      `);
    const review = ins.recordset[0];

    // Auto-provision the employee's login (if needed) and email them a link
    // to complete their self-assessment — a set-password invite when the
    // account is new. In dev (no SMTP/Graph) sendMail prints it to console.
    let emailed = false;
    if (employee.Email) {
      let setPwToken = null;
      try {
        const prov = await ensureUserLogin(pool, {
          email: employee.Email, name: employee.Name, employeeId: employee.Id, role: 'employee',
        });
        setPwToken = prov.setPasswordToken;
      } catch (e) { console.error('[kpi/provision-employee]', e.message); }
      const tpl = renderKpiReviewEmail({
        kind: 'employee_start',
        employeeName: employee.Name,
        managerName,
        periodLabel,
        kpiCount: snapshot.length,
        link: reviewEmailLink(setPwToken, review.Id),
      });
      emailed = true;
      sendMail({ to: employee.Email, subject: tpl.subject, text: tpl.text, html: tpl.html })
        .catch((e) => console.error('[kpi/review-email]', e.message));
    }

    res.status(201).json({
      id: review.Id,
      companyId: employee.CompanyId,
      employeeId: employee.Id,
      employeeName: employee.Name,
      managerId,
      managerName,
      periodLabel,
      status: review.Status,
      kpiCount: snapshot.length,
      emailedTo: emailed ? employee.Email : null,
      createdAt: review.CreatedAt,
    });
  } catch (err) {
    console.error('[kpi/reviews/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
