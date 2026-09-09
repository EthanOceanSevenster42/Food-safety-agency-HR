// PostgreSQL adapter exposing the same surface the routes were written against
// (the `mssql` package): getPool() → pool.request().input(...).query(...)
// returning { recordset, recordsets, rowsAffected }. Queries throughout the
// codebase are T-SQL; translateStatements() rewrites them to Postgres at
// runtime so the route files stay untouched.
//
// Two Postgres-specific concerns are handled here:
//   * Identifiers. The schema is created unquoted, so Postgres folds every
//     table/column name to lower case and result keys arrive lowered. Rows are
//     run through COLUMN_CASE to restore the PascalCase the JS code reads.
//   * Booleans. BIT columns became real BOOLEAN columns, but the route SQL
//     still writes `IsActive = 1`, which Postgres rejects. Integer literals
//     compared against known boolean columns are rewritten to TRUE/FALSE, and
//     values bound as sql.Bit are coerced to real booleans.
import pg from 'pg';
import { COLUMN_CASE, BOOLEAN_COLUMNS, UNIQUE_KEYS } from './pg-colmap.js';

// mssql handed back JS numbers for DECIMAL/BIGINT; node-postgres defaults to
// strings to avoid precision loss. Match the old behaviour so callers that do
// arithmetic on these keep working.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
// DATE is a calendar day, not an instant. Parsing it into a JS Date puts it at
// local midnight, which then serialises to the previous day in UTC — so hand
// date-only columns back as the plain 'YYYY-MM-DD' string they already are.
pg.types.setTypeParser(1082, (v) => v); // date

// ---------------------------------------------------------------------------
// `sql` type stubs — routes pass sql.Int / sql.NVarChar(255) / sql.Bit etc.
// Postgres placeholders don't need types, but the stub remembers which T-SQL
// type was asked for so .input() can coerce sql.Bit values to booleans.
// ---------------------------------------------------------------------------
function makeTypeStub(typeName) {
  const target = function () {};
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'tsqlType') return typeName;
      if (prop === Symbol.toPrimitive) return () => 'sqltype';
      // sql.NVarChar.MAX and friends keep the outer type name.
      return makeTypeStub(typeName);
    },
    // sql.NVarChar(255) → still an NVarChar stub.
    apply: () => makeTypeStub(typeName),
  });
}

export const sql = new Proxy({}, { get: (_t, prop) => makeTypeStub(String(prop)) });

// ---------------------------------------------------------------------------
// T-SQL → PostgreSQL translation
// ---------------------------------------------------------------------------

// Masks '…' string literals (with '' escapes) so keyword/param rewrites can't
// touch text inside quotes. Returns masked text + the literals to restore.
function maskStrings(text) {
  const literals = [];
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "'") { out += text[i]; continue; }
    let j = i + 1;
    while (j < text.length) {
      if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
      if (text[j] === "'") break;
      j++;
    }
    literals.push(text.slice(i, j + 1));
    out += `\x01${literals.length - 1}\x02`;
    i = j;
  }
  return { masked: out, literals };
}

const unmask = (masked, literals) =>
  masked.replace(/\x01(\d+)\x02/g, (_, n) => literals[Number(n)]);

// SELECT TOP n → LIMIT n at the end of that SELECT's scope (end of statement,
// or just before the closing paren of the subquery it lives in).
function rewriteTop(masked) {
  const matches = [...masked.matchAll(/\bSELECT(\s+DISTINCT)?\s+TOP\s+\(?(\d+)\)?/gi)];
  for (let k = matches.length - 1; k >= 0; k--) {
    const m = matches[k];
    const head = `SELECT${m[1] || ''} `;
    const afterTop = m.index + m[0].length;
    let depth = 0;
    let end = masked.length;
    for (let i = afterTop; i < masked.length; i++) {
      const c = masked[i];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) { end = i; break; }
        depth--;
      } else if (c === ';' && depth === 0) { end = i; break; }
    }
    masked =
      masked.slice(0, m.index) +
      head +
      masked.slice(afterTop, end).trim() +
      ` LIMIT ${m[2]}` +
      masked.slice(end);
  }
  return masked;
}

