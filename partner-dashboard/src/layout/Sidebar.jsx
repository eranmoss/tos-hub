import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

const BUILDER_PATHS = ['/dashboard/builder', '/dashboard/components'];

const NAV = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/inventory', label: 'Inventory' },
  { to: '/dashboard/transactions', label: 'Transactions' },
  { to: '/dashboard/intelligence', label: 'Intelligence' },
  // Page Builder handled separately below
  { to: '/dashboard/system-log', label: 'System Log' },
  { to: '/dashboard/settings', label: 'Settings' },
];

export default function Sidebar({ open, onToggle }) {
  const { tenant, logout } = useAuth();
  const { pathname } = useLocation();
  const builderActive = BUILDER_PATHS.some(p => pathname.startsWith(p));

  if (!open) {
    return (
      <div className="w-10 shrink-0 bg-primary flex flex-col items-center py-3 gap-4 h-full border-r border-white/10">
        <button
          onClick={onToggle}
          title="Expand menu"
          className="text-white/60 hover:text-white transition-colors mt-1"
          aria-label="Expand sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1" />
        <button
          onClick={logout}
          title="Log out"
          className="text-white/40 hover:text-white/70 transition-colors mb-1"
          aria-label="Log out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <nav className="w-[240px] bg-primary text-white flex flex-col shrink-0 h-full">

      {/* Header */}
      <div className="px-5 py-5 border-b border-white/10 flex items-start justify-between">
        <div>
          <img
            src="/bridgify-logo.png"
            alt="Bridgify"
            className="h-6 brightness-0 invert opacity-90 mb-1"
          />
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/50 font-medium">
            Travel Operating System
          </div>
        </div>
        <button
          onClick={onToggle}
          title="Collapse menu"
          className="text-white/40 hover:text-white transition-colors mt-0.5 shrink-0"
          aria-label="Collapse sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <ul className="flex-1 mt-3 overflow-y-auto">
        {NAV.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center px-5 py-2 text-sm font-medium border-l-4 ${
                  isActive
                    ? 'bg-white/10 border-accent text-white'
                    : 'border-transparent text-white/80 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          </li>
        ))}

        {/* Page Builder section */}
        <li>
          <div
            className={`flex items-center px-5 py-2 text-sm font-medium border-l-4 ${
              builderActive
                ? 'bg-white/10 border-accent text-white'
                : 'border-transparent text-white/80'
            }`}
          >
            <span className="flex-1">Page Builder</span>
            {builderActive && (
              <svg className="w-3 h-3 text-white/50" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          {/* Sub-items */}
          <ul className="bg-black/20">
            <li>
              <NavLink
                to="/dashboard/builder"
                end
                className={({ isActive }) =>
                  `flex items-center pl-9 pr-5 py-1.5 text-sm border-l-4 ${
                    isActive
                      ? 'bg-white/10 border-accent text-white font-medium'
                      : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                Pages
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/dashboard/components"
                className={({ isActive }) =>
                  `flex items-center pl-9 pr-5 py-1.5 text-sm border-l-4 ${
                    isActive
                      ? 'bg-white/10 border-accent text-white font-medium'
                      : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                Components
              </NavLink>
            </li>
          </ul>
        </li>
      </ul>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10 text-xs">
        {tenant && (
          <>
            <div className="font-medium truncate">{tenant.user_name || tenant.email}</div>
            <div className="text-white/60 truncate">
              {tenant.tenant_name || tenant.tenant_id} &middot; {tenant.tier}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={logout}
          className="mt-3 text-white/70 hover:text-white underline"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
