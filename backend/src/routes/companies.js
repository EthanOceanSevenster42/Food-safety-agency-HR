import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCompanies } from '../middleware/access.js';
import { upload, UPLOAD_DIR } from '../upload.js';
import { buildOrgChartPdfBuffer } from '../org-pdf.js';

const router = Router();

router.use(requireAuth);
// Company records are world-readable (needed for the organogram everyone can
// see); editing them needs the 'companies' segment at write.
router.use(requireCompanies());

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Parse an optional integer field within a sensible range. Returns:
//   undefined when the key is absent (= "leave unchanged" for PUT)
//   null when the value is empty (= "clear the field")
//   integer otherwise
function parseOptionalInt(value, { min = 1, max = 99 } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function parseOptionalBool(value) {
  if (value === undefined) return undefined;
  if (value === '' || value === null) return null;
  return value === 'true' || value === true || value === '1' || value === 1;
}

function parseOptionalText(value) {
  if (value === undefined) return undefined;
  const s = String(value || '').trim();
  return s === '' ? null : s;
}

function normalizeBrandColor(raw) {
  if (raw == null) return undefined; // undefined => don't change (PUT) / use null (POST)
  const v = String(raw).trim();
  if (v === '') return null; // explicit clear
  if (!HEX_RE.test(v)) {
    const err = new Error('Brand color must be a hex value like #088298');
    err.status = 400;
    throw err;
  }
  return v.toLowerCase();
}

// Optional secondary SELECT for columns that may not exist on older
// databases. Returns a Map<id, { sowProviderName, ... }> when the new
// columns are present, or an empty map (everything falls back to null) when
// the auto-migration couldn't add them.
async function loadCompanyProviderDefaults(pool) {
  try {
    const r = await pool.request().query(`
      SELECT Id, SowProviderName, SowProviderDesignation, SowProviderLocation,
             DocHeaderSideMargin, DocFooterSideMargin,
             DocSectionSeparator, DocPageNumberPosition,
             DocFooterPlacement, DocHeaderPlacement
      FROM dbo.Companies;
    `);
    const m = new Map();
    const okPlacement = (v) => (['all', 'first', 'last', 'none'].includes(v) ? v : 'all');
    for (const row of r.recordset) {
      m.set(row.Id, {
        sowProviderName:        row.SowProviderName,
        sowProviderDesignation: row.SowProviderDesignation,
        sowProviderLocation:    row.SowProviderLocation,
        docHeaderSideMargin:    !!row.DocHeaderSideMargin,
        docFooterSideMargin:    !!row.DocFooterSideMargin,
        // Default to true so any row without the column reads correctly
        // before the migration is applied.
        docSectionSeparator:    row.DocSectionSeparator == null ? true : !!row.DocSectionSeparator,
        docPageNumberPosition:  row.DocPageNumberPosition === 'top' ? 'top' : 'bottom',
        docFooterPlacement:     okPlacement(row.DocFooterPlacement),
        docHeaderPlacement:     okPlacement(row.DocHeaderPlacement),
      });
    }
    return m;
  } catch (err) {
    console.warn('[companies] provider-defaults columns unavailable:', err.message);
    return new Map();
  }
}

// Separate defensive read for the CoreValuesJson column. Returns
// Map<id, string[]> — empty array when the row's column is null, garbage,
// or missing entirely on older DBs.
async function loadCompanyCoreValues(pool) {
  try {
    const r = await pool.request().query('SELECT Id, CoreValuesJson FROM dbo.Companies;');
    const m = new Map();
    for (const row of r.recordset) m.set(row.Id, parseStringList(row.CoreValuesJson));
    return m;
  } catch (err) {
    console.warn('[companies] CoreValuesJson column unavailable:', err.message);
    return new Map();
  }
}

// Same shape as core values — a JSON array of strings stored per-company.
async function loadCompanyFacets(pool) {
  try {
    const r = await pool.request().query('SELECT Id, CompanyFacetsJson FROM dbo.Companies;');
    const m = new Map();
    for (const row of r.recordset) m.set(row.Id, parseStringList(row.CompanyFacetsJson));
    return m;
  } catch (err) {
    console.warn('[companies] CompanyFacetsJson column unavailable:', err.message);
    return new Map();
  }
}

// Coerce stored / submitted string-list data into a clean array. Trims,
// drops empties, caps each entry at 255 chars and the list at 50 items so
// the column can't be abused. Shared by Core values + Company facets.
function parseStringList(raw) {
  if (raw == null) return [];
  let arr;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  } else return [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, 255) : ''))
    .filter(Boolean)
    .slice(0, 50);
}

// Separate defensive read for the KPI-frequency column — uses its own
// try/catch so a missing column on older DBs doesn't blank the provider
// defaults map above.
async function loadCompanyKpiFrequencies(pool) {
  try {
    const r = await pool.request().query('SELECT Id, KpiFrequency FROM dbo.Companies;');
    const m = new Map();
    for (const row of r.recordset) {
      m.set(row.Id, row.KpiFrequency || 'Quarterly');
    }
    return m;
  } catch (err) {
    console.warn('[companies] KpiFrequency column unavailable:', err.message);
    return new Map();
  }
}

