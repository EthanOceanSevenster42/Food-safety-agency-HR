// Applies db/seed-data-mysql.sql to the MySQL database configured in .env.
// Usage (from backend/):  node scripts/apply-seed-data-mysql.js
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const file = path.resolve(import.meta.dirname, '..', 'db', 'seed-data-mysql.sql');
const sqlText = fs.readFileSync(file, 'utf8');

const conn = await mysql.createConnection({
  host: (process.env.DB_SERVER || 'localhost').split('\\')[0],
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'lancorp',
  multipleStatements: true,
  charset: 'utf8mb4',
});

await conn.query(sqlText);

const [counts] = await conn.query(`
  SELECT
    (SELECT COUNT(*) FROM Companies)   AS companies,
    (SELECT COUNT(*) FROM Employees)   AS employees,
    (SELECT COUNT(*) FROM Users)       AS users,
    (SELECT COUNT(*) FROM Assets)      AS assets,
    (SELECT COUNT(*) FROM AssetImages) AS assetImages,
    (SELECT COUNT(*) FROM Projects)    AS projects,
    (SELECT COUNT(*) FROM ProjectProcesses) AS processes,
    (SELECT COUNT(*) FROM SowTemplates)     AS templates,
    (SELECT COUNT(*) FROM SowVersions)      AS sowVersions,
    (SELECT COUNT(*) FROM KpiSessions)      AS kpiSessions,
    (SELECT COUNT(*) FROM KpiReviews)       AS kpiReviews
`);
console.log('[seed-data] applied. Row counts:', counts[0]);
await conn.end();
