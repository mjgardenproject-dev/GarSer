// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sha256Hex, type GoogleIdConfiguration } from '../../utils/googleIdentity';

const mocks = vi.hoisted(() => ({
  signInWithIdToken: vi.fn(),
  signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
  load: vi.fn(),
  describe: vi.fn(async () => ({ role: 'client', isNew: true, firstName: 'Ana' })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithIdToken: mocks.signInWithIdToken, signInWithOAuth: mocks.signInWithOAuth } },
}));
vi.mock('../../lib/oauthAccount', () => ({ describeOAuthSignIn: mocks.describe }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../utils/googleIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/googleIdentity')>()),
  loadGoogleIdentity: mocks.load,
}));

import GoogleSignInButton from './GoogleSignInButton';

function fakeGoogle() {
  let config: GoogleIdConfiguration | null = null;
  const api = {
    initialize: vi.fn((c: GoogleIdConfiguration) => { config = c; }),
    renderButton: vi.fn((el: HTMLElement) => { el.innerHTML = '<div role="button">Continuar con Google</div>'; }),
    prompt: vi.fn(),
    cancel: vi.fn(),
    disableAutoSelect: vi.fn(),
  };
  return { api, config: () => config! };
}

const setUserAgent = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    setUserAgent(DESKTOP);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('sin Client ID de Google no se enseña nada', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const { container } = render(<GoogleSignInButton redirectPath="/x" onSignedIn={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('pinta el botón oficial y entra con el token de Google y el nonce correcto', async () => {
    const google = fakeGoogle();
    mocks.load.mockResolvedValue(google.api);
    mocks.signInWithIdToken.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const onSignedIn = vi.fn();
    render(<GoogleSignInButton context="signup" redirectPath="/x" oneTap onSignedIn={onSignedIn} />);

    await waitFor(() => expect(google.api.renderButton).toHaveBeenCalled());
    const config = google.config();
    expect(config.client_id).toBe('client-123.apps.googleusercontent.com');
    expect(config.ux_mode).toBe('popup');
    expect(config.context).toBe('signup');
    expect(google.api.renderButton.mock.calls[0][1]).toMatchObject({ text: 'signup_with', locale: 'es', theme: 'outline' });
    expect(google.api.prompt).toHaveBeenCalled();

    await config.callback({ credential: 'id-token-de-google' });
    const args = mocks.signInWithIdToken.mock.calls[0][0] as { provider: string; token: string; nonce: string };
    expect(args.provider).toBe('google');
    expect(args.token).toBe('id-token-de-google');
    // A Google se le dio la huella del nonce; a Supabase, el original.
    expect(await sha256Hex(args.nonce)).toBe(config.nonce);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ role: 'client', isNew: true, firstName: 'Ana' }));
  });

  it('si Supabase lo rechaza, lo explica y prepara otro intento con un nonce nuevo', async () => {
    const google = fakeGoogle();
    mocks.load.mockResolvedValue(google.api);
    mocks.signInWithIdToken.mockResolvedValue({ data: {}, error: { message: 'Provider (issuer "https://accounts.google.com") is not enabled' } });
    const onSignedIn = vi.fn();
    render(<GoogleSignInButton redirectPath="/x" onSignedIn={onSignedIn} />);
    await waitFor(() => expect(google.api.initialize).toHaveBeenCalledTimes(1));
    const firstNonce = google.config().nonce;
    await google.config().callback({ credential: 't' });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'El acceso con Google aún no está activado. Entra con tu correo.');
    await waitFor(() => expect(google.api.initialize).toHaveBeenCalledTimes(2));
    expect(google.config().nonce).not.toBe(firstNonce);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('si el script de Google no carga, usa la redirección y vuelve a la ruta pedida', async () => {
    mocks.load.mockRejectedValue(new Error('google_identity_blocked'));
    const beforeRedirect = vi.fn();
    render(<GoogleSignInButton redirectPath="/reserva/confirmacion?auth=1&resume=abc" beforeRedirect={beforeRedirect} onSignedIn={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Continuar con Google/ }));
    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalled());
    expect(beforeRedirect).toHaveBeenCalled();
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reserva/confirmacion?auth=1&resume=abc')}`,
        queryParams: { prompt: 'select_account' },
      },
    });
  });

  it('dentro de Instagram no abre Google: explica cómo abrir la web en el navegador', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0');
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<GoogleSignInButton redirectPath="/x" shareUrl="https://garser.es/reserva/confirmacion?auth=1&resume=abc" onSignedIn={vi.fn()} />);
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(screen.getByRole('note').textContent).toContain('Google no deja iniciar sesión dentro de Instagram');
    expect(screen.getByRole('note').textContent).toContain('Abrir en el navegador');
    fireEvent.click(screen.getByRole('button', { name: /Copiar enlace/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://garser.es/reserva/confirmacion?auth=1&resume=abc'));
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});
