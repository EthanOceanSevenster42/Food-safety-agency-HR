-- FSA HR module — the People & management hub screens.
--
-- Additive: nothing here touches the tables inherited from the asset/KPI side.
-- Identifiers are intentionally UNQUOTED so Postgres folds them to lower case;
-- src/db.js maps result keys back to the PascalCase the route code expects.
--
-- Apply with: node scripts/apply-pg-schema.js (from backend/)

-- Staff register behind "Directory & site placements". Kept separate from
-- Employees (which drives the organogram and KPI cycle) because this is the
-- placement view: who is standing at which site, under which registration.
CREATE TABLE IF NOT EXISTS FsaStaff (
    Id           SERIAL PRIMARY KEY,
    StaffNo      VARCHAR(20)  NOT NULL UNIQUE,
    Name         VARCHAR(255) NOT NULL,
    Role         VARCHAR(255) NOT NULL,
    Service      VARCHAR(50)  NOT NULL,
    Site         VARCHAR(255) NOT NULL,
    Registration VARCHAR(100) NOT NULL,
    RegKind      VARCHAR(10)  NOT NULL,   -- ok | warn | bad | na
    Contract     VARCHAR(50)  NOT NULL,
    SortOrder    INT          NOT NULL DEFAULT 0
);

-- Competence matrix. One row per employee, one cell per registration type.
CREATE TABLE IF NOT EXISTS FsaCompetence (
    Id                    SERIAL PRIMARY KEY,
    Name                  VARCHAR(255) NOT NULL,
    Site                  VARCHAR(255) NOT NULL,
    DalrrdText            VARCHAR(50) NOT NULL,
    DalrrdKind            VARCHAR(10) NOT NULL,
    AntePostText          VARCHAR(50) NOT NULL,
    AntePostKind          VARCHAR(10) NOT NULL,
    ClassificationText    VARCHAR(50) NOT NULL,
    ClassificationKind    VARCHAR(10) NOT NULL,
    HaccpText             VARCHAR(50) NOT NULL,
    HaccpKind             VARCHAR(10) NOT NULL,
    MedicalText           VARCHAR(50) NOT NULL,
    MedicalKind           VARCHAR(10) NOT NULL,
    SortOrder             INT NOT NULL DEFAULT 0
);

