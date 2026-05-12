import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const {
  getDedupConfig, patchDedupConfig, getDedupLog, getEscalations,
  resolveEscalation, getPrompts, patchPrompt,
} = vi.hoisted(() => ({
  getDedupConfig: vi.fn(),
  patchDedupConfig: vi.fn(),
  getDedupLog: vi.fn(),
  getEscalations: vi.fn(),
  resolveEscalation: vi.fn(),
  getPrompts: vi.fn(),
  patchPrompt: vi.fn(),
}));

vi.mock('../src/api/dashboard.js', () => ({
  getDedupConfig, patchDedupConfig, getDedupLog, getEscalations, resolveEscalation,
  getPrompts, patchPrompt,
}));

import Intelligence from '../src/pages/Intelligence.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

beforeEach(() => {
  getDedupConfig.mockReset();
  getDedupConfig.mockResolvedValue({ config_json: null });
  patchDedupConfig.mockReset();
  getDedupLog.mockResolvedValue({ decisions: [] });
  getEscalations.mockResolvedValue({ escalations: [
    { id: 'e1', prompt_key: 'price_variance', status: 'PENDING',
      trigger_data: { variance: 0.2 }, created_at: new Date().toISOString() }
  ]});
  resolveEscalation.mockResolvedValue({ id: 'e1', status: 'RESOLVED' });
  getPrompts.mockResolvedValue({ prompts: [
    { id: 'p1', prompt_key: 'inv_low', category: 'INVENTORY',
      trigger_condition: 'stock < 5', escalate_to_human: false, is_active: true, version: '1.0' }
  ]});
  patchPrompt.mockResolvedValue({ id: 'p1', prompt_key: 'inv_low', is_active: false });
});

describe('Layer 8: Intelligence', () => {
  it('dedup config editor saves', async () => {
    wrap(<Intelligence />);
    await waitFor(() => expect(getDedupConfig).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Save config/i }));
    await waitFor(() => expect(patchDedupConfig).toHaveBeenCalled());
  });

  it('switches to Escalations tab and shows card', async () => {
    wrap(<Intelligence />);
    await userEvent.click(screen.getByRole('button', { name: /Escalations/i }));
    await screen.findByText('price_variance');
  });

  it('switches to Prompts tab and toggles active', async () => {
    wrap(<Intelligence />);
    await userEvent.click(screen.getByRole('button', { name: /^Prompts$/i }));
    await screen.findByText('inv_low');
    const toggle = screen.getByRole('checkbox', { name: /Active/i });
    await userEvent.click(toggle);
    await waitFor(() => expect(patchPrompt).toHaveBeenCalledWith('p1', { is_active: false }));
  });
});
