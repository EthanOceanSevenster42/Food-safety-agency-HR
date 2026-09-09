-- Apply with a privileged login (SSMS as sa, or sqlcmd -E).
-- Idempotent — safe to run more than once.
-- After this completes, no backend restart is needed: Anthony's
-- SELECT/INSERT/UPDATE routes already reference the new columns
-- through defensive secondary queries that no-op when absent.

USE lancorp;
GO

-- Per-company list of core values (e.g. "Integrity").
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'CoreValuesJson')
    ALTER TABLE dbo.Companies ADD CoreValuesJson NVARCHAR(MAX) NULL;
GO

-- Per-company list of departments / facets (e.g. "Operations").
-- Drives the department dropdown in the KPA-formulation task.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'CompanyFacetsJson')
    ALTER TABLE dbo.Companies ADD CompanyFacetsJson NVARCHAR(MAX) NULL;
GO

-- Task kind on each template: 'sow' (SOW document editor) or 'kpa'
-- (KPA-formulation editor). Default 'sow' keeps existing templates intact.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SowTemplates') AND name = 'Kind')
    ALTER TABLE dbo.SowTemplates ADD Kind NVARCHAR(20) NOT NULL DEFAULT 'sow';
GO

-- Task kind on each process — inherited from the source template.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'Kind')
    ALTER TABLE dbo.ProjectProcesses ADD Kind NVARCHAR(20) NOT NULL DEFAULT 'sow';
GO

-- Employee a KPA-kind process is for. Null for SOW processes. Left as an
-- unenforced soft reference (no FK) because Companies already cascades
-- through both Employees and Projects → ProjectProcesses, which means a
-- second cascade path from Employees would trigger SQL Server's
-- multi-cascade-path block. Application code is responsible for clearing
-- this when an employee is deleted.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'EmployeeId')
    ALTER TABLE dbo.ProjectProcesses ADD EmployeeId INT NULL;
GO

-- KPA payload for a KPA-kind process: JSON array of
-- { name, department, weight }.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProjectProcesses') AND name = 'KpaDataJson')
    ALTER TABLE dbo.ProjectProcesses ADD KpaDataJson NVARCHAR(MAX) NULL;
GO