// OUTPUT INSERTED.a, INSERTED.b → RETURNING a, b appended to the statement.
// Postgres allows RETURNING on INSERT/UPDATE/DELETE, so unlike the MySQL port
// this stays a single statement.
function rewriteOutput(masked) {
  const outMatch = /\bOUTPUT\b/i.exec(masked);
  if (!outMatch) return masked;

  const afterOutput = masked.slice(outMatch.index + outMatch[0].length);
  const endMatch = /\b(VALUES|WHERE|SELECT|FROM)\b/i.exec(afterOutput);
  const listEnd = endMatch ? endMatch.index : afterOutput.length;
  const cols = afterOutput
    .slice(0, listEnd)
    .replace(/\b(INSERTED|DELETED)\./gi, '')
    .trim()
    .replace(/,\s*$/, '');
  const tail = afterOutput.slice(listEnd);
  const base = (masked.slice(0, outMatch.index) + tail).replace(/\s*;\s*$/, '');

  return `${base} RETURNING ${cols}`;
}

const BOOLEAN_COLUMNS_LOWER = new Set([...BOOLEAN_COLUMNS].map((c) => c.toLowerCase()));

// Finds `name( … )` with balanced parentheses and hands the top-level argument
// list to `build`. Used for function rewrites where a flat regex would trip
// over nested calls.
function replaceCall(text, name, build) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'i');
  let out = text;
  for (;;) {
    const m = re.exec(out);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break; // unbalanced — leave it for Postgres to complain about
    const args = splitTopLevel(out.slice(open + 1, end)).map((a) => a.trim());
    out = out.slice(0, m.index) + build(args) + out.slice(end + 1);
  }
  return out;
}

// MySQL JSON helpers → Postgres. `IS JSON` needs Postgres 16+; jsonb `@>`
// tests containment the way JSON_CONTAINS does.
function rewriteJsonFunctions(masked) {
  // CAST(@cid AS JSON) → (@cid)::text::jsonb. Going via text means a bound
  // integer arrives as the JSON number 1 rather than an untyped literal.
  let out = masked.replace(
    /\bCAST\s*\(\s*([^()]+?)\s+AS\s+JSON\s*\)/gi,
    '($1)::text::jsonb'
  );
  out = replaceCall(out, 'JSON_VALID', ([x]) => `(${x} IS JSON)`);
  out = replaceCall(out, 'JSON_CONTAINS', ([a, b]) => `((${a})::jsonb @> (${b}))`);
  return out;
}

// Splits on commas that sit outside any parentheses. String literals are
// already masked, so their commas can't be seen from here.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// `INSERT INTO Users (…, IsActive, …) VALUES (…, 1, …)` — a bare 1/0 in the
// position of a BOOLEAN column. Postgres will not coerce an integer literal to
// boolean, so swap those positions for TRUE/FALSE. Parameterised values are
// left alone; .input() coerces those via the sql.Bit type hint.
function rewriteBooleanInsertValues(stmt) {
  const insert = /\bINSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/i.exec(stmt);
  if (!insert) return stmt;

  const cols = splitTopLevel(insert[2]).map((c) => c.trim());
  const boolPositions = new Set();
  cols.forEach((c, i) => {
    if (BOOLEAN_COLUMNS_LOWER.has(c.toLowerCase())) boolPositions.add(i);
  });
  if (!boolPositions.size) return stmt;

  const valuesKw = /\bVALUES\b/i.exec(stmt.slice(insert.index + insert[0].length));
  if (!valuesKw) return stmt;

  const valuesStart = insert.index + insert[0].length + valuesKw.index + valuesKw[0].length;
  let out = stmt.slice(0, valuesStart);
  const rest = stmt.slice(valuesStart);

  // Walk the tuples that follow VALUES, rewriting each in place and stopping
  // at the first thing that is not another `( … )` tuple.
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /[\s,]/.test(rest[i])) { out += rest[i]; i++; }
    if (rest[i] !== '(') break;

    let depth = 0;
    let end = i;
    for (; end < rest.length; end++) {
      if (rest[end] === '(') depth++;
      else if (rest[end] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break; // unbalanced — leave the remainder untouched

    const inner = rest.slice(i + 1, end);
    const rewritten = splitTopLevel(inner)
      .map((value, idx) => {
        if (!boolPositions.has(idx)) return value;
        return value.replace(/^(\s*)([01])(\s*)$/, (_m, a, digit, b) =>
          `${a}${digit === '1' ? 'TRUE' : 'FALSE'}${b}`
        );
      })
      .join(',');

    out += `(${rewritten})`;
    i = end + 1;
  }

  return out + rest.slice(i);
}

