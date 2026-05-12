import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { getTransactions } = vi.hoisted(() => ({ getTransactions: vi.fn() }));
vi.mock('../src/api/dashboard.js', () => ({ getTransactions }));

import Transactions from '../src/pages/Transactions.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

beforeEach(() => {
  getTransactions.mockReset();
});

const mkRow = (i, overrides = {}) => ({
  txn_id: `t${i}`, supplier_slug: 's1', operation: 'search', status: 'SUCCESS',
  latency_ms: 100 + i, source: 'LIVE', created_at: new Date().toISOString(),
  ...overrides,
});

describe('Layer 7: Transactions', () => {
  it('renders table + summary', async () => {
    getTransactions.mockResolvedValue({
      transactions: [mkRow(1), mkRow(2, { status: 'ERROR' })],
      total: 2, page: 1, pages: 1,
      summary: { success_rate_pct: 50, avg_latency_ms: 101 },
    });
    wrap(<Transactions />);
    await screen.findAllByText('s1');
    expect(screen.getByText(/Success rate: 50%/)).toBeInTheDocument();
    expect(screen.getAllByText('ERROR').length).toBeGreaterThanOrEqual(1);
  });

  it('Apply button sends filter params', async () => {
    getTransactions.mockResolvedValue({
      transactions: [], total: 0, page: 1, pages: 1,
      summary: { success_rate_pct: 0, avg_latency_ms: 0 },
    });
    wrap(<Transactions />);
    await waitFor(() => expect(getTransactions).toHaveBeenCalled());
    const statusSelects = screen.getAllByRole('combobox');
    // statusSelects[1] is the "Status" filter
    await userEvent.selectOptions(statusSelects[1], 'ERROR');
    await userEvent.click(screen.getByRole('button', { name: /^Apply$/i }));
    await waitFor(() => {
      const last = getTransactions.mock.calls[getTransactions.mock.calls.length - 1][0];
      expect(last.status).toBe('ERROR');
    });
  });
});
