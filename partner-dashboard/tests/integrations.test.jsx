import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const {
  getSuppliers, runSupplierTest,
  createOnboardSession, patchOnboardManifest, confirmOnboardSession,
  promoteOnboardSession, getOnboardSession, analyzeDocsUrl,
} = vi.hoisted(() => ({
  getSuppliers: vi.fn(),
  runSupplierTest: vi.fn(),
  createOnboardSession: vi.fn(async () => ({ session_id: 'sess_1' })),
  patchOnboardManifest: vi.fn(async () => ({ session_id: 'sess_1' })),
  confirmOnboardSession: vi.fn(),
  promoteOnboardSession: vi.fn(),
  getOnboardSession: vi.fn(),
  analyzeDocsUrl: vi.fn(),
}));
vi.mock('../src/api/dashboard.js', () => ({
  getSuppliers, runSupplierTest,
  createOnboardSession, patchOnboardManifest, confirmOnboardSession,
  promoteOnboardSession, getOnboardSession, analyzeDocsUrl,
}));

import Integrations from '../src/pages/Integrations.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<MemoryRouter><PageContextProvider>{ui}</PageContextProvider></MemoryRouter>);

beforeEach(() => {
  getSuppliers.mockReset();
  runSupplierTest.mockReset();
});

describe('Layer 6: Integrations', () => {
  it('renders supplier cards', async () => {
    getSuppliers.mockResolvedValue({ integrations: [
      { supplier_slug: 'hb', name: 'HotelBeds', categories: ['HOTEL'], status: 'UP',
        sla_tier: 'ENTERPRISE', operations: ['search','book','cancel','get'],
        last_test_run: { status: 'PASS', ran_at: new Date().toISOString(), steps_passed: 6, steps_total: 6 },
        credential_rotation_due: null, activated_at: new Date().toISOString() },
    ] });
    wrap(<Integrations />);
    await screen.findByText('HotelBeds');
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
  });

  it('run tests button triggers API', async () => {
    getSuppliers.mockResolvedValue({ integrations: [
      { supplier_slug: 'hb', name: 'HotelBeds', categories: ['HOTEL'], status: 'UP',
        sla_tier: 'ENTERPRISE', operations: ['search'], last_test_run: null, activated_at: null },
    ] });
    runSupplierTest.mockResolvedValue({ session_id: 's1', message: 'ok' });
    wrap(<Integrations />);
    await screen.findByText('HotelBeds');
    await userEvent.click(screen.getByRole('button', { name: /Run Tests/i }));
    await waitFor(() => expect(runSupplierTest).toHaveBeenCalledWith('hb'));
  });

  it('wizard opens with docs step and advances', async () => {
    getSuppliers.mockResolvedValue({ integrations: [] });
    wrap(<Integrations />);
    await userEvent.click(await screen.findByRole('button', { name: /Add Integration/i }));
    expect(screen.getByText(/Step 1 of 9/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/openapi.yaml/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Next/i }));
    expect(screen.getByText(/Step 2 of 9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Next/i }));
    await waitFor(() => expect(createOnboardSession).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Step 3 of 9/)).toBeInTheDocument());
  });

  it('Step 0 Analyze populates detected auth and credentials', async () => {
    getSuppliers.mockResolvedValue({ integrations: [] });
    analyzeDocsUrl.mockResolvedValue({
      ok: true,
      mode: 'OPENAPI',
      supplier_name: 'Bridgify',
      base_url_sandbox: 'https://api.bridgify.io',
      base_url_production: 'https://api.bridgify.io',
      auth: {
        auth_type: 'OAUTH2_CLIENT_CREDENTIALS',
        credential_fields: ['client_id', 'client_secret'],
        token_url: 'https://api.bridgify.io/accounts/token/',
        scopes: ['read', 'write'],
      },
      operations: { search: { method: 'GET', endpoint: '/attractions/products/' } },
      confidence: 'HIGH',
      paths_found: 6,
      missing: [],
    });

    wrap(<Integrations />);
    await userEvent.click(await screen.findByRole('button', { name: /Add Integration/i }));
    const input = screen.getByPlaceholderText(/openapi.yaml/i);
    await userEvent.type(input, 'https://docs.bridgify.io/');
    await userEvent.click(screen.getByRole('button', { name: /Analyze/i }));

    await waitFor(() => expect(analyzeDocsUrl).toHaveBeenCalledWith('https://docs.bridgify.io/'));
    await screen.findByText('Bridgify');
    expect(screen.getByText(/OAUTH2_CLIENT_CREDENTIALS/)).toBeInTheDocument();
    expect(screen.getByText('client_id')).toBeInTheDocument();
    expect(screen.getByText('client_secret')).toBeInTheDocument();
    expect(screen.getByText(/HIGH confidence/)).toBeInTheDocument();
  });
});
