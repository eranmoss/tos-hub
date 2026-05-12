import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock every api module used by pages mounted inside the Shell.
vi.mock('../src/api/dashboard.js', () => ({
  getOverview: vi.fn(async () => ({
    suppliers: [], transactions: { total_24h: 0, success_rate_pct: 0, avg_latency_ms: 0, volume_by_hour: [] },
    agent_sessions: { active: 0, completed_24h: 0, failed_24h: 0 },
    escalations: { pending: 0, resolved_24h: 0 },
    dedup: { duplicate_24h: 0, uncertain_24h: 0, distinct_24h: 0 },
  })),
  getSuppliers: vi.fn(async () => ({ integrations: [] })),
}));
vi.mock('../src/api/agent.js', () => ({
  sendMessage: vi.fn(),
  getSavedPrompts: vi.fn(async () => ({ saved_prompts: [] })),
  savePrompt: vi.fn(),
  deleteSavedPrompt: vi.fn(),
  getConversations: vi.fn(async () => ({ conversations: [] })),
}));

import Shell from '../src/layout/Shell.jsx';
import Overview from '../src/pages/Overview.jsx';

// Seed a non-expired jwt so useAuth() returns a tenant name for the sidebar.
const seedJwt = () => {
  const payload = { tenant_id: 't1', tenant_name: 'Acme', tier: 'GROWTH', email: 'a@a.com', exp: 9999999999 };
  const b64 = btoa(JSON.stringify(payload)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  localStorage.setItem('tos_jwt', `h.${b64}.s`);
};

describe('Layer 3: Shell', () => {
  it('renders sidebar, topbar, and agent panel (collapsed initially)', async () => {
    seedJwt();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Shell />}>
            <Route index element={<Overview />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/^TOS$/)).toBeInTheDocument(); // sidebar wordmark
    expect(screen.getByText('Acme')).toBeInTheDocument();  // tenant name
    expect(screen.getAllByText(/Overview/i).length).toBeGreaterThan(0);
    const panel = screen.getByTestId('agent-panel');
    expect(panel.className).toMatch(/w-0/);
  });

  it('agent toggle opens/closes panel', async () => {
    seedJwt();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Shell />}>
            <Route index element={<Overview />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const btn = screen.getByTestId('agent-toggle');
    await userEvent.click(btn);
    const panel = screen.getByTestId('agent-panel');
    expect(panel.className).toMatch(/w-\[360px\]/);
    await userEvent.click(btn);
    expect(screen.getByTestId('agent-panel').className).toMatch(/w-0/);
  });
});
