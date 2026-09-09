# LANCorp Asset Control

Internal web app for tracking the company's IT and office assets across all LANCorp companies — allocations, lifecycles, repairs, and analytics.

- **Frontend**: React 18 + Vite, served on `http://localhost:5173`
- **Backend**: Node.js + Express, served on `http://localhost:4000`
- **Database**: Microsoft SQL Server
- **Email**: Microsoft Graph (preferred) or SMTP (fallback)

---

## Quick start (TL;DR)

```bash
# 1. Database
sqlcmd -E -S localhost -C -i backend/db/schema.sql

# 2. Backend
cd backend
cp .env.example .env        # then edit DB_*, JWT_SECRET, GRAPH_* values
npm install
npm run dev                 # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173

# 4. Seed initial admin user (see backend/db/seed.xlsx)
```

---

## Project layout

```
LANCorp/
├── backend/                # Node + Express API
│   ├── db/
│   │   ├── schema.sql              # Idempotent schema migration (run first)
│   │   ├── seed.xlsx               # Initial Users + AppSettings to insert
│   │   └── wipe-demo-data.sql      # Clears all demo content (keeps Users)
│   ├── scripts/
│   │   ├── seed.js                 # CLI: create or update one user
│   │   ├── generate-seed-xlsx.js   # Rebuilds db/seed.xlsx from live DB
│   │   ├── test-graph.js           # Sends a test email via Graph
│   │   ├── test-email-template.js  # Renders sample notification emails
│   │   └── test-docket.js          # Generates a sample repair-docket PDF
│   ├── src/
│   │   ├── routes/                 # Express routers (auth, assets, ...)
│   │   ├── db.js                   # SQL Server connection pool
│   │   ├── email.js                # Email dispatcher (Graph or SMTP)
│   │   ├── graph-mail.js           # MSAL + Graph sendMail
│   │   ├── pdf.js                  # Repair docket PDF builder
│   │   └── upload.js               # multer config + uploads dir helpers
│   ├── uploads/                    # Runtime: logos, asset photos, dockets
│   ├── .env.example                # Template — copy to .env and fill in
│   └── server.js                   # Express bootstrap
└── frontend/                # React app
    ├── src/
    │   ├── pages/                  # Top-level routes (Analytics, Repairs, ...)
    │   ├── components/             # Reusable UI (cards, modals, ...)
    │   ├── api.js                  # fetch wrapper around the backend
    │   └── styles.css              # Single global stylesheet w/ design tokens
    └── vite.config.js              # Dev proxy: /api + /uploads -> :4000
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20.x or 24.x | `node --version` to check |
| npm | bundled with Node | |
| Microsoft SQL Server | 2019+ (Developer or Express edition is fine) | Must accept TCP/IP on port 1433 |
| sqlcmd | bundled with SQL Server tools | Used to apply `schema.sql` |

> The dev currently works on Windows. The instructions below assume Windows + a local SQL Server instance, but everything is plain Node and works equally well on macOS / Linux pointing at a remote SQL Server.

---

## Database setup — read this carefully

This is where most setup issues happen. Work through it in order.

### 1. SQL Server must allow TCP/IP

By default a fresh SQL Server install only listens on Shared Memory. Enable TCP:

1. Open **SQL Server Configuration Manager**
2. Expand *SQL Server Network Configuration → Protocols for {your instance}*
3. Right-click **TCP/IP → Enable**
4. Under TCP/IP properties → IP Addresses tab → at the bottom set **TCP Port = 1433** for IPAll
5. Restart the SQL Server service from the Services snap-in

If you skip this you'll see `ConnectionError: Failed to connect to localhost:1433` from the backend.

### 2. Pick an authentication mode

Two options — pick the one that matches your SQL Server instance:

#### Option A — SQL login (recommended, works on all platforms)

1. Open **SQL Server Management Studio (SSMS)**
2. Connect to the instance with Windows Authentication
3. Right-click the server → **Properties → Security → Server authentication = SQL Server and Windows Authentication mode**
4. Restart SQL Server from the Services snap-in
5. Create a SQL login (or reuse the seeded one):
   ```sql
   USE master;
   CREATE LOGIN [lancorp_app] WITH PASSWORD = 'StrongPasswordHere!', CHECK_POLICY = OFF;
   ALTER SERVER ROLE dbcreator ADD MEMBER [lancorp_app];   -- needed for first run only
   ```
6. Put `lancorp_app` and the password into `backend/.env` as `DB_USER` and `DB_PASSWORD`.

After running `schema.sql` once, you can downgrade the login:
```sql
USE lancorp;
CREATE USER [lancorp_app] FOR LOGIN [lancorp_app];
ALTER ROLE db_owner ADD MEMBER [lancorp_app];
USE master;
ALTER SERVER ROLE dbcreator DROP MEMBER [lancorp_app];
```

#### Option B — Windows Authentication (Windows only, no password)

mssql-node doesn't speak Windows auth out of the box. If you have to use Windows auth, install the optional driver:
```bash
cd backend
npm install msnodesqlv8
```
Then change `backend/src/db.js` to use `mssql/msnodesqlv8` and supply a connection string instead of user/password. **Avoid this unless you must** — SQL login (Option A) is simpler.

### 3. Apply the schema

The schema script is **idempotent** — it creates whatever doesn't exist and adds new columns to existing tables. Safe to re-run.

```bash
# Windows (Anthony's machine), using Windows Auth:
"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE" -E -S localhost -C -i backend/db/schema.sql

