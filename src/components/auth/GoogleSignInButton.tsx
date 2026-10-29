import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { declareSignupRoleIfNeeded, describeOAuthSignIn, type OAuthSignInResult } from '../../lib/oauthAccount';
import {
  createNonce,
  detectEmbeddedBrowser,
  getGoogleClientId,
  googleSignInErrorMessage,
  loadGoogleIdentity,
  openInChromeHref,
  type GoogleAccountsId,
} from '../../utils/googleIdentity';

// «Continuar con Google» (2026-10-21). Con el botón oficial de Google en la propia web: el cliente
// elige su cuenta en una ventanita y vuelve en el acto con la sesión iniciada, sin perder lo que
// tenía en pantalla (la reserva). Si el script de Google no carga (bloqueadores, navegadores que lo
// cortan), se usa la redirección clásica de Supabase. Dentro de Instagram, Facebook o TikTok Google
// no deja entrar: se explica cómo abrir la web en el navegador.

interface Props {
  /** Para el texto de Google y su ventanita. */
  context?: 'signin' | 'signup' | 'use';
  /** Ruta interna a la que volver si se usa la redirección clásica. */
  redirectPath: string;
  /** Antes de irse a Google con la redirección (p. ej. guardar la reserva). */
  beforeRedirect?: () => void;
  /** Enlace a copiar para abrirlo en el navegador (por defecto, la página actual). */
  shareUrl?: string;
  /** Sugerir la cuenta de Google con «One Tap» al llegar. */
  oneTap?: boolean;
  /**
   * Rol elegido en el selector del alta, cuando no es cliente (2026-10-28). Google no puede
   * mandar el rol como sí hace el alta por correo (supabase.auth.signUp con requested_role en
   * los metadatos): la cuenta nace 'client' siempre. Con esto, en cuanto hay sesión nueva se
   * declara la intención real vía self_declare_signup_role antes de avisar a onSignedIn.
   */
  signupRole?: 'gardener' | 'company';
  onSignedIn: (result: OAuthSignInResult) => void;
}

type Mode = 'loading' | 'google' | 'fallback' | 'embedded';

export const GoogleLogo: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

const OWN_BUTTON = 'flex min-h-11 w-full items-center justify-center gap-3 rounded-full border border-gray-300 bg-white px-4 py-2.5 text-base font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]';

const GoogleSignInButton: React.FC<Props> = ({ context = 'signin', redirectPath, beforeRedirect, shareUrl, oneTap = false, signupRole, onSignedIn }) => {
  const clientId = getGoogleClientId();
  const embedded = detectEmbeddedBrowser();
  const [mode, setMode] = useState<Mode>(embedded ? 'embedded' : 'loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showEmbeddedHelp, setShowEmbeddedHelp] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string>('');
  const apiRef = useRef<GoogleAccountsId | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const setUp = useCallback(async (api: GoogleAccountsId, withPrompt: boolean) => {
    const nonce = await createNonce();
    nonceRef.current = nonce.raw;
    api.initialize({
      client_id: clientId,
      nonce: nonce.hashed,
      context,
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
      callback: async ({ credential }) => {
        setBusy(true);
        setError('');
        try {
          const { data, error: signInError } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: credential,
            nonce: nonceRef.current,
          });
          if (signInError || !data?.user) throw signInError ?? new Error('sin_usuario');
          const result = await declareSignupRoleIfNeeded(await describeOAuthSignIn(data.user), signupRole);
          onSignedInRef.current(result);
        } catch (signInError) {
          setError(googleSignInErrorMessage(signInError));
          // Un nonce nuevo para el siguiente intento.
          void setUp(api, false);
        } finally {
          setBusy(false);
        }
      },
    });
    if (slotRef.current) {
      slotRef.current.innerHTML = '';
      const width = Math.round(Math.min(400, Math.max(220, slotRef.current.offsetWidth || 320)));
      api.renderButton(slotRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: context === 'signup' ? 'signup_with' : 'continue_with',
        shape: 'pill',
        logo_alignment: 'center',
        width,
        locale: 'es',
      });
    }
    if (withPrompt) api.prompt();
  }, [clientId, context, signupRole]);

  useEffect(() => {
    if (!clientId || embedded) return undefined;
    let cancelled = false;
    loadGoogleIdentity()
      .then(async (api) => {
        if (cancelled) return;
        apiRef.current = api;
        setMode('google');
        await setUp(api, oneTap);
      })
      .catch(() => { if (!cancelled) setMode('fallback'); });
    return () => {
      cancelled = true;
      try { apiRef.current?.cancel(); } catch { /* la ventanita ya no estaba */ }
    };
  }, [clientId, embedded, oneTap, setUp]);

  const redirectToGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      beforeRedirect?.();
      // Sin ruta de vuelta, el callback lleva a cada cuenta a su panel (postLoginPath). `role`
      // viaja igual: AuthCallbackPage declara la intención con self_declare_signup_role antes de
      // navegar, para la vuelta por redirección clásica (sin esto, el popup de arriba basta).
      const queryParts = [
        redirectPath ? `next=${encodeURIComponent(redirectPath)}` : '',
        signupRole ? `role=${signupRole}` : '',
      ].filter(Boolean);
      const query = queryParts.length ? `?${queryParts.join('&')}` : '';
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback${query}`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(googleSignInErrorMessage(oauthError));
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = shareUrl || window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado. Pégalo en Safari o Chrome.');
    } catch {
      toast.error('No se ha podido copiar. Mantén pulsada la dirección para copiarla.');
    }
  };

  if (!clientId) return null;

  const chromeHref = openInChromeHref(shareUrl || window.location.href);

  return (
    <div className="space-y-2">
      {mode === 'embedded' ? (
        <>
          <button type="button" onClick={() => setShowEmbeddedHelp(true)} className={OWN_BUTTON}>
            <GoogleLogo /> Continuar con Google
          </button>
          {showEmbeddedHelp && (
            <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Google no deja iniciar sesión dentro de {embedded}</p>
              <p className="mt-1">
                Abre esta página en tu navegador (Safari o Chrome) y vuelve a pulsar «Continuar con Google».
                {chromeHref ? '' : ' En el iPhone: toca ··· arriba y elige «Abrir en el navegador».'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {chromeHref && (
                  <a href={chromeHref} className="inline-flex min-h-11 flex-auto items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir en Chrome
                  </a>
                )}
                <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 flex-auto items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100">
                  <Copy className="h-4 w-4" aria-hidden="true" /> Copiar enlace
                </button>
              </div>
            </div>
          )}
        </>
      ) : mode === 'fallback' ? (
        <button type="button" onClick={() => void redirectToGoogle()} disabled={busy} className={OWN_BUTTON}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <GoogleLogo />}
          Continuar con Google
        </button>
      ) : (
        <div className="relative">
          {/* El botón oficial de Google se pinta aquí; mientras carga, un hueco del mismo alto. */}
          <div ref={slotRef} className="flex min-h-11 w-full justify-center" data-testid="google-button-slot" />
          {mode === 'loading' && <div className="absolute inset-0 animate-pulse rounded-full bg-gray-100" aria-hidden="true" />}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full bg-white/90 text-sm font-semibold text-gray-700" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-700" aria-hidden="true" /> Entrando con Google…
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
};

export default GoogleSignInButton;