// MySQL upsert → Postgres upsert:
//   INSERT INTO t (…) VALUES (…) AS new
//   ON DUPLICATE KEY UPDATE a = new.a
// becomes
//   INSERT INTO t (…) VALUES (…)
//   ON CONFLICT (<unique cols>) DO UPDATE SET a = EXCLUDED.a
function rewriteUpsert(masked) {
  const dup = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.exec(masked);
  if (!dup) return masked;

  const table = (masked.match(/\bINSERT\s+INTO\s+(\w+)/i) || [])[1];
  const cols = table ? UNIQUE_KEYS[table.toLowerCase()] : undefined;
  if (!cols) {
    throw new Error(
      `ON DUPLICATE KEY UPDATE against "${table ?? '?'}" has no known unique key; ` +
        'add one to the schema and re-run scripts/gen-colmap.mjs'
    );
  }

  let head = masked.slice(0, dup.index);
  let setList = masked.slice(dup.index + dup[0].length);

  // MySQL 8 row alias — "VALUES (…) AS new" — has no Postgres equivalent;
  // drop it and point its references at EXCLUDED instead.
  let alias = 'new';
  const aliasMatch = /\s+AS\s+(\w+)\s*$/i.exec(head);
  if (aliasMatch) {
    alias = aliasMatch[1];
    head = head.slice(0, aliasMatch.index);
  }
  setList = setList.replace(new RegExp(`\\b${alias}\\.`, 'gi'), 'EXCLUDED.');

  return `${head} ON CONFLICT (${cols.join(', ')}) DO UPDATE SET${setList}`;
}

// `IsActive = 1` → `IsActive = TRUE` for columns that are BOOLEAN in Postgres.
function rewriteBooleanLiterals(masked) {
  for (const col of BOOLEAN_COLUMNS) {
    const re = new RegExp(`\\b(${col})\\s*(=|<>|!=)\\s*([01])\\b`, 'gi');
    masked = masked.replace(re, (_m, c, op, digit) =>
      `${c} ${op} ${digit === '1' ? 'TRUE' : 'FALSE'}`
    );
  }
  return masked;
}

