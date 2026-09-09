// Generates src/pg-colmap.js from the schema files (the shape source of truth)
// plus the SQL written in backend/src.
//
// Emits three things the Postgres adapter needs:
//   COLUMN_CASE      lower-case -> canonical PascalCase, to undo Postgres's
//                    folding of unquoted identifiers in result keys.
//   BOOLEAN_COLUMNS  columns that are BOOLEAN in Postgres, so route SQL that
//                    still says `IsActive = 1` can be rewritten.
//   UNIQUE_KEYS      table -> unique column list, used to turn MySQL's
//                    ON DUPLICATE KEY UPDATE into Postgres ON CONFLICT.
//
// Usage (from backend/):  node scripts/gen-colmap.mjs
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = process.argv[2] || path.resolve(import.meta.dirname, '..');
const OUT = process.argv[3] || path.resolve(BACKEND, 'src', 'pg-colmap.js');

// schema-mysql.sql carries the tables inherited from the asset/KPI side;
// schema-fsa-hr.sql carries the FSA HR module. Both are parsed the same way.
const SCHEMA_FILES = ['schema-mysql.sql', 'schema-fsa-hr.sql'];

const canonical = new Map();   // lower -> canonical
const sources = new Map();     // lower -> where it came from
const booleanCols = new Set(); // canonical names of boolean columns
const uniqueKeys = new Map();  // canonical table -> [canonical columns]

function add(name, src) {
  if (!name) return;
  const lower = name.toLowerCase();
  if (lower === name) return; // already lower-case: no mapping needed
  if (!canonical.has(lower)) {
    canonical.set(lower, name);
    sources.set(lower, src);
  }
}

const RESERVED_LINE = /^(PRIMARY KEY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN KEY|CHECK)\b/i;

// Pulls out every `CREATE TABLE IF NOT EXISTS name ( … )` block by walking
// parenthesis depth, so it works for both the MySQL (`) ENGINE=InnoDB;`) and
// the Postgres (`);`) dialects.
function tableBlocks(sql) {
  const blocks = [];
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    blocks.push({ table: m[1], body: sql.slice(open + 1, end) });
    re.lastIndex = end;
  }
  return blocks;
}

// --- 1. schema: table names, column names, booleans, unique keys ---------
for (const file of SCHEMA_FILES) {
  const p = path.join(BACKEND, 'db', file);
  if (!fs.existsSync(p)) {
    console.warn(`  (skipping missing ${file})`);
    continue;
  }
  const sql = fs.readFileSync(p, 'utf8');

  // Columns added by a later ALTER TABLE are just as real as the ones in the
  // CREATE TABLE, and were previously missed — which left their result keys
  // lower-cased and reaching the UI as undefined.
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+([^;]*);/gi
  )) {
    add(m[1], 'table');
    add(m[2], 'column');
    const decl = m[3].toUpperCase();
    if (decl.includes('TINYINT(1)') || /BOOLEAN/.test(decl)) booleanCols.add(m[2]);
  }

  for (const { table, body } of tableBlocks(sql)) {
    add(table, 'table');

    for (const rawLine of body.split('\n')) {
      const bare = rawLine.trim().replace(/,$/, '');
      if (!bare || bare.startsWith('--')) continue;

      // Table-level: CONSTRAINT <name> UNIQUE (a, b)  /  UNIQUE (a, b)
      const tableUnique =
        /^(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*(?:KEY\s+\w+\s*)?\(([^)]*)\)$/i.exec(bare);
      if (tableUnique) {
        const cols = tableUnique[1].split(',').map((c) => c.trim()).filter(Boolean);
        if (cols.length && !uniqueKeys.has(table)) uniqueKeys.set(table, cols);
        continue;
      }

      if (RESERVED_LINE.test(bare)) continue;

      const col = /^(\w+)\s/.exec(bare);
      if (!col) continue;
      add(col[1], 'column');

      const upper = bare.toUpperCase();
      if (upper.includes('TINYINT(1)') || /\bBOOLEAN\b/.test(upper)) {
        booleanCols.add(col[1]);
      }

      // Column-level: <Col> VARCHAR(100) NOT NULL UNIQUE
      if (/\bUNIQUE\b/i.test(bare) && !uniqueKeys.has(table)) {
        uniqueKeys.set(table, [col[1]]);
      }
    }
  }
}

