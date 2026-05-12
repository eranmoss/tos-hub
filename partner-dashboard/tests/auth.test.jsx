import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { requestMagicLink, verifyToken } = vi.hoisted(() => ({
  requestMagicLink: vi.fn(async () => ({ message: 'check your email' })),
  verifyToken: vi.fn(async () => ({ jwt: 'fake.jwt.token' })),
}));

vi.mock('../src/api/auth.js', () => ({ requestMagicLink, verifyToken }));

import MagicLinkForm from '../src/auth/MagicLinkForm.jsx';
import VerifyToken from '../src/auth/VerifyToken.jsx';
import ProtectedRoute from '../src/auth/ProtectedRoute.jsx';

describe('Layer 2: MagicLinkForm', () => {
  it('submits email and shows success state', async () => {
    render(<MemoryRouter><MagicLinkForm /></MemoryRouter>);
    await userEvent.type(screen.getByPlaceholderText(/you@partner\.com/i), 'foo@bar.com');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    expect(requestMagicLink).toHaveBeenCalledWith('foo@bar.com');
    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
  });
});

describe('Layer 2: VerifyToken', () => {
  it('stores JWT and navigates to /dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/verify/tok123']}>
        <Routes>
          <Route path="/verify/:token" element={<VerifyToken />} />
          <Route path="/dashboard" element={<div>Dashboard Home</div>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(localStorage.getItem('tos_jwt')).toBe('fake.jwt.token'));
    await waitFor(() => expect(screen.getByText(/Dashboard Home/)).toBeInTheDocument());
  });
});

describe('Layer 2: ProtectedRoute', () => {
  it('redirects to /login when no jwt', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><div>Private</div></ProtectedRoute>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/Login page/)).toBeInTheDocument();
  });

  it('renders children when a valid (non-expired) jwt is present', () => {
    // jwt with exp far in the future
    const payload = { tenant_id: 't1', tenant_name: 'T', tier: 'GROWTH', email: 'e@e.com', exp: 9999999999 };
    const b64 = btoa(JSON.stringify(payload)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    localStorage.setItem('tos_jwt', `header.${b64}.sig`);
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><div>Private</div></ProtectedRoute>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Private')).toBeInTheDocument();
  });
});
