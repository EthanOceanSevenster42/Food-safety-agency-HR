import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSegments } from '../middleware/access.js';
import { getRepairCoordinator, setSetting } from '../settings.js';
import { getPool, sql } from '../db.js';
import { regenerateAllActiveDockets } from '../docket-regen.js';

const router = Router();
router.use(requireAuth);
router.use(requireSegments('asset_repairs'));

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

router.get('/', async (_req, res) => {
  try {
    const repairCoordinator = await getRepairCoordinator();
    res.json({ repairCoordinator });
  } catch (err) {
    console.error('[settings/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/repair-coordinator', async (req, res) => {
  const email = (req.body?.email || '').trim();
  const name = (req.body?.name || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required' });

  try {
    await setSetting('RepairCoordinatorEmail', email);
    await setSetting('RepairCoordinatorName', name || null);

    // Regenerate active in-repair dockets so the printed PDF matches the new coordinator
    const pool = await getPool();
    const active = await pool.request().query(
      'SELECT Id FROM dbo.Assets WHERE IsInRepairs = 1 AND RepairDocketFile IS NOT NULL'
    );
    const ids = active.recordset.map((r) => r.Id);
    const regenerated = await regenerateAllActiveDockets(ids).catch((e) => {
      console.error('[settings/repair-coordinator] regen failed:', e.message);
      return 0;
    });

    res.json({
      repairCoordinator: await getRepairCoordinator(),
      docketsRegenerated: regenerated,
    });
  } catch (err) {
    console.error('[settings/repair-coordinator]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
