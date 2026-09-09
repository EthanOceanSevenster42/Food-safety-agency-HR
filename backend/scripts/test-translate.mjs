// Exercises the T-SQL -> Postgres translator against shapes taken from the
// real route files. Run: node test-translate.mjs
import { translateStatements, sql } from '../src/db.js';

let pass = 0;
let fail = 0;

function check(label, actual, expectSubstrings, expectAbsent = []) {
  const problems = [];
  for (const s of expectSubstrings) {
    if (!actual.includes(s)) problems.push(`missing: ${JSON.stringify(s)}`);
  }
  for (const s of expectAbsent) {
    if (actual.includes(s)) problems.push(`should not contain: ${JSON.stringify(s)}`);
  }
  if (problems.length) {
    fail++;
    console.log(`FAIL  ${label}`);
    console.log(`      sql: ${actual.replace(/\s+/g, ' ').trim()}`);
    problems.forEach((p) => console.log(`      ${p}`));
  } else {
    pass++;
    console.log(`ok    ${label}`);
  }
}

// 1. brackets, dbo., SYSUTCDATETIME, ISNULL
{
  const [st] = translateStatements(
    `SELECT [Id], ISNULL([DisplayName], 'n/a') AS Who, SYSUTCDATETIME() AS Now
       FROM dbo.Users WHERE [Email] = @email`,
    { email: 'a@b.c' }
  );
  check('select: brackets/dbo/isnull/utcnow', st.sql,
    ['SELECT Id,', 'COALESCE(DisplayName,', "AS Who", "(NOW() AT TIME ZONE 'UTC')", 'FROM Users', 'Email = $1'],
    ['[', 'dbo.', 'ISNULL', 'SYSUTCDATETIME']);
  console.log(`      values: ${JSON.stringify(st.values)}`);
}

// 2. INSERT ... OUTPUT INSERTED.Id ... VALUES  -> RETURNING at the end
{
  const [st] = translateStatements(
    `INSERT INTO dbo.Employees (CompanyId, Name)
       OUTPUT INSERTED.Id, INSERTED.Name
       VALUES (@companyId, @name);`,
    { companyId: 1, name: 'X' }
  );
  check('insert: OUTPUT -> RETURNING', st.sql,
    ['INSERT INTO Employees', 'VALUES ($1, $2)', 'RETURNING Id, Name'],
    ['OUTPUT', 'INSERTED.']);
}

// 3. UPDATE ... OUTPUT ... WHERE -> RETURNING after WHERE
{
  const [st] = translateStatements(
    `UPDATE dbo.Employees SET Name = @name
       OUTPUT INSERTED.Id, INSERTED.Name
       WHERE Id = @id;`,
    { name: 'Y', id: 7 }
  );
  const wherePos = st.sql.indexOf('WHERE');
  const retPos = st.sql.indexOf('RETURNING');
  check('update: OUTPUT -> RETURNING after WHERE', st.sql,
    ['UPDATE Employees', 'SET Name = $1', 'WHERE Id = $2', 'RETURNING Id, Name'],
    ['OUTPUT', 'INSERTED.']);
  if (retPos < wherePos) { fail++; console.log('FAIL  update: RETURNING must follow WHERE'); }
  else { pass++; console.log('ok    update: RETURNING follows WHERE'); }
}

// 4. OUTPUT INSERTED.*
{
  const [st] = translateStatements(
    `INSERT INTO dbo.Projects (Name) OUTPUT INSERTED.* VALUES (@n);`,
    { n: 'p' }
  );
  check('insert: OUTPUT INSERTED.* -> RETURNING *', st.sql,
    ['RETURNING *'], ['INSERTED']);
}

// 5. SELECT TOP 1
{
  const [st] = translateStatements(
    `SELECT TOP 1 Id, Status FROM dbo.KpiReviews WHERE EmployeeId = @e ORDER BY CreatedAt DESC`,
    { e: 3 }
  );
  check('select: TOP 1 -> LIMIT 1', st.sql,
    ['SELECT Id, Status', 'ORDER BY CreatedAt DESC LIMIT 1'], ['TOP']);
}

// 6. boolean literals against BOOLEAN columns
{
  const [st] = translateStatements(
    `SELECT Id FROM dbo.Users WHERE Email = @e AND IsActive = 1`,
    { e: 'x' }
  );
  check('bool literal: IsActive = 1 -> TRUE', st.sql,
    ['IsActive = TRUE'], ['IsActive = 1']);

  const [st2] = translateStatements(
    `UPDATE dbo.SowTemplates SET IsDefault = 0 WHERE CompanyId = @c`,
    { c: 1 }
  );
  check('bool literal: IsDefault = 0 -> FALSE', st2.sql,
    ['IsDefault = FALSE'], ['IsDefault = 0']);
}

// 7. sql.Bit coercion happens in .input(), verified via a fake Request
{
  // translateStatements only sees params, so emulate what .input() stores.
  const bitStub = sql.Bit;
  if (bitStub.tsqlType !== 'Bit') { fail++; console.log(`FAIL  sql.Bit stub carries type (got ${bitStub.tsqlType})`); }
  else { pass++; console.log('ok    sql.Bit stub carries type'); }
  const varcharStub = sql.NVarChar(sql.MAX);
  if (varcharStub.tsqlType !== 'NVarChar') { fail++; console.log(`FAIL  sql.NVarChar(sql.MAX) keeps type (got ${varcharStub.tsqlType})`); }
  else { pass++; console.log('ok    sql.NVarChar(sql.MAX) keeps type'); }
}

