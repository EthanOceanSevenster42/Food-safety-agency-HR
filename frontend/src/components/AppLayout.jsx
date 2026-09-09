import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { auth } from '../auth.js';
import { navFor, roleLabel } from '../roles.js';

export default function AppLayout() {
  const navigate = useNavigate();
  const user = auth.getUser();
  const navItems = navFor(user);

  function handleLogout() {
    auth.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/fsa-logo.svg" alt="Food Safety Agency" />
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-block">
            <div className="user-name">{user?.displayName || user?.email}</div>
            {user?.role && <div className="user-role">{roleLabel(user.role)}</div>}
          </div>
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
