// Inicio de sesión con Google en la propia web (2026-10-21), con Google Identity Services (GIS).
//
// El cliente elige su cuenta en una ventanita de Google y vuelve en el acto con un «ID token», que
// Supabase verifica (signInWithIdToken). Sin salir de garser.es: no se pierde la reserva y Google
// enseña «garser.es» en vez de la dirección técnica de Supabase.
//
// Seguridad: cada intento lleva un «nonce» aleatorio. A Google se le da su huella (SHA-256) y a
// Supabase el valor original, que comprueba que el token se emitió para este intento y no se
// reutiliza.

export interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

export interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  context?: 'signin' | 'signup' | 'use';
  ux_mode?: 'popup' | 'redirect';
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
}

export interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
}

export interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonConfiguration) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}

// `window.google` ya lo declara el cargador de Google Maps (src/lib/googleMapsLoader.ts) como `any`.
const gisApi = (): GoogleAccountsId | undefined => window.google?.accounts?.id;

export const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/** El Client ID de Google (público). Sin él, el botón no se enseña. */
export function getGoogleClientId(): string {
  return String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

let loading: Promise<GoogleAccountsId> | null = null;

/**
 * Carga el script de Google una sola vez. Falla si no llega a tiempo (bloqueadores, navegadores
 * que cortan a Google o sin conexión): entonces se usa la redirección clásica.
 */
export function loadGoogleIdentity(timeoutMs = 8000): Promise<GoogleAccountsId> {
  const ready = gisApi();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<GoogleAccountsId>((resolve, reject) => {
    const done = () => {
      const api = gisApi();
      if (api) resolve(api);
      else reject(new Error('google_identity_unavailable'));
    };
    const timer = window.setTimeout(() => reject(new Error('google_identity_timeout')), timeoutMs);
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => { window.clearTimeout(timer); done(); }, { once: true });
    script.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('google_identity_blocked')); }, { once: true });
  }).catch((error) => {
    // Un fallo no se queda guardado: el siguiente intento vuelve a probar.
    loading = null;
    throw error;
  });
  return loading;
}

/** Solo para los tests. */
export function resetGoogleIdentityLoader() {
  loading = null;
}

function randomHex(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nonce de un intento: `raw` para Supabase y `hashed` (SHA-256 en hex) para Google. */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = randomHex();
  return { raw, hashed: await sha256Hex(raw) };
}

export type EmbeddedBrowser = 'Instagram' | 'Facebook' | 'TikTok' | 'Snapchat' | 'LinkedIn' | 'Pinterest' | 'X' | 'una app';

/**
 * Navegadores dentro de otras apps (Instagram, Facebook, TikTok…). Google no deja iniciar sesión
 * en ellos («disallowed_useragent»), así que en vez de un error se explica cómo abrir la web en el
 * navegador. WhatsApp, Gmail y las vistas de Safari/Chrome no cuentan: ahí Google sí funciona.
 */
export function detectEmbeddedBrowser(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): EmbeddedBrowser | null {
  const ua = userAgent || '';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS|\[FB/i.test(ua)) return 'Facebook';
  if (/musical_ly|TikTok|BytedanceWebview|ByteLocale/i.test(ua)) return 'TikTok';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  if (/Pinterest/i.test(ua)) return 'Pinterest';
  if (/Twitter|TwitterAndroid/i.test(ua)) return 'X';
  // Android WebView genérico («; wv)»), salvo el de WhatsApp, que abre el navegador.
  if (/Android/i.test(ua) && /; wv\)/i.test(ua) && !/WhatsApp/i.test(ua)) return 'una app';
  return null;
}

/** En Android, un enlace que abre la misma página en Chrome. En iPhone no hay forma: se explica. */
export function openInChromeHref(url: string, userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string | null {
  if (!/Android/i.test(userAgent)) return null;
  try {
    const parsed = new URL(url);
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=${parsed.protocol.replace(':', '')};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}

/** Mensaje claro para cada error al entrar con Google. */
export function googleSignInErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || error || '');
  if (/provider is not enabled|unsupported provider|not enabled/i.test(message)) {
    return 'El acceso con Google aún no está activado. Entra con tu correo.';
  }
  if (/nonce/i.test(message)) return 'La ventana de Google ha caducado. Vuelve a pulsar el botón.';
  if (/network|fetch|failed to fetch/i.test(message)) return 'No hay conexión. Revisa tu internet y vuelve a intentarlo.';
  return 'No hemos podido entrar con Google. Vuelve a intentarlo o entra con tu correo.';
}