export function translateStatements(text, params) {
  let { masked, literals } = maskStrings(text);

  masked = masked
    .replace(/\bN(?=\x01)/g, '')                    // N'…' → '…'
    .replace(/\[(\w+)\]/g, '$1')                    // [Ident] → Ident (folds to lower)
    .replace(/\bdbo\./gi, '')
    .replace(/\bSYSUTCDATETIME\s*\(\s*\)/gi, "(NOW() AT TIME ZONE 'UTC')")
    .replace(/\bGETUTCDATE\s*\(\s*\)/gi, "(NOW() AT TIME ZONE 'UTC')")
    .replace(/\bGETDATE\s*\(\s*\)/gi, 'NOW()')
    .replace(/\bISNULL\s*\(/gi, 'COALESCE(')
    .replace(/\bSCOPE_IDENTITY\s*\(\s*\)/gi, 'LASTVAL()')
    .replace(/AS\s+N?VARCHAR\s*\(\s*(?:MAX|\d+)\s*\)/gi, 'AS TEXT');

  masked = rewriteJsonFunctions(masked);
  masked = rewriteBooleanLiterals(masked);
  masked = rewriteTop(masked);

  // Split on top-level semicolons (string literals are masked), then convert
  // each statement's upsert and OUTPUT clauses.
  const pieces = masked.split(';').map((s) => s.trim()).filter(Boolean);
  const statements = pieces.map((piece) =>
    rewriteOutput(rewriteUpsert(rewriteBooleanInsertValues(piece)))
  );

  // @name → $n. A name used more than once reuses its placeholder, which
  // Postgres allows and keeps the values array aligned.
  return statements.map((stmt) => {
    const values = [];
    const indexByName = new Map();
    const withPlaceholders = stmt.replace(/@(\w+)/g, (_, name) => {
      if (!(name in params)) throw new Error(`Missing SQL parameter @${name}`);
      if (!indexByName.has(name)) {
        values.push(params[name]);
        indexByName.set(name, values.length);
      }
      return `$${indexByName.get(name)}`;
    });
    return { sql: unmask(withPlaceholders, literals), values };
  });
}

// ---------------------------------------------------------------------------
// Pool + mssql-shaped Request
// ---------------------------------------------------------------------------
let poolPromise;
let pgPool;

function createPgPool() {
  return new pg.Pool({
    host: (process.env.DB_SERVER || 'localhost').split('\\')[0],
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'fsa_hr',
    max: 10,
    ssl:
      String(process.env.DB_ENCRYPT).toLowerCase() === 'true'
        ? { rejectUnauthorized: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() !== 'true' }
        : false,
  });
}

// Postgres lower-cases unquoted identifiers, so restore the casing the JS
// expects. Unknown keys (e.g. an alias added without regenerating the map)
// pass through untouched.
function mapRowKeys(row) {
  const out = {};
  for (const key of Object.keys(row)) out[COLUMN_CASE[key] || key] = row[key];
  return out;
}

class Request {
  constructor(pool) {
    this.pool = pool;
    this.params = {};
  }

  // mssql allows .input(name, type, value) and .input(name, value).
  input(name, typeOrValue, maybeValue) {
    const hasType = arguments.length >= 3;
    let value = hasType ? maybeValue : typeOrValue;
    if (value === undefined) value = null;

    // BIT columns are BOOLEAN in Postgres; routes still pass 1/0.
    const tsqlType = hasType && typeOrValue ? typeOrValue.tsqlType : undefined;
    if (tsqlType === 'Bit' && value !== null) {
      value = value === true || value === 1 || value === '1';
    }

    this.params[name] = value;
    return this;
  }

  async query(text) {
    const statements = translateStatements(text, this.params);
    const client = await this.pool.connect();
    try {
      const recordsets = [];
      const rowsAffected = [];
      for (const st of statements) {
        const res = await client.query(st.sql, st.values);
        const producesRows =
          /^\s*(SELECT|WITH)\b/i.test(st.sql) || /\bRETURNING\b/i.test(st.sql);
        if (producesRows) {
          recordsets.push((res.rows || []).map(mapRowKeys));
          rowsAffected.push(res.rowCount ?? (res.rows || []).length);
        } else {
          rowsAffected.push(res.rowCount ?? 0);
        }
      }
      return { recordset: recordsets[0] ?? [], recordsets, rowsAffected };
    } finally {
      client.release();
    }
  }
}

// Schema (incl. everything the old SQL Server runtime migrations added) is
// applied by db/schema-postgres.sql via scripts/apply-pg-schema.js, so there is
// nothing to do at connect time. Kept because an admin endpoint exposes it.
export async function rerunRuntimeMigrations() {
  return [];
}

export function getPool() {
  if (!poolPromise) {
    pgPool = createPgPool();
    // A pool-level error handler stops an idle-client disconnect from taking
    // the process down.
    pgPool.on('error', (err) => console.error('[db] idle client error:', err.message));
    const wrapped = {
      request: () => new Request(pgPool),
      close: () => pgPool.end(),
    };
    poolPromise = pgPool
      .query('SELECT 1')
      .then(() => {
        console.log(
          '[db] connected to PostgreSQL',
          process.env.DB_SERVER || 'localhost',
          '/',
          process.env.DB_DATABASE || 'fsa_hr'
        );
        return wrapped;
      })
      .catch((err) => {
        poolPromise = undefined;
        pgPool.end().catch(() => {});
        throw err;
      });
  }
  return poolPromise;
}
