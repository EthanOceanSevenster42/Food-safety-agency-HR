-- Apply with a privileged login (SSMS as sa, or sqlcmd -E -C).
-- Idempotent.

USE lancorp;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'KpidocDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD KpidocDataJson NVARCHAR(MAX) NULL;
GO

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
