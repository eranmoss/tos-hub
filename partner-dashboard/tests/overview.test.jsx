import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getOverview } = vi.hoisted(() => ({ getOverview: vi.fn() }));
vi.mock('../src/api/dashboard.js', () => ({ getOverview }));

import Overview from '../src/pages/Overview.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

beforeEach(() => {
  getOverview.mockReset();
});

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

describe('Layer 5: Overview', () => {
  it('renders data from overview API', async () => {
    getOverview.mockResolvedValue({
      suppliers: [{ supplier_slug: 's1', name: 'Sup', status: 'UP', latency_p95_ms: 100, error_rate_pct: 0.5, transactions_24h: 50 }],
      transactions: { total_24h: 120, success_rate_pct: 99.1, avg_latency_ms: 300, volume_by_hour: [] },
      agent_sessions: { active: 1, completed_24h: 5, failed_24h: 0 },
      escalations: { pending: 2, resolved_24h: 3 },
      dedup: { duplicate_24h: 4, uncertain_24h: 1, distinct_24h: 10 },
    });
    wrap(<Overview />);
    await waitFor(() => expect(getOverview).toHaveBeenCalled());
    await screen.findByText('Sup');
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('99.1%')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders sync_status_by_supplier rows when present', async () => {
    getOverview.mockResolvedValue({
      suppliers: [],
      transactions: { total_24h: 0, success_rate_pct: 0, avg_latency_ms: 0, volume_by_hour: [] },
      agent_sessions: { active: 0, completed_24h: 0, failed_24h: 0 },
      escalations: { pending: 0, resolved_24h: 0 },
      dedup: { duplicate_24h: 0, uncertain_24h: 0, distinct_24h: 0 },
      sync_status_by_supplier: [
        { supplier_slug: 'hotelbeds-hotels', records_active: 300, records_inactive: 2,
          last_synced_at: new Date().toISOString(), last_job_status: 'COMPLETE',
          last_job_started_at: new Date().toISOString() },
      ],
    });
    wrap(<Overview />);
    await screen.findByText(/Inventory sync/i);
    expect(screen.getByText('hotelbeds-hotels')).toBeInTheDocument();
    expect(screen.getByText(/300 active · 2 inactive/)).toBeInTheDocument();
  });

  it('polls on interval', async () => {
    vi.useFakeTimers();
    getOverview.mockResolvedValue({
      suppliers: [], transactions: { total_24h: 0, success_rate_pct: 0, avg_latency_ms: 0, volume_by_hour: [] },
      agent_sessions: { active: 0, completed_24h: 0, failed_24h: 0 },
      escalations: { pending: 0, resolved_24h: 0 },
      dedup: { duplicate_24h: 0, uncertain_24h: 0, distinct_24h: 0 },
    });
    wrap(<Overview />);
    await vi.waitFor(() => expect(getOverview).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30000);
    expect(getOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});
