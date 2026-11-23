import { FileText, LogOut, LayoutDashboard, Sparkles } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/interview/new', label: 'Start Interview', icon: Sparkles },
  { to: '/resume', label: 'Resume', icon: FileText },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">AI</div>
          <div>
            <p className="eyebrow">Practice studio</p>
            <h1>Mock Interview</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="user-card">
          <p className="eyebrow">Signed in</p>
          <strong>{user?.email || 'Candidate'}</strong>
          <button type="button" className="secondary-button" onClick={logout}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <main className="content-panel">
        <Outlet />
      </main>
    </div>
  );
}
