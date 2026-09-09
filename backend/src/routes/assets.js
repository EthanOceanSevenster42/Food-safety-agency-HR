import { Router } from 'express';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';
import { upload, deleteUpload, UPLOAD_DIR } from '../upload.js';
import { sendMail } from '../email.js';
import { generateRepairDocket, repairReference } from '../pdf.js';
import { regenerateDocketForAsset } from '../docket-regen.js';
import { renderRepairEmail } from '../email-templates.js';
import { getRepairCoordinator } from '../settings.js';

const router = Router();
router.use(requireAuth);
router.use(requireSegments('asset_allocated', 'asset_all', 'asset_repairs'));

const STAGE_LABEL = {
  booked_in: 'Booked In',
  out_for_dispatch: 'Out for Dispatch',
  at_supplier: 'At Supplier',
  received_back: 'Received Back',
};

function isValidEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

async function getRepairContext(pool, assetId) {
  const r = await pool.request().input('id', sql.Int, assetId).query(`
    SELECT a.*, c.Name AS CompanyName, c.LogoFile AS CompanyLogoFile, c.BrandColor AS CompanyBrandColor,
           e.Name AS OwnerName, e.Title AS OwnerTitle, e.Email AS OwnerEmail
    FROM dbo.Assets a
    INNER JOIN dbo.Companies c ON c.Id = a.CompanyId
    LEFT JOIN dbo.Employees e ON e.Id = a.AssignedEmployeeId
    WHERE a.Id = @id
  `);
  if (!r.recordset[0]) return null;
  const row = r.recordset[0];
  return {
    asset: row,
    company: { Name: row.CompanyName, LogoFile: row.CompanyLogoFile, BrandColor: row.CompanyBrandColor },
    owner: row.OwnerName ? { Name: row.OwnerName, Title: row.OwnerTitle, Email: row.OwnerEmail } : null,
  };
}

async function getRecipientsForAsset(pool, assetId) {
  const r = await pool
    .request()
    .input('id', sql.Int, assetId)
    .query('SELECT Id, Email FROM dbo.RepairRecipients WHERE AssetId = @id ORDER BY Id');
  return r.recordset.map((x) => ({ id: x.Id, email: x.Email }));
}

async function getStageHistoryForAsset(pool, assetId) {
  const r = await pool
    .request()
    .input('id', sql.Int, assetId)
    .query('SELECT Stage, EnteredAt, ActorEmail FROM dbo.RepairStageHistory WHERE AssetId = @id ORDER BY EnteredAt');
  return r.recordset.map((x) => ({ stage: x.Stage, enteredAt: x.EnteredAt, actor: x.ActorEmail }));
}

async function recordStageEntry(pool, assetId, stage, actor, when) {
  await pool
    .request()
    .input('id', sql.Int, assetId)
    .input('stage', sql.NVarChar(50), stage)
    .input('actor', sql.NVarChar(255), actor || null)
    .input('when', sql.DateTime2, when || new Date())
    .query('INSERT INTO dbo.RepairStageHistory (AssetId, Stage, EnteredAt, ActorEmail) VALUES (@id, @stage, @when, @actor)');
}

// Copy the live RepairProblem/Supplier/Notes/Recipients/StageHistory into the RepairHistory tables
// and then clear the live tracking rows. Called only when a repair is resolved.
async function snapshotRepairToHistory(pool, assetId, { prev, ownerId, resolvedBy }) {
  // Build owner snapshot (name string at time of resolve)
  let ownerName = null;
  if (ownerId) {
    const o = await pool
      .request()
      .input('id', sql.Int, ownerId)
      .query('SELECT Name FROM dbo.Employees WHERE Id = @id');
    ownerName = o.recordset[0]?.Name ?? null;
  }

  const ref = repairReference(assetId, prev.RepairBookedInAt);

  const histInsert = await pool
    .request()
    .input('assetId',    sql.Int, assetId)
    .input('reference',  sql.NVarChar(100), ref)
    .input('problem',    sql.NVarChar(sql.MAX), prev.RepairProblem || null)
    .input('supplier',   sql.NVarChar(255), prev.RepairSupplier || null)
    .input('ownerId',    sql.Int, ownerId || null)
    .input('ownerName',  sql.NVarChar(255), ownerName)
    .input('bookedInAt', sql.DateTime2, prev.RepairBookedInAt || null)
    .input('resolvedBy', sql.NVarChar(255), resolvedBy)
    .input('docketFile', sql.NVarChar(500), prev.RepairDocketFile || null)
    .query(`
      INSERT INTO dbo.RepairHistory
        (AssetId, Reference, Problem, Supplier, OwnerEmployeeId, OwnerNameSnapshot,
         BookedInAt, ResolvedBy, DocketFile)
      OUTPUT INSERTED.Id
      VALUES (@assetId, @reference, @problem, @supplier, @ownerId, @ownerName,
              @bookedInAt, @resolvedBy, @docketFile);
    `);
  const histId = histInsert.recordset[0].Id;

  // Copy notes
  await pool
    .request()
    .input('histId', sql.Int, histId)
    .input('assetId', sql.Int, assetId)
    .query(`
      INSERT INTO dbo.RepairHistoryNotes (RepairHistoryId, Author, Message, CreatedAt)
      SELECT @histId, Author, Message, CreatedAt FROM dbo.RepairNotes WHERE AssetId = @assetId
    `);

  // Copy stage history (and add a final 'received_back' or 'returned' marker)
  await pool
    .request()
    .input('histId', sql.Int, histId)
    .input('assetId', sql.Int, assetId)
    .query(`
      INSERT INTO dbo.RepairHistoryStages (RepairHistoryId, Stage, EnteredAt, ActorEmail)
      SELECT @histId, Stage, EnteredAt, ActorEmail FROM dbo.RepairStageHistory WHERE AssetId = @assetId
    `);

  await pool
    .request()
    .input('histId', sql.Int, histId)
    .input('stage', sql.NVarChar(50), 'returned')
    .input('actor', sql.NVarChar(255), resolvedBy)
    .query(`
      INSERT INTO dbo.RepairHistoryStages (RepairHistoryId, Stage, EnteredAt, ActorEmail)
      VALUES (@histId, @stage, SYSUTCDATETIME(), @actor)
    `);

  // Clear live rows
  await pool.request().input('id', sql.Int, assetId).query('DELETE FROM dbo.RepairNotes WHERE AssetId = @id');
  await pool.request().input('id', sql.Int, assetId).query('DELETE FROM dbo.RepairRecipients WHERE AssetId = @id');
  await pool.request().input('id', sql.Int, assetId).query('DELETE FROM dbo.RepairStageHistory WHERE AssetId = @id');
}

