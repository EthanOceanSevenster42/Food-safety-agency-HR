# FSA HR Portal

Human-resources and asset-management portal for the **Food Safety Agency**.

Forked from *LANCorp Asset Control* and re-pointed at **PostgreSQL**. The
inherited LANCorp README is kept as `README.lancorp.md` for reference — its
SQL Server / MySQL instructions no longer apply.

---

## Quick start (TL;DR)

```bash
# 1. Backend deps
cd backend
npm install

# 2. Database — creates the role, the database, and all 44 tables
npm run schema

# 3. Demo data — FSA company, staff and a super-admin login
npm run seed:fsa

# 4. HR module content — registers, programmes, documents, dashboard
npm run seed:hr

# 5. Backend  (http://localhost:4000)
npm run dev

# 6. Frontend (http://localhost:5173) — in a second terminal
cd ../frontend
npm install
npm run dev
```

Then sign in at <http://localhost:5173>:

Create the first sign-in yourself — the seed takes the credentials as
arguments, so no account password lives in this repository:

```bash
node scripts/seed-fsa.js <your-email> <a-password-you-choose>
```

Running it with no arguments falls back to a development default.

---

## Prerequisites

| | |
| --- | --- |
| Node.js | 20+ (developed on 24) |
| PostgreSQL | 16+ (developed on 17.10) — `IS JSON` needs 16 |

The Postgres superuser credentials are only used to create the role and
database on first run. Set `PG_SUPER_USER` / `PG_SUPER_PASSWORD` in
`backend/.env` if yours are not `postgres` / `postgres`.

---

## Configuration

`backend/.env` (already populated for local dev):

```ini
DB_SERVER=127.0.0.1
DB_PORT=5432
DB_DATABASE=fsa_hr
DB_USER=fsa_hr
DB_PASSWORD=fsa_local_dev
```

Email uses Microsoft Graph and is **inherited from the LANCorp setup** (same
`moc-pty.com` tenant). Point `GRAPH_SEND_AS` at an FSA mailbox when one
exists; blank out the `GRAPH_*` values and the backend logs emails to the
console instead of sending them.

---

## Project layout

```
FSA Hr system/
├── backend/                        # Node + Express API
│   ├── db/
│   │   ├── schema-postgres.sql     # inherited tables (generated)
│   │   ├── schema-fsa-hr.sql       # the FSA HR module's 20 tables
│   │   ├── fsa-hr-content.js       # the hub's content, from the design canvas
│   │   ├── schema-mysql.sql        # shape source of truth for the generators
│   │   ├── schema.sql              # inherited T-SQL, kept for reference
│   │   └── seed-data*.sql          # LANCorp business data — NOT loaded, see below
│   ├── scripts/
│   │   ├── apply-pg-schema.js      # npm run schema  (applies both schemas)
│   │   ├── seed-fsa.js             # npm run seed:fsa
│   │   ├── seed-fsa-hr.js          # npm run seed:hr
│   │   ├── gen-colmap.mjs          # npm run colmap
│   │   └── test-translate.mjs      # npm run test:translate
│   └── src/
│       ├── db.js                   # T-SQL → Postgres adapter (see below)
│       ├── pg-colmap.js            # generated identifier / boolean / unique maps
│       └── routes/fsa-hr.js        # /api/fsa — the hub's endpoints
└── frontend/                       # React + Vite
    ├── public/                     # logo.png + background.jpg (APS assets)
    └── src/
        ├── aps.css                 # the APS design language
        ├── components/ApsShell.jsx # sidebar + page shell
        └── fsa/                    # the eleven hub screens
```

---

## How the database layer works

Every route was written against the `mssql` package in T-SQL. Rather than
rewrite ~200 queries, `backend/src/db.js` presents the same surface
(`pool.request().input(...).query(...)` → `{ recordset, recordsets, rowsAffected }`)
and rewrites the SQL to Postgres at runtime. **Route files stay untouched.**

What it translates:

| T-SQL / MySQL | Postgres |
| --- | --- |
| `[Ident]`, `dbo.` | stripped (identifiers fold to lower case) |
| `SYSUTCDATETIME()` | `(NOW() AT TIME ZONE 'UTC')` |
| `ISNULL(a, b)` | `COALESCE(a, b)` |
| `SELECT TOP n` | `LIMIT n` |
| `OUTPUT INSERTED.x` | `RETURNING x` |
| `ON DUPLICATE KEY UPDATE` | `ON CONFLICT (…) DO UPDATE SET … EXCLUDED` |
| `JSON_VALID(x)` | `x IS JSON` |
| `JSON_CONTAINS(a, b)` | `a::jsonb @> b` |
| `@param` | `$1`, `$2`, … (repeats reuse one placeholder) |
| `CAST(x AS NVARCHAR(MAX))` | `CAST(x AS TEXT)` |

Two Postgres-specific hazards are handled automatically:

* **Identifier case.** Tables are created unquoted, so Postgres lower-cases
  them and result keys arrive as `passwordhash`. Rows are mapped back to
  `PasswordHash` through `COLUMN_CASE` in `src/pg-colmap.js`.
* **Booleans.** `BIT` columns are now real `BOOLEAN`s, but the route SQL still
  says `IsActive = 1` and passes `1`/`0` positionally in `INSERT`s. Both are
  rewritten to `TRUE`/`FALSE`, and `sql.Bit` parameters are coerced.

`src/pg-colmap.js` is generated. After changing the schema or adding a SQL
alias, re-run:

```bash
npm run colmap
npm run test:translate     # 21 translation tests
```

