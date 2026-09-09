-- MySQL translation of schema.sql for local development.
-- Includes every column/table the SQL Server runtime migrations (old
-- src/db.js RUNTIME_MIGRATIONS) added, so tables are created in their
-- final shape and no runtime DDL is needed.
-- Apply with: node scripts/apply-mysql-schema.js (from backend/)

CREATE DATABASE IF NOT EXISTS lancorp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lancorp;

CREATE TABLE IF NOT EXISTS Users (
    Id            INT AUTO_INCREMENT PRIMARY KEY,
    Email         VARCHAR(255) NOT NULL UNIQUE,
    PasswordHash  VARCHAR(255) NOT NULL,
    DisplayName   VARCHAR(255) NULL,
    Role          VARCHAR(50)  NOT NULL DEFAULT 'user',
    -- Per-page permission map (JSON) for standard accounts; NULL for
    -- superadmin/admin (= full access). Parsed in JS (access.js).
    Permissions   LONGTEXT     NULL,
    IsActive      TINYINT(1)   NOT NULL DEFAULT 1,
    EmployeeId    INT          NULL,
    InviteToken   VARCHAR(64)  NULL,
    InviteExpires DATETIME(6)  NULL,
    CreatedAt     DATETIME(6)  NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt     DATETIME(6)  NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Companies (
    Id                      INT AUTO_INCREMENT PRIMARY KEY,
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
    SowUppercaseCompanyName TINYINT(1) NULL,
    DocH1AllCaps            TINYINT(1) NULL,
    DocH2AllCaps            TINYINT(1) NULL,
    DocH3AllCaps            TINYINT(1) NULL,
    DocLandscapeHeaderFile  VARCHAR(500) NULL,
    DocLandscapeFooterFile  VARCHAR(500) NULL,
    SowProviderName         VARCHAR(255) NULL,
    SowProviderDesignation  VARCHAR(255) NULL,
    SowProviderLocation     VARCHAR(500) NULL,
    CoreValuesJson          LONGTEXT NULL,
    CompanyFacetsJson       LONGTEXT NULL,
    DocBannerSideMargin     TINYINT(1) NOT NULL DEFAULT 0,
    DocHeaderSideMargin     TINYINT(1) NOT NULL DEFAULT 0,
    DocFooterSideMargin     TINYINT(1) NOT NULL DEFAULT 0,
    DocSectionSeparator     TINYINT(1) NOT NULL DEFAULT 1,
    DocPageNumberPosition   VARCHAR(10) NOT NULL DEFAULT 'bottom',
    DocFooterPlacement      VARCHAR(10) NOT NULL DEFAULT 'all',
    DocHeaderPlacement      VARCHAR(10) NOT NULL DEFAULT 'first',
    KpiFrequency            VARCHAR(20) NOT NULL DEFAULT 'Quarterly',
    CreatedAt               DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt               DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Employees (
    Id                   INT AUTO_INCREMENT PRIMARY KEY,
    CompanyId            INT NOT NULL,
    Name                 VARCHAR(255) NOT NULL,
    Title                VARCHAR(255) NULL,
    Email                VARCHAR(255) NULL,
    ManagerId            INT NULL,
    Department           VARCHAR(255) NULL,
    KpiExempt            TINYINT(1) NOT NULL DEFAULT 0,
    KpiFrequencyOverride VARCHAR(20) NULL,
    CreatedAt            DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt            DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_Employees_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Employees_Manager FOREIGN KEY (ManagerId) REFERENCES Employees(Id),
    INDEX IX_Employees_CompanyId (CompanyId),
    INDEX IX_Employees_ManagerId (ManagerId)
) ENGINE=InnoDB;

-- Matrix reporting: additional managers beyond an employee's primary
-- ManagerId. An employee's "allocated managers" = primary + every row here.
CREATE TABLE IF NOT EXISTS EmployeeManagers (
    EmployeeId INT NOT NULL,
    ManagerId  INT NOT NULL,
    CreatedAt  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (EmployeeId, ManagerId),
    CONSTRAINT FK_EmpMgr_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE,
    CONSTRAINT FK_EmpMgr_Manager  FOREIGN KEY (ManagerId)  REFERENCES Employees(Id),
    CONSTRAINT CK_EmpMgr_NotSelf  CHECK (EmployeeId <> ManagerId),
    INDEX IX_EmployeeManagers_ManagerId (ManagerId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Assets (
    Id                         INT AUTO_INCREMENT PRIMARY KEY,
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
    Notes                      LONGTEXT NULL,
    AssignedEmployeeId         INT NULL,
    LastAssignedEmployeeId     INT NULL,
    IsInRepairs                TINYINT(1) NOT NULL DEFAULT 0,
    RepairStage                VARCHAR(50) NULL,
    RepairProblem              LONGTEXT NULL,
    RepairSupplier             VARCHAR(255) NULL,
    RepairBookedInAt           DATETIME(6) NULL,
    RepairDocketFile           VARCHAR(500) NULL,
    CreatedAt                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_Assets_Company  FOREIGN KEY (CompanyId)          REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Assets_Employee FOREIGN KEY (AssignedEmployeeId) REFERENCES Employees(Id),
    INDEX IX_Assets_CompanyId (CompanyId),
    INDEX IX_Assets_AssignedEmployeeId (AssignedEmployeeId),
    INDEX IX_Assets_Category (Category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairStageHistory (
    Id         INT AUTO_INCREMENT PRIMARY KEY,
    AssetId    INT NOT NULL,
    Stage      VARCHAR(50) NOT NULL,
    EnteredAt  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    ActorEmail VARCHAR(255) NULL,
    CONSTRAINT FK_RepairStageHistory_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE,
    INDEX IX_RepairStageHistory_AssetId (AssetId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairHistory (
    Id                INT AUTO_INCREMENT PRIMARY KEY,
    AssetId           INT NOT NULL,
    Reference         VARCHAR(100) NULL,
    Problem           LONGTEXT NULL,
    Supplier          VARCHAR(255) NULL,
    OwnerEmployeeId   INT NULL,
    OwnerNameSnapshot VARCHAR(255) NULL,
    BookedInAt        DATETIME(6) NULL,
    ResolvedAt        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    ResolvedBy        VARCHAR(255) NULL,
    DocketFile        VARCHAR(500) NULL,
    CONSTRAINT FK_RepairHistory_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE,
    INDEX IX_RepairHistory_AssetId (AssetId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairHistoryNotes (
    Id              INT AUTO_INCREMENT PRIMARY KEY,
    RepairHistoryId INT NOT NULL,
    Author          VARCHAR(255) NULL,
    Message         LONGTEXT NOT NULL,
    CreatedAt       DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_RepairHistoryNotes_Hist FOREIGN KEY (RepairHistoryId) REFERENCES RepairHistory(Id) ON DELETE CASCADE,
    INDEX IX_RepairHistoryNotes_HistId (RepairHistoryId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairHistoryStages (
    Id              INT AUTO_INCREMENT PRIMARY KEY,
    RepairHistoryId INT NOT NULL,
    Stage           VARCHAR(50) NOT NULL,
    EnteredAt       DATETIME(6) NOT NULL,
    ActorEmail      VARCHAR(255) NULL,
    CONSTRAINT FK_RepairHistoryStages_Hist FOREIGN KEY (RepairHistoryId) REFERENCES RepairHistory(Id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairNotes (
    Id        INT AUTO_INCREMENT PRIMARY KEY,
    AssetId   INT NOT NULL,
    Author    VARCHAR(255) NULL,
    Message   LONGTEXT NOT NULL,
    CreatedAt DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_RepairNotes_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE,
    INDEX IX_RepairNotes_AssetId (AssetId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS RepairRecipients (
    Id        INT AUTO_INCREMENT PRIMARY KEY,
    AssetId   INT NOT NULL,
    Email     VARCHAR(255) NOT NULL,
    CreatedAt DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_RepairRecipients_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE,
    INDEX IX_RepairRecipients_AssetId (AssetId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS AssetImages (
    Id           INT AUTO_INCREMENT PRIMARY KEY,
    AssetId      INT NOT NULL,
    FileName     VARCHAR(500) NOT NULL,
    OriginalName VARCHAR(500) NULL,
    CreatedAt    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_AssetImages_Asset FOREIGN KEY (AssetId) REFERENCES Assets(Id) ON DELETE CASCADE,
    INDEX IX_AssetImages_AssetId (AssetId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS CategoryDefaults (
    Id                         INT AUTO_INCREMENT PRIMARY KEY,
    CompanyId                  INT NOT NULL,
    Category                   VARCHAR(100) NOT NULL,
    DepreciationPercentPerYear DECIMAL(5,2) NULL,
    UsefulLifeYears            INT NULL,
    CreatedAt                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt                  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_CategoryDefaults_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_CategoryDefaults_CompanyCategory UNIQUE (CompanyId, Category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Projects (
    Id          INT AUTO_INCREMENT PRIMARY KEY,
    CompanyId   INT NOT NULL,
    Name        VARCHAR(255) NOT NULL,
    Description LONGTEXT NULL,
    Color       VARCHAR(20) NULL,
    CreatedBy   VARCHAR(255) NULL,
    CompletedAt DATETIME(6) NULL,
    Department  VARCHAR(50) NOT NULL DEFAULT 'Procurement',
    CreatedAt   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_Projects_Company FOREIGN KEY (CompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    INDEX IX_Projects_CompanyId (CompanyId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ProjectProcesses (
    Id               INT AUTO_INCREMENT PRIMARY KEY,
    ProjectId        INT NOT NULL,
    Name             VARCHAR(255) NOT NULL,
    Description      LONGTEXT NULL,
    Color            VARCHAR(20) NULL,
    PositionX        DOUBLE NOT NULL DEFAULT 0,
    PositionY        DOUBLE NOT NULL DEFAULT 0,
    SowDataJson      LONGTEXT NULL,
    SowDocFile       VARCHAR(500) NULL,
    Kind             VARCHAR(20) NOT NULL DEFAULT 'sow',
    EmployeeId       INT NULL,
    KpaDataJson      LONGTEXT NULL,
    JdDataJson       LONGTEXT NULL,
    EdpDataJson      LONGTEXT NULL,
    KpidocDataJson   LONGTEXT NULL,
    SourceTemplateId INT NULL,
    CreatedAt        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_ProjectProcesses_Project FOREIGN KEY (ProjectId) REFERENCES Projects(Id) ON DELETE CASCADE,
    INDEX IX_ProjectProcesses_ProjectId (ProjectId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS SowVersions (
    Id            INT AUTO_INCREMENT PRIMARY KEY,
    ProcessId     INT NOT NULL,
    Version       VARCHAR(50) NOT NULL,
    SowDataJson   LONGTEXT NULL,
    SowDocFile    VARCHAR(500) NULL,
    SignedDocFile VARCHAR(500) NULL,
    CreatedAt     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy     VARCHAR(255) NULL,
    CONSTRAINT FK_SowVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE,
    INDEX IX_SowVersions_ProcessId (ProcessId),
    INDEX IX_SowVersions_ProcessId_CreatedAt (ProcessId, CreatedAt DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS KpaVersions (
    Id          INT AUTO_INCREMENT PRIMARY KEY,
    ProcessId   INT NOT NULL,
    Version     VARCHAR(50) NOT NULL,
    KpaDataJson LONGTEXT NULL,
    EmployeeId  INT NULL,
    CreatedAt   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy   VARCHAR(255) NULL,
    CONSTRAINT FK_KpaVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE,
    INDEX IX_KpaVersions_ProcessId (ProcessId),
    INDEX IX_KpaVersions_ProcessId_CreatedAt (ProcessId, CreatedAt DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS JdVersions (
    Id         INT AUTO_INCREMENT PRIMARY KEY,
    ProcessId  INT NOT NULL,
    Version    VARCHAR(50) NOT NULL,
    JdDataJson LONGTEXT NULL,
    CreatedAt  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy  VARCHAR(255) NULL,
    CONSTRAINT FK_JdVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE,
    INDEX IX_JdVersions_ProcessId (ProcessId),
    INDEX IX_JdVersions_ProcessId_CreatedAt (ProcessId, CreatedAt DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS EdpVersions (
    Id          INT AUTO_INCREMENT PRIMARY KEY,
    ProcessId   INT NOT NULL,
    Version     VARCHAR(50) NOT NULL,
    EdpDataJson LONGTEXT NULL,
    CreatedAt   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy   VARCHAR(255) NULL,
    CONSTRAINT FK_EdpVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE,
    INDEX IX_EdpVersions_ProcessId (ProcessId),
    INDEX IX_EdpVersions_ProcessId_CreatedAt (ProcessId, CreatedAt DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS KpidocVersions (
    Id             INT AUTO_INCREMENT PRIMARY KEY,
    ProcessId      INT NOT NULL,
    Version        VARCHAR(50) NOT NULL,
    KpidocDataJson LONGTEXT NULL,
    CreatedAt      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy      VARCHAR(255) NULL,
    CONSTRAINT FK_KpidocVersions_Process FOREIGN KEY (ProcessId) REFERENCES ProjectProcesses(Id) ON DELETE CASCADE,
    INDEX IX_KpidocVersions_ProcessId (ProcessId),
    INDEX IX_KpidocVersions_ProcessId_CreatedAt (ProcessId, CreatedAt DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS SowTemplates (
    Id                       INT AUTO_INCREMENT PRIMARY KEY,
    OwnerCompanyId           INT NOT NULL,
    Name                     VARCHAR(255) NOT NULL,
    Description              LONGTEXT NULL,
    IsDefault                TINYINT(1) NOT NULL DEFAULT 0,
    DataJson                 LONGTEXT NULL,
    SharedWithCompanyIdsJson LONGTEXT NULL,
    Kind                     VARCHAR(20) NOT NULL DEFAULT 'sow',
    Department               VARCHAR(50) NOT NULL DEFAULT 'Procurement',
    NextTemplateIdsJson      LONGTEXT NULL,
    NextStepsJson            LONGTEXT NULL,
    CreatedAt                DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt                DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CreatedBy                VARCHAR(255) NULL,
    CONSTRAINT FK_SowTemplates_OwnerCompany FOREIGN KEY (OwnerCompanyId) REFERENCES Companies(Id) ON DELETE CASCADE,
    INDEX IX_SowTemplates_OwnerCompanyId (OwnerCompanyId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS AppSettings (
    Id           INT AUTO_INCREMENT PRIMARY KEY,
    SettingKey   VARCHAR(100) NOT NULL UNIQUE,
    SettingValue VARCHAR(500) NULL,
    UpdatedAt    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS KpiSessions (
    Id           INT AUTO_INCREMENT PRIMARY KEY,
    EmployeeId   INT NOT NULL,
    PeriodLabel  VARCHAR(50) NOT NULL,
    SessionDate  DATE NULL,
    DocumentFile VARCHAR(500) NULL,
    OriginalName VARCHAR(500) NULL,
    Notes        LONGTEXT NULL,
    UploadedBy   VARCHAR(255) NULL,
    CreatedAt    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_KpiSessions_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE,
    INDEX IX_KpiSessions_EmployeeId (EmployeeId)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS KpiReviews (
    Id                  INT AUTO_INCREMENT PRIMARY KEY,
    CompanyId           INT NOT NULL,
    EmployeeId          INT NOT NULL,
    ManagerId           INT NULL,
    SourceProcessId     INT NULL,
    PeriodLabel         VARCHAR(50) NOT NULL,
    KpiSnapshotJson     LONGTEXT NULL,
    Status              VARCHAR(30) NOT NULL DEFAULT 'employee_pending',
    EmployeeRatingsJson LONGTEXT NULL,
    ManagerRatingsJson  LONGTEXT NULL,
    SessionNotesJson    LONGTEXT NULL,
    SessionPasswordHash VARCHAR(255) NULL,
    DueDate             DATE NULL,
    EmployeeSubmittedAt DATETIME(6) NULL,
    ManagerSubmittedAt  DATETIME(6) NULL,
    UnlockedAt          DATETIME(6) NULL,
    ManagerAckAt        DATETIME(6) NULL,
    EmployeeAckAt       DATETIME(6) NULL,
    CompletedAt         DATETIME(6) NULL,
    KpiSessionId        INT NULL,
    CreatedBy           VARCHAR(255) NULL,
    CreatedAt           DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UpdatedAt           DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT FK_KpiReviews_Employee FOREIGN KEY (EmployeeId) REFERENCES Employees(Id) ON DELETE CASCADE,
    INDEX IX_KpiReviews_CompanyId (CompanyId),
    INDEX IX_KpiReviews_EmployeeId (EmployeeId)
) ENGINE=InnoDB;
