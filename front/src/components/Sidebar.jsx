import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import './Sidebar.css';

const NAV = [
  {
    to: '/',
    label: 'Home',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/orders',
    label: 'Orders',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    to: '/hostings',
    label: 'Payment Connections',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4"/>
      </svg>
    ),
  },
  {
    to: '/plpg',
    label: 'PLPG',
    icon: (
      <svg width="18" height="18" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="13" cy="13" r="11.5" />
        <circle cx="13" cy="13" r="8"    strokeWidth="1"   opacity=".5" />
        <circle cx="13" cy="13" r="4.5"  strokeWidth="1"   opacity=".35" />
        <circle cx="13" cy="13" r="1.8"  fill="currentColor" stroke="none" />
        <path d="M13 3v2.5M13 20.5V23M3 13h2.5M20.5 13H23" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7.5 7.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 7.5l-1.8 1.8M9.3 16.7l-1.8 1.8"
          strokeWidth="1" strokeLinecap="round" opacity=".55" />
      </svg>
    ),
  },
  {
    to: '/ai',
    label: 'AI Metrics',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

const MODERATION_NAV = [
  {
    to: '/users',
    label: 'Users',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    to: '/xhostings',
    label: 'Hostings',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

function SunIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  );
}

export default function Sidebar() {
  const { admin, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">⚡</span>
        <span className="sidebar-title">XPage Admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        <div className="sidebar-section-label">Moderation</div>

        {MODERATION_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link sidebar-sub-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <div className="sidebar-admin-name">{admin?.name}</div>
        <div className="sidebar-admin-email">{admin?.email}</div>
        <button className="sidebar-logout" onClick={logout}>Logout</button>
      </div>
    </aside>
  );
}
