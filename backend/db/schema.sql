IF DB_ID('lancorp') IS NULL
    CREATE DATABASE lancorp;
GO

USE lancorp;
GO

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        Email         NVARCHAR(255) NOT NULL UNIQUE,
        PasswordHash  NVARCHAR(255) NOT NULL,
        DisplayName   NVARCHAR(255) NULL,
        -- Account type: 'standard' (page permissions in Permissions), or the
        -- fixed staff types 'manager' / 'employee'. See src/middleware/access.js.
        Role          NVARCHAR(50)  NOT NULL DEFAULT 'employee',
        -- Per-page permission map (JSON) for standard accounts, e.g.
        -- {"assets":"write","hr":"read"}. NULL for staff accounts.
        Permissions   NVARCHAR(MAX) NULL,
        IsActive      BIT           NOT NULL DEFAULT 1,
        EmployeeId    INT           NULL,
        InviteToken   NVARCHAR(64)  NULL,
        InviteExpires DATETIME2     NULL,
        CreatedAt     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.Companies', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Companies (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        Name        NVARCHAR(255) NOT NULL UNIQUE,
        LogoFile    NVARCHAR(500) NULL,
        BrandColor  NVARCHAR(7) NULL,
        CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- Idempotent migration for existing installs
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'BrandColor'
)
BEGIN
    ALTER TABLE dbo.Companies ADD BrandColor NVARCHAR(7) NULL;
END
GO

-- Branded header/footer images used on every page of generated SOW documents
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowHeaderFile')
    ALTER TABLE dbo.Companies ADD SowHeaderFile NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowFooterFile')
    ALTER TABLE dbo.Companies ADD SowFooterFile NVARCHAR(500) NULL;
GO

-- Company registration / VAT number (printed on the SOW cover page)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'RegistrationNumber')
    ALTER TABLE dbo.Companies ADD RegistrationNumber NVARCHAR(100) NULL;
GO

-- Per-company SOW typography settings.
-- All optional; the generator falls back to "Arial 12 / 14 / 13 / 12, uppercase" when null.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowFontFamily')
    ALTER TABLE dbo.Companies ADD SowFontFamily NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowBodyFontSize')
    ALTER TABLE dbo.Companies ADD SowBodyFontSize INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowHeading1FontSize')
    ALTER TABLE dbo.Companies ADD SowHeading1FontSize INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowHeading2FontSize')
    ALTER TABLE dbo.Companies ADD SowHeading2FontSize INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowHeading3FontSize')
    ALTER TABLE dbo.Companies ADD SowHeading3FontSize INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowUppercaseCompanyName')
    ALTER TABLE dbo.Companies ADD SowUppercaseCompanyName BIT NULL;
GO

-- Per-heading "all caps" flags applied to generated documents
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'DocH1AllCaps')
    ALTER TABLE dbo.Companies ADD DocH1AllCaps BIT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'DocH2AllCaps')
    ALTER TABLE dbo.Companies ADD DocH2AllCaps BIT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'DocH3AllCaps')
    ALTER TABLE dbo.Companies ADD DocH3AllCaps BIT NULL;
GO

-- Landscape-orientation header / footer banners (the portrait ones already exist as SowHeaderFile / SowFooterFile)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'DocLandscapeHeaderFile')
    ALTER TABLE dbo.Companies ADD DocLandscapeHeaderFile NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'DocLandscapeFooterFile')
    ALTER TABLE dbo.Companies ADD DocLandscapeFooterFile NVARCHAR(500) NULL;
GO