router.get('/', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT c.Id, c.Name, c.LogoFile, c.BrandColor, c.SowHeaderFile, c.SowFooterFile,
             c.RegistrationNumber,
             c.SowFontFamily, c.SowBodyFontSize, c.SowHeading1FontSize,
             c.SowHeading2FontSize, c.SowHeading3FontSize,
             c.DocH1AllCaps, c.DocH2AllCaps, c.DocH3AllCaps,
             c.DocLandscapeHeaderFile, c.DocLandscapeFooterFile,
             c.CreatedAt,
             (SELECT COUNT(*) FROM dbo.Employees       e WHERE e.CompanyId = c.Id) AS EmployeeCount,
             (SELECT COUNT(*) FROM dbo.Assets          a WHERE a.CompanyId = c.Id) AS AssetCount,
             (SELECT COUNT(*) FROM dbo.Assets          a WHERE a.CompanyId = c.Id AND a.IsInRepairs = 1) AS AssetsInRepairsCount,
             (SELECT COUNT(*) FROM dbo.Projects        p WHERE p.CompanyId = c.Id) AS ProjectCount
      FROM dbo.Companies c
      ORDER BY c.Name;
    `);
    const providerDefaults = await loadCompanyProviderDefaults(pool);
    const kpiFreqs = await loadCompanyKpiFrequencies(pool);
    const coreValuesByCompany = await loadCompanyCoreValues(pool);
    const facetsByCompany = await loadCompanyFacets(pool);
    res.json(
      result.recordset.map((c) => {
        const defaults = providerDefaults.get(c.Id) || {
          sowProviderName: null, sowProviderDesignation: null, sowProviderLocation: null,
          docHeaderSideMargin: false, docFooterSideMargin: false,
          docSectionSeparator: true,
          docPageNumberPosition: 'bottom',
        };
        return {
          id: c.Id,
          name: c.Name,
          logoUrl: c.LogoFile ? `/uploads/${c.LogoFile}` : null,
          brandColor: c.BrandColor,
          sowHeaderUrl: c.SowHeaderFile ? `/uploads/${c.SowHeaderFile}` : null,
          sowFooterUrl: c.SowFooterFile ? `/uploads/${c.SowFooterFile}` : null,
          docLandscapeHeaderUrl: c.DocLandscapeHeaderFile ? `/uploads/${c.DocLandscapeHeaderFile}` : null,
          docLandscapeFooterUrl: c.DocLandscapeFooterFile ? `/uploads/${c.DocLandscapeFooterFile}` : null,
          registrationNumber: c.RegistrationNumber,
          sowFontFamily: c.SowFontFamily,
          sowBodyFontSize: c.SowBodyFontSize,
          sowHeading1FontSize: c.SowHeading1FontSize,
          sowHeading2FontSize: c.SowHeading2FontSize,
          sowHeading3FontSize: c.SowHeading3FontSize,
          docH1AllCaps: c.DocH1AllCaps == null ? null : !!c.DocH1AllCaps,
          docH2AllCaps: c.DocH2AllCaps == null ? null : !!c.DocH2AllCaps,
          docH3AllCaps: c.DocH3AllCaps == null ? null : !!c.DocH3AllCaps,
          docHeaderSideMargin:    defaults.docHeaderSideMargin,
          docFooterSideMargin:    defaults.docFooterSideMargin,
          docSectionSeparator:    defaults.docSectionSeparator,
          docPageNumberPosition:  defaults.docPageNumberPosition,
          docFooterPlacement:     defaults.docFooterPlacement || 'all',
          docHeaderPlacement:     defaults.docHeaderPlacement || 'all',
          sowProviderName:        defaults.sowProviderName,
          sowProviderDesignation: defaults.sowProviderDesignation,
          sowProviderLocation:    defaults.sowProviderLocation,
          employeeCount: c.EmployeeCount,
          assetCount: c.AssetCount,
          assetsInRepairsCount: c.AssetsInRepairsCount,
          projectCount: c.ProjectCount,
          kpiFrequency: kpiFreqs.get(c.Id) || 'Quarterly',
          coreValues: coreValuesByCompany.get(c.Id) || [],
          companyFacets: facetsByCompany.get(c.Id) || [],
          createdAt: c.CreatedAt,
        };
      })
    );
  } catch (err) {
    console.error('[companies/list]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

const COMPANY_UPLOAD_FIELDS_RAW = upload.fields([
  { name: 'logo',                maxCount: 1 },
  { name: 'sowHeader',           maxCount: 1 },
  { name: 'sowFooter',           maxCount: 1 },
  { name: 'docLandscapeHeader',  maxCount: 1 },
  { name: 'docLandscapeFooter',  maxCount: 1 },
]);

// Wrap multer so its errors (file too large, wrong type) come back as a 400
// JSON response rather than the default HTML error page or 500.
function COMPANY_UPLOAD_FIELDS(req, res, next) {
  COMPANY_UPLOAD_FIELDS_RAW(req, res, (err) => {
    if (!err) return next();
    const code = err.code || '';
    let message = err.message || 'Upload failed';
    if (code === 'LIMIT_FILE_SIZE') message = 'File is too large — please keep each image under 20 MB.';
    else if (code === 'LIMIT_UNEXPECTED_FILE') message = `Unexpected upload field: ${err.field}`;
    console.error('[companies/upload]', err);
    return res.status(400).json({ error: message });
  });
}

// Helper: clean up any files in req.files (used when an error aborts the request)
function cleanupUploadedFiles(req) {
  const all = Object.values(req.files || {}).flat();
  for (const f of all) fs.unlink(f.path, () => {});
}

router.post('/', COMPANY_UPLOAD_FIELDS, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ error: 'Name is required' });
  }

  let brandColor;
  try {
    brandColor = normalizeBrandColor(req.body.brandColor) ?? null;
  } catch (err) {
    cleanupUploadedFiles(req);
    return res.status(err.status || 400).json({ error: err.message });
  }

  const logoFile      = req.files?.logo?.[0]?.filename ?? null;
  const sowHeaderFile = req.files?.sowHeader?.[0]?.filename ?? null;
  const sowFooterFile = req.files?.sowFooter?.[0]?.filename ?? null;
  const docLandscapeHeaderFile = req.files?.docLandscapeHeader?.[0]?.filename ?? null;
  const docLandscapeFooterFile = req.files?.docLandscapeFooter?.[0]?.filename ?? null;
  const registrationNumber = (req.body.registrationNumber || '').trim() || null;

  // Typography overrides (all optional)
  const sowFontFamily       = parseOptionalText(req.body.sowFontFamily) ?? null;
  const sowBodyFontSize     = parseOptionalInt(req.body.sowBodyFontSize)     ?? null;
  const sowHeading1FontSize = parseOptionalInt(req.body.sowHeading1FontSize) ?? null;
  const sowHeading2FontSize = parseOptionalInt(req.body.sowHeading2FontSize) ?? null;
  const sowHeading3FontSize = parseOptionalInt(req.body.sowHeading3FontSize) ?? null;
  const docH1AllCaps = parseOptionalBool(req.body.docH1AllCaps) ?? null;
  const docH2AllCaps = parseOptionalBool(req.body.docH2AllCaps) ?? null;
  const docH3AllCaps = parseOptionalBool(req.body.docH3AllCaps) ?? null;

  const sowProviderName        = parseOptionalText(req.body.sowProviderName)        ?? null;
  const sowProviderDesignation = parseOptionalText(req.body.sowProviderDesignation) ?? null;
  const sowProviderLocation    = parseOptionalText(req.body.sowProviderLocation)    ?? null;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('name', sql.NVarChar(255), name)
      .input('logo', sql.NVarChar(500), logoFile)
      .input('brandColor', sql.NVarChar(7), brandColor)
      .input('sowHeader', sql.NVarChar(500), sowHeaderFile)
      .input('sowFooter', sql.NVarChar(500), sowFooterFile)
      .input('lsHeader', sql.NVarChar(500), docLandscapeHeaderFile)
      .input('lsFooter', sql.NVarChar(500), docLandscapeFooterFile)
      .input('regNumber', sql.NVarChar(100), registrationNumber)
      .input('sowFontFamily', sql.NVarChar(100), sowFontFamily)
      .input('sowBodyFontSize', sql.Int, sowBodyFontSize)
      .input('sowH1FontSize', sql.Int, sowHeading1FontSize)
      .input('sowH2FontSize', sql.Int, sowHeading2FontSize)
      .input('sowH3FontSize', sql.Int, sowHeading3FontSize)
      .input('h1AllCaps', sql.Bit, docH1AllCaps == null ? null : (docH1AllCaps ? 1 : 0))
      .input('h2AllCaps', sql.Bit, docH2AllCaps == null ? null : (docH2AllCaps ? 1 : 0))
      .input('h3AllCaps', sql.Bit, docH3AllCaps == null ? null : (docH3AllCaps ? 1 : 0))
      .query(`
        INSERT INTO dbo.Companies
          (Name, LogoFile, BrandColor, SowHeaderFile, SowFooterFile,
           DocLandscapeHeaderFile, DocLandscapeFooterFile,
           RegistrationNumber,
           SowFontFamily, SowBodyFontSize, SowHeading1FontSize, SowHeading2FontSize, SowHeading3FontSize,
           DocH1AllCaps, DocH2AllCaps, DocH3AllCaps)
        OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.LogoFile, INSERTED.BrandColor,
               INSERTED.SowHeaderFile, INSERTED.SowFooterFile,
               INSERTED.DocLandscapeHeaderFile, INSERTED.DocLandscapeFooterFile,
               INSERTED.RegistrationNumber,
               INSERTED.SowFontFamily, INSERTED.SowBodyFontSize, INSERTED.SowHeading1FontSize,
               INSERTED.SowHeading2FontSize, INSERTED.SowHeading3FontSize,
               INSERTED.DocH1AllCaps, INSERTED.DocH2AllCaps, INSERTED.DocH3AllCaps,
               INSERTED.CreatedAt
        VALUES (@name, @logo, @brandColor, @sowHeader, @sowFooter,
                @lsHeader, @lsFooter,
                @regNumber,
                @sowFontFamily, @sowBodyFontSize, @sowH1FontSize, @sowH2FontSize, @sowH3FontSize,
                @h1AllCaps, @h2AllCaps, @h3AllCaps);
      `);
    const c = result.recordset[0];

    // Try to set the optional Service Provider defaults via a follow-up
    // UPDATE — wrapped in try/catch so older databases (without the new
    // columns) still accept the insert.
    let appliedProviderDefaults = { name: null, designation: null, location: null };
    if (sowProviderName || sowProviderDesignation || sowProviderLocation) {
      try {
        await pool.request()
          .input('id', sql.Int, c.Id)
          .input('providerName',        sql.NVarChar(255), sowProviderName)
          .input('providerDesignation', sql.NVarChar(255), sowProviderDesignation)
          .input('providerLocation',    sql.NVarChar(500), sowProviderLocation)
          .query(`
            UPDATE dbo.Companies
              SET SowProviderName        = @providerName,
                  SowProviderDesignation = @providerDesignation,
                  SowProviderLocation    = @providerLocation
              WHERE Id = @id;
          `);
        appliedProviderDefaults = {
          name: sowProviderName, designation: sowProviderDesignation, location: sowProviderLocation,
        };
      } catch (err) {
        console.warn('[companies/create] could not save provider defaults:', err.message);
      }
    }

    // Banner-side-margin toggles — per-banner (header / footer) — same
    // defensive separate-query pattern. Both default to BIT 0 at the
    // schema level, so we only write when the user explicitly turned a
    // flag on.
    const docHeaderSideMargin = parseOptionalBool(req.body.docHeaderSideMargin) ?? false;
    const docFooterSideMargin = parseOptionalBool(req.body.docFooterSideMargin) ?? false;
    let savedHeaderSideMargin = false;
    let savedFooterSideMargin = false;
    if (docHeaderSideMargin || docFooterSideMargin) {
      try {
        await pool.request()
          .input('id', sql.Int, c.Id)
          .input('h',  sql.Bit, docHeaderSideMargin ? 1 : 0)
          .input('f',  sql.Bit, docFooterSideMargin ? 1 : 0)
          .query('UPDATE dbo.Companies SET DocHeaderSideMargin = @h, DocFooterSideMargin = @f WHERE Id = @id;');
        savedHeaderSideMargin = docHeaderSideMargin;
        savedFooterSideMargin = docFooterSideMargin;
      } catch (err) {
        console.warn('[companies/create] could not save banner-margin flags:', err.message);
      }
    }

    // Section-separator toggle — defaults ON at the schema level, so we
    // only need to write when the user explicitly disabled it.
    const docSectionSeparator = parseOptionalBool(req.body.docSectionSeparator);
    let savedSectionSeparator = docSectionSeparator === undefined ? true : !!docSectionSeparator;
    if (docSectionSeparator === false) {
      try {
        await pool.request().input('id', sql.Int, c.Id)
          .query('UPDATE dbo.Companies SET DocSectionSeparator = 0 WHERE Id = @id;');
      } catch (err) {
        console.warn('[companies/create] could not save section-separator flag:', err.message);
      }
    }

    // Core values — JSON array of strings on the body as `coreValuesJson`
    // (sent as a stringified array via FormData). Written via a separate
    // optional UPDATE so a legacy DB without the column still accepts the
    // INSERT above.
    let savedCoreValues = [];
    if (req.body.coreValuesJson !== undefined) {
      const parsed = parseStringList(req.body.coreValuesJson);
      try {
        await pool.request()
          .input('id', sql.Int, c.Id)
          .input('cv', sql.NVarChar(sql.MAX), parsed.length ? JSON.stringify(parsed) : null)
          .query('UPDATE dbo.Companies SET CoreValuesJson = @cv WHERE Id = @id;');
        savedCoreValues = parsed;
      } catch (err) {
        console.warn('[companies/create] could not save core values:', err.message);
      }
    }

    // Company departments / facets — same wire format as core values.
    let savedCompanyFacets = [];
    if (req.body.companyFacetsJson !== undefined) {
      const parsed = parseStringList(req.body.companyFacetsJson);
      try {
        await pool.request()
          .input('id', sql.Int, c.Id)
          .input('f', sql.NVarChar(sql.MAX), parsed.length ? JSON.stringify(parsed) : null)
          .query('UPDATE dbo.Companies SET CompanyFacetsJson = @f WHERE Id = @id;');
        savedCompanyFacets = parsed;
      } catch (err) {
        console.warn('[companies/create] could not save company facets:', err.message);
      }
    }

    // Page-number position ('top' / 'bottom'). Schema default is
    // 'bottom', so we only need to write when 'top' is requested.
    const rawPNPos = typeof req.body.docPageNumberPosition === 'string'
      ? req.body.docPageNumberPosition.toLowerCase()
      : null;
    const docPageNumberPosition = rawPNPos === 'top' ? 'top' : 'bottom';
    let savedPageNumberPosition = docPageNumberPosition;
    if (docPageNumberPosition === 'top') {
      try {
        await pool.request().input('id', sql.Int, c.Id).input('p', sql.NVarChar(10), 'top')
          .query('UPDATE dbo.Companies SET DocPageNumberPosition = @p WHERE Id = @id;');
      } catch (err) {
        console.warn('[companies/create] could not save page-number-position:', err.message);
        savedPageNumberPosition = 'bottom';
      }
    }

    // Header/footer placement ('all' | 'first' | 'last' | 'none'). The column
    // default is 'all', so we only write when something other than 'all' is
    // requested. Wrapped per-column so a legacy DB missing the column can't
    // fail the whole create.
    const pickPlacement = (v, dflt) => {
      const s = typeof v === 'string' ? v.toLowerCase() : null;
      return ['all', 'first', 'last', 'none'].includes(s) ? s : dflt;
    };
    // Footer historically shows on every page ('all'); the header letterhead
    // only on the cover ('first'). Preserve those as the create-time defaults.
    let savedFooterPlacement = pickPlacement(req.body.docFooterPlacement, 'all');
    let savedHeaderPlacement = pickPlacement(req.body.docHeaderPlacement, 'first');
    for (const [col, val, key] of [
      ['DocFooterPlacement', savedFooterPlacement, 'fp'],
      ['DocHeaderPlacement', savedHeaderPlacement, 'hp'],
    ]) {
      if (val !== 'all') {
        try {
          await pool.request().input('id', sql.Int, c.Id).input(key, sql.NVarChar(10), val)
            .query(`UPDATE dbo.Companies SET ${col} = @${key} WHERE Id = @id;`);
        } catch (err) {
          console.warn('[companies/create] could not save placement:', err.message);
        }
      }
    }

    res.status(201).json({
      id: c.Id,
      name: c.Name,
      logoUrl: c.LogoFile ? `/uploads/${c.LogoFile}` : null,
      brandColor: c.BrandColor,
      sowHeaderUrl: c.SowHeaderFile ? `/uploads/${c.SowHeaderFile}` : null,
      sowFooterUrl: c.SowFooterFile ? `/uploads/${c.SowFooterFile}` : null,
      docLandscapeHeaderUrl: c.DocLandscapeHeaderFile ? `/uploads/${c.DocLandscapeHeaderFile}` : null,
      docLandscapeFooterUrl: c.DocLandscapeFooterFile ? `/uploads/${c.DocLandscapeFooterFile}` : null,
      registrationNumber: c.RegistrationNumber,
      sowFontFamily: c.SowFontFamily,
      sowBodyFontSize: c.SowBodyFontSize,
      sowHeading1FontSize: c.SowHeading1FontSize,
      sowHeading2FontSize: c.SowHeading2FontSize,
      sowHeading3FontSize: c.SowHeading3FontSize,
      docH1AllCaps: c.DocH1AllCaps == null ? null : !!c.DocH1AllCaps,
      docH2AllCaps: c.DocH2AllCaps == null ? null : !!c.DocH2AllCaps,
      docH3AllCaps: c.DocH3AllCaps == null ? null : !!c.DocH3AllCaps,
      sowProviderName:        appliedProviderDefaults.name,
      sowProviderDesignation: appliedProviderDefaults.designation,
      sowProviderLocation:    appliedProviderDefaults.location,
      docHeaderSideMargin:    savedHeaderSideMargin,
      docFooterSideMargin:    savedFooterSideMargin,
      docSectionSeparator:    savedSectionSeparator,
      docPageNumberPosition:  savedPageNumberPosition,
      docFooterPlacement:     savedFooterPlacement,
      docHeaderPlacement:     savedHeaderPlacement,
      coreValues:             savedCoreValues,
      companyFacets:          savedCompanyFacets,
      createdAt: c.CreatedAt,
    });
  } catch (err) {
    cleanupUploadedFiles(req);
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: 'A company with this name already exists' });
    }
    console.error('[companies/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', COMPANY_UPLOAD_FIELDS, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ error: 'Invalid id' });
  }

  const name = (req.body.name || '').trim();
  const removeLogo               = req.body.removeLogo      === 'true';
  const removeSowHeader          = req.body.removeSowHeader === 'true';
  const removeSowFooter          = req.body.removeSowFooter === 'true';
  const removeDocLandscapeHeader = req.body.removeDocLandscapeHeader === 'true';
  const removeDocLandscapeFooter = req.body.removeDocLandscapeFooter === 'true';
  // undefined = keep existing; '' = clear; anything else = new value
  const registrationNumberRaw = req.body.registrationNumber;
  const registrationNumber = registrationNumberRaw === undefined
    ? undefined
    : (String(registrationNumberRaw).trim() || null);

  if (!name) {
    cleanupUploadedFiles(req);
    return res.status(400).json({ error: 'Name is required' });
  }

  let brandColor;
  try {
    brandColor = normalizeBrandColor(req.body.brandColor);
  } catch (err) {
    cleanupUploadedFiles(req);
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const pool = await getPool();
    const existing = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT LogoFile, BrandColor, SowHeaderFile, SowFooterFile,
               DocLandscapeHeaderFile, DocLandscapeFooterFile, RegistrationNumber
        FROM dbo.Companies WHERE Id = @id
      `);
    if (!existing.recordset[0]) {
      cleanupUploadedFiles(req);
      return res.status(404).json({ error: 'Not found' });
    }
    const oldLogo     = existing.recordset[0].LogoFile;
    const oldHeader   = existing.recordset[0].SowHeaderFile;
    const oldFooter   = existing.recordset[0].SowFooterFile;
    const oldLsHeader = existing.recordset[0].DocLandscapeHeaderFile;
    const oldLsFooter = existing.recordset[0].DocLandscapeFooterFile;
    const oldBrand    = existing.recordset[0].BrandColor;
    const oldRegNo    = existing.recordset[0].RegistrationNumber;

    const newLogoUpload     = req.files?.logo?.[0]?.filename;
    const newHeaderUpload   = req.files?.sowHeader?.[0]?.filename;
    const newFooterUpload   = req.files?.sowFooter?.[0]?.filename;
    const newLsHeaderUpload = req.files?.docLandscapeHeader?.[0]?.filename;
    const newLsFooterUpload = req.files?.docLandscapeFooter?.[0]?.filename;

    let newLogo   = oldLogo;
    if (newLogoUpload) newLogo = newLogoUpload;
    else if (removeLogo) newLogo = null;

    let newHeader = oldHeader;
    if (newHeaderUpload) newHeader = newHeaderUpload;
    else if (removeSowHeader) newHeader = null;

    let newFooter = oldFooter;
    if (newFooterUpload) newFooter = newFooterUpload;
    else if (removeSowFooter) newFooter = null;

    let newLsHeader = oldLsHeader;
    if (newLsHeaderUpload) newLsHeader = newLsHeaderUpload;
    else if (removeDocLandscapeHeader) newLsHeader = null;

    let newLsFooter = oldLsFooter;
    if (newLsFooterUpload) newLsFooter = newLsFooterUpload;
    else if (removeDocLandscapeFooter) newLsFooter = null;

    const newBrand = brandColor === undefined ? oldBrand : brandColor;
    const newRegNo = registrationNumber === undefined ? oldRegNo : registrationNumber;

    // Typography + heading-caps flags — parse only if the field appears in the body
    const newFontFamily = parseOptionalText(req.body.sowFontFamily);
    const newBodySize   = parseOptionalInt(req.body.sowBodyFontSize);
    const newH1Size     = parseOptionalInt(req.body.sowHeading1FontSize);
    const newH2Size     = parseOptionalInt(req.body.sowHeading2FontSize);
    const newH3Size     = parseOptionalInt(req.body.sowHeading3FontSize);
    const newH1AllCaps  = parseOptionalBool(req.body.docH1AllCaps);
    const newH2AllCaps  = parseOptionalBool(req.body.docH2AllCaps);
    const newH3AllCaps  = parseOptionalBool(req.body.docH3AllCaps);

    // Build SET clause dynamically so absent fields don't get overwritten
    const setParts = [
      'Name = @name', 'LogoFile = @logo', 'BrandColor = @brandColor',
      'SowHeaderFile = @sowHeader', 'SowFooterFile = @sowFooter',
      'DocLandscapeHeaderFile = @lsHeader', 'DocLandscapeFooterFile = @lsFooter',
      'RegistrationNumber = @regNumber',
      'UpdatedAt = SYSUTCDATETIME()',
    ];
    const updateReq = pool.request()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar(255), name)
      .input('logo', sql.NVarChar(500), newLogo)
      .input('brandColor', sql.NVarChar(7), newBrand)
      .input('sowHeader', sql.NVarChar(500), newHeader)
      .input('sowFooter', sql.NVarChar(500), newFooter)
      .input('lsHeader', sql.NVarChar(500), newLsHeader)
      .input('lsFooter', sql.NVarChar(500), newLsFooter)
      .input('regNumber', sql.NVarChar(100), newRegNo);
    if (newFontFamily !== undefined) {
      updateReq.input('sowFontFamily', sql.NVarChar(100), newFontFamily);
      setParts.push('SowFontFamily = @sowFontFamily');
    }
    if (newBodySize !== undefined) {
      updateReq.input('sowBodyFontSize', sql.Int, newBodySize);
      setParts.push('SowBodyFontSize = @sowBodyFontSize');
    }
    if (newH1Size !== undefined) {
      updateReq.input('sowH1', sql.Int, newH1Size);
      setParts.push('SowHeading1FontSize = @sowH1');
    }
    if (newH2Size !== undefined) {
      updateReq.input('sowH2', sql.Int, newH2Size);
      setParts.push('SowHeading2FontSize = @sowH2');
    }
    if (newH3Size !== undefined) {
      updateReq.input('sowH3', sql.Int, newH3Size);
      setParts.push('SowHeading3FontSize = @sowH3');
    }
    if (newH1AllCaps !== undefined) {
      updateReq.input('h1Caps', sql.Bit, newH1AllCaps == null ? null : (newH1AllCaps ? 1 : 0));
      setParts.push('DocH1AllCaps = @h1Caps');
    }
    if (newH2AllCaps !== undefined) {
      updateReq.input('h2Caps', sql.Bit, newH2AllCaps == null ? null : (newH2AllCaps ? 1 : 0));
      setParts.push('DocH2AllCaps = @h2Caps');
    }
    if (newH3AllCaps !== undefined) {
      updateReq.input('h3Caps', sql.Bit, newH3AllCaps == null ? null : (newH3AllCaps ? 1 : 0));
      setParts.push('DocH3AllCaps = @h3Caps');
    }

    // Default Service Provider signatory + banner-side-margin toggle —
    // applied AFTER the main update via separate optional queries so an
    // old DB without the columns doesn't fail the whole PUT.
    const newProviderName        = parseOptionalText(req.body.sowProviderName);
    const newProviderDesignation = parseOptionalText(req.body.sowProviderDesignation);
    const newProviderLocation    = parseOptionalText(req.body.sowProviderLocation);
    const newHeaderSideMargin    = parseOptionalBool(req.body.docHeaderSideMargin);
    const newFooterSideMargin    = parseOptionalBool(req.body.docFooterSideMargin);
    const newSectionSeparator    = parseOptionalBool(req.body.docSectionSeparator);
    const rawPNPos = typeof req.body.docPageNumberPosition === 'string'
      ? req.body.docPageNumberPosition.toLowerCase()
      : undefined;
    const newPageNumberPosition  = rawPNPos === 'top' ? 'top'
      : rawPNPos === 'bottom' ? 'bottom'
      : undefined;
    const rawFooterPlacement = typeof req.body.docFooterPlacement === 'string'
      ? req.body.docFooterPlacement.toLowerCase()
      : undefined;
    const newFooterPlacement = ['all', 'first', 'last', 'none'].includes(rawFooterPlacement)
      ? rawFooterPlacement
      : undefined;
    const rawHeaderPlacement = typeof req.body.docHeaderPlacement === 'string'
      ? req.body.docHeaderPlacement.toLowerCase()
      : undefined;
    const newHeaderPlacement = ['all', 'first', 'last', 'none'].includes(rawHeaderPlacement)
      ? rawHeaderPlacement
      : undefined;

    const result = await updateReq.query(`
      UPDATE dbo.Companies SET ${setParts.join(', ')}
      OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.LogoFile, INSERTED.BrandColor,
             INSERTED.SowHeaderFile, INSERTED.SowFooterFile,
             INSERTED.DocLandscapeHeaderFile, INSERTED.DocLandscapeFooterFile,
             INSERTED.RegistrationNumber,
             INSERTED.SowFontFamily, INSERTED.SowBodyFontSize, INSERTED.SowHeading1FontSize,
             INSERTED.SowHeading2FontSize, INSERTED.SowHeading3FontSize,
             INSERTED.DocH1AllCaps, INSERTED.DocH2AllCaps, INSERTED.DocH3AllCaps,
             INSERTED.CreatedAt
      WHERE Id = @id;
    `);

    // Apply provider defaults in a separate query so legacy DBs without the
    // new columns still accept the main update.
    let savedProvider = { name: null, designation: null, location: null };
    let savedHeaderSideMargin = false;
    let savedFooterSideMargin = false;
    let savedSectionSeparator = true;
    let savedPageNumberPosition = 'bottom';
    let savedFooterPlacement = 'all';
    let savedHeaderPlacement = 'all';
    let savedCoreValues = [];
    let savedCompanyFacets = [];
    try {
      const r = await pool.request()
        .input('id', sql.Int, id)
        .query(`SELECT SowProviderName, SowProviderDesignation, SowProviderLocation,
                       DocHeaderSideMargin, DocFooterSideMargin, DocSectionSeparator,
                       DocPageNumberPosition, DocFooterPlacement, DocHeaderPlacement,
                       CoreValuesJson, CompanyFacetsJson
                FROM dbo.Companies WHERE Id = @id`);
      savedProvider = {
        name:        r.recordset[0]?.SowProviderName        ?? null,
        designation: r.recordset[0]?.SowProviderDesignation ?? null,
        location:    r.recordset[0]?.SowProviderLocation    ?? null,
      };
      savedHeaderSideMargin = !!r.recordset[0]?.DocHeaderSideMargin;
      savedFooterSideMargin = !!r.recordset[0]?.DocFooterSideMargin;
      savedSectionSeparator = r.recordset[0]?.DocSectionSeparator == null
        ? true
        : !!r.recordset[0].DocSectionSeparator;
      savedPageNumberPosition = r.recordset[0]?.DocPageNumberPosition === 'top' ? 'top' : 'bottom';
      savedFooterPlacement = ['all', 'first', 'last', 'none'].includes(r.recordset[0]?.DocFooterPlacement)
        ? r.recordset[0].DocFooterPlacement
        : 'all';
      savedHeaderPlacement = ['all', 'first', 'last', 'none'].includes(r.recordset[0]?.DocHeaderPlacement)
        ? r.recordset[0].DocHeaderPlacement
        : 'all';
      savedCoreValues = parseStringList(r.recordset[0]?.CoreValuesJson);
      savedCompanyFacets = parseStringList(r.recordset[0]?.CompanyFacetsJson);
      const providerSetParts = [];
      const providerReq = pool.request().input('id', sql.Int, id);
      if (newProviderName !== undefined) {
        providerReq.input('providerName', sql.NVarChar(255), newProviderName);
        providerSetParts.push('SowProviderName = @providerName');
        savedProvider.name = newProviderName;
      }
      if (newProviderDesignation !== undefined) {
        providerReq.input('providerDesignation', sql.NVarChar(255), newProviderDesignation);
        providerSetParts.push('SowProviderDesignation = @providerDesignation');
        savedProvider.designation = newProviderDesignation;
      }
      if (newProviderLocation !== undefined) {
        providerReq.input('providerLocation', sql.NVarChar(500), newProviderLocation);
        providerSetParts.push('SowProviderLocation = @providerLocation');
        savedProvider.location = newProviderLocation;
      }
      if (providerSetParts.length > 0) {
        await providerReq.query(`UPDATE dbo.Companies SET ${providerSetParts.join(', ')} WHERE Id = @id;`);
      }
      // Update the per-banner side-margin flags independently. We only
      // touch each column when the corresponding field arrived on the
      // body so the PUT is partial-update friendly.
      const marginSetParts = [];
      const marginReq = pool.request().input('id', sql.Int, id);
      if (newHeaderSideMargin !== undefined) {
        marginReq.input('h', sql.Bit, newHeaderSideMargin ? 1 : 0);
        marginSetParts.push('DocHeaderSideMargin = @h');
        savedHeaderSideMargin = !!newHeaderSideMargin;
      }
      if (newFooterSideMargin !== undefined) {
        marginReq.input('f', sql.Bit, newFooterSideMargin ? 1 : 0);
        marginSetParts.push('DocFooterSideMargin = @f');
        savedFooterSideMargin = !!newFooterSideMargin;
      }
      if (marginSetParts.length > 0) {
        await marginReq.query(`UPDATE dbo.Companies SET ${marginSetParts.join(', ')} WHERE Id = @id;`);
      }
      if (newSectionSeparator !== undefined) {
        const v = newSectionSeparator ? 1 : 0;
        await pool.request().input('id', sql.Int, id).input('v', sql.Bit, v)
          .query('UPDATE dbo.Companies SET DocSectionSeparator = @v WHERE Id = @id;');
        savedSectionSeparator = !!newSectionSeparator;
      }
      if (newPageNumberPosition !== undefined) {
        await pool.request().input('id', sql.Int, id).input('p', sql.NVarChar(10), newPageNumberPosition)
          .query('UPDATE dbo.Companies SET DocPageNumberPosition = @p WHERE Id = @id;');
        savedPageNumberPosition = newPageNumberPosition;
      }
      if (newFooterPlacement !== undefined) {
        await pool.request().input('id', sql.Int, id).input('fp', sql.NVarChar(10), newFooterPlacement)
          .query('UPDATE dbo.Companies SET DocFooterPlacement = @fp WHERE Id = @id;');
        savedFooterPlacement = newFooterPlacement;
      }
      if (newHeaderPlacement !== undefined) {
        await pool.request().input('id', sql.Int, id).input('hp', sql.NVarChar(10), newHeaderPlacement)
          .query('UPDATE dbo.Companies SET DocHeaderPlacement = @hp WHERE Id = @id;');
        savedHeaderPlacement = newHeaderPlacement;
      }
      // Core values — replace the whole list when the field is present.
      if (req.body.coreValuesJson !== undefined) {
        const parsed = parseStringList(req.body.coreValuesJson);
        await pool.request()
          .input('id', sql.Int, id)
          .input('cv', sql.NVarChar(sql.MAX), parsed.length ? JSON.stringify(parsed) : null)
          .query('UPDATE dbo.Companies SET CoreValuesJson = @cv WHERE Id = @id;');
        savedCoreValues = parsed;
      }
      // Company departments / facets — same shape, same replace semantics.
      if (req.body.companyFacetsJson !== undefined) {
        const parsed = parseStringList(req.body.companyFacetsJson);
        await pool.request()
          .input('id', sql.Int, id)
          .input('f', sql.NVarChar(sql.MAX), parsed.length ? JSON.stringify(parsed) : null)
          .query('UPDATE dbo.Companies SET CompanyFacetsJson = @f WHERE Id = @id;');
        savedCompanyFacets = parsed;
      }
    } catch (err) {
      console.warn('[companies/update] optional columns skipped:', err.message);
    }
    const c = result.recordset[0];

    // Delete any old file that has been replaced or cleared
    if (oldLogo     && oldLogo     !== newLogo)     fs.unlink(path.join(UPLOAD_DIR, oldLogo),     () => {});
    if (oldHeader   && oldHeader   !== newHeader)   fs.unlink(path.join(UPLOAD_DIR, oldHeader),   () => {});
    if (oldFooter   && oldFooter   !== newFooter)   fs.unlink(path.join(UPLOAD_DIR, oldFooter),   () => {});
    if (oldLsHeader && oldLsHeader !== newLsHeader) fs.unlink(path.join(UPLOAD_DIR, oldLsHeader), () => {});
    if (oldLsFooter && oldLsFooter !== newLsFooter) fs.unlink(path.join(UPLOAD_DIR, oldLsFooter), () => {});

    res.json({
      id: c.Id,
      name: c.Name,
      logoUrl: c.LogoFile ? `/uploads/${c.LogoFile}` : null,
      brandColor: c.BrandColor,
      sowHeaderUrl: c.SowHeaderFile ? `/uploads/${c.SowHeaderFile}` : null,
      sowFooterUrl: c.SowFooterFile ? `/uploads/${c.SowFooterFile}` : null,
      docLandscapeHeaderUrl: c.DocLandscapeHeaderFile ? `/uploads/${c.DocLandscapeHeaderFile}` : null,
      docLandscapeFooterUrl: c.DocLandscapeFooterFile ? `/uploads/${c.DocLandscapeFooterFile}` : null,
      registrationNumber: c.RegistrationNumber,
      sowFontFamily: c.SowFontFamily,
      sowBodyFontSize: c.SowBodyFontSize,
      sowHeading1FontSize: c.SowHeading1FontSize,
      sowHeading2FontSize: c.SowHeading2FontSize,
      sowHeading3FontSize: c.SowHeading3FontSize,
      docH1AllCaps: c.DocH1AllCaps == null ? null : !!c.DocH1AllCaps,
      docH2AllCaps: c.DocH2AllCaps == null ? null : !!c.DocH2AllCaps,
      docH3AllCaps: c.DocH3AllCaps == null ? null : !!c.DocH3AllCaps,
      sowProviderName:        savedProvider.name,
      sowProviderDesignation: savedProvider.designation,
      sowProviderLocation:    savedProvider.location,
      docHeaderSideMargin:    savedHeaderSideMargin,
      docFooterSideMargin:    savedFooterSideMargin,
      docSectionSeparator:    savedSectionSeparator,
      docPageNumberPosition:  savedPageNumberPosition,
      docFooterPlacement:     savedFooterPlacement,
      docHeaderPlacement:     savedHeaderPlacement,
      coreValues:             savedCoreValues,
      companyFacets:          savedCompanyFacets,
      createdAt: c.CreatedAt,
    });
  } catch (err) {
    cleanupUploadedFiles(req);
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: 'A company with this name already exists' });
    }
    console.error('[companies/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT LogoFile, SowHeaderFile, SowFooterFile, DocLandscapeHeaderFile, DocLandscapeFooterFile FROM dbo.Companies WHERE Id = @id');
  if (!existing.recordset[0]) return res.status(404).json({ error: 'Not found' });

  await pool.request().input('id', sql.Int, id).query('DELETE FROM dbo.Companies WHERE Id = @id');
  for (const f of [
    existing.recordset[0].LogoFile,
    existing.recordset[0].SowHeaderFile,
    existing.recordset[0].SowFooterFile,
    existing.recordset[0].DocLandscapeHeaderFile,
    existing.recordset[0].DocLandscapeFooterFile,
  ]) {
    if (f) fs.unlink(path.join(UPLOAD_DIR, f), () => {});
  }
  res.json({ ok: true });
});

