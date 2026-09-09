import { getPool, sql } from './db.js';
import { generateRepairDocket, repairReference } from './pdf.js';
import { deleteUpload } from './upload.js';
import { getRepairCoordinator } from './settings.js';

async function loadRepairContext(pool, assetId) {
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

// Regenerate the repair docket PDF for a single asset that is currently in repairs.
// Pulls the live repair coordinator from app settings, replaces the saved docket file,
// and updates Assets.RepairDocketFile. Returns the new filename or null when skipped.
export async function regenerateDocketForAsset(assetId) {
  const pool = await getPool();
  const ctx = await loadRepairContext(pool, assetId);
  if (!ctx || !ctx.asset.IsInRepairs) return null;

  const coordinator = await getRepairCoordinator();
  const reference = repairReference(assetId, ctx.asset.RepairBookedInAt);

  // Live notes for this repair, oldest-first — that's the order the PDF
  // reads naturally (the story of the repair from start to "now").
  const notesResult = await pool
    .request()
    .input('id', sql.Int, assetId)
    .query('SELECT Author, Message, CreatedAt FROM dbo.RepairNotes WHERE AssetId = @id ORDER BY CreatedAt ASC');
  const notes = notesResult.recordset.map((r) => ({
    author:    r.Author,
    message:   r.Message,
    createdAt: r.CreatedAt,
  }));

  const newFile = await generateRepairDocket({
    asset: ctx.asset,
    company: ctx.company,
    owner: ctx.owner,
    problem: ctx.asset.RepairProblem || '',
    supplier: ctx.asset.RepairSupplier,
    coordinator,
    reference,
    notes,
  });

  if (ctx.asset.RepairDocketFile && ctx.asset.RepairDocketFile !== newFile) {
    deleteUpload(ctx.asset.RepairDocketFile);
  }
  await pool
    .request()
    .input('id', sql.Int, assetId)
    .input('file', sql.NVarChar(500), newFile)
    .query('UPDATE dbo.Assets SET RepairDocketFile = @file WHERE Id = @id');

  return newFile;
}

export async function regenerateAllActiveDockets(assetIds) {
  let count = 0;
  for (const id of assetIds) {
    try {
      const result = await regenerateDocketForAsset(id);
      if (result) count++;
    } catch (err) {
      console.error('[docket-regen] failed for asset', id, '-', err.message);
    }
  }
  return count;
}
