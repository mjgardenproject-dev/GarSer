// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  signOut: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } }, error: null })),
  getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null as null | { code: string; status: number } })),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      getUser: mocks.getUser,
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

  describe('clave del enlace de un profesional (QA-101)', () => {
    const KEY = 'garser.providerLinkCodes.v1';
    const PRO = '11111111-1111-4111-8111-111111111111';
    const CODE = '0123456789abcdef0123456789abcdef';
    beforeEach(() => localStorage.clear());

    it('«Cerrar sesión» la olvida', async () => {
      localStorage.setItem(KEY, JSON.stringify({ [PRO]: { code: CODE, at: Date.now(), userId: 'u1' } }));
      render(<AuthProvider><Probe /></AuthProvider>);
      await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
      await act(async () => { await ctx.signOut(); });
      await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('si la sesión caduca sola, se conserva ligada a su cuenta', async () => {
      localStorage.setItem(KEY, JSON.stringify({ [PRO]: { code: CODE, at: Date.now(), userId: 'u1' } }));
      render(<AuthProvider><Probe /></AuthProvider>);
      await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
      await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
      expect(JSON.parse(localStorage.getItem(KEY) as string)[PRO].userId).toBe('u1');
    });

    it('al entrar, la de un visitante pasa a la cuenta y la de otra cuenta se olvida', async () => {
      const OTHER = '22222222-2222-4222-8222-222222222222';
      localStorage.setItem(KEY, JSON.stringify({
        [PRO]: { code: CODE, at: Date.now(), userId: null },
        [OTHER]: { code: CODE, at: Date.now(), userId: 'u9' },
      }));
      render(<AuthProvider><Probe /></AuthProvider>);
      await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
      const stored = JSON.parse(localStorage.getItem(KEY) as string);
      expect(stored[PRO].userId).toBe('u1');
      expect(stored).not.toHaveProperty(OTHER);
    });
  });

  it('PH-35: si la sesión se cerró en otro dispositivo, al volver a la app sale solo aquí y avisa', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } as never, error: { code: 'session_not_found', status: 403 } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { mocks.listener?.('SIGNED_IN', { user: { id: 'u1' } }); });
    await act(async () => { window.dispatchEvent(new Event('focus')); await new Promise((r) => setTimeout(r, 0)); });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await act(async () => { mocks.listener?.('SIGNED_OUT', null); });
    expect(ctx.sessionEndedAt).toBe('/empresa/solicitudes?x=1');
  });
});