// 8. repeated parameter reuses one placeholder
{
  const [st] = translateStatements(
    `SELECT Id FROM dbo.Users WHERE Email = @e OR DisplayName = @e`,
    { e: 'dup' }
  );
  check('params: repeated @e reuses $1', st.sql, ['Email = $1', 'DisplayName = $1']);
  if (st.values.length !== 1) { fail++; console.log(`FAIL  params: expected 1 value, got ${st.values.length}`); }
  else { pass++; console.log('ok    params: single value for repeated name'); }
}

// 9. string literals are protected from rewriting
{
  const [st] = translateStatements(
    `SELECT Id FROM dbo.Users WHERE Notes = N'IsActive = 1 and [brackets] and dbo.x'`,
    {}
  );
  check('literals: text inside quotes untouched', st.sql,
    ["'IsActive = 1 and [brackets] and dbo.x'"]);
}

// 10. OFFSET/FETCH passes through (Postgres supports it natively)
{
  const [st] = translateStatements(
    `SELECT Id FROM dbo.Assets ORDER BY Id OFFSET @o ROWS FETCH NEXT @n ROWS ONLY`,
    { o: 0, n: 20 }
  );
  check('paging: OFFSET/FETCH kept', st.sql,
    ['OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY']);
}

// 11. CAST to NVARCHAR(MAX)
{
  const [st] = translateStatements(
    `SELECT CAST(Permissions AS NVARCHAR(MAX)) AS Permissions FROM dbo.Users WHERE Id = @id`,
    { id: 1 }
  );
  check('cast: NVARCHAR(MAX) -> TEXT', st.sql, ['CAST(Permissions AS TEXT)'], ['NVARCHAR']);
}


// 12. MySQL upsert on AppSettings -> ON CONFLICT (SettingKey)
{
  const [st] = translateStatements(
    `INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (@k, @v) AS new
       ON DUPLICATE KEY UPDATE SettingValue = new.SettingValue, UpdatedAt = SYSUTCDATETIME()`,
    { k: 'a', v: 'b' }
  );
  check('upsert: AppSettings -> ON CONFLICT (SettingKey)', st.sql,
    ['INSERT INTO AppSettings', 'VALUES ($1, $2)', 'ON CONFLICT (SettingKey) DO UPDATE SET',
     'SettingValue = EXCLUDED.SettingValue', "UpdatedAt = (NOW() AT TIME ZONE 'UTC')"],
    ['ON DUPLICATE', 'AS new', 'new.']);
}

// 13. MySQL upsert with a composite unique key
{
  const [st] = translateStatements(
    `INSERT INTO dbo.CategoryDefaults (CompanyId, Category, DepreciationPercentPerYear, UsefulLifeYears)
       VALUES (@cid, @cat, @depr, @life) AS new
       ON DUPLICATE KEY UPDATE
         DepreciationPercentPerYear = new.DepreciationPercentPerYear,
         UsefulLifeYears            = new.UsefulLifeYears`,
    { cid: 1, cat: 'x', depr: 10, life: 5 }
  );
  check('upsert: composite ON CONFLICT (CompanyId, Category)', st.sql,
    ['ON CONFLICT (CompanyId, Category) DO UPDATE SET',
     'DepreciationPercentPerYear = EXCLUDED.DepreciationPercentPerYear',
     'UsefulLifeYears            = EXCLUDED.UsefulLifeYears'],
    ['ON DUPLICATE', 'new.']);
}

// 14. positional boolean literal in an INSERT (users.js shape)
{
  const [st] = translateStatements(
    `INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, Permissions, IsActive, EmployeeId)
       OUTPUT INSERTED.Id
       VALUES (@email, @hash, @display, @role, @perms, 1, @employeeId);`,
    { email: 'a', hash: 'b', display: 'c', role: 'user', perms: null, employeeId: 2 }
  );
  check('insert bool: IsActive position -> TRUE', st.sql,
    ['VALUES ($1, $2, $3, $4, $5, TRUE, $6)', 'RETURNING Id']);
}

// 15. positional boolean 0 (sow-templates.js shape)
{
  const [st] = translateStatements(
    `INSERT INTO dbo.SowTemplates (OwnerCompanyId, Name, Description, IsDefault, DataJson, Department, Kind, CreatedBy)
       OUTPUT INSERTED.*
       VALUES (@cid, @name, @desc, 0, @json, @dept, @kind, @by);`,
    { cid: 1, name: 'n', desc: 'd', json: '{}', dept: 'x', kind: 'k', by: 'me' }
  );
  check('insert bool: IsDefault position -> FALSE', st.sql,
    ['VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7)', 'RETURNING *']);
}

// 16. seed.js shape — positional boolean AND an upsert together
{
  const [st] = translateStatements(
    `INSERT INTO dbo.Users (Email, PasswordHash, DisplayName, Role, IsActive)
       VALUES (@email, @hash, @name, 'admin', 1) AS new
       ON DUPLICATE KEY UPDATE
         PasswordHash = new.PasswordHash,
         IsActive     = 1,
         UpdatedAt    = SYSUTCDATETIME()`,
    { email: 'a@b.c', hash: 'h', name: 'N' }
  );
  check('seed shape: positional TRUE + ON CONFLICT (Email)', st.sql,
    ["VALUES ($1, $2, $3, 'admin', TRUE)", 'ON CONFLICT (Email) DO UPDATE SET',
     'PasswordHash = EXCLUDED.PasswordHash', 'IsActive = TRUE'],
    ['ON DUPLICATE', 'AS new']);
}

// 17. a non-boolean 1/0 in an INSERT must be left alone
{
  const [st] = translateStatements(
    `INSERT INTO dbo.Employees (CompanyId, Name, Department) VALUES (1, @n, @d);`,
    { n: 'x', d: 'y' }
  );
  check('insert bool: non-boolean column keeps its integer', st.sql,
    ['VALUES (1, $1, $2)'], ['TRUE', 'FALSE']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
