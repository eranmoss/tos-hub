import { useLocation } from 'react-router-dom';

const TITLES = {
  '/dashboard': 'Overview',
  '/dashboard/integrations': 'Integrations',
  '/dashboard/inventory': 'Inventory',
  '/dashboard/transactions': 'Transactions',
  '/dashboard/intelligence': 'Intelligence',
  '/dashboard/builder': 'Page Builder › Pages',
  '/dashboard/components': 'Page Builder › Components',
  '/dashboard/system-log': 'System Log',
  '/dashboard/settings': 'Settings',
};

export default function Topbar({ onToggleAgent, agentOpen, hasUnread, sidebarOpen, onToggleSidebar }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'Dashboard';

  return (
    <header className="h-14 bg-white border-b border-border-default flex items-center justify-between px-4 shrink-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Expand menu"
            className="text-text-secondary hover:text-primary transition-colors shrink-0"
            aria-label="Expand sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <h1 className="text-lg font-semibold text-primary truncate">{title}</h1>
      </div>

      <button
        type="button"
        onClick={onToggleAgent}
        className="relative flex items-center gap-2 rounded-btn border border-border-default px-3 py-1.5 text-sm hover:border-accent shrink-0"
        aria-label={agentOpen ? 'Close agent panel' : 'Open agent panel'}
        data-testid="agent-toggle"
      >
        <span aria-hidden>💬</span>
        <span>{agentOpen ? 'Hide' : 'Ask'} agent</span>
        {hasUnread && !agentOpen && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-danger rounded-full" />
        )}
      </button>
    </header>
  );
}
