// Lightweight diff utilities for the SOW version history panel.
//
// The two top-level helpers are:
//   diffSowData(prev, next)  → a structured per-section/sub-section diff
//   wordDiff(oldText, newText) → inline word-level diff for a single string
//
// The diff is rendered as `[ { type: 'same' | 'add' | 'remove', text } ]` so
// the React component can map straight to span elements.

// --- Plain-text extraction ----------------------------------------------------

export function htmlToText(html) {
  if (!html) return '';
  // Newlines around block-level tags so paragraphs/lists become separate
  // chunks rather than one squashed run.
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- Word-level diff (LCS-based) ---------------------------------------------
// Splits each side into tokens (word, whitespace, punctuation), runs LCS to
// find the longest common subsequence, then walks back producing a flat list
// of {type, text} segments. The LCS table is O(n*m); for the section-body
// sizes the editor produces (typically <2 000 words) this is plenty fast.

function tokenize(text) {
  if (!text) return [];
  // Keep whitespace and punctuation as their own tokens so the diff lines up
  // word-by-word but preserves spacing in the rendered output.
  return text.match(/\s+|[\w'-]+|[^\w\s]/g) || [];
}

function lcsMatrix(a, b) {
  const n = a.length, m = b.length;
  // 2-D Int16 array — limits each text to ~32 000 tokens, well above any
  // realistic SOW section length.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

export function wordDiff(oldText, newText) {
  const a = tokenize(oldText || '');
  const b = tokenize(newText || '');
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ type: 'add', text: b.join('') }];
  if (b.length === 0) return [{ type: 'remove', text: a.join('') }];

  const dp = lcsMatrix(a, b);
  const out = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: 'same', text: a[i - 1] }); i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ type: 'remove', text: a[i - 1] }); i--;
    } else {
      out.push({ type: 'add', text: b[j - 1] }); j--;
    }
  }
  while (i > 0) { out.push({ type: 'remove', text: a[--i] }); }
  while (j > 0) { out.push({ type: 'add',    text: b[--j] }); }
  out.reverse();

  // Collapse adjacent runs of the same type so the render isn't a token spam.
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === s.type) last.text += s.text;
    else merged.push({ ...s });
  }
  return merged;
}

// --- SOW-level structural diff -----------------------------------------------
// Compares two SOW payloads at three levels: cover fields, the section tree,
// and the signature parties. Each entry has a `status`:
//   'added'     — present in `next`, not in `prev`
//   'removed'   — present in `prev`, not in `next`
//   'modified'  — present in both but the body / title changed
//   'unchanged' — identical
//
// Sub-sections and sub-sub-sections are matched by their `id` if present,
// otherwise by their (zero-based) index inside the parent section. The
// editor regenerates ids when needed, so the index fallback covers the
// case where an older save predates id stability.