async function getNotesForAsset(pool, assetId) {
  const r = await pool
    .request()
    .input('id', sql.Int, assetId)
    .query('SELECT Id, Author, Message, CreatedAt FROM dbo.RepairNotes WHERE AssetId = @id ORDER BY CreatedAt DESC');
  return r.recordset.map((x) => ({
    id: x.Id,
    author: x.Author,
    message: x.Message,
    createdAt: x.CreatedAt,
  }));
}

const REPAIR_STAGES = ['booked_in', 'out_for_dispatch', 'at_supplier', 'received_back'];

function mapAsset(row, images = []) {
  return {
    id: row.Id,
    companyId: row.CompanyId,
    category: row.Category,
    type: row.Type,
    name: row.Name,
    serialNumber: row.SerialNumber,
    assetTag: row.AssetTag,
    purchaseDate: row.PurchaseDate,
    purchaseValue: row.PurchaseValue == null ? null : Number(row.PurchaseValue),
    depreciationPercentPerYear: row.DepreciationPercentPerYear == null ? null : Number(row.DepreciationPercentPerYear),
    usefulLifeYears: row.UsefulLifeYears,
    notes: row.Notes,
    assignedEmployeeId: row.AssignedEmployeeId,
    assignedEmployeeName: row.AssignedEmployeeName ?? null,
    assignedEmployeeTitle: row.AssignedEmployeeTitle ?? null,
    lastAssignedEmployeeId: row.LastAssignedEmployeeId ?? null,
    lastAssignedEmployeeName: row.LastAssignedEmployeeName ?? null,
    lastAssignedEmployeeTitle: row.LastAssignedEmployeeTitle ?? null,
    isInRepairs: !!row.IsInRepairs,
    repairStage: row.RepairStage,
    repairProblem: row.RepairProblem ?? null,
    repairSupplier: row.RepairSupplier ?? null,
    repairBookedInAt: row.RepairBookedInAt ?? null,
    repairDocketUrl: row.RepairDocketFile ? `/uploads/${row.RepairDocketFile}` : null,
    images,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

async function fetchImagesByAssetIds(pool, assetIds) {
  if (!assetIds.length) return new Map();
  const ids = assetIds.join(',');
  const result = await pool.request().query(`
    SELECT Id, AssetId, FileName FROM dbo.AssetImages WHERE AssetId IN (${ids}) ORDER BY Id;
  `);
  const map = new Map();
  for (const r of result.recordset) {
    if (!map.has(r.AssetId)) map.set(r.AssetId, []);
    map.get(r.AssetId).push({ id: r.Id, url: `/uploads/${r.FileName}` });
  }
  return map;
}

// Excel export of all currently in-repair assets (across all companies)
router.get('/repairs/export', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT a.*, e.Name AS AssignedEmployeeName, e.Title AS AssignedEmployeeTitle, e.Email AS AssignedEmployeeEmail,
             c.Name AS CompanyName
      FROM dbo.Assets a
      LEFT JOIN dbo.Employees e ON e.Id = a.AssignedEmployeeId
      INNER JOIN dbo.Companies c ON c.Id = a.CompanyId
      WHERE a.IsInRepairs = 1
      ORDER BY c.Name, a.RepairBookedInAt;
    `);

    const STAGE_LABELS_MAP = {
      booked_in: 'Booked In',
      out_for_dispatch: 'Out for Dispatch',
      at_supplier: 'At Supplier',
      received_back: 'Received Back',
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FSA HR Portal';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Repairs', { views: [{ state: 'frozen', ySplit: 1 }] });

    sheet.columns = [
      { header: 'Company',         key: 'company',     width: 22 },
      { header: 'Asset',           key: 'asset',       width: 32 },
      { header: 'Category',        key: 'category',    width: 14 },
      { header: 'Type',            key: 'type',        width: 14 },
      { header: 'Asset Tag',       key: 'tag',         width: 14 },
      { header: 'Serial',          key: 'serial',      width: 18 },
      { header: 'Owner',           key: 'owner',       width: 22 },
      { header: 'Owner Email',     key: 'ownerEmail',  width: 26 },
      { header: 'Stage',           key: 'stage',       width: 18 },
      { header: 'Booked In',       key: 'bookedIn',    width: 18, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
      { header: 'Days in Repair',  key: 'days',        width: 14 },
      { header: 'Supplier',        key: 'supplier',    width: 24 },
      { header: 'Problem',         key: 'problem',     width: 50 },
      { header: 'Reference',       key: 'ref',         width: 22 },
    ];

    const today = Date.now();
    for (const a of result.recordset) {
      const bookedIn = a.RepairBookedInAt ? new Date(a.RepairBookedInAt) : null;
      const days = bookedIn ? Math.floor((today - bookedIn.getTime()) / (24 * 60 * 60 * 1000)) : null;
      sheet.addRow({
        company:    a.CompanyName,
        asset:      a.Name,
        category:   a.Category,
        type:       a.Type ?? '',
        tag:        a.AssetTag ?? '',
        serial:     a.SerialNumber ?? '',
        owner:      a.AssignedEmployeeName ?? '',
        ownerEmail: a.AssignedEmployeeEmail ?? '',
        stage:      STAGE_LABELS_MAP[a.RepairStage] || a.RepairStage || '',
        bookedIn:   bookedIn,
        days:       days,
        supplier:   a.RepairSupplier ?? '',
        problem:    a.RepairProblem ?? '',
        ref:        a.RepairBookedInAt ? repairReference(a.Id, a.RepairBookedInAt) : '',
      });
    }

    // Header style
    const head = sheet.getRow(1);
    head.height = 24;
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E6F81' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    // Color rows by stage
    const STAGE_FILL = {
      booked_in:        'FFF7F2E1',
      out_for_dispatch: 'FFE3ECF6',
      at_supplier:      'FFFFE9CC',
      received_back:    'FFDDF2E5',
    };
    const STAGE_PILL = {
      booked_in:        { bg: 'FF8B7E55', fg: 'FFFFFFFF' },
      out_for_dispatch: { bg: 'FF1F4E79', fg: 'FFFFFFFF' },
      at_supplier:      { bg: 'FFE08A00', fg: 'FFFFFFFF' },
      received_back:    { bg: 'FF2D8C5C', fg: 'FFFFFFFF' },
    };

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rowAsset = result.recordset[r - 2];
      const stageKey = rowAsset?.RepairStage;
      const fill = STAGE_FILL[stageKey] || 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE4E8EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE4E8EB' } },
          left:   { style: 'thin', color: { argb: 'FFE4E8EB' } },
          right:  { style: 'thin', color: { argb: 'FFE4E8EB' } },
        };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      const stageCell = row.getCell('stage');
      const pill = STAGE_PILL[stageKey];
      if (pill) {
        stageCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pill.bg } };
        stageCell.font = { bold: true, color: { argb: pill.fg } };
        stageCell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }

    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

    const todayStr = new Date().toISOString().slice(0, 10);
    const fileName = `FSA-Repairs-${todayStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[assets/repairs/export]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// All in-repairs assets across all companies (with company info embedded)
router.get('/repairs', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT a.*, e.Name AS AssignedEmployeeName, e.Title AS AssignedEmployeeTitle,
             le.Name AS LastAssignedEmployeeName, le.Title AS LastAssignedEmployeeTitle,
             c.Name AS CompanyName, c.LogoFile AS CompanyLogoFile, c.BrandColor AS CompanyBrandColor
      FROM dbo.Assets a
      LEFT JOIN dbo.Employees e  ON e.Id  = a.AssignedEmployeeId
      LEFT JOIN dbo.Employees le ON le.Id = a.LastAssignedEmployeeId
      INNER JOIN dbo.Companies c ON c.Id = a.CompanyId
      WHERE a.IsInRepairs = 1
      ORDER BY c.Name, a.Category, a.Name;
    `);
    const ids = result.recordset.map((r) => r.Id);
    const imagesByAsset = await fetchImagesByAssetIds(pool, ids);
    res.json(
      result.recordset.map((r) => ({
        ...mapAsset(r, imagesByAsset.get(r.Id) ?? []),
        companyName: r.CompanyName,
        companyLogoUrl: r.CompanyLogoFile ? `/uploads/${r.CompanyLogoFile}` : null,
        companyBrandColor: r.CompanyBrandColor,
      }))
    );
  } catch (err) {
    console.error('[assets/repairs]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Excel export — must come before '/:id' style routes
router.get('/export', async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  try {
    const pool = await getPool();
    const companyResult = await pool
      .request()
      .input('id', sql.Int, companyId)
      .query('SELECT Name FROM dbo.Companies WHERE Id = @id');
    if (!companyResult.recordset[0]) return res.status(404).json({ error: 'Company not found' });
    const companyName = companyResult.recordset[0].Name;

    const result = await pool
      .request()
      .input('cid', sql.Int, companyId)
      .query(`
        SELECT a.*, e.Name AS AssignedEmployeeName, e.Title AS AssignedEmployeeTitle
        FROM dbo.Assets a
        LEFT JOIN dbo.Employees e ON e.Id = a.AssignedEmployeeId
        WHERE a.CompanyId = @cid
        ORDER BY a.Category, a.Name;
      `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'FSA HR Portal';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Assets', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Asset Tag',          key: 'assetTag',          width: 14 },
      { header: 'Status',             key: 'status',            width: 13 },
      { header: 'Category',           key: 'category',          width: 16 },
      { header: 'Type',               key: 'type',              width: 14 },
      { header: 'Name / Model',       key: 'name',              width: 32 },
      { header: 'Assigned To',        key: 'assignedName',      width: 22 },
      { header: 'Title',              key: 'assignedTitle',     width: 22 },
      { header: 'Serial Number',      key: 'serialNumber',      width: 18 },
      { header: 'Purchase Date',      key: 'purchaseDate',      width: 14, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Purchase Value',     key: 'purchaseValue',     width: 16, style: { numFmt: '"R " #,##0.00' } },
      { header: 'Current Book Value', key: 'bookValue',         width: 18, style: { numFmt: '"R " #,##0.00' } },
      { header: 'Depreciation %/yr',  key: 'depreciationPct',   width: 16, style: { numFmt: '0.0"%"' } },
      { header: 'Useful Life (yrs)',  key: 'usefulLifeYears',   width: 14 },
      { header: 'Replacement Date',   key: 'replacementDate',   width: 16, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Notes',              key: 'notes',             width: 40 },
    ];

    const today = Date.now();
    for (const a of result.recordset) {
      const isInRepairs = !!a.IsInRepairs;
      const status = isInRepairs
        ? 'In Repairs'
        : (a.AssignedEmployeeId ? 'Allocated' : 'In Storage');

      let bookValue = null;
      if (a.PurchaseValue != null && a.DepreciationPercentPerYear != null && a.PurchaseDate) {
        const yearsElapsed = (today - new Date(a.PurchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        const remainingFraction = Math.max(0, 1 - (yearsElapsed * Number(a.DepreciationPercentPerYear)) / 100);
        bookValue = Number(a.PurchaseValue) * remainingFraction;
      }

      let replacementDate = null;
      if (a.PurchaseDate && a.UsefulLifeYears) {
        const d = new Date(a.PurchaseDate);
        d.setFullYear(d.getFullYear() + a.UsefulLifeYears);
        replacementDate = d;
      }

      sheet.addRow({
        assetTag: a.AssetTag ?? '',
        status,
        category: a.Category,
        type: a.Type ?? '',
        name: a.Name,
        assignedName: a.AssignedEmployeeName ?? '',
        assignedTitle: a.AssignedEmployeeTitle ?? '',
        serialNumber: a.SerialNumber ?? '',
        purchaseDate: a.PurchaseDate ? new Date(a.PurchaseDate) : null,
        purchaseValue: a.PurchaseValue == null ? null : Number(a.PurchaseValue),
        bookValue,
        depreciationPct: a.DepreciationPercentPerYear == null ? null : Number(a.DepreciationPercentPerYear),
        usefulLifeYears: a.UsefulLifeYears ?? null,
        replacementDate,
        notes: a.Notes ?? '',
      });
    }

    // Header styling
    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E6F81' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FF1F5564' } },
        left:   { style: 'thin', color: { argb: 'FF1F5564' } },
        right:  { style: 'thin', color: { argb: 'FF1F5564' } },
        bottom: { style: 'thin', color: { argb: 'FF1F5564' } },
      };
    });

    // Data row styling — colour-coded by status
    const STATUS_FILL = {
      'In Storage': 'FFF2F4F5',
      'Allocated':  'FFE5F0F4',
      'In Repairs': 'FFFFF1DD',
    };
    const STATUS_BORDER = 'FFE4E8EB';
    const STATUS_PILL_FILL = {
      'In Storage': 'FFC9D1D5',
      'Allocated':  'FF2E6F81',
      'In Repairs': 'FFE08A00',
    };
    const STATUS_PILL_FONT = {
      'In Storage': 'FF1F3138',
      'Allocated':  'FFFFFFFF',
      'In Repairs': 'FFFFFFFF',
    };

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const status = row.getCell('status').value;
      const fill = STATUS_FILL[status] || 'FFFFFFFF';
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.border = {
          top:    { style: 'thin', color: { argb: STATUS_BORDER } },
          bottom: { style: 'thin', color: { argb: STATUS_BORDER } },
          left:   { style: 'thin', color: { argb: STATUS_BORDER } },
          right:  { style: 'thin', color: { argb: STATUS_BORDER } },
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
      });

      // Make the Status cell a coloured pill
      const statusCell = row.getCell('status');
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_PILL_FILL[status] } };
      statusCell.font = { bold: true, color: { argb: STATUS_PILL_FONT[status] } };
      statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

    const todayStr = new Date().toISOString().slice(0, 10);
    const safeName = companyName.replace(/[^\w\-]+/g, '_');
    const fileName = `FSA-${safeName}-Assets-${todayStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[assets/export]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('cid', sql.Int, companyId)
      .query(`
        SELECT a.*, e.Name AS AssignedEmployeeName, e.Title AS AssignedEmployeeTitle,
               le.Name AS LastAssignedEmployeeName, le.Title AS LastAssignedEmployeeTitle
        FROM dbo.Assets a
        LEFT JOIN dbo.Employees e  ON e.Id  = a.AssignedEmployeeId
        LEFT JOIN dbo.Employees le ON le.Id = a.LastAssignedEmployeeId
        WHERE a.CompanyId = @cid
        ORDER BY a.Category, a.Name;
      `);
    const ids = result.recordset.map((r) => r.Id);
    const imagesByAsset = await fetchImagesByAssetIds(pool, ids);
    res.json(result.recordset.map((r) => mapAsset(r, imagesByAsset.get(r.Id) ?? [])));
  } catch (err) {
    console.error('[assets/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function getEnrichedAsset(pool, id) {
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT a.*, e.Name AS AssignedEmployeeName, e.Title AS AssignedEmployeeTitle,
             le.Name AS LastAssignedEmployeeName, le.Title AS LastAssignedEmployeeTitle
      FROM dbo.Assets a
      LEFT JOIN dbo.Employees e  ON e.Id  = a.AssignedEmployeeId
      LEFT JOIN dbo.Employees le ON le.Id = a.LastAssignedEmployeeId
      WHERE a.Id = @id;
    `);
  if (!result.recordset[0]) return null;
  const imgs = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Id, FileName FROM dbo.AssetImages WHERE AssetId = @id ORDER BY Id');
  const images = imgs.recordset.map((r) => ({ id: r.Id, url: `/uploads/${r.FileName}` }));
  return mapAsset(result.recordset[0], images);
}

router.post('/', async (req, res) => {
  const {
    companyId, category, type, name, serialNumber, assetTag,
    purchaseDate, purchaseValue, depreciationPercentPerYear, usefulLifeYears,
    notes, assignedEmployeeId, isInRepairs, repairStage,
  } = req.body ?? {};
  if (!companyId || !category?.trim() || !name?.trim()) {
    return res.status(400).json({ error: 'companyId, category and name are required' });
  }

  // If marking as in-repairs without an explicit stage, default to 'booked_in'
  const effectiveStage = isInRepairs
    ? (REPAIR_STAGES.includes(repairStage) ? repairStage : 'booked_in')
    : null;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('companyId', sql.Int, companyId)
      .input('category', sql.NVarChar(100), category.trim())
      .input('type', sql.NVarChar(100), type?.trim() || null)
      .input('name', sql.NVarChar(255), name.trim())
      .input('serial', sql.NVarChar(255), serialNumber?.trim() || null)
      .input('tag', sql.NVarChar(100), assetTag?.trim() || null)
      .input('purchaseDate', sql.Date, purchaseDate || null)
      .input('purchaseValue', sql.Decimal(12, 2), purchaseValue == null || purchaseValue === '' ? null : Number(purchaseValue))
      .input('deprPct', sql.Decimal(5, 2), depreciationPercentPerYear == null || depreciationPercentPerYear === '' ? null : Number(depreciationPercentPerYear))
      .input('lifeYears', sql.Int, usefulLifeYears == null || usefulLifeYears === '' ? null : parseInt(usefulLifeYears, 10))
      .input('notes', sql.NVarChar(sql.MAX), notes?.trim() || null)
      .input('assignedEmployeeId', sql.Int, assignedEmployeeId || null)
      .input('isInRepairs', sql.Bit, isInRepairs ? 1 : 0)
      .input('repairStage', sql.NVarChar(50), effectiveStage)
      .query(`
        INSERT INTO dbo.Assets
          (CompanyId, Category, Type, Name, SerialNumber, AssetTag, PurchaseDate,
           PurchaseValue, DepreciationPercentPerYear, UsefulLifeYears,
           Notes, AssignedEmployeeId, IsInRepairs, RepairStage)
        OUTPUT INSERTED.Id
        VALUES (@companyId, @category, @type, @name, @serial, @tag, @purchaseDate,
                @purchaseValue, @deprPct, @lifeYears,
                @notes, @assignedEmployeeId, @isInRepairs, @repairStage);
      `);
    const enriched = await getEnrichedAsset(pool, result.recordset[0].Id);
    res.status(201).json(enriched);
  } catch (err) {
    console.error('[assets/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  // Treat this as a PATCH-style update — only fields actually present in the
  // request body get written. Anything not sent is left untouched. This keeps
  // partial updates (e.g. mark-as-repaired, drag-between-stages) from wiping
  // unrelated columns like PurchaseValue or DepreciationPercentPerYear.
  const body = req.body ?? {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  const {
    category, type, name, serialNumber, assetTag,
    purchaseDate, purchaseValue, depreciationPercentPerYear, usefulLifeYears,
    notes, assignedEmployeeId, isInRepairs, repairStage,
  } = body;

  // Stage transition logic (unchanged)
  let stageDirective;
  if (isInRepairs === false) stageDirective = null;
  else if (isInRepairs === true) {
    stageDirective = REPAIR_STAGES.includes(repairStage) ? repairStage : 'booked_in';
  } else if (REPAIR_STAGES.includes(repairStage)) {
    stageDirective = repairStage;
  }

  try {
    const pool = await getPool();

    // Capture prior state — including owner and recipients — BEFORE the update, because
    // resolving a repair will null out AssignedEmployeeId and the snapshot wipes live recipients.
    const ctxBefore = await getRepairContext(pool, id);
    if (!ctxBefore) return res.status(404).json({ error: 'Not found' });
    const prev = { recordset: [ctxBefore.asset] };
    const prevStage = ctxBefore.asset.RepairStage;
    const prevInRepairs = !!ctxBefore.asset.IsInRepairs;
    const prevAssignedId = ctxBefore.asset.AssignedEmployeeId;
    const isResolving = prevInRepairs && isInRepairs === false;
    const recipientsBefore = prevInRepairs ? await getRecipientsForAsset(pool, id) : [];
    const stageHistoryBefore = prevInRepairs ? await getStageHistoryForAsset(pool, id) : [];

    // Build the SET clause dynamically, parameter by parameter, so that
    // omitted fields don't get nulled.
    const setParts = ['UpdatedAt = SYSUTCDATETIME()'];
    const request = pool.request().input('id', sql.Int, id);

    // NOT NULL columns — guard with COALESCE so a stray null doesn't violate the schema
    if (has('category')) {
      request.input('category', sql.NVarChar(100), category?.trim() || null);
      setParts.push('Category = COALESCE(@category, Category)');
    }
    if (has('name')) {
      request.input('name', sql.NVarChar(255), name?.trim() || null);
      setParts.push('Name = COALESCE(@name, Name)');
    }

    // Nullable columns — present in body means "use this value" (null clears)
    if (has('type')) {
      request.input('type', sql.NVarChar(100), type?.trim() || null);
      setParts.push('Type = @type');
    }
    if (has('serialNumber')) {
      request.input('serial', sql.NVarChar(255), serialNumber?.trim() || null);
      setParts.push('SerialNumber = @serial');
    }
    if (has('assetTag')) {
      request.input('tag', sql.NVarChar(100), assetTag?.trim() || null);
      setParts.push('AssetTag = @tag');
    }
    if (has('purchaseDate')) {
      request.input('purchaseDate', sql.Date, purchaseDate || null);
      setParts.push('PurchaseDate = @purchaseDate');
    }
    if (has('purchaseValue')) {
      const v = purchaseValue == null || purchaseValue === '' ? null : Number(purchaseValue);
      request.input('purchaseValue', sql.Decimal(12, 2), v);
      setParts.push('PurchaseValue = @purchaseValue');
    }
    if (has('depreciationPercentPerYear')) {
      const v = depreciationPercentPerYear == null || depreciationPercentPerYear === ''
        ? null : Number(depreciationPercentPerYear);
      request.input('deprPct', sql.Decimal(5, 2), v);
      setParts.push('DepreciationPercentPerYear = @deprPct');
    }
    if (has('usefulLifeYears')) {
      const v = usefulLifeYears == null || usefulLifeYears === ''
        ? null : parseInt(usefulLifeYears, 10);
      request.input('lifeYears', sql.Int, v);
      setParts.push('UsefulLifeYears = @lifeYears');
    }
    if (has('notes')) {
      request.input('notes', sql.NVarChar(sql.MAX), notes?.trim() || null);
      setParts.push('Notes = @notes');
    }

    // Resolution forces AssignedEmployeeId to NULL (asset returns to storage).
    // Otherwise honor whatever the client sent.
    if (isResolving) {
      request.input('assignedEmployeeId', sql.Int, null);
      setParts.push('AssignedEmployeeId = @assignedEmployeeId');
    } else if (has('assignedEmployeeId')) {
      request.input('assignedEmployeeId', sql.Int, assignedEmployeeId ?? null);
      setParts.push('AssignedEmployeeId = @assignedEmployeeId');
    }

    if (has('isInRepairs')) {
      request.input('isInRepairs', sql.Bit, isInRepairs ? 1 : 0);
      setParts.push('IsInRepairs = @isInRepairs');
    }

    if (stageDirective !== undefined) {
      request.input('repairStage', sql.NVarChar(50), stageDirective);
      setParts.push('RepairStage = @repairStage');
    }

    // On resolve: stash prior owner so the user can later restore allocation,
    // and wipe the live repair-tracking columns (the snapshot below preserves them).
    if (isResolving) {
      if (prevAssignedId != null) {
        request.input('lastAssignedId', sql.Int, prevAssignedId);
        setParts.push('LastAssignedEmployeeId = @lastAssignedId');
      }
      setParts.push('RepairProblem    = NULL');
      setParts.push('RepairSupplier   = NULL');
      setParts.push('RepairBookedInAt = NULL');
      setParts.push('RepairDocketFile = NULL');
    }

    const result = await request.query(`
      UPDATE dbo.Assets SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id
      WHERE Id = @id;
    `);
    if (!result.recordset[0]) return res.status(404).json({ error: 'Not found' });

    // Stage transition logging (during repair) — record the timestamp the new stage was entered
    if (prevInRepairs && stageDirective && typeof stageDirective === 'string' && stageDirective !== prevStage) {
      await recordStageEntry(pool, id, stageDirective, req.user?.email || null, new Date());
    }

    // On resolution — snapshot the completed repair into history, then drop live tracking rows.
    if (isResolving) {
      try {
        await snapshotRepairToHistory(pool, id, {
          prev: prev.recordset[0],
          ownerId: prevAssignedId,
          resolvedBy: req.user?.email || null,
        });
      } catch (snapErr) {
        console.error('[assets/update] snapshot to history failed:', snapErr.message);
      }
    }

    // Notify on repair stage transitions and on "marked repaired"
    try {
      if (isResolving) {
        // Use BEFORE state — the resolve update + snapshot have wiped owner/recipients/history live
        const emailTo = Array.from(new Set([
          ctxBefore.owner?.Email,
          ...recipientsBefore.map((r) => r.email),
        ].filter(isValidEmail)));
        if (emailTo.length > 0) {
          const stageHistory = [
            ...stageHistoryBefore,
            { stage: 'returned', enteredAt: new Date(), actor: req.user?.email || null },
          ];
          const tpl = renderRepairEmail({
            company: ctxBefore.company,
            asset: ctxBefore.asset,
            owner: ctxBefore.owner,
            currentStage: 'returned',
            intent: 'returned',
            author: req.user?.email || null,
            stageHistory,
          });
          sendMail({ to: emailTo, subject: tpl.subject, text: tpl.text, html: tpl.html, attachments: tpl.attachments })
            .catch((err) => console.error('[email] repair-complete failed:', err.message));
        }
      } else {
        const ctx = await getRepairContext(pool, id);
        const newStage = ctx.asset.RepairStage;
        const newInRepairs = !!ctx.asset.IsInRepairs;
        const recipients = await getRecipientsForAsset(pool, id);
        const emailTo = Array.from(new Set([
          ctx.owner?.Email,
          ...recipients.map((r) => r.email),
        ].filter(isValidEmail)));
        if (emailTo.length > 0 && prevInRepairs && newInRepairs && newStage && newStage !== prevStage) {
          const stageHistory = await getStageHistoryForAsset(pool, id);
          const tpl = renderRepairEmail({
            company: ctx.company,
            asset: ctx.asset,
            owner: ctx.owner,
            currentStage: newStage,
            intent: 'stage_changed',
            fromStage: prevStage,
            author: req.user?.email || null,
            stageHistory,
          });
          sendMail({ to: emailTo, subject: tpl.subject, text: tpl.text, html: tpl.html, attachments: tpl.attachments })
            .catch((err) => console.error('[email] stage-change failed:', err.message));
        }
      }
    } catch (notifyErr) {
      console.error('[assets/update] notification error:', notifyErr.message);
    }

    const enriched = await getEnrichedAsset(pool, id);
    res.json(enriched);
  } catch (err) {
    console.error('[assets/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const pool = await getPool();
    // Capture image filenames so we can clean them up after cascade-delete
    const imgs = await pool
      .request()
      .input('id', sql.Int, id)
      .query('SELECT FileName FROM dbo.AssetImages WHERE AssetId = @id;');
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.Assets WHERE Id = @id;');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    imgs.recordset.forEach((r) => deleteUpload(r.FileName));
    res.json({ ok: true });
  } catch (err) {
    console.error('[assets/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload one or more photos for an asset
router.post('/:id/images', upload.array('images', 10), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    (req.files || []).forEach((f) => deleteUpload(f.filename));
    return res.status(400).json({ error: 'Invalid id' });
  }
  if (!req.files?.length) return res.status(400).json({ error: 'No images uploaded' });

  try {
    const pool = await getPool();
    const exists = await pool.request().input('id', sql.Int, id).query('SELECT 1 AS ok FROM dbo.Assets WHERE Id = @id');
    if (!exists.recordset[0]) {
      req.files.forEach((f) => deleteUpload(f.filename));
      return res.status(404).json({ error: 'Asset not found' });
    }
    const inserted = [];
    for (const f of req.files) {
      const r = await pool
        .request()
        .input('aid', sql.Int, id)
        .input('fn', sql.NVarChar(500), f.filename)
        .input('orig', sql.NVarChar(500), f.originalname)
        .query(`
          INSERT INTO dbo.AssetImages (AssetId, FileName, OriginalName)
          OUTPUT INSERTED.Id, INSERTED.FileName
          VALUES (@aid, @fn, @orig);
        `);
      inserted.push({ id: r.recordset[0].Id, url: `/uploads/${r.recordset[0].FileName}` });
    }
    res.status(201).json(inserted);
  } catch (err) {
    (req.files || []).forEach((f) => deleteUpload(f.filename));
    console.error('[assets/upload-images]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===================== REPAIR WORKFLOW =====================

// Send an asset to repairs — captures problem + supplier + recipients,
// generates the PDF docket, and emails owner + extras with the docket attached.
router.post('/:id/send-to-repairs', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const problem = (req.body.problem || '').trim();
  const supplier = (req.body.supplier || '').trim() || null;
  const incomingRecipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];

  if (!problem) return res.status(400).json({ error: 'Problem description is required' });

  const recipients = Array.from(new Set(
    incomingRecipients
      .map((e) => (typeof e === 'string' ? e.trim() : ''))
      .filter(isValidEmail)
  ));

  try {
    const pool = await getPool();
    const ctx = await getRepairContext(pool, id);
    if (!ctx) return res.status(404).json({ error: 'Asset not found' });

    const bookedInAt = new Date();
    const reference = repairReference(id, bookedInAt);

    // Update the asset
    await pool
      .request()
      .input('id', sql.Int, id)
      .input('problem', sql.NVarChar(sql.MAX), problem)
      .input('supplier', sql.NVarChar(255), supplier)
      .input('bookedInAt', sql.DateTime2, bookedInAt)
      .query(`
        UPDATE dbo.Assets
        SET IsInRepairs = 1,
            RepairStage = 'booked_in',
            RepairProblem = @problem,
            RepairSupplier = @supplier,
            RepairBookedInAt = @bookedInAt,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @id;
      `);

    // Reset stage history for this new repair cycle and record the initial booking entry
    await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.RepairStageHistory WHERE AssetId = @id');
    await recordStageEntry(pool, id, 'booked_in', req.user?.email || null, bookedInAt);

    // Replace recipients (so resending overrides previous list)
    await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.RepairRecipients WHERE AssetId = @id');
    for (const email of recipients) {
      await pool
        .request()
        .input('id', sql.Int, id)
        .input('email', sql.NVarChar(255), email)
        .query('INSERT INTO dbo.RepairRecipients (AssetId, Email) VALUES (@id, @email)');
    }

    // Generate PDF docket — uses the system-wide repair coordinator as the single notify-on-updates contact
    const coordinator = await getRepairCoordinator();
    const pdfFile = await generateRepairDocket({
      asset: ctx.asset,
      company: ctx.company,
      owner: ctx.owner,
      problem,
      supplier,
      coordinator,
      reference,
    });

    // Save docket filename on the asset (replaces any prior docket)
    if (ctx.asset.RepairDocketFile && ctx.asset.RepairDocketFile !== pdfFile) {
      deleteUpload(ctx.asset.RepairDocketFile);
    }
    await pool
      .request()
      .input('id', sql.Int, id)
      .input('file', sql.NVarChar(500), pdfFile)
      .query('UPDATE dbo.Assets SET RepairDocketFile = @file WHERE Id = @id');

    // Build email recipient list: owner email + extra recipients (deduped)
    const emailTo = Array.from(new Set([
      ctx.owner?.Email,
      ...recipients,
    ].filter(isValidEmail)));

    if (emailTo.length > 0) {
      // Refresh ctx so RepairProblem/RepairSupplier are populated for the template
      const fresh = await getRepairContext(pool, id);
      const stageHistory = await getStageHistoryForAsset(pool, id);
      const tpl = renderRepairEmail({
        company: fresh.company,
        asset: fresh.asset,
        owner: fresh.owner,
        currentStage: 'booked_in',
        intent: 'booked',
        author: req.user?.email || null,
        reference,
        stageHistory,
      });
      sendMail({
        to: emailTo,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        attachments: [
          ...tpl.attachments,
          { filename: `repair-docket-${reference}.pdf`, path: path.join(UPLOAD_DIR, pdfFile) },
        ],
      }).catch((err) => console.error('[email] send-to-repairs failed:', err.message));
    }

    const enriched = await getEnrichedAsset(pool, id);
    res.json(enriched);
  } catch (err) {
    console.error('[assets/send-to-repairs]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get full repair detail for an asset (for the detail modal)
router.get('/:id/repair', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const pool = await getPool();
    const enriched = await getEnrichedAsset(pool, id);
    if (!enriched) return res.status(404).json({ error: 'Not found' });
    const [recipients, notes, stageHistory] = await Promise.all([
      getRecipientsForAsset(pool, id),
      getNotesForAsset(pool, id),
      getStageHistoryForAsset(pool, id),
    ]);
    const ctx = await getRepairContext(pool, id);
    res.json({
      asset: enriched,
      company: { id: ctx.asset.CompanyId, name: ctx.company.Name, brandColor: ctx.company.BrandColor, logoUrl: ctx.company.LogoFile ? `/uploads/${ctx.company.LogoFile}` : null },
      owner: ctx.owner ? { name: ctx.owner.Name, title: ctx.owner.Title, email: ctx.owner.Email } : null,
      recipients,
      notes,
      stageHistory,
    });
  } catch (err) {
    console.error('[assets/repair-detail]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All completed repair cycles for an asset (most recent first)
router.get('/:id/repair-history', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const histResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT h.*, e.Name AS OwnerCurrentName
        FROM dbo.RepairHistory h
        LEFT JOIN dbo.Employees e ON e.Id = h.OwnerEmployeeId
        WHERE h.AssetId = @id
        ORDER BY h.ResolvedAt DESC
      `);

    if (histResult.recordset.length === 0) return res.json([]);

    const histIds = histResult.recordset.map((r) => r.Id);
    const idList = histIds.join(',');

    const [stageRows, noteRows] = await Promise.all([
      pool.request().query(`
        SELECT RepairHistoryId, Stage, EnteredAt, ActorEmail
        FROM dbo.RepairHistoryStages
        WHERE RepairHistoryId IN (${idList})
        ORDER BY EnteredAt
      `),
      pool.request().query(`
        SELECT RepairHistoryId, Author, Message, CreatedAt
        FROM dbo.RepairHistoryNotes
        WHERE RepairHistoryId IN (${idList})
        ORDER BY CreatedAt
      `),
    ]);

    const stagesByHist = new Map();
    for (const r of stageRows.recordset) {
      if (!stagesByHist.has(r.RepairHistoryId)) stagesByHist.set(r.RepairHistoryId, []);
      stagesByHist.get(r.RepairHistoryId).push({ stage: r.Stage, enteredAt: r.EnteredAt, actor: r.ActorEmail });
    }
    const notesByHist = new Map();
    for (const r of noteRows.recordset) {
      if (!notesByHist.has(r.RepairHistoryId)) notesByHist.set(r.RepairHistoryId, []);
      notesByHist.get(r.RepairHistoryId).push({
        author: r.Author, message: r.Message, createdAt: r.CreatedAt,
      });
    }

    res.json(histResult.recordset.map((r) => ({
      id: r.Id,
      reference: r.Reference,
      problem: r.Problem,
      supplier: r.Supplier,
      ownerEmployeeId: r.OwnerEmployeeId,
      ownerName: r.OwnerCurrentName || r.OwnerNameSnapshot,
      bookedInAt: r.BookedInAt,
      resolvedAt: r.ResolvedAt,
      resolvedBy: r.ResolvedBy,
      docketUrl: r.DocketFile ? `/uploads/${r.DocketFile}` : null,
      stages: stagesByHist.get(r.Id) || [],
      notes: notesByHist.get(r.Id) || [],
    })));
  } catch (err) {
    console.error('[assets/repair-history]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Transfer an asset to a different company. Clears any current employee assignment
// (employee belongs to the old company) and the LastAssignedEmployeeId snapshot.
// Blocked while the asset is in repairs to keep the workflow simple.
router.post('/:id/transfer', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newCompanyId = parseInt(req.body?.companyId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (Number.isNaN(newCompanyId)) return res.status(400).json({ error: 'companyId is required' });

  try {
    const pool = await getPool();
    const cur = await pool.request().input('id', sql.Int, id).query('SELECT CompanyId, IsInRepairs FROM dbo.Assets WHERE Id = @id');
    if (!cur.recordset[0]) return res.status(404).json({ error: 'Asset not found' });
    if (cur.recordset[0].IsInRepairs) {
      return res.status(409).json({ error: 'Cannot transfer an asset while it is in repairs. Resolve the repair first.' });
    }
    if (cur.recordset[0].CompanyId === newCompanyId) {
      return res.status(400).json({ error: 'Asset already belongs to this company' });
    }
    const target = await pool.request().input('id', sql.Int, newCompanyId).query('SELECT Id FROM dbo.Companies WHERE Id = @id');
    if (!target.recordset[0]) return res.status(404).json({ error: 'Target company not found' });

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('cid', sql.Int, newCompanyId)
      .query(`
        UPDATE dbo.Assets
        SET CompanyId              = @cid,
            AssignedEmployeeId     = NULL,
            LastAssignedEmployeeId = NULL,
            UpdatedAt              = SYSUTCDATETIME()
        WHERE Id = @id
      `);

    const enriched = await getEnrichedAsset(pool, id);
    res.json(enriched);
  } catch (err) {
    console.error('[assets/transfer]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a note — emails everyone on the recipient list + the owner
router.post('/:id/notes', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const author = req.user?.email || 'Unknown';

  try {
    const pool = await getPool();
    const ctx = await getRepairContext(pool, id);
    if (!ctx) return res.status(404).json({ error: 'Asset not found' });

    const inserted = await pool
      .request()
      .input('id', sql.Int, id)
      .input('author', sql.NVarChar(255), author)
      .input('message', sql.NVarChar(sql.MAX), message)
      .query(`
        INSERT INTO dbo.RepairNotes (AssetId, Author, Message)
        OUTPUT INSERTED.Id, INSERTED.Author, INSERTED.Message, INSERTED.CreatedAt
        VALUES (@id, @author, @message);
      `);
    const note = inserted.recordset[0];

    // Regenerate the docket PDF so it picks up the new note. Fire-and-forget:
    // the response shouldn't wait on it, and a failure just means the docket
    // is slightly stale until the next regen trigger (stage change, settings
    // change, or another note).
    regenerateDocketForAsset(id).catch((err) =>
      console.warn('[notes-create] docket regen failed:', err.message)
    );

    // Email recipients + owner
    const recipients = await getRecipientsForAsset(pool, id);
    const emailTo = Array.from(new Set([
      ctx.owner?.Email,
      ...recipients.map((r) => r.email),
    ].filter(isValidEmail)));

    if (emailTo.length > 0) {
      const tpl = renderRepairEmail({
        company: ctx.company,
        asset: ctx.asset,
        owner: ctx.owner,
        currentStage: ctx.asset.RepairStage || 'booked_in',
        intent: 'note',
        note: message,
        author,
      });
      sendMail({ to: emailTo, subject: tpl.subject, text: tpl.text, html: tpl.html, attachments: tpl.attachments })
        .catch((err) => console.error('[email] note add failed:', err.message));
    }

    res.status(201).json({
      id: note.Id,
      author: note.Author,
      message: note.Message,
      createdAt: note.CreatedAt,
    });
  } catch (err) {
    console.error('[assets/notes-create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/notes/:noteId', async (req, res) => {
  const noteId = parseInt(req.params.noteId, 10);
  if (Number.isNaN(noteId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    // Capture the owning asset BEFORE the delete so we can regen its docket.
    const owner = await pool.request().input('id', sql.Int, noteId)
      .query('SELECT AssetId FROM dbo.RepairNotes WHERE Id = @id');
    const r = await pool.request().input('id', sql.Int, noteId).query('DELETE FROM dbo.RepairNotes WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    const assetId = owner.recordset[0]?.AssetId;
    if (assetId) {
      regenerateDocketForAsset(assetId).catch((err) =>
        console.warn('[notes-delete] docket regen failed:', err.message)
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[assets/notes-delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/recipients', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const email = (req.body.email || '').trim();
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  try {
    const pool = await getPool();
    const exists = await pool.request().input('id', sql.Int, id).query('SELECT 1 AS ok FROM dbo.Assets WHERE Id = @id');
    if (!exists.recordset[0]) return res.status(404).json({ error: 'Asset not found' });

    // Skip duplicates
    const dup = await pool
      .request()
      .input('id', sql.Int, id)
      .input('email', sql.NVarChar(255), email)
      .query('SELECT Id FROM dbo.RepairRecipients WHERE AssetId = @id AND Email = @email');
    if (dup.recordset[0]) {
      return res.status(409).json({ error: 'Email already on the recipient list' });
    }

    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .input('email', sql.NVarChar(255), email)
      .query(`
        INSERT INTO dbo.RepairRecipients (AssetId, Email)
        OUTPUT INSERTED.Id, INSERTED.Email
        VALUES (@id, @email);
      `);
    res.status(201).json({ id: r.recordset[0].Id, email: r.recordset[0].Email });
  } catch (err) {
    console.error('[assets/recipients-add]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/recipients/:rid', async (req, res) => {
  const rid = parseInt(req.params.rid, 10);
  if (Number.isNaN(rid)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, rid).query('DELETE FROM dbo.RepairRecipients WHERE Id = @id');
    if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[assets/recipients-delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a single asset image
router.delete('/images/:imageId', async (req, res) => {
  const imageId = parseInt(req.params.imageId, 10);
  if (Number.isNaN(imageId)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const pool = await getPool();
    const found = await pool.request().input('id', sql.Int, imageId).query('SELECT FileName FROM dbo.AssetImages WHERE Id = @id');
    if (!found.recordset[0]) return res.status(404).json({ error: 'Not found' });
    await pool.request().input('id', sql.Int, imageId).query('DELETE FROM dbo.AssetImages WHERE Id = @id');
    deleteUpload(found.recordset[0].FileName);
    res.json({ ok: true });
  } catch (err) {
    console.error('[assets/delete-image]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
