import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { getInventory } = vi.hoisted(() => ({ getInventory: vi.fn() }));
vi.mock('../src/api/dashboard.js', () => ({ getInventory }));

import Inventory from '../src/pages/Inventory.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

beforeEach(() => { getInventory.mockReset(); });

const mkRecord = (i, overrides = {}) => ({
  id: `r${i}`,
  supplier_slug: 'hotelbeds-hotels',
  type: 'HOTEL',
  title: `Hotel ${i}`,
  city: 'Barcelona',
  country: 'ES',
  latitude: 41.38,
  longitude: 2.19,
  category: null,
  star_rating: 5,
  is_active: true,
  last_synced_at: new Date().toISOString(),
  ...overrides,
});

const baseResp = (records = []) => ({
  records,
  total: records.length,
  page: 1,
  pages: 1,
  sync_summary: {
    status: 'COMPLETE',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    records_active: records.filter((r) => r.is_active).length,
    records_inactive: records.filter((r) => !r.is_active).length,
  },
  sync_status_by_supplier: [
    {
      supplier_slug: 'hotelbeds-hotels',
      records_active: 2,
      records_inactive: 1,
      last_synced_at: new Date().toISOString(),
      last_job_status: 'COMPLETE',
      last_job_started_at: new Date().toISOString(),
    },
  ],
});

describe('§7B Inventory page', () => {
  it('renders records, sync status, and per-supplier row', async () => {
    getInventory.mockResolvedValue(
      baseResp([mkRecord(1), mkRecord(2, { is_active: false, city: 'Madrid' })])
    );
    wrap(<Inventory />);
    await screen.findByText('Hotel 1');
    expect(screen.getByText('Hotel 2')).toBeInTheDocument();
    expect(screen.getAllByText(/hotelbeds-hotels/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 active/)).toBeInTheDocument();
  });

  it('Apply sends type + city filters', async () => {
    getInventory.mockResolvedValue(baseResp([mkRecord(1)]));
    wrap(<Inventory />);
    await waitFor(() => expect(getInventory).toHaveBeenCalled());
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0], 'HOTEL');
    const cityInput = screen.getByPlaceholderText(/Barcelona/i);
    await userEvent.type(cityInput, 'Barce');
    await userEvent.click(screen.getByRole('button', { name: /^Apply$/i }));
    await waitFor(() => {
      const last = getInventory.mock.calls[getInventory.mock.calls.length - 1][0];
      expect(last.type).toBe('HOTEL');
      expect(last.city).toBe('Barce');
    });
  });

  it('row click expands raw JSON', async () => {
    getInventory.mockResolvedValue(baseResp([mkRecord(1)]));
    wrap(<Inventory />);
    const row = await screen.findByText('Hotel 1');
    await userEvent.click(row);
    await waitFor(() => {
      expect(screen.getByText(/"id": "r1"/)).toBeInTheDocument();
    });
  });

  it('renders empty state when no records', async () => {
    getInventory.mockResolvedValue(baseResp([]));
    wrap(<Inventory />);
    await screen.findByText(/No records match/i);
  });
});
