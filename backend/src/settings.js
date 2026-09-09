import { getPool, sql } from './db.js';

export async function getSetting(key) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = @k');
  return r.recordset[0]?.SettingValue ?? null;
}

export async function setSetting(key, value) {
  const pool = await getPool();
  await pool
    .request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(500), value ?? null)
    .query(`
      INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (@k, @v) AS new
      ON DUPLICATE KEY UPDATE SettingValue = new.SettingValue, UpdatedAt = SYSUTCDATETIME()
    `);
}

export async function getRepairCoordinator() {
  const [email, name] = await Promise.all([
    getSetting('RepairCoordinatorEmail'),
    getSetting('RepairCoordinatorName'),
  ]);
  return { email: email || null, name: name || null };
}
