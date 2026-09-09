-- Apply with a privileged login (SSMS as sa, or sqlcmd -E -C).
-- Idempotent — safe to run more than once.

USE lancorp;
GO

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
