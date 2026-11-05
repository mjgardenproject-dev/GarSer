// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  update: vi.fn(),
  role: vi.fn(async () => 'client'),
  rpc: vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: 'declared', error: null })),
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

import {
  accountRoleLabel, declareAccountType, declareSignupRoleIfNeeded, describeOAuthSignIn, googleProfileOf, isFreshAccount,
  rememberSignupIntent, syncProfileFromGoogle, takeSignupIntent, usesGoogle, welcomeMessage,
} from './oauthAccount';

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

  it('«cuenta nueva» se decide con las fechas del servidor, no con el reloj del móvil', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    // Móvil adelantado una hora: con el reloj parecería vieja; con las dos fechas del servidor, nueva.
    expect(isFreshAccount({ created_at: '2026-11-04T10:59:58Z', last_sign_in_at: '2026-11-04T10:59:59Z' }, now)).toBe(true);
    // Cuenta de hace días que entra otra vez ahora: vieja aunque «last_sign_in» sea reciente.
    expect(isFreshAccount({ created_at: '2026-10-01T09:00:00Z', last_sign_in_at: '2026-11-04T11:59:00Z' }, now)).toBe(false);
    // Sin la segunda fecha, se compara con el reloj (2 minutos).
    expect(isFreshAccount({ created_at: '2026-11-04T11:59:30Z', last_sign_in_at: undefined }, now)).toBe(true);
    expect(isFreshAccount({ created_at: '2026-11-04T11:00:00Z', last_sign_in_at: undefined }, now)).toBe(false);
    expect(isFreshAccount({ created_at: '', last_sign_in_at: undefined }, now)).toBe(false);
  });

  it('nombra cada tipo de cuenta para los avisos', () => {
    expect(accountRoleLabel('gardener')).toBe('jardinero');
    expect(accountRoleLabel('company')).toBe('empresa');
    expect(accountRoleLabel('employee')).toBe('empleado de una empresa');
    expect(accountRoleLabel('client')).toBe('cliente');
    expect(accountRoleLabel(null)).toBe('cliente');
  });

  describe('declareAccountType', () => {
    it('devuelve el estado que contesta el servidor', async () => {
      for (const status of ['declared', 'unchanged', 'blocked_activity', 'blocked_role'] as const) {
        mocks.rpc.mockResolvedValueOnce({ data: status, error: null });
        expect(await declareAccountType('gardener')).toBe(status);
      }
      expect(mocks.rpc).toHaveBeenCalledWith('self_declare_signup_role', { p_role: 'gardener' });
    });

    it('un error de red o de la función es «failed», nunca un éxito', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
      expect(await declareAccountType('company')).toBe('failed');
      mocks.rpc.mockResolvedValueOnce({ data: 'algo_raro', error: null });
      expect(await declareAccountType('company')).toBe('failed');
    });

    it('la versión antigua de la función (void, sin error) cuenta como hecho', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
      expect(await declareAccountType('gardener')).toBe('declared');
    });
  });

  describe('declareSignupRoleIfNeeded', () => {
    const client = { role: 'client', isNew: true, firstName: 'Ana' };

    it('con tipo elegido y cuenta cliente: lo declara y devuelve el rol nuevo', async () => {
      const result = await declareSignupRoleIfNeeded(client, 'gardener');
      expect(mocks.rpc).toHaveBeenCalledWith('self_declare_signup_role', { p_role: 'gardener' });
      expect(result).toEqual({ role: 'gardener', isNew: true, firstName: 'Ana', requestedRole: 'gardener' });
      expect(result.roleProblem).toBeUndefined();
    });

    it('ya NO depende de que la cuenta parezca nueva: una de cliente sin actividad también pasa', async () => {
      const result = await declareSignupRoleIfNeeded({ ...client, isNew: false }, 'company');
      expect(mocks.rpc).toHaveBeenCalledWith('self_declare_signup_role', { p_role: 'company' });
      expect(result.role).toBe('company');
    });

    it('sin tipo elegido (cliente normal, o solo entrando): no llama al servidor', async () => {
      const result = await declareSignupRoleIfNeeded(client, undefined);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result).toEqual(client);
    });

    it('si ya es de ese tipo (reintento, doble clic): no llama y no hay problema', async () => {
      const result = await declareSignupRoleIfNeeded({ ...client, role: 'gardener' }, 'gardener');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result.role).toBe('gardener');
      expect(result.roleProblem).toBeUndefined();
    });

    it('si es de OTRO tipo (jardinero que elige empresa): lo dice, no lo toca', async () => {
      const result = await declareSignupRoleIfNeeded({ ...client, role: 'gardener' }, 'company');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result).toMatchObject({ role: 'gardener', requestedRole: 'company', roleProblem: 'other_role' });
    });

    it('cliente con reservas: el servidor lo impide y se dice «has_activity»', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: 'blocked_activity', error: null });
      const result = await declareSignupRoleIfNeeded({ ...client, isNew: false }, 'gardener');
      expect(result).toMatchObject({ role: 'client', requestedRole: 'gardener', roleProblem: 'has_activity' });
    });

    it('si el servidor dice que ya es de otro tipo, «other_role»', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: 'blocked_role', error: null });
      const result = await declareSignupRoleIfNeeded({ role: null, isNew: false, firstName: '' }, 'gardener');
      expect(result.roleProblem).toBe('other_role');
    });

    it('si la llamada falla, NO se sigue en silencio como cliente: trae «failed»', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
      const result = await declareSignupRoleIfNeeded(client, 'gardener');
      expect(result).toMatchObject({ role: 'client', requestedRole: 'gardener', roleProblem: 'failed' });
    });
  });

  describe('tipo elegido guardado para la vuelta por redirección', () => {
    beforeEach(() => localStorage.clear());

    it('se guarda, se lee una sola vez y se borra', () => {
      rememberSignupIntent('company');
      expect(takeSignupIntent()).toBe('company');
      expect(takeSignupIntent()).toBeNull();
    });

    it('caduca a los 15 minutos', () => {
      rememberSignupIntent('gardener');
      expect(takeSignupIntent(Date.now() + 16 * 60 * 1000)).toBeNull();
    });

    it('sin tipo (cliente) borra el que hubiera de un intento anterior', () => {
      rememberSignupIntent('gardener');
      rememberSignupIntent(null);
      expect(takeSignupIntent()).toBeNull();
    });

    it('ignora valores raros', () => {
      localStorage.setItem('garser:signup-intent', JSON.stringify({ role: 'admin', at: Date.now() }));
      expect(takeSignupIntent()).toBeNull();
      localStorage.setItem('garser:signup-intent', 'no-es-json');
      expect(takeSignupIntent()).toBeNull();
    });
  });
});
