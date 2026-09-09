-- Apply with a privileged login (SSMS as sa, or sqlcmd -E -C).
-- Idempotent — safe to run more than once.

USE lancorp;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'EdpDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD EdpDataJson NVARCHAR(MAX) NULL;
GO

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
