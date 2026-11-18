// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

type GoogleResult = { role: string | null; isNew: boolean; firstName: string; requestedRole?: string; roleProblem?: string };

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  user: null as null | { id: string },
  loading: false,
  authUserId: undefined as string | undefined,
  getUserCalls: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  declare: vi.fn(),
  refreshAccount: vi.fn(async () => undefined),
  lastGoogleProps: null as null | { context: string; signupRole?: string; oneTap?: boolean; onSignedIn: (r: GoogleResult) => void },
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.loading, signIn: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut }) }));
vi.mock('../../contexts/AccountContext', () => ({ useAccount: () => ({ refresh: mocks.refreshAccount }) }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: (...a: unknown[]) => { mocks.getUserCalls(...a); return Promise.resolve({ data: { user: mocks.authUserId ? { id: mocks.authUserId } : null } }); } } } }));
vi.mock('../../lib/oauthAccount', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/oauthAccount')>()),
  declareSignupRoleIfNeeded: mocks.declare,
}));
vi.mock('./GoogleSignInButton', () => ({
  default: (props: { context: string; signupRole?: string; oneTap?: boolean; onSignedIn: (r: GoogleResult) => void }) => {
    mocks.lastGoogleProps = props;
    return <button type="button">Google ({props.context}{props.signupRole ? `, ${props.signupRole}` : ''})</button>;
  },
}));

import AuthForm from './AuthForm';
import { getPendingAuthStep, setPendingAuthStep } from '../../lib/pendingAuthStep';

const authTree = (entry: string | { pathname: string; state?: unknown }) => (
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/auth" element={<AuthForm />} />
      <Route path="/dashboard" element={<p>Panel del cliente</p>} />
      <Route path="/chats" element={<p>Chats de Antonio</p>} />
      <Route path="/admin/dashboard" element={<p>Panel de administrador</p>} />
      <Route path="/empresa" element={<p>Panel de empresa</p>} />
      <Route path="/" element={<p>Inicio</p>} />
    </Routes>
  </MemoryRouter>
);

const renderAuth = (entry: string | { pathname: string; state?: unknown } = '/auth') => render(authTree(entry));

/** Como en la vida real: la pantalla de entrar ya estaba abierta y la sesión se inicia DESPUÉS (Google). */
const renderThenSignIn = (userId: string, entry: string | { pathname: string; state?: unknown } = '/auth') => {
  mocks.user = null;
  const result = render(authTree(entry));
  mocks.user = { id: userId };
  result.rerender(authTree(entry));
  return result;
};

const optionNames = () => screen.getAllByRole('button').map((b) => b.textContent ?? '');

