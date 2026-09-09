import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import authRouter from './src/routes/auth.js';
import companiesRouter from './src/routes/companies.js';
import employeesRouter from './src/routes/employees.js';
import assetsRouter from './src/routes/assets.js';
import settingsRouter from './src/routes/settings.js';
import analyticsRouter from './src/routes/analytics.js';
import usersRouter from './src/routes/users.js';
import projectsRouter from './src/routes/projects.js';
import sowTemplatesRouter from './src/routes/sow-templates.js';
import kpiRouter from './src/routes/kpi.js';
import fsaHrRouter from './src/routes/fsa-hr.js';
import { getPool } from './src/db.js';

const app = express();
const PORT = process.env.PORT || 4000;

const UPLOAD_DIR = path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// 25 MB JSON body limit — SOWs and task templates ship the full document
// payload (cover, sections, appendices, signature rows including base64-
// inlined images in preview requests). The default 100 kB cap was rejecting
// realistic templates with a PayloadTooLargeError that surfaced as an
// opaque 500 on the client.
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/sow-templates', sowTemplatesRouter);
app.use('/api/kpi', kpiRouter);
app.use('/api/fsa', fsaHrRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  // Honour the error's own status code (body-parser sets 413 for oversized
  // bodies, JSON parse errors → 400, etc.) and surface its message instead
  // of a flat "Internal server error" so the client can show something
  // actionable. Falls back to 500 if no status was set.
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const message = err?.expose && err?.message
    ? err.message
    : (status < 500 ? (err?.message || 'Bad request') : 'Internal server error');
  res.status(status).json({ error: message });
});

getPool()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] FSA HR API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server] failed to connect to database:', err.message);
    process.exit(1);
  });
