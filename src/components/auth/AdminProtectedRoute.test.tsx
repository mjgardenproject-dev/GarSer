// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../lib/adminAccess', () => ({ fetchCurrentUserProfileRole: vi.fn(), isAdminRole: () => false }));

import AdminProtectedRoute from './AdminProtectedRoute';

const AuthProbe = () => {
  const state = useLocation().state as { redirectTo?: string } | null;
  return <p>auth → {state?.redirectTo ?? 'sin vuelta'}</p>;
};

describe('AdminProtectedRoute sin sesión (PH-35)', () => {
  afterEach(cleanup);

  it('manda a la entrada recordando la página, para volver a ella', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/users?tab=bajas']}>
        <Routes>
          <Route path="/admin/users" element={<AdminProtectedRoute><p>panel</p></AdminProtectedRoute>} />
          <Route path="/auth" element={<AuthProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByText(/auth →/)).textContent).toBe('auth → /admin/users?tab=bajas');
  });
});
