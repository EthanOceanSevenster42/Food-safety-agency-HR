-- Matrix reporting: an employee can report to more than one manager.
-- Adds dbo.EmployeeManagers holding the ADDITIONAL managers beyond the
-- employee's primary manager (dbo.Employees.ManagerId). An employee's
-- "allocated managers" = the primary manager plus every row here.
--
-- Apply as a privileged login (the app login lacks DDL rights), e.g.:
--   sqlcmd -S localhost -d lancorp -E -i db/migrate-managers.sql

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
    PRINT 'Created dbo.EmployeeManagers.';
END
ELSE
    PRINT 'dbo.EmployeeManagers already exists.';
GO
