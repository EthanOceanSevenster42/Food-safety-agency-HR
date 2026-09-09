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

-- ---------------------------------------------------------------------------
-- Reference layer. Everything below was previously hard-coded — either as a
-- constant in a route file or as an array in a React component — which meant
-- business content (the directors' decision, the reporting period, the entity
-- details) could only be changed by editing and redeploying code.
-- ---------------------------------------------------------------------------

-- Single-value configuration and organisation details.
CREATE TABLE IF NOT EXISTS FsaSettings (
    SettingKey VARCHAR(60)  PRIMARY KEY,
    Value      TEXT         NOT NULL,
    Note       VARCHAR(255) NULL
);

-- Ordered vocabularies. One table rather than a dozen two-column tables: every
-- one of these is (domain, code, label, optional severity, order).
CREATE TABLE IF NOT EXISTS FsaLookups (
    Id        SERIAL PRIMARY KEY,
    Domain    VARCHAR(40)  NOT NULL,   -- alert_kind | phase | pipeline_stage | req_stage | owner | department | competence_legend | leave_status | leave_sort | coverage | programme_state
    Code      VARCHAR(60)  NOT NULL,
    Label     VARCHAR(160) NOT NULL,
    Kind      VARCHAR(10)  NULL,       -- ok | warn | bad | info | na, where the label carries a severity
    Detail    VARCHAR(400) NULL,
    Route     VARCHAR(120) NULL,       -- where this entry's call to action leads
    SortOrder INT          NOT NULL DEFAULT 0,
    CONSTRAINT UQ_FsaLookups UNIQUE (Domain, Code)
);

CREATE INDEX IF NOT EXISTS IX_FsaLookups_Domain ON FsaLookups (Domain, SortOrder);

-- The tiles that start a task on the HR home screen.
CREATE TABLE IF NOT EXISTS FsaQuickActions (
    Id        SERIAL PRIMARY KEY,
    Route     VARCHAR(120) NOT NULL,
    Icon      VARCHAR(60)  NOT NULL,
    Title     VARCHAR(80)  NOT NULL,
    Sub       VARCHAR(160) NOT NULL,
    -- When set, the subtitle is replaced by a live count from the API rather
    -- than the fixed Sub text (e.g. 'pending' -> "3 requests waiting on you").
    CountKey  VARCHAR(40)  NULL,
    CountOne  VARCHAR(80)  NULL,       -- singular phrasing for the count
    CountMany VARCHAR(80)  NULL,       -- plural phrasing
    CountZero VARCHAR(80)  NULL,       -- what to say at zero
    SortOrder INT          NOT NULL DEFAULT 0,
    IsActive  BOOLEAN      NOT NULL DEFAULT TRUE
);

