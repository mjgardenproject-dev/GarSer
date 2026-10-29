// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  update: vi.fn(),
  role: vi.fn(async () => 'client'),
  rpc: vi.fn(async () => ({ error: null })),
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }),
      update: (patch: unknown) => ({ eq: async (_col: string, id: string) => { mocks.update(patch, id); return { error: null }; } }),
    }),
    rpc: mocks.rpc,
  },
}));
vi.mock('./adminAccess', () => ({ fetchCurrentUserProfileRole: mocks.role }));

import { declareSignupRoleIfNeeded, describeOAuthSignIn, googleProfileOf, syncProfileFromGoogle, usesGoogle, welcomeMessage } from './oauthAccount';

let n = 0;
const googleUser = (overrides: Partial<User> = {}): User => ({
  id: `u-${++n}`,
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'Ana López', picture: 'https://lh3.googleusercontent.com/a/abc' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
  identities: [],
  ...overrides,
} as unknown as User);

describe('oauthAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = { full_name: '', avatar_url: null, role: 'client' };
  });

  it('reconoce las cuentas que usan Google (también las unidas a una de correo)', () => {
    expect(usesGoogle(googleUser())).toBe(true);
    expect(usesGoogle(googleUser({ app_metadata: { provider: 'email', providers: ['email', 'google'] } }))).toBe(true);
    expect(usesGoogle(googleUser({ app_metadata: { provider: 'email', providers: ['email'] } }))).toBe(false);
    expect(usesGoogle(null)).toBe(false);
  });

  it('toma el nombre y solo fotos por https', () => {
    expect(googleProfileOf(googleUser())).toEqual({ fullName: 'Ana López', avatarUrl: 'https://lh3.googleusercontent.com/a/abc' });
    expect(googleProfileOf(googleUser({ user_metadata: { name: 'Ana', avatar_url: 'javascript:alert(1)' } })).avatarUrl).toBe('');
  });

  it('completa nombre y foto de un cliente si están vacíos, una vez por sesión', async () => {
    const user = googleUser();
    await syncProfileFromGoogle(user);
    expect(mocks.update).toHaveBeenCalledWith({ full_name: 'Ana López', avatar_url: 'https://lh3.googleusercontent.com/a/abc' }, user.id);
    await syncProfileFromGoogle(user);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('nunca pisa lo que ya tiene el perfil', async () => {
    mocks.profile = { full_name: 'Ana L.', avatar_url: 'https://garser.es/foto.jpg', role: 'client' };
    await syncProfileFromGoogle(googleUser());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('a un profesional no le pone la foto de Google (es la que ven sus clientes)', async () => {
    mocks.profile = { full_name: '', avatar_url: null, role: 'gardener' };
    await syncProfileFromGoogle(googleUser());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('distingue cuenta nueva de cuenta de siempre y saluda', async () => {
    const now = Date.now();
    const fresh = await describeOAuthSignIn(googleUser({ created_at: new Date(now - 10_000).toISOString() }), now);
    expect(fresh).toEqual({ role: 'client', isNew: true, firstName: 'Ana' });
    expect(welcomeMessage(fresh)).toBe('¡Bienvenido a GarSer, Ana!');
    const old = await describeOAuthSignIn(googleUser({ created_at: '2026-01-01T00:00:00Z' }), now);
    expect(old.isNew).toBe(false);
    expect(welcomeMessage({ isNew: false, firstName: '' })).toBe('¡Hola de nuevo!');
  });

  describe('declareSignupRoleIfNeeded', () => {
    const client = { role: 'client', isNew: true, firstName: 'Ana' };

    it('cuenta nueva, aún client, con rol de alta: llama a la RPC y devuelve el rol nuevo', async () => {
      const result = await declareSignupRoleIfNeeded(client, 'gardener');
      expect(mocks.rpc).toHaveBeenCalledWith('self_declare_signup_role', { p_role: 'gardener' });
      expect(result).toEqual({ role: 'gardener', isNew: true, firstName: 'Ana' });
    });

    it('sin rol de alta (cliente normal, o solo entrando): no llama a la RPC', async () => {
      const result = await declareSignupRoleIfNeeded(client, undefined);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result).toEqual(client);
    });

    it('cuenta que no es nueva: no llama a la RPC aunque haya rol de alta', async () => {
      const result = await declareSignupRoleIfNeeded({ ...client, isNew: false }, 'company');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result.role).toBe('client');
    });

    it('la cuenta ya no es client (doble clic, reintento): no llama a la RPC', async () => {
      const result = await declareSignupRoleIfNeeded({ ...client, role: 'gardener' }, 'company');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result.role).toBe('gardener');
    });

    it('si la RPC falla, no rompe el alta: devuelve el resultado original', async () => {
      mocks.rpc.mockResolvedValueOnce({ error: { message: 'nope' } });
      const result = await declareSignupRoleIfNeeded(client, 'gardener');
      expect(result).toEqual(client);
    });
  });
});