// Category defaults — per-company prefills for new asset depreciation/lifecycle.
// The list returned merges every category currently used by this company's assets
// with whatever has been saved in CategoryDefaults, so newly-introduced categories
// automatically appear in the editor.
router.get('/:id/category-defaults', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const result = await pool.request().input('cid', sql.Int, id).query(`
      WITH AllCategories AS (
        SELECT DISTINCT Category FROM dbo.Assets         WHERE CompanyId = @cid
        UNION
        SELECT          Category FROM dbo.CategoryDefaults WHERE CompanyId = @cid
      )
      SELECT ac.Category,
             cd.DepreciationPercentPerYear,
             cd.UsefulLifeYears
      FROM AllCategories ac
      LEFT JOIN dbo.CategoryDefaults cd
             ON cd.CompanyId = @cid AND cd.Category = ac.Category
      ORDER BY ac.Category;
    `);
    res.json(result.recordset.map((r) => ({
      category: r.Category,
      depreciationPercent: r.DepreciationPercentPerYear == null ? null : Number(r.DepreciationPercentPerYear),
      usefulLifeYears: r.UsefulLifeYears,
    })));
  } catch (err) {
    console.error('[companies/category-defaults/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/category-defaults', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  try {
    const pool = await getPool();

    // Verify the company exists so we don't create orphan defaults
    const exists = await pool.request().input('id', sql.Int, id).query('SELECT 1 AS ok FROM dbo.Companies WHERE Id = @id');
    if (!exists.recordset[0]) return res.status(404).json({ error: 'Company not found' });

    for (const item of items) {
      const cat = (item.category ?? '').toString().trim();
      if (!cat) continue;

      const depr = item.depreciationPercent === '' || item.depreciationPercent == null
        ? null
        : Number(item.depreciationPercent);
      const life = item.usefulLifeYears === '' || item.usefulLifeYears == null
        ? null
        : parseInt(item.usefulLifeYears, 10);

      // If both fields are null, drop the row entirely so we don't keep ghost rows
      if (depr == null && life == null) {
        await pool
          .request()
          .input('cid', sql.Int, id)
          .input('cat', sql.NVarChar(100), cat)
          .query('DELETE FROM dbo.CategoryDefaults WHERE CompanyId = @cid AND Category = @cat');
        continue;
      }

      await pool
        .request()
        .input('cid', sql.Int, id)
        .input('cat', sql.NVarChar(100), cat)
        .input('depr', sql.Decimal(5, 2), depr)
        .input('life', sql.Int, Number.isFinite(life) ? life : null)
        .query(`
          INSERT INTO dbo.CategoryDefaults (CompanyId, Category, DepreciationPercentPerYear, UsefulLifeYears)
          VALUES (@cid, @cat, @depr, @life) AS new
          ON DUPLICATE KEY UPDATE
            DepreciationPercentPerYear = new.DepreciationPercentPerYear,
            UsefulLifeYears            = new.UsefulLifeYears,
            UpdatedAt                  = SYSUTCDATETIME()
        `);
    }

    // Return the merged view so the UI can update without a separate fetch
    const refreshed = await pool.request().input('cid', sql.Int, id).query(`
      WITH AllCategories AS (
        SELECT DISTINCT Category FROM dbo.Assets         WHERE CompanyId = @cid
        UNION
        SELECT          Category FROM dbo.CategoryDefaults WHERE CompanyId = @cid
      )
      SELECT ac.Category, cd.DepreciationPercentPerYear, cd.UsefulLifeYears
      FROM AllCategories ac
      LEFT JOIN dbo.CategoryDefaults cd
             ON cd.CompanyId = @cid AND cd.Category = ac.Category
      ORDER BY ac.Category;
    `);
    res.json(refreshed.recordset.map((r) => ({
      category: r.Category,
      depreciationPercent: r.DepreciationPercentPerYear == null ? null : Number(r.DepreciationPercentPerYear),
      usefulLifeYears: r.UsefulLifeYears,
    })));
  } catch (err) {
    console.error('[companies/category-defaults/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/employees', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const pool = await getPool();
  // KpiExempt / KpiFrequencyOverride are added by a runtime migration. Older
  // databases that pre-date the migration still need to answer this route, so
  // we read them via a defensive secondary SELECT and merge the values in.
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT Id, CompanyId, Name, Title, Email, ManagerId, Department
      FROM dbo.Employees
      WHERE CompanyId = @id
      ORDER BY ISNULL(ManagerId, 0), Name;
    `);
  let kpiByEmp = new Map();
  try {
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, KpiExempt, KpiFrequencyOverride
      FROM dbo.Employees WHERE CompanyId = @id;
    `);
    for (const row of r.recordset) {
      kpiByEmp.set(row.Id, {
        kpiExempt: !!row.KpiExempt,
        kpiFrequencyOverride: row.KpiFrequencyOverride,
      });
    }
  } catch (err) {
    console.warn('[companies/employees] KPI columns unavailable:', err.message);
  }
  // Additional (matrix) managers per employee. Defensive try/catch so a DB that
  // pre-dates the EmployeeManagers migration still answers this route.
  const additionalByEmp = new Map();
  try {
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT em.EmployeeId, em.ManagerId
      FROM dbo.EmployeeManagers em
      INNER JOIN dbo.Employees e ON e.Id = em.EmployeeId
      WHERE e.CompanyId = @id
      ORDER BY em.ManagerId;
    `);
    for (const row of r.recordset) {
      if (!additionalByEmp.has(row.EmployeeId)) additionalByEmp.set(row.EmployeeId, []);
      additionalByEmp.get(row.EmployeeId).push(row.ManagerId);
    }
  } catch (err) {
    console.warn('[companies/employees] EmployeeManagers unavailable:', err.message);
  }
  res.json(
    result.recordset.map((e) => ({
      id: e.Id,
      companyId: e.CompanyId,
      name: e.Name,
      title: e.Title,
      email: e.Email,
      managerId: e.ManagerId,
      additionalManagerIds: additionalByEmp.get(e.Id) ?? [],
      department: e.Department,
      kpiExempt: kpiByEmp.get(e.Id)?.kpiExempt ?? false,
      kpiFrequencyOverride: kpiByEmp.get(e.Id)?.kpiFrequencyOverride ?? null,
    }))
  );
});

// GET /api/companies/:id/org-pdf — a printable organogram PDF for the company,
// showing each employee's name, department and contact email in a top-down
// reporting tree. Streamed as an attachment.
router.get('/:id/org-pdf', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getPool();
    const co = await pool.request().input('id', sql.Int, id)
      .query('SELECT Name FROM dbo.Companies WHERE Id = @id');
    if (!co.recordset[0]) return res.status(404).json({ error: 'Company not found' });

    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT Id, Name, Title, Email, Department, ManagerId
      FROM dbo.Employees
      WHERE CompanyId = @id
      ORDER BY ISNULL(ManagerId, 0), Name;
    `);
    const employees = r.recordset.map((e) => ({
      id: e.Id, name: e.Name, title: e.Title, email: e.Email,
      department: e.Department, managerId: e.ManagerId,
    }));

    const companyName = co.recordset[0].Name;
    const buffer = await buildOrgChartPdfBuffer({ companyName, employees, generatedAt: new Date().toISOString() });
    const safe = (companyName || 'Company').replace(/[^a-z0-9]+/gi, ' ').trim() || 'Company';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Org Chart - ${safe}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[companies/org-pdf]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
