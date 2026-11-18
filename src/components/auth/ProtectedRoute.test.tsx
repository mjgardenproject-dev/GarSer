// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  auth: { user: null as null | { id: string }, loading: false, sessionEndedUserId: null as string | null, signedOutByUser: false },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));

import ProtectedRoute from './ProtectedRoute';

const AuthProbe = () => {
  const state = useLocation().state as { redirectTo?: string; redirectUserId?: string } | null;
  return <p>auth → {state?.redirectTo ?? 'sin vuelta'} · de {state?.redirectUserId ?? 'nadie'}</p>;
};

const renderAt = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/chat" element={<ProtectedRoute><p>chats</p></ProtectedRoute>} />
      <Route path="/auth" element={<AuthProbe />} />
    </Routes>
  </MemoryRouter>,
);

describe('ProtectedRoute sin sesión (QA-155)', () => {
  afterEach(() => { cleanup(); mocks.auth.user = null; mocks.auth.sessionEndedUserId = null; mocks.auth.signedOutByUser = false; });

  it('recuerda la página Y de quién era la sesión que se cerró, para que otra cuenta no la herede', () => {
    mocks.auth.sessionEndedUserId = 'antonio';
    renderAt('/chat');
    expect(screen.getByText('auth → /chat · de antonio')).toBeTruthy();
  });

  it('un visitante que abre un enlace protegido (sin sesión anterior) vuelve a él al entrar', () => {
    renderAt('/chat');
    expect(screen.getByText('auth → /chat · de nadie')).toBeTruthy();
  });

  it('con sesión enseña la página', () => {
    mocks.auth.user = { id: 'antonio' };
    renderAt('/chat');
    expect(screen.getByText('chats')).toBeTruthy();
  });

  it('quien ACABA de cerrar sesión desde esta página no la deja «recordada» como enlace de vuelta (QA-155)', () => {
    mocks.auth.signedOutByUser = true;
    renderAt('/chat');
    // No navega a /auth con la página recordada (la recarga a /auth la hace el cierre de sesión).
    expect(screen.queryByText(/auth →/)).toBeNull();
    expect(screen.queryByText('chats')).toBeNull();
  });
});