-- Role requisitions: manager requests -> HR builds the pack -> marketing
-- publishes -> live in the recruitment pipeline.
CREATE TABLE IF NOT EXISTS FsaRequisitions (
    Id          SERIAL PRIMARY KEY,
    Ref         VARCHAR(20)  NOT NULL UNIQUE,
    Role        VARCHAR(255) NOT NULL,
    Dept        VARCHAR(100) NOT NULL,
    Site        VARCHAR(255) NOT NULL,
    Contract    VARCHAR(50)  NOT NULL,
    Posts       VARCHAR(10)  NOT NULL DEFAULT '1',
    RequestedBy VARCHAR(255) NULL,
    TargetStart VARCHAR(50)  NULL,
    Reason      VARCHAR(255) NULL,
    Motivation  TEXT         NULL,
    Stage       INT          NOT NULL DEFAULT 1,  -- 1 requested .. 4 live
    PackIjd     BOOLEAN      NOT NULL DEFAULT FALSE,
    PackKpi     BOOLEAN      NOT NULL DEFAULT FALSE,
    PackEdp     BOOLEAN      NOT NULL DEFAULT FALSE,
    CreatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Recruitment pipeline cards. Stage is the column index: 0 Applied ..
-- 4 Onboarding.
CREATE TABLE IF NOT EXISTS FsaCandidates (
    Id        SERIAL PRIMARY KEY,
    Ref       VARCHAR(20)  NOT NULL UNIQUE,
    Role      VARCHAR(255) NOT NULL,
    Site      VARCHAR(255) NOT NULL,
    Tag       VARCHAR(100) NOT NULL,
    TagKind   VARCHAR(10)  NOT NULL DEFAULT 'n',  -- g | w | t | n
    Stage     INT          NOT NULL DEFAULT 0,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Red to Green programmes — one row per person in onboarding.
CREATE TABLE IF NOT EXISTS FsaProgrammes (
    Id         SERIAL PRIMARY KEY,
    Code       VARCHAR(20)  NOT NULL UNIQUE,
    Name       VARCHAR(255) NOT NULL,
    Role       VARCHAR(255) NOT NULL,
    Dept       VARCHAR(100) NOT NULL,
    Site       VARCHAR(255) NOT NULL,
    StartDate  DATE         NULL,
    Mentor     VARCHAR(255) NULL,
    Phase      INT          NOT NULL DEFAULT 1,
    DayLabel   VARCHAR(50)  NULL,
    P1         INT          NOT NULL DEFAULT 0,
    P2         INT          NOT NULL DEFAULT 0,
    P3         INT          NOT NULL DEFAULT 0,
    Status     VARCHAR(50)  NOT NULL,
    StatusKind VARCHAR(10)  NOT NULL,   -- ok | bad | info | warn
    Gate       VARCHAR(100) NULL,
    SortOrder  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaProgrammeNotes (
    Id          SERIAL PRIMARY KEY,
    ProgrammeId INT          NOT NULL,
    NoteDate    DATE         NOT NULL,
    Author      VARCHAR(255) NOT NULL,
    Body        TEXT         NOT NULL,
    CreatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_FsaProgrammeNotes_Programme FOREIGN KEY (ProgrammeId)
      REFERENCES FsaProgrammes(Id) ON DELETE CASCADE
);

-- Per-programme sign-off of individual checklist activities.
CREATE TABLE IF NOT EXISTS FsaProgrammeChecks (
    Id          SERIAL PRIMARY KEY,
    ProgrammeId INT     NOT NULL,
    Phase       INT     NOT NULL,
    ItemIndex   INT     NOT NULL,
    Done        BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT FK_FsaProgrammeChecks_Programme FOREIGN KEY (ProgrammeId)
      REFERENCES FsaProgrammes(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_FsaProgrammeChecks UNIQUE (ProgrammeId, Phase, ItemIndex)
);

-- Department method templates. Dept '*' holds the locked group method that
-- every department inherits; other rows are that department's own additions.
CREATE TABLE IF NOT EXISTS FsaTemplateActivities (
    Id        SERIAL PRIMARY KEY,
    Dept      VARCHAR(100) NOT NULL,
    Phase     INT          NOT NULL,   -- 0 arrival, 1 Red, 2 Orange, 3 Green
    Week      INT          NOT NULL DEFAULT 1,
    Body      VARCHAR(500) NOT NULL,
    Owner     VARCHAR(100) NOT NULL,
    IsMaster  BOOLEAN      NOT NULL DEFAULT FALSE,
    Enabled   BOOLEAN      NOT NULL DEFAULT TRUE,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Phase 3 volume targets — the one part of the method each department sets.
CREATE TABLE IF NOT EXISTS FsaPhaseTargets (
    Id        SERIAL PRIMARY KEY,
    Dept      VARCHAR(100) NOT NULL,
    Label     VARCHAR(255) NOT NULL,
    Value     VARCHAR(20)  NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Leave is decided against site coverage, so requests carry their impact.
CREATE TABLE IF NOT EXISTS FsaLeaveRequests (
    Id           SERIAL PRIMARY KEY,
    Name         VARCHAR(255) NOT NULL,
    Role         VARCHAR(255) NOT NULL,
    Site         VARCHAR(255) NOT NULL,
    LeaveType    VARCHAR(100) NOT NULL,
    Dates        VARCHAR(100) NOT NULL,
    BalanceAfter VARCHAR(50)  NOT NULL,
    Impact       TEXT         NOT NULL,
    Status       VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending|approved|declined
    DecidedAt    TIMESTAMP(6) NULL,
    DecidedBy    VARCHAR(255) NULL,
    SortOrder    INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaSiteCoverage (
    Id        SERIAL PRIMARY KEY,
    Site      VARCHAR(255) NOT NULL UNIQUE,
    Pct       INT          NOT NULL,
    Badge     VARCHAR(50)  NOT NULL,
    Kind      VARCHAR(10)  NOT NULL,
    Detail    VARCHAR(255) NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaDocumentLibraries (
    Id        SERIAL PRIMARY KEY,
    Name      VARCHAR(255) NOT NULL UNIQUE,
    SortOrder INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaDocuments (
    Id         SERIAL PRIMARY KEY,
    Name       VARCHAR(255) NOT NULL,
    Ref        VARCHAR(50)  NOT NULL UNIQUE,
    Kind       VARCHAR(50)  NOT NULL,
    Version    VARCHAR(20)  NOT NULL,
    Owner      VARCHAR(255) NOT NULL,
    NextReview VARCHAR(50)  NOT NULL,
    Status     VARCHAR(50)  NOT NULL,
    StatusKind VARCHAR(10)  NOT NULL,
    Library    VARCHAR(255) NOT NULL,
    SortOrder  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaAcknowledgements (
    Id        SERIAL PRIMARY KEY,
    DocName   VARCHAR(255) NOT NULL,
    Detail    VARCHAR(255) NOT NULL,
    Pct       INT          NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- HR home: findings/observations/recommendations, notices and the week ahead.
CREATE TABLE IF NOT EXISTS FsaAlerts (
    Id        SERIAL PRIMARY KEY,
    Kind      VARCHAR(30)  NOT NULL,   -- Finding | Observation | Recommendation | Note
    Title     VARCHAR(255) NOT NULL,
    Body      TEXT         NOT NULL,
    Action    VARCHAR(255) NOT NULL,
    Ref       VARCHAR(50)  NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaNotices (
    Id         SERIAL PRIMARY KEY,
    NoticeDate DATE         NOT NULL,
    Title      VARCHAR(255) NOT NULL,
    Body       TEXT         NOT NULL,
    SortOrder  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaWeekItems (
    Id        SERIAL PRIMARY KEY,
    DayLabel  VARCHAR(10)  NOT NULL,
    Body      VARCHAR(255) NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Management dashboard.
CREATE TABLE IF NOT EXISTS FsaServiceStats (
    Id          SERIAL PRIMARY KEY,
    Name        VARCHAR(100) NOT NULL UNIQUE,
    Staff       VARCHAR(10)  NOT NULL,
    Vacancies   VARCHAR(10)  NOT NULL,
    Utilisation VARCHAR(10)  NOT NULL,
    Pct         INT          NOT NULL,
    SortOrder   INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS FsaWatchItems (
    Id        SERIAL PRIMARY KEY,
    Title     VARCHAR(255) NOT NULL,
    Body      TEXT         NOT NULL,
    Tag       VARCHAR(50)  NOT NULL,
    TagKind   VARCHAR(10)  NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Headline figures shown on HR home / the dashboard / each register. Kept as
-- rows so they can be edited without a deploy.
CREATE TABLE IF NOT EXISTS FsaStats (
    Id        SERIAL PRIMARY KEY,
    Screen    VARCHAR(30)  NOT NULL,   -- home | dash | competence | r2g | docs
    Value     VARCHAR(20)  NOT NULL,
    Label     VARCHAR(100) NOT NULL,
    Note      VARCHAR(255) NULL,
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS IX_FsaTemplateActivities_Dept ON FsaTemplateActivities (Dept, Phase);
CREATE INDEX IF NOT EXISTS IX_FsaPhaseTargets_Dept ON FsaPhaseTargets (Dept);
CREATE INDEX IF NOT EXISTS IX_FsaProgrammeNotes_Programme ON FsaProgrammeNotes (ProgrammeId);
CREATE INDEX IF NOT EXISTS IX_FsaProgrammeChecks_Programme ON FsaProgrammeChecks (ProgrammeId);
CREATE INDEX IF NOT EXISTS IX_FsaDocuments_Library ON FsaDocuments (Library);
CREATE INDEX IF NOT EXISTS IX_FsaCandidates_Stage ON FsaCandidates (Stage);
CREATE INDEX IF NOT EXISTS IX_FsaStats_Screen ON FsaStats (Screen);

-- ---------------------------------------------------------------------------
-- Leave at scale.
--
-- The first cut stored everything a leave request showed as display strings
-- ("2026-09-14 → 2026-09-25", "6.5 days"), which cannot be sorted, filtered or
-- paged. With thousands of employees the leave screen is a work queue, so the
-- request carries real typed columns and the indexes to query them by.
--
-- ADD COLUMN IF NOT EXISTS keeps this idempotent alongside the CREATE TABLEs.
-- ---------------------------------------------------------------------------
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS StaffNo      VARCHAR(20)  NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS Service      VARCHAR(50)  NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS StartDate    DATE         NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS EndDate      DATE         NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS Days         NUMERIC(4,1) NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS BalanceDays  NUMERIC(5,1) NULL;
-- Coverage severity if this request is approved: ok | warn | bad. Replaces
-- reading a paragraph per row — the paragraph stays in Impact for the detail.
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS CoverageKind VARCHAR(10)  NULL;
ALTER TABLE FsaLeaveRequests ADD COLUMN IF NOT EXISTS SubmittedAt  TIMESTAMP(6) NULL;

CREATE INDEX IF NOT EXISTS IX_FsaLeave_Status       ON FsaLeaveRequests (Status);
CREATE INDEX IF NOT EXISTS IX_FsaLeave_Site         ON FsaLeaveRequests (Site);
CREATE INDEX IF NOT EXISTS IX_FsaLeave_Service      ON FsaLeaveRequests (Service);
CREATE INDEX IF NOT EXISTS IX_FsaLeave_StartDate    ON FsaLeaveRequests (StartDate);
CREATE INDEX IF NOT EXISTS IX_FsaLeave_CoverageKind ON FsaLeaveRequests (CoverageKind);
-- The default queue view is "pending, worst coverage first, soonest first".
CREATE INDEX IF NOT EXISTS IX_FsaLeave_Queue        ON FsaLeaveRequests (Status, CoverageKind, StartDate);
-- Case-insensitive name/site search without a sequential scan.
CREATE INDEX IF NOT EXISTS IX_FsaLeave_NameLower    ON FsaLeaveRequests (LOWER(Name));

-- ---------------------------------------------------------------------------
-- Method templates: keep a programme's checklist stable.
--
-- Two problems with the first cut:
--
--   1. Sign-offs were keyed by position in the list (Phase + ItemIndex). Turn
--      one template activity off and every sign-off below it shifted up by
--      one, so a signed-off activity silently became a different activity —
--      corruption of a competence record. They are now keyed by ActivityId.
--
--   2. A running programme read the live template, so editing a department's
--      template changed the checklist under people who were mid-programme.
--      The screen promised the opposite. Each programme now owns a snapshot of
--      the activities it started on.
-- ---------------------------------------------------------------------------

ALTER TABLE FsaProgrammeChecks ADD COLUMN IF NOT EXISTS ActivityId INT NULL;
-- The positional key has to go before the activity key can be trusted.
ALTER TABLE FsaProgrammeChecks DROP CONSTRAINT IF EXISTS UQ_FsaProgrammeChecks;
ALTER TABLE FsaProgrammeChecks DROP CONSTRAINT IF EXISTS UQ_FsaProgrammeChecks_Activity;
ALTER TABLE FsaProgrammeChecks
  ADD CONSTRAINT UQ_FsaProgrammeChecks_Activity UNIQUE (ProgrammeId, ActivityId);

-- The activity list a programme started on. Rows are added when the programme
-- starts and are not touched by later template edits.
CREATE TABLE IF NOT EXISTS FsaProgrammeActivities (
    Id          SERIAL PRIMARY KEY,
    ProgrammeId INT NOT NULL,
    ActivityId  INT NOT NULL,
    Phase       INT NOT NULL,
    SortOrder   INT NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaProgrammeActivities_Programme FOREIGN KEY (ProgrammeId)
      REFERENCES FsaProgrammes(Id) ON DELETE CASCADE,
    CONSTRAINT FK_FsaProgrammeActivities_Activity FOREIGN KEY (ActivityId)
      REFERENCES FsaTemplateActivities(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_FsaProgrammeActivities UNIQUE (ProgrammeId, ActivityId)
);

CREATE INDEX IF NOT EXISTS IX_FsaProgrammeActivities_Programme
  ON FsaProgrammeActivities (ProgrammeId, Phase, SortOrder);

-- Which template version a programme is running, for the blast-radius figure
-- the templates screen shows before a change is made.
ALTER TABLE FsaProgrammes ADD COLUMN IF NOT EXISTS TemplateSnapshotAt TIMESTAMP(6) NULL;