-- Default Service-Provider signatory captured against the issuing company.
-- The SOW editor uses these to pre-populate the Service Provider rows on the
-- Signature Control page so the same person doesn't have to be typed in on
-- every new SOW. They're optional; if left blank the Service Provider rows
-- come up empty and the user fills them in per-SOW.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowProviderName')
    ALTER TABLE dbo.Companies ADD SowProviderName NVARCHAR(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowProviderDesignation')
    ALTER TABLE dbo.Companies ADD SowProviderDesignation NVARCHAR(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'SowProviderLocation')
    ALTER TABLE dbo.Companies ADD SowProviderLocation NVARCHAR(500) NULL;
GO

-- Per-company list of core values (e.g. "Integrity", "Customer obsession").
-- Stored as a JSON array of strings so the count is open-ended; downstream
-- document generators read this column to render the company's values.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'CoreValuesJson')
    ALTER TABLE dbo.Companies ADD CoreValuesJson NVARCHAR(MAX) NULL;
GO

-- Per-company list of "departments / facets" (e.g. "Human Resources",
-- "Operations", "New Business"). Used as the source of the department
-- dropdown in the KPA-formulation task so weighted KPAs can later be
-- rolled up per facet for a focus-area view.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'CompanyFacetsJson')
    ALTER TABLE dbo.Companies ADD CompanyFacetsJson NVARCHAR(MAX) NULL;
GO

-- Department field for employees (free text, used by analytics filters)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Employees') AND name = 'Department'
)
BEGIN
    ALTER TABLE dbo.Employees ADD Department NVARCHAR(255) NULL;
END
GO

IF OBJECT_ID('dbo.Employees', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Employees (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompanyId   INT NOT NULL,
        Name        NVARCHAR(255) NOT NULL,
        Title       NVARCHAR(255) NULL,
        Email       NVARCHAR(255) NULL,
        ManagerId   INT NULL,
        CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Employees_Company  FOREIGN KEY (CompanyId) REFERENCES dbo.Companies(Id) ON DELETE CASCADE,
        CONSTRAINT FK_Employees_Manager  FOREIGN KEY (ManagerId) REFERENCES dbo.Employees(Id)
    );
    CREATE INDEX IX_Employees_CompanyId ON dbo.Employees(CompanyId);
    CREATE INDEX IX_Employees_ManagerId ON dbo.Employees(ManagerId);
END
GO

-- Additional (matrix) reporting lines beyond an employee's primary manager
-- (Employees.ManagerId). An employee's "allocated managers" = the primary
-- manager plus every ManagerId listed here.
IF OBJECT_ID('dbo.EmployeeManagers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeManagers (
        EmployeeId  INT NOT NULL,
        ManagerId   INT NOT NULL,
        CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EmployeeManagers PRIMARY KEY (EmployeeId, ManagerId),
        CONSTRAINT FK_EmpMgr_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.Employees(Id) ON DELETE CASCADE,
        CONSTRAINT FK_EmpMgr_Manager  FOREIGN KEY (ManagerId)  REFERENCES dbo.Employees(Id),
        CONSTRAINT CK_EmpMgr_NotSelf  CHECK (EmployeeId <> ManagerId)
    );
    CREATE INDEX IX_EmployeeManagers_ManagerId ON dbo.EmployeeManagers(ManagerId);
END
GO

IF OBJECT_ID('dbo.Assets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Assets (
        Id                          INT IDENTITY(1,1) PRIMARY KEY,
        CompanyId                   INT NOT NULL,
        Category                    NVARCHAR(100) NOT NULL,
        Type                        NVARCHAR(100) NULL,
        Name                        NVARCHAR(255) NOT NULL,
        SerialNumber                NVARCHAR(255) NULL,
        AssetTag                    NVARCHAR(100) NULL,
        PurchaseDate                DATE NULL,
        PurchaseValue               DECIMAL(12,2) NULL,
        DepreciationPercentPerYear  DECIMAL(5,2)  NULL,
        UsefulLifeYears             INT           NULL,
        Notes                       NVARCHAR(MAX) NULL,
        AssignedEmployeeId          INT NULL,
        CreatedAt                   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt                   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Assets_Company  FOREIGN KEY (CompanyId)          REFERENCES dbo.Companies(Id) ON DELETE CASCADE,
        CONSTRAINT FK_Assets_Employee FOREIGN KEY (AssignedEmployeeId) REFERENCES dbo.Employees(Id) ON DELETE NO ACTION
    );
    CREATE INDEX IX_Assets_CompanyId          ON dbo.Assets(CompanyId);
    CREATE INDEX IX_Assets_AssignedEmployeeId ON dbo.Assets(AssignedEmployeeId);
    CREATE INDEX IX_Assets_Category           ON dbo.Assets(Category);
END
GO

-- Idempotent migrations for new lifecycle/cost columns on Assets
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'PurchaseValue')
    ALTER TABLE dbo.Assets ADD PurchaseValue DECIMAL(12,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'DepreciationPercentPerYear')
    ALTER TABLE dbo.Assets ADD DepreciationPercentPerYear DECIMAL(5,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'UsefulLifeYears')
    ALTER TABLE dbo.Assets ADD UsefulLifeYears INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'IsInRepairs')
    ALTER TABLE dbo.Assets ADD IsInRepairs BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'RepairStage')
    ALTER TABLE dbo.Assets ADD RepairStage NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'RepairProblem')
    ALTER TABLE dbo.Assets ADD RepairProblem NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'RepairSupplier')
    ALTER TABLE dbo.Assets ADD RepairSupplier NVARCHAR(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'RepairBookedInAt')
    ALTER TABLE dbo.Assets ADD RepairBookedInAt DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'RepairDocketFile')
    ALTER TABLE dbo.Assets ADD RepairDocketFile NVARCHAR(500) NULL;