function safeStr(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

function matchBy(arr, keyFn) {
  const out = new Map();
  (arr || []).forEach((item, i) => {
    const k = keyFn(item, i);
    if (k != null && !out.has(k)) out.set(k, { item, index: i });
  });
  return out;
}

function diffSubsubsections(prevSubsubs, nextSubsubs) {
  const prev = Array.isArray(prevSubsubs) ? prevSubsubs : [];
  const next = Array.isArray(nextSubsubs) ? nextSubsubs : [];
  const len = Math.max(prev.length, next.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const p = prev[i]; const n = next[i];
    if (p && !n) { out.push({ status: 'removed', title: safeStr(p.title), body: safeStr(p.body), prevBody: safeStr(p.body), nextBody: '' }); continue; }
    if (!p && n) { out.push({ status: 'added',   title: safeStr(n.title), body: safeStr(n.body), prevBody: '', nextBody: safeStr(n.body) }); continue; }
    const titleChanged = safeStr(p.title) !== safeStr(n.title);
    const bodyChanged  = safeStr(p.body)  !== safeStr(n.body);
    out.push({
      status: titleChanged || bodyChanged ? 'modified' : 'unchanged',
      title: safeStr(n.title),
      prevTitle: safeStr(p.title),
      nextTitle: safeStr(n.title),
      prevBody:  safeStr(p.body),
      nextBody:  safeStr(n.body),
      titleChanged,
      bodyChanged,
    });
  }
  return out;
}

function diffSubsections(prevSubs, nextSubs) {
  const prev = Array.isArray(prevSubs) ? prevSubs : [];
  const next = Array.isArray(nextSubs) ? nextSubs : [];
  const len = Math.max(prev.length, next.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const p = prev[i]; const n = next[i];
    if (p && !n) {
      out.push({ status: 'removed', title: safeStr(p.title), prevBody: safeStr(p.body), nextBody: '', subsubsections: [] });
      continue;
    }
    if (!p && n) {
      out.push({ status: 'added', title: safeStr(n.title), prevBody: '', nextBody: safeStr(n.body), subsubsections: diffSubsubsections([], n.subsubsections) });
      continue;
    }
    const titleChanged = safeStr(p.title) !== safeStr(n.title);
    const bodyChanged  = safeStr(p.body)  !== safeStr(n.body);
    const subsubs = diffSubsubsections(p.subsubsections, n.subsubsections);
    const subsubChanged = subsubs.some((s) => s.status !== 'unchanged');
    out.push({
      status: titleChanged || bodyChanged || subsubChanged ? 'modified' : 'unchanged',
      title: safeStr(n.title),
      prevTitle: safeStr(p.title),
      nextTitle: safeStr(n.title),
      prevBody:  safeStr(p.body),
      nextBody:  safeStr(n.body),
      titleChanged,
      bodyChanged,
      subsubsections: subsubs,
    });
  }
  return out;
}

function diffSections(prevSections, nextSections) {
  const prev = Array.isArray(prevSections) ? prevSections : [];
  const next = Array.isArray(nextSections) ? nextSections : [];
  // Section ids are stable across saves, so we match on id when both sides
  // have one. We render the result in the *new* order, appending any
  // removed-only sections at the end so they're still visible.
  const prevById = matchBy(prev, (s) => s.id);
  const seenPrev = new Set();
  const out = [];

  next.forEach((n, ni) => {
    const m = n?.id ? prevById.get(n.id) : null;
    const p = m?.item ?? prev[ni];
    if (m) seenPrev.add(m.item);
    if (!p) {
      out.push({
        status: 'added',
        number: ni + 1,
        title: safeStr(n.title),
        prevBody: '',
        nextBody: safeStr(n.body),
        subsections: diffSubsections([], n.subsections),
      });
      return;
    }
    const titleChanged = safeStr(p.title) !== safeStr(n.title);
    const bodyChanged  = safeStr(p.body)  !== safeStr(n.body);
    const subs = diffSubsections(p.subsections, n.subsections);
    const subChanged = subs.some((s) => s.status !== 'unchanged');
    out.push({
      status: titleChanged || bodyChanged || subChanged ? 'modified' : 'unchanged',
      number: ni + 1,
      title: safeStr(n.title),
      prevTitle: safeStr(p.title),
      nextTitle: safeStr(n.title),
      prevBody:  safeStr(p.body),
      nextBody:  safeStr(n.body),
      titleChanged,
      bodyChanged,
      subsections: subs,
    });
  });

  prev.forEach((p, pi) => {
    if (seenPrev.has(p)) return;
    if (next.some((n) => n?.id && p?.id && n.id === p.id)) return;
    // Match by index as a fallback for older saves without ids — already
    // covered if the index produced a hit in the loop above.
    if (next[pi] && !p.id) return;
    out.push({
      status: 'removed',
      number: pi + 1,
      title: safeStr(p.title),
      prevBody: safeStr(p.body),
      nextBody: '',
      subsections: diffSubsections(p.subsections, []),
    });
  });

  return out;
}

function diffCover(prev, next) {
  const fields = ['clientName', 'subtitle', 'dateOfSubmission', 'version', 'revision'];
  const changed = [];
  for (const f of fields) {
    const a = safeStr(prev?.[f]);
    const b = safeStr(next?.[f]);
    if (a !== b) changed.push({ field: f, prev: a, next: b });
  }
  return changed;
}

export function diffSowData(prevData, nextData) {
  const prev = prevData || {};
  const next = nextData || {};
  return {
    cover:    diffCover(prev.cover, next.cover),
    sections: diffSections(prev.sections, next.sections),
  };
}