-- A decision put to the directors, with its supporting figures as real
-- columns. The dashboard previously recovered the two amounts by running a
-- regular expression over the prose sentence.
CREATE TABLE IF NOT EXISTS FsaDecisions (
    Id          SERIAL PRIMARY KEY,
    Screen      VARCHAR(30)  NOT NULL DEFAULT 'dash',
    Title       VARCHAR(120) NOT NULL,
    Body        TEXT         NOT NULL,
    Detail      TEXT         NULL,
    AgainstLabel VARCHAR(80) NULL,
    AgainstValue VARCHAR(40) NULL,
    AgainstBasis VARCHAR(200) NULL,
    ForLabel    VARCHAR(80)  NULL,
    ForValue    VARCHAR(40)  NULL,
    ForBasis    VARCHAR(200) NULL,
    SortOrder   INT          NOT NULL DEFAULT 0,
    IsActive    BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS IX_FsaDecisions_Screen ON FsaDecisions (Screen, SortOrder);

-- Where an alert's call to action leads. The route used to be recovered on the
-- client by matching the Action text against a hard-coded map, so adding an
-- alert meant editing React to make its button work.
ALTER TABLE FsaAlerts ADD COLUMN IF NOT EXISTS Route VARCHAR(120) NULL;

-- The registration column was one free-text field carrying three different
-- sentence shapes ("Valid to 2027-04-30", "Expires 2026-10-14", "Expired
-- 2026-08-31", "Not applicable"), so it could not be scanned or sorted. The
-- date now has its own column; the text stays for anything unusual.
ALTER TABLE FsaStaff ADD COLUMN IF NOT EXISTS RegExpiry DATE NULL;

CREATE INDEX IF NOT EXISTS IX_FsaStaff_RegExpiry ON FsaStaff (RegKind, RegExpiry);

-- ---------------------------------------------------------------------------
-- One employee record, not two. The placement register (FsaStaff) and the
-- employee table used by assets, KPI and the organogram held the same nine
-- people as unconnected rows, so an asset, a KPI review and a placement could
-- point at three different versions of one person. These columns move the
-- placement facts onto Employees, which becomes the master record.
-- ---------------------------------------------------------------------------
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS StaffNo      VARCHAR(20)  NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS Service      VARCHAR(50)  NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS Site         VARCHAR(255) NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS Contract     VARCHAR(50)  NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS Registration VARCHAR(100) NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS RegKind      VARCHAR(10)  NULL;
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS RegExpiry    DATE         NULL;
-- Employees who are on the placement register. An office account created for
-- system access only is not a placement.
ALTER TABLE Employees ADD COLUMN IF NOT EXISTS OnRegister   BOOLEAN NOT NULL DEFAULT FALSE;

-- A staff number identifies a person, so it must be unique where present.
CREATE UNIQUE INDEX IF NOT EXISTS UQ_Employees_StaffNo
  ON Employees (StaffNo) WHERE StaffNo IS NOT NULL;

CREATE INDEX IF NOT EXISTS IX_Employees_Register
  ON Employees (CompanyId, OnRegister, RegKind, RegExpiry);

-- ===========================================================================
-- Monthly management report (handoff §5.3). A document tabled at the directors'
-- meeting, not a dashboard: figures for a stated period, findings, the state of
-- last month's actions, this month's commitments (ticked live in the meeting),
-- decisions requested, and sign-off lines.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS FsaReports (
    Id                SERIAL PRIMARY KEY,
    Period            VARCHAR(7)   NOT NULL,   -- YYYY-MM
    PeriodLabel       VARCHAR(80)  NOT NULL,   -- "1–31 August 2026"
    PositionStatement TEXT         NOT NULL,
    SourceNote        VARCHAR(200) NULL,       -- printed under each table
    CompiledBy        VARCHAR(120) NULL,
    CompiledAt        DATE         NULL,
    ReviewedBy        VARCHAR(120) NULL,
    ReviewedAt        DATE         NULL,
    AcceptedBy        VARCHAR(120) NULL,
    AcceptedAt        DATE         NULL,
    CONSTRAINT UQ_FsaReports_Period UNIQUE (Period)
);

-- The eleven tracked indicators: actual against target, with a status class.
CREATE TABLE IF NOT EXISTS FsaReportIndicators (
    Id         SERIAL PRIMARY KEY,
    ReportId   INT          NOT NULL,
    Name       VARCHAR(160) NOT NULL,
    Actual     VARCHAR(40)  NOT NULL,
    Target     VARCHAR(40)  NOT NULL,
    StatusKind VARCHAR(20)  NOT NULL,   -- ok | observation | finding
    Note       VARCHAR(300) NULL,
    SortOrder  INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaReportIndicators_Report FOREIGN KEY (ReportId)
      REFERENCES FsaReports(Id) ON DELETE CASCADE
);

-- Findings and recommendations, evidence-led with a corrective action.
CREATE TABLE IF NOT EXISTS FsaReportFindings (
    Id               SERIAL PRIMARY KEY,
    ReportId         INT          NOT NULL,
    Kind             VARCHAR(20)  NOT NULL,  -- Finding | Observation | Recommendation | Note
    Ref              VARCHAR(40)  NOT NULL,
    Title            VARCHAR(255) NOT NULL,
    Evidence         TEXT         NOT NULL,
    CorrectiveAction TEXT         NULL,
    Owner            VARCHAR(120) NULL,
    DueDate          DATE         NULL,
    SortOrder        INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaReportFindings_Report FOREIGN KEY (ReportId)
      REFERENCES FsaReports(Id) ON DELETE CASCADE
);

-- Both "progress on prior actions" and "next-step commitments" — same shape,
-- separated by Section. Commitments carry a tick that is set in the meeting.
CREATE TABLE IF NOT EXISTS FsaReportActions (
    Id        SERIAL PRIMARY KEY,
    ReportId  INT          NOT NULL,
    Section   VARCHAR(12)  NOT NULL,   -- prior | commitment
    Body      TEXT         NOT NULL,
    Owner     VARCHAR(120) NULL,
    DueDate   DATE         NULL,
    State     VARCHAR(20)  NULL,       -- prior rows: done | in progress | not started
    Ticked    BOOLEAN      NOT NULL DEFAULT FALSE,
    TickedBy  VARCHAR(255) NULL,
    TickedAt  TIMESTAMP(6) NULL,
    SortOrder INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaReportActions_Report FOREIGN KEY (ReportId)
      REFERENCES FsaReports(Id) ON DELETE CASCADE
);

-- Decisions put to the directors, phrased as a decision they can take.
CREATE TABLE IF NOT EXISTS FsaReportDecisions (
    Id        SERIAL PRIMARY KEY,
    ReportId  INT          NOT NULL,
    Title     VARCHAR(255) NOT NULL,
    Body      TEXT         NOT NULL,
    SortOrder INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaReportDecisions_Report FOREIGN KEY (ReportId)
      REFERENCES FsaReports(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS IX_FsaReportIndicators_Report ON FsaReportIndicators (ReportId, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaReportFindings_Report   ON FsaReportFindings (ReportId, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaReportActions_Report    ON FsaReportActions (ReportId, Section, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaReportDecisions_Report  ON FsaReportDecisions (ReportId, SortOrder);

-- ===========================================================================
-- Performance management (handoff §5.6). A pack per employee per cycle, in
-- four stages, carrying three documents: the inspector job description (weighted
-- key result areas), the KPI & KPA schedule (measures, weights, ratings) and the
-- EDP. Packs are role-templated so an IJD/KPA set is role-specific.
-- ===========================================================================

-- Role templates: the default KRAs and KPA measures a new pack inherits.
CREATE TABLE IF NOT EXISTS FsaRoleTemplates (
    Id        SERIAL PRIMARY KEY,
    Role      VARCHAR(160) NOT NULL UNIQUE,
    Service   VARCHAR(50)  NULL,
    Mandate   TEXT         NULL,       -- statutory mandate for the role
    ReportsTo VARCHAR(160) NULL,
    RegType   VARCHAR(120) NULL,       -- registration the placement requires
    SortOrder INT          NOT NULL DEFAULT 0
);

-- Template KRAs (job-description side) and measures (KPA side).
CREATE TABLE IF NOT EXISTS FsaRoleTemplateItems (
    Id         SERIAL PRIMARY KEY,
    TemplateId INT          NOT NULL,
    Part       VARCHAR(10)  NOT NULL,  -- kra | measure
    Area       VARCHAR(160) NOT NULL,
    Detail     TEXT         NULL,      -- duties, or how the measure is counted
    Weight     INT          NOT NULL DEFAULT 0,
    Target     VARCHAR(80)  NULL,      -- measures only
    SortOrder  INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaRoleTemplateItems_Template FOREIGN KEY (TemplateId)
      REFERENCES FsaRoleTemplates(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS FsaPerfPacks (
    Id         SERIAL PRIMARY KEY,
    StaffNo    VARCHAR(20)  NOT NULL,
    CycleYear  INT          NOT NULL,
    -- objectives | midyear | yearend | closed
    Stage      VARCHAR(20)  NOT NULL DEFAULT 'objectives',
    Role       VARCHAR(160) NOT NULL,
    TemplateId INT          NULL,
    -- Per-document state: outstanding | draft | complete
    JdState    VARCHAR(20)  NOT NULL DEFAULT 'outstanding',
    KpiState   VARCHAR(20)  NOT NULL DEFAULT 'outstanding',
    EdpState   VARCHAR(20)  NOT NULL DEFAULT 'outstanding',
    Mandate    TEXT         NULL,
    ReportsTo  VARCHAR(160) NULL,
    RegType    VARCHAR(120) NULL,
    UpdatedAt  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT UQ_FsaPerfPacks UNIQUE (StaffNo, CycleYear),
    CONSTRAINT FK_FsaPerfPacks_Template FOREIGN KEY (TemplateId)
      REFERENCES FsaRoleTemplates(Id)
);

-- Weighted key result areas — the job-description tab.
CREATE TABLE IF NOT EXISTS FsaPerfKras (
    Id        SERIAL PRIMARY KEY,
    PackId    INT          NOT NULL,
    Area      VARCHAR(160) NOT NULL,
    Duties    TEXT         NULL,
    Weight    INT          NOT NULL DEFAULT 0,
    SortOrder INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaPerfKras_Pack FOREIGN KEY (PackId)
      REFERENCES FsaPerfPacks(Id) ON DELETE CASCADE
);

-- The KPA schedule. Rating is 1-5 against a "Meets" line of 3; anything below
-- it is a shortfall, and the EDP goals are derived from those rather than typed.
CREATE TABLE IF NOT EXISTS FsaPerfMeasures (
    Id        SERIAL PRIMARY KEY,
    PackId    INT          NOT NULL,
    Area      VARCHAR(160) NOT NULL,
    Detail    TEXT         NULL,
    Target    VARCHAR(80)  NULL,
    Weight    INT          NOT NULL DEFAULT 0,
    Rating    INT          NULL,       -- 1-5, NULL until rated
    SortOrder INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaPerfMeasures_Pack FOREIGN KEY (PackId)
      REFERENCES FsaPerfPacks(Id) ON DELETE CASCADE
);

-- Development goals. MeasureId records which shortfall produced the goal.
CREATE TABLE IF NOT EXISTS FsaPerfGoals (
    Id         SERIAL PRIMARY KEY,
    PackId     INT          NOT NULL,
    MeasureId  INT          NULL,
    Goal       TEXT         NOT NULL,
    Provider   VARCHAR(160) NULL,
    StartDate  DATE         NULL,
    EndDate    DATE         NULL,
    SignedBy   VARCHAR(120) NULL,
    SignedAt   DATE         NULL,
    SortOrder  INT          NOT NULL DEFAULT 0,
    CONSTRAINT FK_FsaPerfGoals_Pack FOREIGN KEY (PackId)
      REFERENCES FsaPerfPacks(Id) ON DELETE CASCADE,
    CONSTRAINT FK_FsaPerfGoals_Measure FOREIGN KEY (MeasureId)
      REFERENCES FsaPerfMeasures(Id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS IX_FsaPerfKras_Pack     ON FsaPerfKras (PackId, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaPerfMeasures_Pack ON FsaPerfMeasures (PackId, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaPerfGoals_Pack    ON FsaPerfGoals (PackId, SortOrder);
CREATE INDEX IF NOT EXISTS IX_FsaRoleTemplateItems_Tpl ON FsaRoleTemplateItems (TemplateId, Part, SortOrder);