// --- 1b. constraints changed after the fact ------------------------------
// A UNIQUE declared in CREATE TABLE can be dropped and replaced by an ALTER
// later in the file. UNIQUE_KEYS drives the ON CONFLICT target, so it has to
// reflect the constraint that actually exists, not the original one.
for (const file of SCHEMA_FILES) {
  const fp = path.join(BACKEND, 'db', file);
  if (!fs.existsSync(fp)) continue;
  const sql = fs.readFileSync(fp, 'utf8');

  const re = /ALTER\s+TABLE\s+(\w+)\s+(DROP|ADD)\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)([^;]*);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, table, action, , rest] = m;
    if (action.toUpperCase() === 'DROP') {
      uniqueKeys.delete(table);
      continue;
    }
    const uq = /UNIQUE\s*\(([^)]*)\)/i.exec(rest);
    if (!uq) continue;
    const cols = uq[1].split(',').map((c) => c.trim()).filter(Boolean);
    if (cols.length) {
      cols.forEach((c) => add(c, 'column'));
      uniqueKeys.set(table, cols);
    }
  }
}

// --- 2. SQL aliases and bracketed identifiers ----------------------------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const backendFiles = [
  ...walk(path.join(BACKEND, 'src')),
  // scripts carry SQL too (seeds, schema tools) and their aliases need mapping
  ...(fs.existsSync(path.join(BACKEND, 'scripts')) ? walk(path.join(BACKEND, 'scripts')) : []),
];
for (const f of backendFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bAS\s+\[?([A-Za-z_]\w*)\]?/g)) add(m[1], 'alias');
  for (const m of src.matchAll(/\[([A-Za-z_]\w*)\]/g)) add(m[1], 'bracketed');
}

// --- 3. safety net: PascalCase property reads on row-ish variables -------
const ROW_VARS =
  /\b(?:r|row|rec|record|rs|item|emp|employee|asset|u|user|c|company|p|proj|kpi|rev|v|d|s|t|doc|req|prog)\.([A-Z]\w*)\b/g;
const frontendSrc = path.join(BACKEND, '..', 'frontend', 'src');
const allFiles = [...backendFiles, ...(fs.existsSync(frontendSrc) ? walk(frontendSrc) : [])];
for (const f of allFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(ROW_VARS)) add(m[1], 'row-read');
}

// --- emit ----------------------------------------------------------------
const entries = [...canonical.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const bySource = {};
for (const [lower] of entries) {
  const s = sources.get(lower);
  bySource[s] = (bySource[s] || 0) + 1;
}

const caseBody = entries.map(([lower, name]) => `  ${lower}: '${name}',`).join('\n');
const boolBody = [...booleanCols].sort().map((c) => `  '${c}',`).join('\n');
const uniqueBody = [...uniqueKeys.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([table, cols]) => `  ${table.toLowerCase()}: [${cols.map((c) => `'${c}'`).join(', ')}],`)
  .join('\n');

const out = `// AUTO-GENERATED by scripts/gen-colmap.mjs — do not edit by hand.
//
// Regenerate after changing a schema file or adding a SQL alias:
//   node scripts/gen-colmap.mjs

// Postgres folds unquoted identifiers to lower case, so every column key in a
// result row arrives lowered. src/db.js runs each row through this map to
// restore the PascalCase that the route and frontend code reads.
export const COLUMN_CASE = {
${caseBody}
};

// Columns that are BOOLEAN in Postgres. Route SQL inherited from SQL Server
// still compares them to integer literals ("IsActive = 1") and passes 1/0
// positionally in INSERTs; db.js rewrites both for these names.
export const BOOLEAN_COLUMNS = new Set([
${boolBody}
]);

// Unique key per table (lower-cased table name), used to translate MySQL's
// "ON DUPLICATE KEY UPDATE" into Postgres "ON CONFLICT (...) DO UPDATE".
export const UNIQUE_KEYS = {
${uniqueBody}
};
`;

fs.writeFileSync(OUT, out);

console.log(`identifiers:     ${entries.length}`);
console.log('by source:      ', bySource);
console.log(`boolean columns: ${booleanCols.size}`);
console.log(`unique keys:     ${uniqueKeys.size}`);
console.log(`wrote:           ${OUT}`);
