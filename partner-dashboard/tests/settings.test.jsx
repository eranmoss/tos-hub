import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const {
  getSettings, rotateApiKey, createWebhook, deleteWebhook, patchNotificationEmail,
} = vi.hoisted(() => ({
  getSettings: vi.fn(),
  rotateApiKey: vi.fn(),
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  patchNotificationEmail: vi.fn(),
}));

vi.mock('../src/api/dashboard.js', () => ({
  getSettings, rotateApiKey, createWebhook, deleteWebhook, patchNotificationEmail,
}));

import Settings from '../src/pages/Settings.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

beforeEach(() => {
  getSettings.mockReset();
  getSettings.mockResolvedValue({
    tenant_name: 'TestCo', tier: 'GROWTH', email: 't@t.com',
    api_key_preview: '****abcd', notification_email: 'ops@t.com', webhooks: [],
  });
  rotateApiKey.mockReset();
  rotateApiKey.mockResolvedValue({ new_api_key: 'newkey123456789012345678901234567890123456789012' });
  createWebhook.mockResolvedValue({ id: 'h1', secret: 'shh' });
  deleteWebhook.mockResolvedValue({ deleted: 'h1' });
  patchNotificationEmail.mockResolvedValue({});
  // Always confirm window prompts
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Layer 9: Settings', () => {
  it('renders account + key preview + webhooks', async () => {
    wrap(<Settings />);
    await screen.findByText('TestCo');
    expect(screen.getByText('****abcd')).toBeInTheDocument();
  });

  it('rotates key and displays new key once', async () => {
    wrap(<Settings />);
    await screen.findByText('TestCo');
    await userEvent.click(screen.getByRole('button', { name: /Rotate key/i }));
    await waitFor(() => expect(rotateApiKey).toHaveBeenCalled());
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it('creates a webhook', async () => {
    wrap(<Settings />);
    await screen.findByText('TestCo');
    await userEvent.type(screen.getByPlaceholderText(/booking\.confirmed/i), 'test.event');
    await userEvent.type(screen.getByPlaceholderText(/https:\/\/example\.com\/hook/i), 'https://x.test/hook');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(createWebhook).toHaveBeenCalledWith({
      event_type: 'test.event', endpoint_url: 'https://x.test/hook',
    }));
  });
});
