// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  signOut: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } }, error: null })),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: (cb: typeof mocks.listener) => {
        mocks.listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: mocks.signOut,
    },
  },
}));
vi.mock('../lib/adminAccess', () => ({ fetchCurrentUserProfileRole: vi.fn(async () => 'company') }));
vi.mock('../utils/bookingResumeStorage', () => ({ clearBookingResumeStorage: vi.fn() }));

import { AuthProvider, useAuth } from './AuthContext';

let ctx: ReturnType<typeof useAuth>;
const Probe = () => { ctx = useAuth(); return null; };

describe('AuthContext: cierre de sesión (R-06)', () => {
  beforeEach(() => {
    mocks.signOut.mockClear();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn(), pathname: '/empresa/solicitudes', search: '?x=1' }, writable: true });
  });
  afterEach(() => cleanup());

  it('cerrar sesión es solo en este dispositivo, y no se avisa como «cerrada desde fuera»', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
    await act(async () => { await ctx.signOut(); });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
    expect(ctx.sessionEndedAt).toBeNull();
  });

  it('«cerrar en todos los dispositivos» es global', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await ctx.signOutEverywhere(); });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('una sesión cerrada desde fuera guarda la página para volver a ella', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
    await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
    expect(ctx.sessionEndedAt).toBe('/empresa/solicitudes?x=1');
    await act(async () => { ctx.clearSessionEnded(); });
    expect(ctx.sessionEndedAt).toBeNull();
  });

  it('sin nadie dentro, un SIGNED_OUT no avisa', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
    expect(ctx.sessionEndedAt).toBeNull();
  });
});
