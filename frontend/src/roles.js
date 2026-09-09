// Central per-account access helpers for the client (segment model).
//
// A user object (auth.getUser()) has:
//   role        — 'superadmin' | 'manager' | 'employee'
//   permissions — { segment: 'read' | 'write' } for managers/employees.
//                 Super admins get full access to every segment implicitly.
//
// Managers & employees have a built-in base (their KPI reviews + a read-only
// organogram) and can be granted any of the per-tab SEGMENTS on top. The backend
// (src/middleware/access.js) is the real enforcement — keep segment keys in sync.

export const SEGMENTS = [
  'asset_analytics', 'asset_allocated', 'asset_all', 'asset_repairs',
  'procurement', 'hr_kpi', 'hr_projects', 'hr_analysis', 'companies',
];

// Segments grouped by the page they belong to. Drives the Users grid, the
// sidebar nav, and per-tab filtering. `to` marks a group that has its own nav
// page; `tab` maps a segment to a tab key within that page.
export const SEGMENT_GROUPS = [
  { page: 'assets', label: 'Asset Control', to: '/', icon: '▤', segments: [
    { key: 'asset_analytics', label: 'Analytics',        tab: 'analytics',  hint: 'Value & lifecycle dashboards.' },
    { key: 'asset_allocated', label: 'Allocated Assets', tab: 'allocated',  hint: 'Per-company org chart & allocated equipment.' },
    { key: 'asset_all',       label: 'All Assets',       tab: 'all-assets', hint: 'Master asset inventory & CRUD.' },
    { key: 'asset_repairs',   label: 'Repairs',          tab: 'repairs',    hint: 'Repair workflow board.' },
  ] },
  { page: 'procurement', label: 'Procurement', to: '/procurement', icon: '⛁', segments: [
    { key: 'procurement', label: 'Procurement Process', hint: 'Projects, SOW / JD / EDP / KPA authoring.' },
  ] },
  { page: 'hr', label: 'Human Resources', to: '/hr', icon: '☺', segments: [
    { key: 'hr_kpi',      label: 'KPI Tracker', tab: 'kpi',      hint: 'Manage KPI sessions & reviews for staff.' },
    { key: 'hr_projects', label: 'HR Projects', tab: 'projects', hint: 'HR document packs (JD/EDP/KPA/SOW).' },
    { key: 'hr_analysis', label: 'Analysis',    tab: 'analysis', hint: 'KPI results & performance analysis.' },
  ] },
  { page: 'companies', label: 'Companies', segments: [
    { key: 'companies', label: 'Company records & branding', hint: 'Create / edit companies and their branding.' },
  ] },
];

export const SEGMENT_LABELS = Object.fromEntries(
  SEGMENT_GROUPS.flatMap((g) => g.segments.map((s) => [s.key, s.label]))
);

const rank = (lvl) => (lvl === 'write' ? 2 : lvl === 'read' ? 1 : 0);
const LEGACY_FULL_ROLES = new Set(['admin', 'user']);
const FULL = Object.fromEntries(SEGMENTS.map((s) => [s, 'write']));

export function isSuperAdmin(user) {
  return user?.role === 'superadmin'
    || (LEGACY_FULL_ROLES.has(user?.role) && !user?.permissions);
}
export function isStaff(user) { return user?.role === 'manager' || user?.role === 'employee'; }

function permsOf(user) { return isSuperAdmin(user) ? FULL : (user?.permissions || {}); }
export function levelFor(user, seg) { return permsOf(user)[seg] || 'none'; }
export const canView = (user, seg) => rank(levelFor(user, seg)) >= 1;
export const canEdit = (user, seg) => rank(levelFor(user, seg)) >= 2;

// A page (group) is reachable if any of its segments is viewable.
export function canViewPage(user, page) {
  const g = SEGMENT_GROUPS.find((x) => x.page === page);
  return !!g && g.segments.some((s) => canView(user, s.key));
}

// The visible tabs (segment defs with a `tab`) within a page, in order.
export function visibleTabs(user, page) {
  const g = SEGMENT_GROUPS.find((x) => x.page === page);
  if (!g) return [];
  return g.segments.filter((s) => s.tab && canView(user, s.key));
}

export const ROLE_LABELS = { superadmin: 'Super admin', manager: 'Manager', employee: 'Employee' };
export function roleLabel(role) { return ROLE_LABELS[role] || role || ''; }

// ---- Navigation ----
const NAV_REVIEWS = { to: '/my-reviews',   label: 'My KPI Reviews', icon: '☑' };
const NAV_TEAM    = { to: '/team-reviews', label: 'Team Reviews',   icon: '☰' };
const NAV_ORG     = { to: '/organogram',   label: 'Organogram',     icon: '⧉' };
const NAV_USERS   = { to: '/users',        label: 'Users',          icon: '◉' };

export function navFor(user) {
  if (!user) return [];
  if (isSuperAdmin(user)) {
    return [
      { to: '/',            label: 'Asset Control',       icon: '▤' },
      { to: '/procurement', label: 'Procurement Process', icon: '⛁' },
      { to: '/hr',          label: 'Human Resources',     icon: '☺' },
      NAV_USERS,
    ];
  }
  // Managers / employees: reviews + organogram base, then any granted pages.
  const items = [NAV_REVIEWS];
  if (user.role === 'manager') items.push(NAV_TEAM);
  items.push(NAV_ORG);
  for (const g of SEGMENT_GROUPS) {
    if (!g.to) continue; // companies has no nav page of its own
    if (canViewPage(user, g.page)) items.push({ to: g.to, label: g.label, icon: g.icon });
  }
  return items;
}

export function homeFor(user) {
  // HR home is the front door for every account; staff still get their own
  // review list from the nav.
  return user ? '/hr-home' : '/login';
}

// ---- Route guard ----
const PAGE_BY_PATH = [
  { area: 'assets',      match: (p) => p === '/' },
  { area: 'procurement', match: (p) => p === '/procurement' || p.startsWith('/procurement/') },
  { area: 'hr',          match: (p) => p === '/hr' || p.startsWith('/hr/') },
];
const STAFF_BASE = ['/my-reviews', '/kpi-review', '/review-session', '/organogram'];

// The People & management hub. Open to every signed-in account — these are the
// HR registers, and the backend (requireAuth on /api/fsa) is the real gate.
export const HUB_BASE = [
  '/hr-home', '/management-dashboard', '/directory', '/competence',
  '/requisitions', '/recruitment', '/red-to-green', '/department-templates',
  '/leave', '/documents',
];
const MANAGER_ONLY = ['/team-reviews', '/team-review'];

export function canAccessPath(user, pathname) {
  if (pathname === '/no-access') return true;
  if (isSuperAdmin(user)) return true;
  const startsAny = (list) => list.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (startsAny(HUB_BASE)) return true;
  if (startsAny(STAFF_BASE)) return true;
  if (startsAny(MANAGER_ONLY)) return user?.role === 'manager';
  if (pathname === '/users') return false; // super-admin only
  const entry = PAGE_BY_PATH.find((e) => e.match(pathname));
  if (!entry) return true; // unknown path (e.g. review deep-links) — backend guards it
  return canViewPage(user, entry.area);
}
