import { Router } from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';

const router = Router();
router.use(requireAuth);
// Editing the org/people records is done from the Asset org chart and the HR
// KPI tracker — writing needs one of those segments. (Reading the roster is via
// the companies router, which is world-readable for the organogram.)
router.use(requireSegments('asset_allocated', 'asset_all', 'hr_kpi'));

// Normalise a request's additionalManagerIds into a clean int list, excluding
// the employee themselves and their primary manager (which lives on
// Employees.ManagerId, not the join table).
function normaliseAdditional(raw, { selfId = null, primaryId = null } = {}) {
  if (!Array.isArray(raw)) return null; // absent → caller should leave rows untouched
  const out = [];
  for (const v of raw) {
    const n = parseInt(v, 10);
    if (!Number.isInteger(n)) continue;
    if (n === selfId || n === primaryId) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// Replace the additional-manager rows for an employee with `ids`.
async function replaceAdditionalManagers(pool, employeeId, ids) {
  await pool.request().input('eid', sql.Int, employeeId)
    .query('DELETE FROM dbo.EmployeeManagers WHERE EmployeeId = @eid;');
  for (const mid of ids) {
    await pool.request()
      .input('eid', sql.Int, employeeId)
      .input('mid', sql.Int, mid)
      .query('INSERT INTO dbo.EmployeeManagers (EmployeeId, ManagerId) VALUES (@eid, @mid);');
  }
}

// Fetch the additional-manager ids for an employee (empty array if none).
async function getAdditionalManagers(pool, employeeId) {
  const r = await pool.request().input('eid', sql.Int, employeeId)
    .query('SELECT ManagerId FROM dbo.EmployeeManagers WHERE EmployeeId = @eid ORDER BY ManagerId;');
  return r.recordset.map((x) => x.ManagerId);
}

router.post('/', async (req, res) => {
  const { companyId, name, title, email, managerId, department } = req.body ?? {};
  if (!companyId || !name?.trim()) {
    return res.status(400).json({ error: 'companyId and name are required' });
  }
  const primaryId = managerId || null;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('companyId', sql.Int, companyId)
      .input('name', sql.NVarChar(255), name.trim())
      .input('title', sql.NVarChar(255), title?.trim() || null)
      .input('email', sql.NVarChar(255), email?.trim() || null)
      .input('managerId', sql.Int, primaryId)
      .input('department', sql.NVarChar(255), department?.trim() || null)
      .query(`
        INSERT INTO dbo.Employees (CompanyId, Name, Title, Email, ManagerId, Department)
        OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Title, INSERTED.Email, INSERTED.ManagerId, INSERTED.Department
        VALUES (@companyId, @name, @title, @email, @managerId, @department);
      `);
    const e = result.recordset[0];

    const additional = normaliseAdditional(req.body?.additionalManagerIds, { selfId: e.Id, primaryId });
    if (additional && additional.length) {
      await replaceAdditionalManagers(pool, e.Id, additional);
    }

    res.status(201).json({
      id: e.Id,
      companyId: e.CompanyId,
      name: e.Name,
      title: e.Title,
      email: e.Email,
      managerId: e.ManagerId,
      department: e.Department,
      additionalManagerIds: additional || [],
    });
  } catch (err) {
    console.error('[employees/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, title, email, managerId, department } = req.body ?? {};

  if (managerId === id) {
    return res.status(400).json({ error: 'An employee cannot be their own manager' });
  }
  const primaryId = managerId ?? null;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar(255), name?.trim() || null)
      .input('title', sql.NVarChar(255), title?.trim() || null)
      .input('email', sql.NVarChar(255), email?.trim() || null)
      .input('managerId', sql.Int, primaryId)
      .input('department', sql.NVarChar(255), department?.trim() || null)
      .query(`
        UPDATE dbo.Employees
        SET Name       = COALESCE(@name, Name),
            Title      = @title,
            Email      = @email,
            ManagerId  = @managerId,
            Department = @department,
            UpdatedAt  = SYSUTCDATETIME()
        OUTPUT INSERTED.Id, INSERTED.CompanyId, INSERTED.Name, INSERTED.Title, INSERTED.Email, INSERTED.ManagerId, INSERTED.Department
        WHERE Id = @id;
      `);
    if (!result.recordset[0]) return res.status(404).json({ error: 'Not found' });
    const e = result.recordset[0];

    // Only touch the join table when the caller explicitly sends the field —
    // so a drag-to-move or an edit from another screen doesn't wipe the extra
    // managers. Also drop the primary from the join if it drifted there.
    const additional = normaliseAdditional(req.body?.additionalManagerIds, { selfId: id, primaryId });
    if (additional) {
      await replaceAdditionalManagers(pool, id, additional);
    } else {
      await pool.request().input('eid', sql.Int, id).input('pid', sql.Int, primaryId)
        .query('DELETE FROM dbo.EmployeeManagers WHERE EmployeeId = @eid AND ManagerId = @pid;');
    }

    res.json({
      id: e.Id,
      companyId: e.CompanyId,
      name: e.Name,
      title: e.Title,
      email: e.Email,
      managerId: e.ManagerId,
      department: e.Department,
      additionalManagerIds: additional ?? (await getAdditionalManagers(pool, id)),
    });
  } catch (err) {
    console.error('[employees/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const pool = await getPool();
    // Reparent direct reports to the deleted employee's manager (or null)
    await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        UPDATE dbo.Employees
        SET ManagerId = (SELECT ManagerId FROM (SELECT ManagerId FROM dbo.Employees WHERE Id = @id) AS src)
        WHERE ManagerId = @id;
      `);
    // Remove any additional-manager links involving this person (as the extra
    // manager of others, or their own extras). The ManagerId FK is NO ACTION,
    // so links where they are someone's additional manager must go first.
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.EmployeeManagers WHERE EmployeeId = @id OR ManagerId = @id;');
    // Unallocate any assets currently assigned to this employee (back to storage)
    await pool
      .request()
      .input('id', sql.Int, id)
      .query('UPDATE dbo.Assets SET AssignedEmployeeId = NULL WHERE AssignedEmployeeId = @id;');
    const del = await pool
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.Employees WHERE Id = @id;');
    if (del.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[employees/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
