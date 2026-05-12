import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

const NAV = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/inventory', label: 'Inventory' },
  { to: '/dashboard/transactions', label: 'Transactions' },
  { to: '/dashboard/intelligence', label: 'Intelligence' },
  { to: '/dashboard/system-log', label: 'System Log' },
  { to: '/dashboard/settings', label: 'Settings' },
];

export default function Sidebar() {
  const { tenant, logout } = useAuth();
  return (
    <nav className="w-[240px] bg-primary text-white flex flex-col shrink-0 h-full">
      <div className="px-5 py-5 border-b border-white/10">
        <img
          src="/bridgify-logo.png"
          alt="Bridgify"
          className="h-6 brightness-0 invert opacity-90 mb-1"
        />
        <div className="text-[11px] uppercase tracking-[0.25em] text-white/50 font-medium">Travel Operating System</div>
      </div>
      <ul className="flex-1 mt-3">
        {NAV.map(({ to, label, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center px-5 py-2 text-sm font-medium border-l-4 ${
                  isActive
                    ? 'bg-white/10 border-accent'
                    : 'border-transparent text-white/80 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="px-5 py-4 border-t border-white/10 text-xs">
        {tenant && (
          <>
            <div className="font-medium">{tenant.user_name || tenant.email}</div>
            <div className="text-white/60">{tenant.tenant_name || tenant.tenant_id} &middot; {tenant.tier}</div>
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
