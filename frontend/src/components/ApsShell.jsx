// App shell in the APS visual language: dark navy sidebar, teal active item
// with a cyan edge, Font Awesome icons, photographic page ground.
//
// The navigation is the People & management hub structure from the FSA HR
// Portal design; the inherited asset/procurement/KPI tools sit below it.
//
// Three widths: a full rail, a 64px icon rail (desktop, remembered), and a
// slide-over drawer under 860px.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../auth.js';
import { api } from '../api.js';
import { roleLabel, isSuperAdmin, canViewPage } from '../roles.js';

// `count` names the field on /api/fsa/nav-counts to badge with.
const HUB_NAV = [
  {
    group: 'Overview',
    items: [
      { to: '/hr-home', label: 'HR home', icon: 'fas fa-house' },
      { to: '/management-dashboard', label: 'Management dashboard', icon: 'fas fa-chart-line' },
    ],
  },
  {
    group: 'People',
    items: [
      { to: '/directory', label: 'Directory & placements', icon: 'fas fa-address-book' },
      { to: '/competence', label: 'Competence & registrations', icon: 'fas fa-certificate', count: 'CompetenceFlags' },
      { to: '/requisitions', label: 'Role requisitions', icon: 'fas fa-file-signature', count: 'ReqsOpen' },
      { to: '/recruitment', label: 'Recruitment', icon: 'fas fa-user-plus' },
    ],
  },
  {
    group: 'Onboarding',
    items: [
      { to: '/red-to-green', label: 'Red to Green tracker', icon: 'fas fa-traffic-light', count: 'ProgrammesAtRisk' },
      { to: '/department-templates', label: 'Department templates', icon: 'fas fa-list-check' },
    ],
  },
  {
    group: 'Time & attendance',
    items: [
      { to: '/leave', label: 'Leave & coverage', icon: 'fas fa-calendar-day', count: 'LeavePending' },
    ],
  },
  {
    group: 'Documents',
    items: [
      { to: '/documents', label: 'Document depository', icon: 'fas fa-folder-open' },
    ],
  },
];

// The tools carried over from the asset/KPI system.
const TOOL_ITEMS = [
  { to: '/', label: 'Equipment & assets', icon: 'fas fa-boxes-stacked', page: 'assets' },
  { to: '/procurement', label: 'Procurement & SOWs', icon: 'fas fa-file-contract', page: 'procurement' },
  { to: '/hr', label: 'KPI & performance', icon: 'fas fa-bullseye', page: 'hr' },
];

const readFlag = (key, fallback = false) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback; // private mode
  }
};

const writeFlag = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
};

export default function ApsShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = auth.getUser();

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [counts, setCounts] = useState({});

  // Restore the sidebar preferences after mount.
  useEffect(() => {
    setCollapsed(readFlag('fsa.sidebarCollapsed'));
    setToolsOpen(readFlag('fsa.toolsOpen', true));
  }, []);

  // Badge counts come from the registers so the sidebar cannot drift from them.
  // Re-read on every navigation so a decision made on a screen shows up here.
  useEffect(() => {
    let live = true;
    api.fsaNavCounts()
      .then((d) => { if (live) setCounts(d || {}); })
      .catch(() => { /* badges are decoration — a failure must not block the shell */ });
    return () => { live = false; };
  }, [location.pathname]);

  // Following a link on a phone should close the drawer behind you.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      writeFlag('fsa.sidebarCollapsed', !prev);
      return !prev;
    });
  }

  function toggleTools() {
    setToolsOpen((prev) => {
      writeFlag('fsa.toolsOpen', !prev);
      return !prev;
    });
  }

  function signOut() {
    auth.clear();
    navigate('/login', { replace: true });
  }

  const tools = TOOL_ITEMS.filter((t) => isSuperAdmin(user) || canViewPage(user, t.page));
  const showUsers = isSuperAdmin(user);
  const hasTools = tools.length > 0 || showUsers;

  function link(item) {
    const n = item.count ? Number(counts[item.count] || 0) : 0;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        title={item.label}
        className={({ isActive }) => 'aps-nav-link' + (isActive ? ' active' : '')}
      >
        <i className={item.icon} aria-hidden="true" />
        {!collapsed && <span className="aps-nav-label">{item.label}</span>}
        {!collapsed && n > 0 && (
          <span className="aps-nav-count" title={`${n}`}>{n > 99 ? '99+' : n}</span>
        )}
      </NavLink>
    );
  }

  return (
    <div className="aps-app">
      <button
        className="aps-hamburger"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open the navigation"
      >
        <i className="fas fa-bars" aria-hidden="true" />
      </button>

      {drawerOpen && <div className="aps-scrim" onClick={() => setDrawerOpen(false)} />}

      <aside
        className={[
          'aps-side',
          collapsed ? 'aps-side--collapsed' : 'aps-side--open',
          drawerOpen ? 'aps-side--mobile-open' : '',
        ].filter(Boolean).join(' ')}
      >
        {!collapsed && (
          <div className="aps-brand">
            {/* Decorative: the wordmark below carries the name. */}
            <img src="/logo.png" alt="" />
            <div className="aps-brand-title">Food Safety Agency</div>
            <div className="aps-brand-sub">People &amp; management hub</div>
          </div>
        )}

        <button
          className="aps-side-toggle"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`fas fa-${collapsed ? 'chevron-right' : 'chevron-left'}`} aria-hidden="true" />
        </button>

        <nav className="aps-nav">
          {HUB_NAV.map((section) => (
            <div key={section.group}>
              {!collapsed && <div className="aps-nav-group">{section.group}</div>}
              {section.items.map(link)}
            </div>
          ))}

          {hasTools && (
            <div>
              {!collapsed && (
                <button
                  className="aps-nav-group"
                  onClick={toggleTools}
                  aria-expanded={toolsOpen}
                  title={toolsOpen ? 'Hide the inherited tools' : 'Show the inherited tools'}
                >
                  <span>Tools</span>
                  <i className={`fas fa-chevron-${toolsOpen ? 'up' : 'down'}`} aria-hidden="true" />
                </button>
              )}
              {(toolsOpen || collapsed) && (
                <>
                  {tools.map(link)}
                  {showUsers && link({ to: '/users', label: 'Users & access', icon: 'fas fa-user-shield' })}
                </>
              )}
            </div>
          )}
        </nav>

        <div className="aps-side-foot">
          {!collapsed && (
            <div className="aps-user">
              <div className="aps-avatar"><i className="fas fa-user" aria-hidden="true" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="aps-user-name">{user?.displayName || user?.email}</div>
                {user?.role && <div className="aps-user-role">{roleLabel(user.role)}</div>}
              </div>
            </div>
          )}
          <button className="aps-signout" onClick={signOut} title="Sign out">
            <i className="fas fa-sign-out-alt" aria-hidden="true" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <main className="aps-main">
        <Outlet />
      </main>
    </div>
  );
}
