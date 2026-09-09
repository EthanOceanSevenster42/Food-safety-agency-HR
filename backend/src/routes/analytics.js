import { Router } from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';

const router = Router();
router.use(requireAuth);
router.use(requireSegments('asset_analytics'));

// Compute current book value for an asset given purchase date, value and depreciation %.
function computeBookValue(purchaseDate, purchaseValue, deprPct) {
  if (!purchaseDate || purchaseValue == null || deprPct == null) return null;
  const yearsElapsed = (Date.now() - new Date(purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const remainingFraction = Math.max(0, 1 - (yearsElapsed * Number(deprPct)) / 100);
  return Number(purchaseValue) * remainingFraction;
}

// Months between now and the asset's expected end-of-life date.
// Negative when the asset is past EoL. Null when EoL cannot be computed.
function monthsToEol(purchaseDate, usefulLifeYears) {
  if (!purchaseDate || !usefulLifeYears) return null;
  const eol = new Date(purchaseDate);
  eol.setFullYear(eol.getFullYear() + Number(usefulLifeYears));
  const diffMs = eol.getTime() - Date.now();
  return diffMs / (30.44 * 24 * 60 * 60 * 1000);
}

router.get('/', async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  const department = (req.query.department || '').trim() || null;
  const eolWindowMonths = parseInt(req.query.eolWindow, 10) || 12;

  try {
    const pool = await getPool();

    const filterClauses = [];
    const reqParams = pool.request();
    if (companyId) {
      filterClauses.push('a.CompanyId = @companyId');
      reqParams.input('companyId', sql.Int, companyId);
    }
    if (department) {
      // Asset belongs to the filtered department when its owner's Department matches.
      // Storage assets have no owner so they are excluded when filtering by department.
      filterClauses.push('e.Department = @department');
      reqParams.input('department', sql.NVarChar(255), department);
    }
    const whereSql = filterClauses.length ? 'WHERE ' + filterClauses.join(' AND ') : '';

    // Pull every asset that matches the filter, with owner + company joins.
    const assetsResult = await reqParams.query(`
      SELECT a.Id, a.CompanyId, a.Category, a.Type, a.Name, a.PurchaseDate,
             a.PurchaseValue, a.DepreciationPercentPerYear, a.UsefulLifeYears,
             a.AssignedEmployeeId, a.IsInRepairs, a.RepairStage, a.RepairBookedInAt,
             c.Name AS CompanyName, c.LogoFile AS CompanyLogoFile, c.BrandColor AS CompanyBrandColor,
             e.Name AS OwnerName, e.Department AS OwnerDepartment
      FROM dbo.Assets a
      INNER JOIN dbo.Companies c ON c.Id = a.CompanyId
      LEFT JOIN dbo.Employees e ON e.Id = a.AssignedEmployeeId
      ${whereSql};
    `);
    const rows = assetsResult.recordset;

    // Departments + companies (always over the full dataset, so the filter dropdowns are stable)
    const [companiesResult, deptsResult] = await Promise.all([
      pool.request().query(`
        SELECT Id, Name, LogoFile, BrandColor FROM dbo.Companies ORDER BY Name;
      `),
      pool.request().query(`
        SELECT DISTINCT Department FROM dbo.Employees
        WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> ''
        ORDER BY Department;
      `),
    ]);
    const companies = companiesResult.recordset.map((r) => ({
      id: r.Id, name: r.Name, brandColor: r.BrandColor,
      logoUrl: r.LogoFile ? `/uploads/${r.LogoFile}` : null,
    }));
    const departments = deptsResult.recordset.map((r) => r.Department);

    // Aggregate totals + per-company breakdown + EOL list
    const totals = {
      assetCount: rows.length,
      totalPurchaseValue: 0,
      totalBookValue: 0,
      inStorageCount: 0,
      allocatedCount: 0,
      inRepairsCount: 0,
      endOfLifeWithin: 0,
      endOfLifeOverdue: 0,
    };
    const byCompanyMap = new Map();
    const byCategoryMap = new Map();
    const byDepartmentMap = new Map();
    const repairPipeline = { booked_in: 0, out_for_dispatch: 0, at_supplier: 0, received_back: 0 };
    const endOfLifeSoon = [];
    const dispatchQueue = []; // assets in 'booked_in' (need to be sent to supplier)

    for (const r of rows) {
      const purchaseValue = r.PurchaseValue == null ? null : Number(r.PurchaseValue);
      const bookValue = computeBookValue(r.PurchaseDate, r.PurchaseValue, r.DepreciationPercentPerYear);
      const months = monthsToEol(r.PurchaseDate, r.UsefulLifeYears);

      if (purchaseValue != null) totals.totalPurchaseValue += purchaseValue;
      if (bookValue != null) totals.totalBookValue += bookValue;

      if (r.IsInRepairs) totals.inRepairsCount++;
      else if (r.AssignedEmployeeId) totals.allocatedCount++;
      else totals.inStorageCount++;

      if (months != null && months < 0) totals.endOfLifeOverdue++;
      else if (months != null && months <= eolWindowMonths) totals.endOfLifeWithin++;

      // Per-company aggregation
      let cb = byCompanyMap.get(r.CompanyId);
      if (!cb) {
        cb = {
          id: r.CompanyId,
          name: r.CompanyName,
          logoUrl: r.CompanyLogoFile ? `/uploads/${r.CompanyLogoFile}` : null,
          brandColor: r.CompanyBrandColor,
          assetCount: 0, purchaseValue: 0, bookValue: 0,
          inRepairs: 0, allocated: 0, storage: 0, eolSoon: 0,
        };
        byCompanyMap.set(r.CompanyId, cb);
      }
      cb.assetCount++;
      if (purchaseValue != null) cb.purchaseValue += purchaseValue;
      if (bookValue != null) cb.bookValue += bookValue;
      if (r.IsInRepairs) cb.inRepairs++;
      else if (r.AssignedEmployeeId) cb.allocated++;
      else cb.storage++;
      if (months != null && months <= eolWindowMonths) cb.eolSoon++;

      // Per-category aggregation (for the category breakdown chart)
      const catKey = r.Category || 'Uncategorised';
      const catEntry = byCategoryMap.get(catKey) || { category: catKey, count: 0, bookValue: 0 };
      catEntry.count++;
      if (bookValue != null) catEntry.bookValue += bookValue;
      byCategoryMap.set(catKey, catEntry);

      // Per-department aggregation
      const deptKey = r.OwnerDepartment || (r.AssignedEmployeeId ? 'Unassigned dept' : 'In storage');
      const dEntry = byDepartmentMap.get(deptKey) || { department: deptKey, count: 0, bookValue: 0 };
      dEntry.count++;
      if (bookValue != null) dEntry.bookValue += bookValue;
      byDepartmentMap.set(deptKey, dEntry);

      // Repair pipeline
      if (r.IsInRepairs && r.RepairStage && repairPipeline[r.RepairStage] != null) {
        repairPipeline[r.RepairStage]++;
      }

      // EOL list (within window OR past)
      if (months != null && months <= eolWindowMonths) {
        endOfLifeSoon.push({
          id: r.Id,
          name: r.Name,
          category: r.Category,
          type: r.Type,
          companyId: r.CompanyId,
          companyName: r.CompanyName,
          ownerName: r.OwnerName || null,
          purchaseDate: r.PurchaseDate,
          monthsRemaining: Math.round(months * 10) / 10,
          bookValue,
        });
      }

      // Dispatch queue (booked in, not yet sent to supplier)
      if (r.IsInRepairs && r.RepairStage === 'booked_in') {
        dispatchQueue.push({
          id: r.Id,
          name: r.Name,
          companyName: r.CompanyName,
          ownerName: r.OwnerName || null,
          bookedInAt: r.RepairBookedInAt,
          daysWaiting: r.RepairBookedInAt
            ? Math.floor((Date.now() - new Date(r.RepairBookedInAt).getTime()) / (24 * 60 * 60 * 1000))
            : null,
        });
      }
    }

    endOfLifeSoon.sort((a, b) => a.monthsRemaining - b.monthsRemaining);
    dispatchQueue.sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0));

    res.json({
      filters: { companyId, department, eolWindowMonths },
      catalog: { companies, departments },
      totals,
      byCompany: Array.from(byCompanyMap.values()).sort((a, b) => b.assetCount - a.assetCount),
      byCategory: Array.from(byCategoryMap.values()).sort((a, b) => b.count - a.count),
      byDepartment: Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count),
      repairPipeline,
      endOfLifeSoon: endOfLifeSoon.slice(0, 50),
      dispatchQueue,
    });
  } catch (err) {
    console.error('[analytics]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
