import { useLocation } from 'react-router-dom';

const TITLES = {
  '/dashboard': 'Overview',
  '/dashboard/integrations': 'Integrations',
  '/dashboard/inventory': 'Inventory',
  '/dashboard/transactions': 'Transactions',
  '/dashboard/intelligence': 'Intelligence',
  '/dashboard/settings': 'Settings',
};

export default function Topbar({ onToggleAgent, agentOpen, hasUnread }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'Dashboard';
  return (
    <header className="h-14 bg-white border-b border-border-default flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold text-primary">{title}</h1>
      <button
        type="button"
        onClick={onToggleAgent}
        className="relative flex items-center gap-2 rounded-btn border border-border-default px-3 py-1.5 text-sm hover:border-accent"
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
