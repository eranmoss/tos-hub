import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock APIs at the module level so any page that loads won't hit the network.
vi.mock('../src/api/auth.js', () => ({
  requestMagicLink: vi.fn(async () => ({ message: 'ok' })),
  verifyToken: vi.fn(async () => ({ jwt: 'stub' })),
}));

vi.mock('../src/api/dashboard.js', () => ({
  getOverview: vi.fn(async () => ({
    suppliers: [],
    transactions: { total_24h: 0, success_rate_pct: 0, avg_latency_ms: 0, volume_by_hour: [] },
    agent_sessions: { active: 0, completed_24h: 0, failed_24h: 0 },
    escalations: { pending: 0, resolved_24h: 0 },
    dedup: { duplicate_24h: 0, uncertain_24h: 0, distinct_24h: 0 },
  })),
  getSuppliers: vi.fn(async () => ({ integrations: [] })),
  runSupplierTest: vi.fn(),
  getTransactions: vi.fn(async () => ({
    transactions: [], total: 0, page: 1, pages: 1,
    summary: { success_rate_pct: 0, avg_latency_ms: 0 },
  })),
  getDedupConfig: vi.fn(async () => ({ config_json: null })),
  patchDedupConfig: vi.fn(),
  getDedupLog: vi.fn(async () => ({ decisions: [] })),
  getEscalations: vi.fn(async () => ({ escalations: [] })),
  resolveEscalation: vi.fn(),
  getPrompts: vi.fn(async () => ({ prompts: [] })),
  patchPrompt: vi.fn(),
  getSettings: vi.fn(async () => ({
    tenant_name: 'TestCo', tier: 'GROWTH', email: 't@t.com',
    api_key_preview: '****abcd', webhooks: [],
  })),
  rotateApiKey: vi.fn(),
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  patchNotificationEmail: vi.fn(),
}));

vi.mock('../src/api/agent.js', () => ({
  sendMessage: vi.fn(async () => ({ conversation_id: 'c1', message_id: 'm1', response: '**ok**' })),
  getSavedPrompts: vi.fn(async () => ({ saved_prompts: [] })),
  savePrompt: vi.fn(),
  deleteSavedPrompt: vi.fn(),
  getConversations: vi.fn(async () => ({ conversations: [] })),
}));

import App from '../src/App.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  it('redirects / to /login and shows sign-in form', () => {
    renderAt('/');
    expect(screen.getByText(/TOS Partner Portal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
  });

  it('/login renders MagicLinkForm', () => {
    renderAt('/login');
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
  });

  it('/dashboard without jwt redirects to /login', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
  });

  it('/verify/:token renders verifying state', () => {
    renderAt('/verify/abc123');
    expect(screen.getByText(/Verifying/i)).toBeInTheDocument();
  });
});
