// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  auth: { sessionEndedAt: null as string | null, sessionEndedUserId: null as string | null, clearSessionEnded: vi.fn() },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn() }) }));
vi.mock('../../utils/selfAccountClosure', () => ({ ACCOUNT_CLOSED_MESSAGE: 'x', consumeAccountClosed: () => false }));

import SessionEndedNotice from './SessionEndedNotice';

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}|{JSON.stringify(location.state)}</p>;
};

const renderAt = () => render(
  <MemoryRouter initialEntries={['/chats']}>
    <SessionEndedNotice />
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);

describe('SessionEndedNotice (QA-155)', () => {
  beforeEach(() => { mocks.auth.clearSessionEnded.mockClear(); });
  afterEach(cleanup);

  it('manda a /auth con la página en la que estaba Y la cuenta a la que pertenecía', () => {
    mocks.auth.sessionEndedAt = '/chats';
    mocks.auth.sessionEndedUserId = 'antonio';
    renderAt();
    const where = screen.getByTestId('where').textContent || '';
    expect(where.startsWith('/auth|')).toBe(true);
    const state = JSON.parse(where.slice('/auth|'.length));
    expect(state.redirectTo).toBe('/chats');
    expect(state.redirectUserId).toBe('antonio');
    expect(mocks.auth.clearSessionEnded).toHaveBeenCalled();
  });

  it('sin sesión cerrada no hace nada', () => {
    mocks.auth.sessionEndedAt = null;
    mocks.auth.sessionEndedUserId = null;
    renderAt();
    expect((screen.getByTestId('where').textContent || '').startsWith('/chats')).toBe(true);
  });
});
