USE lancorp;
GO

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
