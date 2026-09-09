-- PostgreSQL schema for the FSA HR system.
-- Generated from schema-mysql.sql. Identifiers are intentionally UNQUOTED so
-- Postgres folds them to lower case; src/db.js maps result keys back to the
-- PascalCase the route and JS code expect.
-- Apply with: node scripts/apply-pg-schema.js (from backend/)



CREATE TABLE IF NOT EXISTS Users (
    Id            SERIAL PRIMARY KEY,
    Email         VARCHAR(255) NOT NULL UNIQUE,
    PasswordHash  VARCHAR(255) NOT NULL,
    DisplayName   VARCHAR(255) NULL,
    Role          VARCHAR(50)  NOT NULL DEFAULT 'user',
    -- Per-page permission map (JSON) for standard accounts; NULL for
    -- superadmin/admin (= full access). Parsed in JS (access.js).
    Permissions   TEXT     NULL,
    IsActive      BOOLEAN   NOT NULL DEFAULT TRUE,
    EmployeeId    INT          NULL,
    InviteToken   VARCHAR(64)  NULL,
    InviteExpires TIMESTAMP(6)  NULL,
    CreatedAt     TIMESTAMP(6)  NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt     TIMESTAMP(6)  NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS Companies (
    Id                      SERIAL PRIMARY KEY,
    Name                    VARCHAR(255) NOT NULL UNIQUE,
    LogoFile                VARCHAR(500) NULL,
    BrandColor              VARCHAR(7)   NULL,
    SowHeaderFile           VARCHAR(500) NULL,
    SowFooterFile           VARCHAR(500) NULL,
    RegistrationNumber      VARCHAR(100) NULL,
    SowFontFamily           VARCHAR(100) NULL,
    SowBodyFontSize         INT NULL,
    SowHeading1FontSize     INT NULL,
    SowHeading2FontSize     INT NULL,
    SowHeading3FontSize     INT NULL,
    SowUppercaseCompanyName BOOLEAN NULL,
    DocH1AllCaps            BOOLEAN NULL,
    DocH2AllCaps            BOOLEAN NULL,
    DocH3AllCaps            BOOLEAN NULL,
    DocLandscapeHeaderFile  VARCHAR(500) NULL,
    DocLandscapeFooterFile  VARCHAR(500) NULL,
    SowProviderName         VARCHAR(255) NULL,
    SowProviderDesignation  VARCHAR(255) NULL,
    SowProviderLocation     VARCHAR(500) NULL,
    CoreValuesJson          TEXT NULL,
    CompanyFacetsJson       TEXT NULL,
    DocBannerSideMargin     BOOLEAN NOT NULL DEFAULT FALSE,
    DocHeaderSideMargin     BOOLEAN NOT NULL DEFAULT FALSE,
    DocFooterSideMargin     BOOLEAN NOT NULL DEFAULT FALSE,
    DocSectionSeparator     BOOLEAN NOT NULL DEFAULT TRUE,
    DocPageNumberPosition   VARCHAR(10) NOT NULL DEFAULT 'bottom',
    DocFooterPlacement      VARCHAR(10) NOT NULL DEFAULT 'all',
    DocHeaderPlacement      VARCHAR(10) NOT NULL DEFAULT 'first',
    KpiFrequency            VARCHAR(20) NOT NULL DEFAULT 'Quarterly',
    CreatedAt               TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt               TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS Employees (
    Id                   SERIAL PRIMARY KEY,
    CompanyId            INT NOT NULL,
    Name                 VARCHAR(255) NOT NULL,
    Title                VARCHAR(255) NULL,
    Email                VARCHAR(255) NULL,
    ManagerId            INT NULL,
    Department           VARCHAR(255) NULL,
    KpiExempt            BOOLEAN NOT NULL DEFAULT FALSE,
    KpiFrequencyOverride VARCHAR(20) NULL,
    CreatedAt            TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt            TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_Employees_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Employees_Manager FOREIGN KEY (ManagerId) REFERENCES Employees(Id)
);

CREATE TABLE IF NOT EXISTS EmployeeManagers (
    EmployeeId INT NOT NULL,
    ManagerId  INT NOT NULL,
    CreatedAt  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    PRIMARY KEY (EmployeeId, ManagerId),
    CONSTRAINT FK_EmpMgr_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE,
    CONSTRAINT FK_EmpMgr_Manager  FOREIGN KEY (ManagerId)  REFERENCES Employees(Id),
    CONSTRAINT CK_EmpMgr_NotSelf  CHECK (EmployeeId <> ManagerId)
);

CREATE TABLE IF NOT EXISTS Assets (
    Id                         SERIAL PRIMARY KEY,
    CompanyId                  INT NOT NULL,
    Category                   VARCHAR(100) NOT NULL,
    Type                       VARCHAR(100) NULL,
    Name                       VARCHAR(255) NOT NULL,
    SerialNumber               VARCHAR(255) NULL,
    AssetTag                   VARCHAR(100) NULL,
    PurchaseDate               DATE NULL,
    PurchaseValue              DECIMAL(12,2) NULL,
    DepreciationPercentPerYear DECIMAL(5,2) NULL,
    UsefulLifeYears            INT NULL,
    Notes                      TEXT NULL,
    AssignedEmployeeId         INT NULL,
    LastAssignedEmployeeId     INT NULL,
    IsInRepairs                BOOLEAN NOT NULL DEFAULT FALSE,
    RepairStage                VARCHAR(50) NULL,
    RepairProblem              TEXT NULL,
    RepairSupplier             VARCHAR(255) NULL,
    RepairBookedInAt           TIMESTAMP(6) NULL,
    RepairDocketFile           VARCHAR(500) NULL,
    CreatedAt                  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt                  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_Assets_Company  FOREIGN KEY (CompanyId)          REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Assets_Employee FOREIGN KEY (AssignedEmployeeId) REFERENCES Employees(Id)
);

CREATE TABLE IF NOT EXISTS RepairStageHistory (
    Id         SERIAL PRIMARY KEY,
    AssetId    INT NOT NULL,
    Stage      VARCHAR(50) NOT NULL,
    EnteredAt  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    ActorEmail VARCHAR(255) NULL,
    CONSTRAINT FK_RepairStageHistory_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RepairHistory (
    Id                SERIAL PRIMARY KEY,
    AssetId           INT NOT NULL,
    Reference         VARCHAR(100) NULL,
    Problem           TEXT NULL,
    Supplier          VARCHAR(255) NULL,
    OwnerEmployeeId   INT NULL,
    OwnerNameSnapshot VARCHAR(255) NULL,
    BookedInAt        TIMESTAMP(6) NULL,
    ResolvedAt        TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    ResolvedBy        VARCHAR(255) NULL,
    DocketFile        VARCHAR(500) NULL,
    CONSTRAINT FK_RepairHistory_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RepairHistoryNotes (
    Id              SERIAL PRIMARY KEY,
    RepairHistoryId INT NOT NULL,
    Author          VARCHAR(255) NULL,
    Message         TEXT NOT NULL,
    CreatedAt       TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_RepairHistoryNotes_Hist FOREIGN KEY (RepairHistoryId) REFERENCES RepairHistory(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RepairHistoryStages (
    Id              SERIAL PRIMARY KEY,
    RepairHistoryId INT NOT NULL,
    Stage           VARCHAR(50) NOT NULL,
    EnteredAt       TIMESTAMP(6) NOT NULL,
    ActorEmail      VARCHAR(255) NULL,
    CONSTRAINT FK_RepairHistoryStages_Hist FOREIGN KEY (RepairHistoryId) REFERENCES RepairHistory(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RepairNotes (
    Id        SERIAL PRIMARY KEY,
    AssetId   INT NOT NULL,
    Author    VARCHAR(255) NULL,
    Message   TEXT NOT NULL,
    CreatedAt TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_RepairNotes_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RepairRecipients (
    Id        SERIAL PRIMARY KEY,
    AssetId   INT NOT NULL,
    Email     VARCHAR(255) NOT NULL,
    CreatedAt TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_RepairRecipients_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AssetImages (
    Id           SERIAL PRIMARY KEY,
    AssetId      INT NOT NULL,
    FileName     VARCHAR(500) NOT NULL,
    OriginalName VARCHAR(500) NULL,
    CreatedAt    TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_AssetImages_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS CategoryDefaults (
    Id                         SERIAL PRIMARY KEY,
    CompanyId                  INT NOT NULL,
    Category                   VARCHAR(100) NOT NULL,
    DepreciationPercentPerYear DECIMAL(5,2) NULL,
    UsefulLifeYears            INT NULL,
    CreatedAt                  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt                  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_CategoryDefaults_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_CategoryDefaults_CompanyCategory UNIQUE (CompanyId, Category)
);

CREATE TABLE IF NOT EXISTS Projects (
    Id          SERIAL PRIMARY KEY,
    CompanyId   INT NOT NULL,
    Name        VARCHAR(255) NOT NULL,
    Description TEXT NULL,
    Color       VARCHAR(20) NULL,
    CreatedBy   VARCHAR(255) NULL,
    CompletedAt TIMESTAMP(6) NULL,
    Department  VARCHAR(50) NOT NULL DEFAULT 'Procurement',
    CreatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_Projects_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ProjectProcesses (
    Id               SERIAL PRIMARY KEY,
    ProjectId        INT NOT NULL,
    Name             VARCHAR(255) NOT NULL,
    Description      TEXT NULL,
    Color            VARCHAR(20) NULL,
    PositionX        DOUBLE PRECISION NOT NULL DEFAULT 0,
    PositionY        DOUBLE PRECISION NOT NULL DEFAULT 0,
    SowDataJson      TEXT NULL,
    SowDocFile       VARCHAR(500) NULL,
    Kind             VARCHAR(20) NOT NULL DEFAULT 'sow',
    EmployeeId       INT NULL,
    KpaDataJson      TEXT NULL,
    JdDataJson       TEXT NULL,
    EdpDataJson      TEXT NULL,
    KpidocDataJson   TEXT NULL,
    SourceTemplateId INT NULL,
    CreatedAt        TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt        TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_ProjectProcesses_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS SowVersions (
    Id            SERIAL PRIMARY KEY,
    ProcessId     INT NOT NULL,
    Version       VARCHAR(50) NOT NULL,
    SowDataJson   TEXT NULL,
    SowDocFile    VARCHAR(500) NULL,
    SignedDocFile VARCHAR(500) NULL,
    CreatedAt     TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy     VARCHAR(255) NULL,
    CONSTRAINT FK_SowVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KpaVersions (
    Id          SERIAL PRIMARY KEY,
    ProcessId   INT NOT NULL,
    Version     VARCHAR(50) NOT NULL,
    KpaDataJson TEXT NULL,
    EmployeeId  INT NULL,
    CreatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy   VARCHAR(255) NULL,
    CONSTRAINT FK_KpaVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS JdVersions (
    Id         SERIAL PRIMARY KEY,
    ProcessId  INT NOT NULL,
    Version    VARCHAR(50) NOT NULL,
    JdDataJson TEXT NULL,
    CreatedAt  TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy  VARCHAR(255) NULL,
    CONSTRAINT FK_JdVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS EdpVersions (
    Id          SERIAL PRIMARY KEY,
    ProcessId   INT NOT NULL,
    Version     VARCHAR(50) NOT NULL,
    EdpDataJson TEXT NULL,
    CreatedAt   TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy   VARCHAR(255) NULL,
    CONSTRAINT FK_EdpVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KpidocVersions (
    Id             SERIAL PRIMARY KEY,
    ProcessId      INT NOT NULL,
    Version        VARCHAR(50) NOT NULL,
    KpidocDataJson TEXT NULL,
    CreatedAt      TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy      VARCHAR(255) NULL,
    CONSTRAINT FK_KpidocVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS SowTemplates (
    Id                       SERIAL PRIMARY KEY,
    OwnerCompanyId           INT NOT NULL,
    Name                     VARCHAR(255) NOT NULL,
    Description              TEXT NULL,
    IsDefault                BOOLEAN NOT NULL DEFAULT FALSE,
    DataJson                 TEXT NULL,
    SharedWithCompanyIdsJson TEXT NULL,
    Kind                     VARCHAR(20) NOT NULL DEFAULT 'sow',
    Department               VARCHAR(50) NOT NULL DEFAULT 'Procurement',
    NextTemplateIdsJson      TEXT NULL,
    NextStepsJson            TEXT NULL,
    CreatedAt                TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt                TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CreatedBy                VARCHAR(255) NULL,
    CONSTRAINT FK_SowTemplates_OwnerCompany FOREIGN KEY (OwnerCompanyId) REFERENCES Companies(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AppSettings (
    Id           SERIAL PRIMARY KEY,
    SettingKey   VARCHAR(100) NOT NULL UNIQUE,
    SettingValue VARCHAR(500) NULL,
    UpdatedAt    TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS KpiSessions (
    Id           SERIAL PRIMARY KEY,
    EmployeeId   INT NOT NULL,
    PeriodLabel  VARCHAR(50) NOT NULL,
    SessionDate  DATE NULL,
    DocumentFile VARCHAR(500) NULL,
    OriginalName VARCHAR(500) NULL,
    Notes        TEXT NULL,
    UploadedBy   VARCHAR(255) NULL,
    CreatedAt    TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt    TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_KpiSessions_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KpiReviews (
    Id                  SERIAL PRIMARY KEY,
    CompanyId           INT NOT NULL,
    EmployeeId          INT NOT NULL,
    ManagerId           INT NULL,
    SourceProcessId     INT NULL,
    PeriodLabel         VARCHAR(50) NOT NULL,
    KpiSnapshotJson     TEXT NULL,
    Status              VARCHAR(30) NOT NULL DEFAULT 'employee_pending',
    EmployeeRatingsJson TEXT NULL,
    ManagerRatingsJson  TEXT NULL,
    SessionNotesJson    TEXT NULL,
    SessionPasswordHash VARCHAR(255) NULL,
    DueDate             DATE NULL,
    EmployeeSubmittedAt TIMESTAMP(6) NULL,
    ManagerSubmittedAt  TIMESTAMP(6) NULL,
    UnlockedAt          TIMESTAMP(6) NULL,
    ManagerAckAt        TIMESTAMP(6) NULL,
    EmployeeAckAt       TIMESTAMP(6) NULL,
    CompletedAt         TIMESTAMP(6) NULL,
    KpiSessionId        INT NULL,
    CreatedBy           VARCHAR(255) NULL,
    CreatedAt           TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UpdatedAt           TIMESTAMP(6) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT FK_KpiReviews_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE
);



-- Indexes

CREATE INDEX IF NOT EXISTS IX_Employees_CompanyId ON Employees (CompanyId);

CREATE INDEX IF NOT EXISTS IX_Employees_ManagerId ON Employees (ManagerId);

CREATE INDEX IF NOT EXISTS IX_EmployeeManagers_ManagerId ON EmployeeManagers (ManagerId);

CREATE INDEX IF NOT EXISTS IX_Assets_CompanyId ON Assets (CompanyId);

CREATE INDEX IF NOT EXISTS IX_Assets_AssignedEmployeeId ON Assets (AssignedEmployeeId);

CREATE INDEX IF NOT EXISTS IX_Assets_Category ON Assets (Category);

CREATE INDEX IF NOT EXISTS IX_RepairStageHistory_AssetId ON RepairStageHistory (AssetId);

CREATE INDEX IF NOT EXISTS IX_RepairHistory_AssetId ON RepairHistory (AssetId);

CREATE INDEX IF NOT EXISTS IX_RepairHistoryNotes_HistId ON RepairHistoryNotes (RepairHistoryId);

CREATE INDEX IF NOT EXISTS IX_RepairNotes_AssetId ON RepairNotes (AssetId);

CREATE INDEX IF NOT EXISTS IX_RepairRecipients_AssetId ON RepairRecipients (AssetId);

CREATE INDEX IF NOT EXISTS IX_AssetImages_AssetId ON AssetImages (AssetId);

CREATE INDEX IF NOT EXISTS IX_Projects_CompanyId ON Projects (CompanyId);

CREATE INDEX IF NOT EXISTS IX_ProjectProcesses_ProjectId ON ProjectProcesses (ProjectId);

CREATE INDEX IF NOT EXISTS IX_SowVersions_ProcessId ON SowVersions (ProcessId);

CREATE INDEX IF NOT EXISTS IX_SowVersions_ProcessId_CreatedAt ON SowVersions (ProcessId, CreatedAt DESC);

CREATE INDEX IF NOT EXISTS IX_KpaVersions_ProcessId ON KpaVersions (ProcessId);

CREATE INDEX IF NOT EXISTS IX_KpaVersions_ProcessId_CreatedAt ON KpaVersions (ProcessId, CreatedAt DESC);

CREATE INDEX IF NOT EXISTS IX_JdVersions_ProcessId ON JdVersions (ProcessId);

CREATE INDEX IF NOT EXISTS IX_JdVersions_ProcessId_CreatedAt ON JdVersions (ProcessId, CreatedAt DESC);

CREATE INDEX IF NOT EXISTS IX_EdpVersions_ProcessId ON EdpVersions (ProcessId);

CREATE INDEX IF NOT EXISTS IX_EdpVersions_ProcessId_CreatedAt ON EdpVersions (ProcessId, CreatedAt DESC);

CREATE INDEX IF NOT EXISTS IX_KpidocVersions_ProcessId ON KpidocVersions (ProcessId);

CREATE INDEX IF NOT EXISTS IX_KpidocVersions_ProcessId_CreatedAt ON KpidocVersions (ProcessId, CreatedAt DESC);

CREATE INDEX IF NOT EXISTS IX_SowTemplates_OwnerCompanyId ON SowTemplates (OwnerCompanyId);

CREATE INDEX IF NOT EXISTS IX_KpiSessions_EmployeeId ON KpiSessions (EmployeeId);

CREATE INDEX IF NOT EXISTS IX_KpiReviews_CompanyId ON KpiReviews (CompanyId);

CREATE INDEX IF NOT EXISTS IX_KpiReviews_EmployeeId ON KpiReviews (EmployeeId);