---

## Seed data

`npm run seed:fsa` creates the Food Safety Agency company, ten staff across
the six Red-to-Green departments (APS, IMI & Classification, Lab, Auditing,
Vet Services, Training), and a super-admin login. It is idempotent.

`db/seed-data.sql` and `db/seed-data-mysql.sql` are **LANCorp's real business
data** — live employee names, email addresses, KPI reviews and password
hashes. They are deliberately not loaded here and should not be.

---

## Scripts

Run from `backend/`:

| Command | Does |
| --- | --- |
| `npm run dev` | API with `--watch` |
| `npm start` | API |
| `npm run schema` | Create role + database, apply both schema files |
| `npm run seed:fsa` | FSA company, staff and super-admin login |
| `npm run seed:hr` | HR module content (`--force` to reset it) |
| `npm run seed:leave -- 5000` | Generate leave volume for load testing (`--clear` to remove) |
| `npm run colmap` | Regenerate `src/pg-colmap.js` |
| `npm run test:translate` | SQL translation test suite |
| `npm run seed -- <email> <pw>` | Create/update a single admin user |

---

## The People & management hub

The primary experience is the hub from the FSA HR Portal design, in the visual
language of the FSA APS system (dark navy sidebar, teal primary, photographic
page ground, white rounded cards):

| Group | Screen | Route |
| --- | --- | --- |
| Overview | HR home | `/hr-home` |
| Overview | Management dashboard | `/management-dashboard` |
| People | Directory & placements | `/directory` |
| People | Competence & registrations | `/competence` |
| People | Role requisitions | `/requisitions` |
| People | Recruitment | `/recruitment` |
| Onboarding | Red to Green tracker | `/red-to-green` |
| Onboarding | Individual progress | `/red-to-green/:code` |
| Onboarding | Department templates | `/department-templates` |
| Time & attendance | Leave & coverage | `/leave` |
| Documents | Document depository | `/documents` |

The inherited asset, procurement and KPI tools remain under **Tools** in the
sidebar (Equipment & assets, Procurement & SOWs, KPI & performance, Users).

### What is actually wired up

Not a mock-up — each screen reads and writes Postgres through `/api/fsa`:

* **Leave** — a work queue rather than a list (see below).
* **Requisitions** — raise one (it gets the next `REQ-####`), tick off the three
  employee-pack documents, and advance it through the four stages. Marketing
  cannot publish until all three pack documents are complete.
* **Recruitment** — drag a candidate between the five pipeline stages.
* **Red to Green** — sign individual activities off per person; where nothing is
  recorded yet the checklist falls back to how far the phase has run.
* **Department templates** — turn a department's own activities on or off. The
  group method is locked and the API refuses to change it (409).
* **Documents** — add and rename libraries; renaming moves its documents with it.

Sidebar badge counts are read from the registers (`/api/fsa/nav-counts`) rather
than hard-coded, so they cannot drift from the data.

### Leave at agency scale

With ~5 000 employees the pending pile runs to thousands, so **Leave & coverage**
is built as a work queue:

* Filtering, sorting, counting and paging all happen in Postgres — the client
  holds one page (25/50/100) regardless of table size.
* Four summary tiles double as filters: **To decide**, **Needs cover first**
  (approving would leave a site short), **Approved**, **Declined**. The tallies
  respect every filter except status, so they match what each tab would show.
* Search by employee, site or staff number; filter by site, service and leave
  type; sort by urgency, start date, length, employee or site.
* The long "what this does to the site" sentence is reduced to a one-glance
  verdict — *Site short* / *Runs tight* / *No impact* — and kept in full on the
  expanded row.
* Select rows and approve or decline up to 200 in one request.
* Coverage is a fixed companion rail, worst site first, searchable, with a
  *Needs attention* toggle — at 38 placements only the ones in trouble matter.

Requests carry typed columns (`StartDate`, `EndDate`, `Days`, `BalanceDays`,
`CoverageKind`, `Service`, `StaffNo`) with indexes for the queue's default
ordering and a `LOWER(Name)` index for search. Display strings are derived from
those at seed time so the two cannot drift.

Measured on 5 003 rows / 109 pages: 2–33 ms per query, and a 25-row bulk
decision in 6 ms. Generate that volume yourself with:

```bash
npm run seed:leave -- 5000     # add 5000 generated requests
npm run seed:leave -- --clear  # remove them, keeping the three design rows
```

### Content

`npm run seed:hr` loads `db/fsa-hr-content.js` — the staff register, competence
matrix, requisitions, pipeline, the seven Red-to-Green programmes, the group
method plus every department's own activities, phase-3 volume targets, leave
requests, site coverage, the document depository and the dashboard figures.

It is **non-destructive**: a table that already holds rows is left alone, so
decisions and sign-offs survive a re-run. Pass `--force` to reset everything
back to the design's state.

---

## Design system

`frontend/src/aps.css` holds the APS language as `aps-*` classes, ported from
`APS-System-NextJS-dev`:

| | |
| --- | --- |
| Primary | `#007890` (teal), active edge `#00b4d8` |
| Sidebar | `#0f172a`, borders `#1e293b`, items `#94a3b8` |
| Cards | white, 12px radius, `0 0 0 1px rgba(17,24,39,.05), 0 1px 2px rgba(0,0,0,.05)` |
| Type | Geist for the UI, IBM Plex Mono for references, versions and dates |
| Icons | Font Awesome 6.4 |

`logo.png` and `background.jpg` are the APS assets, so the two platforms read as
one system.