describe('AuthForm · acceso y registro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPendingAuthStep(null);
    mocks.user = null;
    mocks.loading = false;
    mocks.authUserId = undefined;
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123');
    mocks.declare.mockImplementation(async (result: GoogleResult, role?: string) => (role ? { ...result, role, requestedRole: role } : result));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  describe('a dónde vuelve quien entra (QA-155, QA-085, QA-012)', () => {
    const login = async () => {
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'ana@ejemplo.com' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    };

    it('el inicio de sesión normal NO espera ninguna petición antes de navegar (esa espera dejaba el panel del profesional en blanco)', async () => {
      mocks.signIn.mockResolvedValue('gardener');
      renderAuth();
      await login();
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(mocks.getUserCalls).not.toHaveBeenCalled();
    });

    it('la misma cuenta, tras cerrarse su sesión, vuelve a la página en la que estaba', async () => {
      mocks.signIn.mockResolvedValue('gardener');
      mocks.authUserId = 'antonio';
      renderAuth({ pathname: '/auth', state: { redirectTo: '/chats', redirectUserId: 'antonio' } });
      await login();
      expect(await screen.findByText('Chats de Antonio')).toBeTruthy();
    });

    it('OTRA cuenta en el mismo móvil NO hereda la página de la anterior: va a su inicio', async () => {
      mocks.signIn.mockResolvedValue('gardener');
      mocks.authUserId = 'miguel';
      renderAuth({ pathname: '/auth', state: { redirectTo: '/chats', redirectUserId: 'antonio' } });
      await login();
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(screen.queryByText('Chats de Antonio')).toBeNull();
    });

    it('si no se puede saber quién entró, la ruta de una sesión anterior se ignora', async () => {
      mocks.signIn.mockResolvedValue('gardener');
      mocks.authUserId = undefined;
      renderAuth({ pathname: '/auth', state: { redirectTo: '/chats', redirectUserId: 'antonio' } });
      await login();
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('una página de administrador nunca se le ofrece a un cliente (antes: «Acceso denegado»)', async () => {
      mocks.signIn.mockResolvedValue('client');
      mocks.authUserId = 'ana';
      renderAuth({ pathname: '/auth', state: { redirectTo: '/admin/dashboard' } });
      await login();
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(screen.queryByText('Panel de administrador')).toBeNull();
    });

    it('quien abre /auth con la sesión ya iniciada va a su inicio, no al formulario (QA-012)', async () => {
      mocks.user = { id: 'ana' };
      renderAuth();
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull();
    });

    it('mientras se comprueba la sesión no decide nada', () => {
      mocks.user = null;
      mocks.loading = true;
      renderAuth();
      expect(screen.queryByText('Panel del cliente')).toBeNull();
    });
  });

  describe('Entrar', () => {
    it('arriba Google, luego «o con tu correo», el formulario y la nota legal', () => {
      renderAuth();
      expect(screen.getByRole('tab', { name: 'Entrar' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('button', { name: 'Google (signin)' })).toBeTruthy();
      expect(mocks.lastGoogleProps!.oneTap).toBe(true);
      expect(screen.getByRole('separator', { name: 'o con tu correo' })).toBeTruthy();
      expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
      expect(screen.getByLabelText('Contraseña')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Términos y condiciones' }).getAttribute('href')).toBe('/terminos');
      expect(screen.getByRole('link', { name: 'Política de privacidad' }).getAttribute('href')).toBe('/privacidad');
    });

    it('no pregunta el tipo de cuenta ni enseña el repetir contraseña', () => {
      renderAuth();
      expect(screen.queryByText('¿Cómo vas a usar GarSer?')).toBeNull();
      expect(screen.queryByLabelText('Repite la contraseña')).toBeNull();
    });

    it('autorrelleno y teclado del móvil bien indicados', () => {
      renderAuth();
      const email = screen.getByLabelText('Correo electrónico') as HTMLInputElement;
      expect(email.getAttribute('autocomplete')).toBe('email');
      expect(email.getAttribute('inputmode')).toBe('email');
      expect((screen.getByLabelText('Contraseña') as HTMLInputElement).getAttribute('autocomplete')).toBe('current-password');
    });

    it('el ojo muestra y oculta la contraseña, con nombre accesible', () => {
      renderAuth();
      const password = screen.getByLabelText('Contraseña') as HTMLInputElement;
      expect(password.type).toBe('password');
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
      expect(password.type).toBe('text');
      fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
      expect(password.type).toBe('password');
    });

    it('un profesional ve una entrada clara a su registro, que lleva a elegir el tipo', () => {
      renderAuth();
      fireEvent.click(screen.getByRole('button', { name: /¿Ofreces servicios de jardinería\?/ }));
      expect(screen.getByRole('tab', { name: 'Crear cuenta' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('¿Cómo vas a usar GarSer?')).toBeTruthy();
    });

    it('con email y contraseña correctos entra y va a su panel', async () => {
      mocks.signIn.mockResolvedValue('client');
      renderAuth();
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'ana@ejemplo.com' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(mocks.signIn).toHaveBeenCalledWith('ana@ejemplo.com', 'secreto1');
    });

    it('un correo mal escrito se explica junto al campo', async () => {
      renderAuth();
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'esto-no-es-un-correo' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Escribe un correo válido');
      expect(mocks.signIn).not.toHaveBeenCalled();
    });
  });

  describe('Crear cuenta: primero, qué tipo', () => {
    it('sin tipo preseleccionado: solo la pregunta; ni Google ni formulario todavía', () => {
      renderAuth('/auth?mode=signup');
      expect(screen.getByText('¿Cómo vas a usar GarSer?')).toBeTruthy();
      expect(optionNames().some((n) => /Cliente/.test(n))).toBe(true);
      expect(optionNames().some((n) => /Profesional/.test(n))).toBe(true);
      // Un solo tipo de profesional (D31): la empresa no se elige al registrarse, nace al añadir a alguien.
      expect(optionNames().some((n) => /Empresa|Jardinero/.test(n))).toBe(false);
      expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
      expect(screen.queryByLabelText('Correo electrónico')).toBeNull();
      expect(screen.getByText('Después no podrás cambiar el tipo de cuenta.')).toBeTruthy();
    });

    it('elegir Profesional: Google y el formulario aparecen, y Google lleva el tipo elegido', () => {
      renderAuth('/auth?mode=signup');
      fireEvent.click(screen.getByRole('button', { name: /Profesional/ }));
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();
      expect(mocks.lastGoogleProps!.oneTap).toBe(false);
      expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
      expect(screen.getByLabelText('Repite la contraseña')).toBeTruthy();
      expect(screen.getByText(/La revisamos antes de publicarte/)).toBeTruthy();
    });

    it('Cliente no manda ningún tipo especial a Google ni enseña el aviso de revisión', () => {
      renderAuth('/auth?mode=signup');
      fireEvent.click(screen.getByRole('button', { name: /Profesional/ }));
      expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /Cambiar tipo de cuenta/ }));
      fireEvent.click(screen.getByRole('button', { name: /Cliente/ }));
      expect(screen.getByRole('button', { name: 'Google (signup)' })).toBeTruthy();
      expect(mocks.lastGoogleProps!.signupRole).toBeUndefined();
      expect(screen.queryByText(/La revisamos antes/)).toBeNull();
    });

    it('«Cambiar tipo de cuenta» vuelve a la pregunta y quita Google', () => {
      renderAuth('/auth?mode=signup&role=gardener');
      expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Cambiar tipo de cuenta/ }));
      expect(screen.getByText('¿Cómo vas a usar GarSer?')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    });

    it('el aviso de «los profesionales se revisan» solo sale al CREAR cuenta, no al entrar', () => {
      renderAuth('/auth?mode=signup&role=gardener');
      expect(screen.getByText(/La revisamos antes de publicarte/)).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Entrar' }));
      expect(screen.queryByText(/La revisamos antes de publicarte/)).toBeNull();
    });

    it('desde la web de jardineros llega con el tipo ya elegido (sin pregunta)', () => {
      renderAuth({ pathname: '/auth', state: { initialMode: 'signup', preselectedRole: 'gardener' } });
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();
    });

    it('un enlace antiguo con role=company (estado o URL) se registra como profesional (D31)', () => {
      renderAuth({ pathname: '/auth', state: { initialMode: 'signup', preselectedRole: 'company' } });
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();
      cleanup();
      renderAuth('/auth?mode=signup&role=company');
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
      expect(screen.queryByText(/Crea tu cuenta de empresa/)).toBeNull();
    });

    it('?role=gardener sin modo abre el registro, no el acceso', () => {
      renderAuth('/auth?role=gardener');
      expect(screen.getByRole('tab', { name: 'Crear cuenta' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
    });

    it('una invitación de empleado (solo cliente): tipo fijo, sin cambiar y sin entrada profesional', () => {
      renderAuth({ pathname: '/auth', state: { initialMode: 'login', forceClientOnly: true } });
      expect(screen.queryByRole('button', { name: /¿Ofreces servicios de jardinería\?/ })).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: 'Crear cuenta' }));
      expect(screen.getByRole('heading', { name: 'Crea tu cuenta de cliente' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Cambiar tipo de cuenta/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Profesional/ })).toBeNull();
    });

    it('con correo: manda el tipo elegido al alta y abre el aviso de confirmación', async () => {
      mocks.signUp.mockResolvedValue(undefined);
      renderAuth('/auth?mode=signup&role=gardener');
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'pepe@ejemplo.com' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } });
      fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'secreto1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
      await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith('pepe@ejemplo.com', 'secreto1', 'gardener'));
    });

    it('si las contraseñas no coinciden, lo dice junto al campo y no crea la cuenta', async () => {
      renderAuth('/auth?mode=signup&role=client');
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'pepe@ejemplo.com' } });
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } });
      fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'otra-cosa' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Las contraseñas no coinciden');
      expect(mocks.signUp).not.toHaveBeenCalled();
    });
  });

  describe('Después de Google', () => {
    // Con sesión, como en la vida real: sin ella no hay nada pendiente.
    // La sesión se inicia con la pantalla ya abierta (renderThenSignIn).
    beforeEach(() => { mocks.user = null; });

    it('cuenta de siempre: saluda y va a su panel, sin preguntar nada', async () => {
      renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: false, firstName: 'Ana' });
      expect(mocks.toast.success).toHaveBeenCalledWith('¡Hola de nuevo, Ana!');
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('registro con Cliente elegido: bienvenida y panel, sin repreguntar', async () => {
      renderThenSignIn('u-1', '/auth?mode=signup&role=client');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      expect(mocks.toast.success).toHaveBeenCalledWith('¡Bienvenido a GarSer, Ana!');
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('registro como profesional: la cuenta ya es de profesional y va a su panel (/dashboard decide el modo)', async () => {
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'gardener', isNew: true, firstName: 'Ana', requestedRole: 'gardener' });
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('al cambiar el tipo de cuenta, la app relee el tipo ANTES de navegar (si no, se ve el panel de cliente)', async () => {
      const order: string[] = [];
      mocks.refreshAccount.mockImplementation(async () => { order.push('refresh'); });
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'gardener', isNew: true, firstName: 'Ana', requestedRole: 'gardener' });
      await screen.findByText('Panel del cliente');
      expect(order).toEqual(['refresh']);
      expect(mocks.refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('entrar con una cuenta de siempre no relee nada de más', async () => {
      renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: false, firstName: 'Ana' });
      await screen.findByText('Panel del cliente');
      expect(mocks.refreshAccount).not.toHaveBeenCalled();
    });

    it('«Entrar» con Google que CREA una cuenta nueva: antes de seguir pregunta el tipo', async () => {
      renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      expect(await screen.findByRole('heading', { name: 'Te damos la bienvenida, Ana' })).toBeTruthy();
      expect(screen.getByText('Hemos creado tu cuenta. ¿Cómo vas a usar GarSer?')).toBeTruthy();
      expect(screen.queryByText('Panel del cliente')).toBeNull();
      expect(mocks.toast.success).not.toHaveBeenCalled();
    });

    it('la pregunta SOBREVIVE a que la pantalla se desmonte (App enseña «Cargando…» al haber sesión)', async () => {
      const first = renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      expect(await screen.findByRole('heading', { name: 'Te damos la bienvenida, Ana' })).toBeTruthy();
      first.unmount();
      expect(getPendingAuthStep()?.kind).toBe('chooser');

      // Al remontar, la sesión ya existe (y el paso pendiente impide que se la lleve al inicio).
      mocks.user = { id: 'u-1' };
      renderAuth();
      expect(await screen.findByRole('heading', { name: 'Te damos la bienvenida, Ana' })).toBeTruthy();
    });

    it('si el aviso llega cuando la pantalla ya se había desmontado, la nueva lo enseña igual', async () => {
      renderThenSignIn('u-1');
      const onSignedIn = mocks.lastGoogleProps!.onSignedIn;
      cleanup();
      onSignedIn({ role: 'client', isNew: false, firstName: 'Ana', requestedRole: 'gardener', roleProblem: 'has_activity' });
      mocks.user = { id: 'u-1' };
      renderAuth();
      expect(await screen.findByRole('heading', { name: 'Este correo ya tiene una cuenta de cliente' })).toBeTruthy();
    });

    it('sin sesión no se enseña nada pendiente (otra persona, sesión cerrada)', () => {
      setPendingAuthStep({ kind: 'chooser', result: { role: 'client', isNew: true, firstName: 'Ana' } });
      mocks.user = null;
      renderAuth();
      expect(screen.queryByRole('heading', { name: 'Te damos la bienvenida, Ana' })).toBeNull();
      expect(getPendingAuthStep()).toBeNull();
    });

    it('…y si dice Cliente, sigue como cliente', async () => {
      renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      fireEvent.click(await screen.findByRole('button', { name: /Cliente/ }));
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(mocks.declare).not.toHaveBeenCalled();
    });

    it('…y si dice Profesional, se declara al servidor y va a su panel; no hay opción «Empresa»', async () => {
      renderThenSignIn('u-1');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      expect(await screen.findByRole('button', { name: /Profesional/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Empresa/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Profesional/ }));
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(mocks.declare).toHaveBeenCalledWith({ role: 'client', isNew: true, firstName: 'Ana' }, 'gardener');
    });

    it('si Google crea la cuenta desde una invitación de empleado (solo cliente), no pregunta', async () => {
      renderThenSignIn('u-1', { pathname: '/auth', state: { initialMode: 'login', forceClientOnly: true } });
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('eligió jardinero y la cuenta ya tiene reservas de cliente: lo explica, no entra como cliente en silencio', async () => {
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: false, firstName: 'Ana', requestedRole: 'gardener', roleProblem: 'has_activity' });
      expect(await screen.findByRole('heading', { name: 'Este correo ya tiene una cuenta de cliente' })).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/reservas o solicitudes/);
      expect(screen.queryByText('Panel del cliente')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Seguir como cliente' }));
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
    });

    it('«Usar otro correo» cierra la sesión de Google y vuelve al formulario', async () => {
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: false, firstName: 'Ana', requestedRole: 'gardener', roleProblem: 'has_activity' });
      fireEvent.click(await screen.findByRole('button', { name: 'Usar otro correo' }));
      await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
      expect(await screen.findByRole('heading', { name: 'Crea tu cuenta de profesional' })).toBeTruthy();
    });

    it('si falló al declarar el tipo, ofrece Reintentar y, si sale bien, sigue al panel', async () => {
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana', requestedRole: 'gardener', roleProblem: 'failed' });
      expect(await screen.findByRole('heading', { name: 'No hemos podido crear tu cuenta de profesional' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Panel del cliente')).toBeTruthy();
      expect(mocks.declare).toHaveBeenCalledWith({ role: 'client', isNew: true, firstName: 'Ana', requestedRole: 'gardener', roleProblem: undefined }, 'gardener');
    });

    it('si Reintentar vuelve a fallar, sigue en el aviso (no se escapa al panel)', async () => {
      mocks.declare.mockImplementation(async (result: GoogleResult) => ({ ...result, roleProblem: 'failed' }));
      renderThenSignIn('u-1', '/auth?mode=signup&role=gardener');
      mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana', requestedRole: 'gardener', roleProblem: 'failed' });
      fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
      await waitFor(() => expect(mocks.declare).toHaveBeenCalled());
      expect(screen.getByRole('heading', { name: 'No hemos podido crear tu cuenta de profesional' })).toBeTruthy();
      expect(screen.queryByText('Panel del cliente')).toBeNull();
    });
  });

  describe('Recuperar contraseña', () => {
    it('lleva a su pantalla, con la confirmación antes de enviar, y se puede volver', () => {
      renderAuth();
      fireEvent.click(screen.getByRole('button', { name: '¿Has olvidado tu contraseña?' }));
      expect(screen.getByRole('heading', { name: 'Recuperar contraseña' })).toBeTruthy();
      expect(screen.queryByRole('tab', { name: 'Entrar' })).toBeNull();
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'ana@ejemplo.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('ana@ejemplo.com')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Volver a entrar' }));
      expect(screen.getByRole('tab', { name: 'Entrar' })).toBeTruthy();
    });
  });

  it('«Volver a la web» lleva al inicio', async () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Volver a la web/ }));
    expect(await screen.findByText('Inicio')).toBeTruthy();
  });

  it('sin Client ID de Google, la pantalla funciona igual solo con correo', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    renderAuth('/auth?mode=signup&role=gardener');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
  });
});