# Cross-platform with a SQL login:
sqlcmd -S <server>,1433 -U <user> -P <password> -C -i backend/db/schema.sql
```

`-C` = trust the server certificate (necessary for local self-signed certs).
`-E` = use Windows Authentication.

You'll see a couple of `(N rows affected)` lines and no errors when it works.

### 4. Seed the initial admin user

A backend developer can insert the seed rows from [backend/db/seed.xlsx](backend/db/seed.xlsx). The workbook has four sheets:

| Sheet | Purpose |
|---|---|
| README | Explains the workflow |
| Users | One row per login account. `PasswordHash` is bcrypt(12 rounds) — drop straight into `dbo.Users.PasswordHash`. |
| AppSettings | Recommended `RepairCoordinator*` rows — insert into `dbo.AppSettings`. |
| Seed SQL | Ready-to-run `INSERT` statements for the two sheets above. Open in Excel, copy the cells, paste into SSMS, run. |

If you'd prefer to create a user via the CLI:
```bash
cd backend
npm run seed -- someone@example.com 'theirPassword' 'Display Name'
```
This hashes the password and either creates the user or updates an existing one with that email.

### 5. Connection settings reference

Set these in `backend/.env`:

| Variable | Example | When to set what |
|---|---|---|
| `DB_SERVER` | `localhost` <br> `localhost\\SQLEXPRESS` <br> `10.0.0.5` <br> `db.internal,1433` | Hostname only, or `host\instance`, or `host,port`. |
| `DB_DATABASE` | `lancorp` | Created automatically by `schema.sql`. |
| `DB_USER` | `lancorp_app` | SQL login created in step 2. |
| `DB_PASSWORD` | `StrongPasswordHere!` | The login's password. |
| `DB_ENCRYPT` | `true` | Set to `true` for SQL Server 2022+ (encryption is default). |
| `DB_TRUST_SERVER_CERTIFICATE` | `true` (dev) / `false` (prod) | Local SQL Server uses a self-signed cert — must be `true` on a dev box. |

### 6. Common database errors and how to fix them

| Symptom | Cause | Fix |
|---|---|---|
| `Failed to connect to localhost:1433` | TCP/IP not enabled or port wrong | See step 1 — enable TCP, set port 1433, restart service. |
| `Login failed for user 'X'` | Wrong password, login disabled, or "SQL Server Authentication mode" not enabled | See step 2 — switch to mixed mode and verify the login. |
| `The certificate chain was issued by an authority that is not trusted` | Self-signed cert | Set `DB_TRUST_SERVER_CERTIFICATE=true`. |
| `CREATE DATABASE permission denied` | The login doesn't have dbcreator | `ALTER SERVER ROLE dbcreator ADD MEMBER [lancorp_app];` (one-time). |
| `Cannot insert duplicate key row` while running `schema.sql` | You re-applied seed `INSERT`s — they're guarded with `IF NOT EXISTS`, so this should never happen on the current schema | Pull latest `schema.sql`. |
| `Multiple cascade paths` when the schema first runs | An older copy of the schema | Use the current `schema.sql`; the FKs are designed around this restriction. |
| Backend hangs at startup with no log | Connection pool waiting on TCP timeout | Verify `DB_SERVER` and `1433` are reachable: `Test-NetConnection localhost -Port 1433`. |

---

## Backend setup

```bash
cd backend
cp .env.example .env
# edit .env: fill in DB_USER, DB_PASSWORD, JWT_SECRET, optionally GRAPH_*
npm install
npm run dev          # restarts on file change
# OR
npm start            # production-style
```

The server logs `[server] LANCorp API listening on http://localhost:4000` on success.

