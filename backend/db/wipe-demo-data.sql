-- Removes all demo content (companies + everything cascading off them).
-- Keeps the Users table (login accounts) and the schema itself untouched.
-- Safe to run repeatedly.

USE lancorp;
GO

-- Null FK references that are NO ACTION so cascade delete on Companies can proceed
UPDATE dbo.Assets
SET AssignedEmployeeId     = NULL,
    LastAssignedEmployeeId = NULL;
GO

-- Cascade deletes from Companies wipe Employees, Assets, AssetImages, RepairNotes,
-- RepairRecipients, RepairStageHistory, RepairHistory (+ its sub-tables).
DELETE FROM dbo.Companies;
GO

-- App settings are technically seeded too — wipe so a fresh installation starts clean.
DELETE FROM dbo.AppSettings;
GO

-- Reset identity counters so a re-seed starts at 1 (purely cosmetic).
DBCC CHECKIDENT ('dbo.Companies',           RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.Employees',           RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.Assets',              RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.AssetImages',         RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairNotes',         RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairRecipients',    RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairStageHistory',  RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairHistory',       RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairHistoryNotes',  RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.RepairHistoryStages', RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('dbo.AppSettings',         RESEED, 0) WITH NO_INFOMSGS;
GO

-- Show remaining row counts so you can verify the wipe
SELECT 'Users (kept)' AS table_name, COUNT(*) AS row_count FROM dbo.Users
UNION ALL SELECT 'Companies',           COUNT(*) FROM dbo.Companies
UNION ALL SELECT 'Employees',           COUNT(*) FROM dbo.Employees
UNION ALL SELECT 'Assets',              COUNT(*) FROM dbo.Assets
UNION ALL SELECT 'AssetImages',         COUNT(*) FROM dbo.AssetImages
UNION ALL SELECT 'RepairNotes',         COUNT(*) FROM dbo.RepairNotes
UNION ALL SELECT 'RepairRecipients',    COUNT(*) FROM dbo.RepairRecipients
UNION ALL SELECT 'RepairStageHistory',  COUNT(*) FROM dbo.RepairStageHistory
UNION ALL SELECT 'RepairHistory',       COUNT(*) FROM dbo.RepairHistory
UNION ALL SELECT 'RepairHistoryNotes',  COUNT(*) FROM dbo.RepairHistoryNotes
UNION ALL SELECT 'RepairHistoryStages', COUNT(*) FROM dbo.RepairHistoryStages
UNION ALL SELECT 'AppSettings',         COUNT(*) FROM dbo.AppSettings;
GO
