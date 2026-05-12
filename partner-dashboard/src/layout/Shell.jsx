import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import AgentPanel from '../agent/AgentPanel.jsx';
import { PageContextProvider } from '../agent/usePageContext.js';

export default function Shell() {
  const [agentOpen, setAgentOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  return (
    <PageContextProvider>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar
            onToggleAgent={() => setAgentOpen((v) => !v)}
            agentOpen={agentOpen}
            hasUnread={hasUnread}
          />
          <main className="flex-1 overflow-y-auto bg-page-bg">
            <Outlet />
          </main>
        </div>
        <AgentPanel open={agentOpen} onUnreadChange={setHasUnread} />
      </div>
    </PageContextProvider>
  );
}