GO
-- Tracks who the asset was last assigned to before being moved to storage
-- (e.g. after a repair is resolved). Used to restore the allocation later.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Assets') AND name = 'LastAssignedEmployeeId')
    ALTER TABLE dbo.Assets ADD LastAssignedEmployeeId INT NULL;
GO

-- Stage transition log for the current/active repair on an asset (cleared when repair is resolved
-- and snapshotted into RepairHistory).
IF OBJECT_ID('dbo.RepairStageHistory', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairStageHistory (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        AssetId     INT           NOT NULL,
        Stage       NVARCHAR(50)  NOT NULL,
        EnteredAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        ActorEmail  NVARCHAR(255) NULL,
        CONSTRAINT FK_RepairStageHistory_Asset FOREIGN KEY (AssetId) REFERENCES dbo.Assets(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RepairStageHistory_AssetId ON dbo.RepairStageHistory(AssetId);
END
GO

-- Completed-repair archive. Each finished repair becomes one row; the live RepairProblem/Supplier/etc
-- on Assets is for the *current* repair only.
IF OBJECT_ID('dbo.RepairHistory', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairHistory (
        Id                INT IDENTITY(1,1) PRIMARY KEY,
        AssetId           INT NOT NULL,
        Reference         NVARCHAR(100) NULL,
        Problem           NVARCHAR(MAX) NULL,
        Supplier          NVARCHAR(255) NULL,
        OwnerEmployeeId   INT NULL,
        OwnerNameSnapshot NVARCHAR(255) NULL,
        BookedInAt        DATETIME2 NULL,
        ResolvedAt        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ResolvedBy        NVARCHAR(255) NULL,
        DocketFile        NVARCHAR(500) NULL,
        CONSTRAINT FK_RepairHistory_Asset FOREIGN KEY (AssetId) REFERENCES dbo.Assets(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RepairHistory_AssetId ON dbo.RepairHistory(AssetId);
END
GO

IF OBJECT_ID('dbo.RepairHistoryNotes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairHistoryNotes (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        RepairHistoryId INT NOT NULL,
        Author          NVARCHAR(255) NULL,
        Message         NVARCHAR(MAX) NOT NULL,
        CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_RepairHistoryNotes_Hist FOREIGN KEY (RepairHistoryId) REFERENCES dbo.RepairHistory(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RepairHistoryNotes_HistId ON dbo.RepairHistoryNotes(RepairHistoryId);
END
GO

IF OBJECT_ID('dbo.RepairHistoryStages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairHistoryStages (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        RepairHistoryId INT NOT NULL,
        Stage           NVARCHAR(50)  NOT NULL,
        EnteredAt       DATETIME2     NOT NULL,
        ActorEmail      NVARCHAR(255) NULL,
        CONSTRAINT FK_RepairHistoryStages_Hist FOREIGN KEY (RepairHistoryId) REFERENCES dbo.RepairHistory(Id) ON DELETE CASCADE
    );
END
GO

IF OBJECT_ID('dbo.RepairNotes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairNotes (
        Id        INT IDENTITY(1,1) PRIMARY KEY,
        AssetId   INT NOT NULL,
        Author    NVARCHAR(255) NULL,
        Message   NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_RepairNotes_Asset FOREIGN KEY (AssetId) REFERENCES dbo.Assets(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RepairNotes_AssetId ON dbo.RepairNotes(AssetId);
END
GO

IF OBJECT_ID('dbo.RepairRecipients', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RepairRecipients (
        Id        INT IDENTITY(1,1) PRIMARY KEY,
        AssetId   INT NOT NULL,
        Email     NVARCHAR(255) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_RepairRecipients_Asset FOREIGN KEY (AssetId) REFERENCES dbo.Assets(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_RepairRecipients_AssetId ON dbo.RepairRecipients(AssetId);
END
GO

-- Asset photos
IF OBJECT_ID('dbo.AssetImages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AssetImages (
        Id           INT IDENTITY(1,1) PRIMARY KEY,
        AssetId      INT NOT NULL,
        FileName     NVARCHAR(500) NOT NULL,
        OriginalName NVARCHAR(500) NULL,
        CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AssetImages_Asset FOREIGN KEY (AssetId) REFERENCES dbo.Assets(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_AssetImages_AssetId ON dbo.AssetImages(AssetId);
END
GO

-- Per-company defaults for asset categories. Used to prefill the depreciation
-- and useful-life fields when adding a new asset under that company.
IF OBJECT_ID('dbo.CategoryDefaults', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CategoryDefaults (
        Id                          INT IDENTITY(1,1) PRIMARY KEY,
        CompanyId                   INT NOT NULL,
        Category                    NVARCHAR(100) NOT NULL,
        DepreciationPercentPerYear  DECIMAL(5,2) NULL,
        UsefulLifeYears             INT NULL,
        CreatedAt                   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt                   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_CategoryDefaults_Company FOREIGN KEY (CompanyId) REFERENCES dbo.Companies(Id) ON DELETE CASCADE,
        CONSTRAINT UQ_CategoryDefaults_CompanyCategory UNIQUE (CompanyId, Category)
    );
END
GO

-- Projects belong to a company. Used by the Procurement Process page.
IF OBJECT_ID('dbo.Projects', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Projects (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        CompanyId   INT            NOT NULL,
        Name        NVARCHAR(255)  NOT NULL,
        Description NVARCHAR(MAX)  NULL,
        Color       NVARCHAR(20)   NULL,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Projects_Company FOREIGN KEY (CompanyId) REFERENCES dbo.Companies(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_Projects_CompanyId ON dbo.Projects(CompanyId);
END
GO

-- Track who created each project (email of the signed-in user at creation time)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'CreatedBy')
    ALTER TABLE dbo.Projects ADD CreatedBy NVARCHAR(255) NULL;
GO

-- Processes (cards/objectives) on the project whiteboard. Each one has a
-- position on the canvas so the user can arrange them as a flow diagram.
IF OBJECT_ID('dbo.ProjectProcesses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectProcesses (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        ProjectId   INT            NOT NULL,
        Name        NVARCHAR(255)  NOT NULL,
        Description NVARCHAR(MAX)  NULL,
        Color       NVARCHAR(20)   NULL,
        PositionX   FLOAT          NOT NULL DEFAULT 0,
        PositionY   FLOAT          NOT NULL DEFAULT 0,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_ProjectProcesses_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Projects(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_ProjectProcesses_ProjectId ON dbo.ProjectProcesses(ProjectId);
END
GO

-- SOW (Scope of Work) form data + last-generated docx filename, scoped per process.
-- Stored as JSON so the form schema can grow without further migrations.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'SowDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD SowDataJson NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'SowDocFile')
    ALTER TABLE dbo.ProjectProcesses ADD SowDocFile NVARCHAR(500) NULL;
GO

-- Task "kind" — 'sow' (existing SOW editor) or 'kpa' (KPA-formulation
-- editor). Determines which modal the whiteboard opens for this process.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'Kind')
    ALTER TABLE dbo.ProjectProcesses ADD Kind NVARCHAR(20) NOT NULL DEFAULT 'sow';
GO

-- Employee this KPA task is for. Null for SOW processes; set when a
-- KPA-kind process is created. No FK: Companies → Employees and
-- Companies → Projects → ProjectProcesses both cascade, so an extra
-- Employees → ProjectProcesses cascade path is blocked by SQL Server.
-- The reference is enforced in application code instead.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'EmployeeId')
    ALTER TABLE dbo.ProjectProcesses ADD EmployeeId INT NULL;
GO

-- KPA list for a KPA-kind process, stored as a JSON array of
-- { name, department, weight } objects so the schema can grow without
-- another migration. Null for SOW processes.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'KpaDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD KpaDataJson NVARCHAR(MAX) NULL;
GO

-- Job Description body for a JD-kind process — JSON blob holding the
-- whole form (title, location, hours, work mode, report-to, compensation,
-- about, overview, qualifications, why join us, how to apply). Null for
-- non-JD processes.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'JdDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD JdDataJson NVARCHAR(MAX) NULL;
GO

-- EDP Alignment Notes body for an EDP-kind process — JSON blob holding
-- the document description + an array of EDPs, each with a WIG and a
-- list of lead measures. Null for non-EDP processes.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'EdpDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD EdpDataJson NVARCHAR(MAX) NULL;
GO

-- KPI Document body for a KPI-Doc-kind process — JSON blob holding the
-- editable header (period label / job title / intro) plus the per-row
-- review fields (data source, data result, status, score, comments).
-- Static columns (Weighting / KPA / Core Value / KPI / How we measure)
-- are NOT persisted here — they're re-pulled from the project's KPA
-- task on every load so renaming a KPA on the KPA task flows through.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'KpidocDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD KpidocDataJson NVARCHAR(MAX) NULL;
GO

-- Immutable history of every JD save — mirrors SowVersions / KpaVersions.
IF OBJECT_ID('dbo.JdVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.JdVersions (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        ProcessId   INT            NOT NULL,
        Version     NVARCHAR(50)   NOT NULL,
        JdDataJson  NVARCHAR(MAX)  NULL,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   NVARCHAR(255)  NULL,
        CONSTRAINT FK_JdVersions_Process FOREIGN KEY (ProcessId)
            REFERENCES dbo.ProjectProcesses(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_JdVersions_ProcessId           ON dbo.JdVersions(ProcessId);
    CREATE INDEX IX_JdVersions_ProcessId_CreatedAt ON dbo.JdVersions(ProcessId, CreatedAt DESC);
END
GO

-- Immutable history of every KPI-Doc save.
IF OBJECT_ID('dbo.KpidocVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.KpidocVersions (
        Id             INT IDENTITY(1,1) PRIMARY KEY,
        ProcessId      INT            NOT NULL,
        Version        NVARCHAR(50)   NOT NULL,
        KpidocDataJson NVARCHAR(MAX)  NULL,
        CreatedAt      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy      NVARCHAR(255)  NULL,
        CONSTRAINT FK_KpidocVersions_Process FOREIGN KEY (ProcessId)
            REFERENCES dbo.ProjectProcesses(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KpidocVersions_ProcessId           ON dbo.KpidocVersions(ProcessId);
    CREATE INDEX IX_KpidocVersions_ProcessId_CreatedAt ON dbo.KpidocVersions(ProcessId, CreatedAt DESC);
END
GO

-- Immutable history of every EDP save.
IF OBJECT_ID('dbo.EdpVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EdpVersions (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        ProcessId   INT            NOT NULL,
        Version     NVARCHAR(50)   NOT NULL,
        EdpDataJson NVARCHAR(MAX)  NULL,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   NVARCHAR(255)  NULL,
        CONSTRAINT FK_EdpVersions_Process FOREIGN KEY (ProcessId)
            REFERENCES dbo.ProjectProcesses(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_EdpVersions_ProcessId           ON dbo.EdpVersions(ProcessId);
    CREATE INDEX IX_EdpVersions_ProcessId_CreatedAt ON dbo.EdpVersions(ProcessId, CreatedAt DESC);
END
GO

-- Immutable history of every KPA save — mirrors dbo.SowVersions. Every
-- PUT to a KPA process appends one row here so the whiteboard can list
-- every version that has ever existed. Versions are never overwritten —
-- newer saves create new rows.
IF OBJECT_ID('dbo.KpaVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.KpaVersions (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        ProcessId   INT            NOT NULL,
        Version     NVARCHAR(50)   NOT NULL,
        KpaDataJson NVARCHAR(MAX)  NULL,
        EmployeeId  INT            NULL,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   NVARCHAR(255)  NULL,
        CONSTRAINT FK_KpaVersions_Process FOREIGN KEY (ProcessId)
            REFERENCES dbo.ProjectProcesses(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KpaVersions_ProcessId           ON dbo.KpaVersions(ProcessId);
    CREATE INDEX IX_KpaVersions_ProcessId_CreatedAt ON dbo.KpaVersions(ProcessId, CreatedAt DESC);
END
GO

-- Immutable history of every SOW save. Each PUT to a SOW writes a row here so
-- the whiteboard can list every version that's ever existed and let the user
-- download an older PDF or diff two versions against each other. Versions are
-- never overwritten — newer saves create new rows, never UPDATE existing ones.
IF OBJECT_ID('dbo.SowVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SowVersions (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        ProcessId   INT            NOT NULL,
        Version     NVARCHAR(50)   NOT NULL,
        SowDataJson NVARCHAR(MAX)  NULL,
        SowDocFile  NVARCHAR(500)  NULL,
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   NVARCHAR(255)  NULL,
        CONSTRAINT FK_SowVersions_Process FOREIGN KEY (ProcessId) REFERENCES dbo.ProjectProcesses(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_SowVersions_ProcessId ON dbo.SowVersions(ProcessId);
    CREATE INDEX IX_SowVersions_ProcessId_CreatedAt ON dbo.SowVersions(ProcessId, CreatedAt DESC);
END
GO

-- Reusable SOW templates per company. Each template stores the SOW JSON
-- snapshot (cover defaults, sections, milestone table seed, signatures,
-- etc.) plus a small array of CompanyIds it has been explicitly shared to.
-- Templates are SNAPSHOTTED into a process's SowDataJson when a Scope of
-- Service task picks one — later edits to the template do NOT propagate
-- back to already-created SOWs.
IF OBJECT_ID('dbo.SowTemplates', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SowTemplates (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        OwnerCompanyId INT NOT NULL,
        Name          NVARCHAR(255) NOT NULL,
        Description   NVARCHAR(MAX) NULL,
        IsDefault     BIT NOT NULL DEFAULT 0,
        DataJson      NVARCHAR(MAX) NULL,
        SharedWithCompanyIdsJson NVARCHAR(MAX) NULL,  -- JSON array of CompanyIds
        CreatedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy     NVARCHAR(255) NULL,
        CONSTRAINT FK_SowTemplates_OwnerCompany FOREIGN KEY (OwnerCompanyId)
            REFERENCES dbo.Companies(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_SowTemplates_OwnerCompanyId ON dbo.SowTemplates(OwnerCompanyId);
END
GO

-- Task "kind" for each template — selects which editor opens for a process
-- built from this template. 'sow' = the SOW document editor; 'kpa' = the
-- dedicated KPA-formulation task.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SowTemplates') AND name = 'Kind')
    ALTER TABLE dbo.SowTemplates ADD Kind NVARCHAR(20) NOT NULL DEFAULT 'sow';
GO

-- App-wide settings (key/value), used for the repair coordinator email etc.
-- Default rows are NOT inserted here — they are seeded from db/seed.xlsx.
IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings (
        Id           INT IDENTITY(1,1) PRIMARY KEY,
        SettingKey   NVARCHAR(100)  NOT NULL UNIQUE,
        SettingValue NVARCHAR(500)  NULL,
        UpdatedAt    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- HR / KPI tracker
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'KpiFrequency')
    ALTER TABLE dbo.Companies ADD KpiFrequency NVARCHAR(20) NOT NULL DEFAULT 'Quarterly';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Employees') AND name = 'KpiExempt')
    ALTER TABLE dbo.Employees ADD KpiExempt BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Employees') AND name = 'KpiFrequencyOverride')
    ALTER TABLE dbo.Employees ADD KpiFrequencyOverride NVARCHAR(20) NULL;
GO

IF OBJECT_ID('dbo.KpiSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.KpiSessions (
        Id           INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId   INT            NOT NULL,
        PeriodLabel  NVARCHAR(50)   NOT NULL,
        SessionDate  DATE           NULL,
        DocumentFile NVARCHAR(500)  NULL,
        OriginalName NVARCHAR(500)  NULL,
        Notes        NVARCHAR(MAX)  NULL,
        UploadedBy   NVARCHAR(255)  NULL,
        CreatedAt    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_KpiSessions_Employee FOREIGN KEY (EmployeeId)
            REFERENCES dbo.Employees(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KpiSessions_EmployeeId ON dbo.KpiSessions(EmployeeId);
END
GO

IF OBJECT_ID('dbo.KpiReviews', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.KpiReviews (
        Id                  INT IDENTITY(1,1) PRIMARY KEY,
        CompanyId           INT            NOT NULL,
        EmployeeId          INT            NOT NULL,
        ManagerId           INT            NULL,
        SourceProcessId     INT            NULL,
        PeriodLabel         NVARCHAR(50)   NOT NULL,
        KpiSnapshotJson     NVARCHAR(MAX)  NULL,
        Status              NVARCHAR(30)   NOT NULL DEFAULT 'employee_pending',
        EmployeeRatingsJson NVARCHAR(MAX)  NULL,
        ManagerRatingsJson  NVARCHAR(MAX)  NULL,
        SessionNotesJson    NVARCHAR(MAX)  NULL,
        SessionPasswordHash NVARCHAR(255)  NULL,
        DueDate             DATE           NULL,
        EmployeeSubmittedAt DATETIME2      NULL,
        ManagerSubmittedAt  DATETIME2      NULL,
        UnlockedAt          DATETIME2      NULL,
        ManagerAckAt        DATETIME2      NULL,
        EmployeeAckAt       DATETIME2      NULL,
        CompletedAt         DATETIME2      NULL,
        KpiSessionId        INT            NULL,
        CreatedBy           NVARCHAR(255)  NULL,
        CreatedAt           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt           DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_KpiReviews_Employee FOREIGN KEY (EmployeeId)
            REFERENCES dbo.Employees(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_KpiReviews_CompanyId ON dbo.KpiReviews(CompanyId);
    CREATE INDEX IX_KpiReviews_EmployeeId ON dbo.KpiReviews(EmployeeId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'Anthony')
    CREATE USER [Anthony] FOR LOGIN [Anthony];
GO

ALTER ROLE db_datareader ADD MEMBER [Anthony];
ALTER ROLE db_datawriter ADD MEMBER [Anthony];
GO
