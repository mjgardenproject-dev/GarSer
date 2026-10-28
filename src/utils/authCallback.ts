import { safeRedirectPath } from './postLoginPath';

// La dirección de vuelta de Google por la redirección clásica (/auth/callback), 2026-10-21.
// `role` (2026-10-28): la intención elegida en el selector del alta, cuando Google usó la
// redirección en vez del popup — ver GoogleSignInButton.redirectToGoogle.

const SIGNUP_ROLES = new Set(['gardener', 'company']);

/** Lo que dice la dirección de vuelta: adónde ir, qué rol declarar y, si lo hay, el error. */
export function readCallbackParams(url: string): { next: string | null; role: 'gardener' | 'company' | null; error: string | null; errorDescription: string | null } {
  const parsed = new URL(url);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const query = parsed.searchParams;
  const next = safeRedirectPath(query.get('next'));
  const roleParam = query.get('role');
  return {
    next: next && !next.startsWith('/auth/callback') ? next : null,
    role: roleParam && SIGNUP_ROLES.has(roleParam) ? (roleParam as 'gardener' | 'company') : null,
    error: query.get('error') || hash.get('error'),
    errorDescription: query.get('error_description') || hash.get('error_description'),
  };
}

export function callbackErrorMessage(error: string, description?: string | null): string {
  if (error === 'access_denied') return 'Has cancelado el acceso con Google. Puedes volver a intentarlo o entrar con tu correo.';
  if (/provider is not enabled|unsupported provider/i.test(description || '')) return 'El acceso con Google aún no está activado. Entra con tu correo.';
  return 'No hemos podido entrar con Google. Vuelve a intentarlo o entra con tu correo.';
}