Health check:
```bash
curl http://localhost:4000/api/health
# -> {"ok":true}
```

### Backend npm scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Watch mode — auto-restart on file changes |
| `npm start` | Production-style start |
| `npm run seed -- <email> <password> [name]` | Create or update a single user |
| `npm run seed:xlsx` | Rebuild `db/seed.xlsx` from the live DB state |

---

## Frontend setup

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api/*` and `/uploads/*` to the backend on port 4000 (see [vite.config.js](frontend/vite.config.js)). No CORS config required during development.

For a production bundle:
```bash
npm run build        # output -> frontend/dist
npm run preview      # serve the built bundle locally
```

---

## Email setup

The app sends three kinds of email: repair booking, stage transitions, and note updates. There are three transport options and they're tried in this order:

### Option A — Microsoft Graph (preferred)

1. **Register an app in Entra ID**
   - Azure portal → *Microsoft Entra ID → App registrations → New registration*
   - Name: `LANCorp Asset Control`
   - Supported account types: *Single tenant*
   - No redirect URI needed
2. Copy **Application (client) ID** and **Directory (tenant) ID** from the Overview page.
3. **Certificates & secrets → New client secret** → copy the *Value* immediately (you won't see it again).
4. **API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Send**, then click **Grant admin consent**.
5. **Optional but recommended**: scope the app to a single mailbox using an [Application Access Policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access) so the app can only send as `Anthony.Penzes@moc-pty.com` instead of any user in the tenant.
6. Fill all four `GRAPH_*` variables in `backend/.env`:
   ```
   GRAPH_TENANT_ID=<directory tenant id>
   GRAPH_CLIENT_ID=<application client id>
   GRAPH_CLIENT_SECRET=<the secret value>
   GRAPH_SEND_AS=Anthony.Penzes@moc-pty.com
   ```
7. Restart the backend and run the smoke test:
   ```bash
   cd backend
   node scripts/test-graph.js Anthony.Penzes@moc-pty.com
   # -> Result: { sent: true, via: 'graph' }
   ```

### Option B — SMTP fallback

If you can't register an app, use a username + password against `smtp.office365.com:587` via `SMTP_*` variables in `backend/.env`. Microsoft 365 typically requires an [App Password](https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9) when 2FA is on.

### Option C — Console stub (default when nothing is configured)

If neither Graph nor SMTP is configured, every "sent" email is logged to the backend console with full body and attachment list. Useful for local dev and demos.

---

## Operations cheat sheet

```bash
# Apply / re-apply the schema (idempotent)
sqlcmd -E -S localhost -C -i backend/db/schema.sql

# Wipe all demo data but keep Users + AppSettings
sqlcmd -E -S localhost -C -i backend/db/wipe-demo-data.sql

# Re-export current Users + Settings into seed.xlsx (run after creating prod-ready accounts)
cd backend && npm run seed:xlsx

# Quick connectivity test — does Node reach SQL Server at all?
cd backend && node -e "import('./src/db.js').then(({getPool}) => getPool().then(() => console.log('OK')).catch(e => console.error('FAIL', e.message)))"

# Send a sample repair email through Graph
cd backend && node scripts/test-graph.js you@example.com
```

---

## Architecture notes

- **Auth**: JWT in `localStorage`, 8-hour expiry. Tokens go in `Authorization: Bearer <token>`. Expired tokens auto-clear and redirect to `/login`.
- **Repair workflow**: assets in repair go through 4 stages — Booked In → Out for Dispatch → At Supplier → Received Back. Resolving moves the asset to storage with a snapshot of the prior owner so allocation can be restored.
- **Repair history**: each completed repair is snapshotted into `RepairHistory` + sub-tables. The live tracking tables (`RepairNotes`, `RepairRecipients`, `RepairStageHistory`) are cleared on resolution.
- **Coordinator email**: a single tenant-wide setting in `dbo.AppSettings` (`RepairCoordinatorEmail` / `RepairCoordinatorName`). Editing it from the Repairs page banner auto-regenerates active dockets.
- **Cascade design**: `Companies` cascades to everything below it. `Assets.AssignedEmployeeId` is `NO ACTION` (not cascade) to avoid SQL Server's "multiple cascade paths" restriction; the app explicitly nulls it before deleting employees.

---

## Tech stack

| Layer | Library | Why |
|---|---|---|
| Backend | Express 4 | minimal HTTP routing |
| | mssql | TDS driver for SQL Server |
| | bcryptjs | password hashing |
| | jsonwebtoken | JWT tokens |
| | multer | multipart uploads |
| | exceljs | Excel export (assets + repairs) |
| | pdfkit | repair docket PDFs |
| | nodemailer | SMTP transport |
| | @azure/msal-node | Graph token acquisition |
| Frontend | React 18 | UI |
| | react-router-dom 6 | routing |
| | Vite 5 | dev server + bundler |

---

## Troubleshooting / FAQ

**Backend starts but the frontend says "Network error" on login.**
The Vite dev server proxies `/api` to `http://localhost:4000`. Make sure the backend is running on port 4000 and the frontend on 5173. Custom ports require updating both `vite.config.js` (target) and `backend/.env` (`PORT`, `CORS_ORIGIN`).

**I created a user via the seed script but can't sign in.**
Check the email exactly — comparison is case-insensitive in SQL Server by default but better to match casing. Confirm `IsActive = 1` in `dbo.Users`. Reset password with `npm run seed -- <email> '<new password>'`.

**Emails aren't arriving but the backend logs `sent: true, via: 'graph'`.**
Look in the **Sent Items** of the `GRAPH_SEND_AS` mailbox first — they should be there because `saveToSentItems` is on. If they are, the recipient's spam filter or a delivery rule is the cause.

**The PDF docket renders but the company logo is missing.**
The logo file is read from `backend/uploads/`. Make sure that directory survives a deployment (volume mount in Docker, or the directory exists on the host) and that `LogoFile` in `dbo.Companies` matches a real file there.

**`schema.sql` says "Cannot resolve the collation conflict"**.
This happens when a SQL Server instance was set up with a non-default collation. Easiest fix: install SQL Server with the default `SQL_Latin1_General_CP1_CI_AS`, or override `COLLATE` per column in `schema.sql`.

---

## License

Internal LANCorp project. Not for redistribution.
