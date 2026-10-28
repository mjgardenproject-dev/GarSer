import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { fetchCurrentUserProfileRole } from './adminAccess';

// Cuentas que entran con Google (2026-10-21).
//
// Una cuenta nueva la crea el servidor como «cliente» (provision_profile_on_signup: sin rol en los
// datos del alta, cliente), con el nombre que manda Google. Aquí se completa lo que falte del
// perfil de un cliente (nombre y foto) SOLO si está vacío: nunca se pisa lo que ya puso. Si ya
// tenía cuenta con ese correo, Supabase une Google a ella y entra en la de siempre, con su rol.

export function usesGoogle(user: Pick<User, 'app_metadata' | 'identities'> | null | undefined): boolean {
  if (!user) return false;
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
  return user.app_metadata?.provider === 'google'
    || providers.includes('google')
    || Boolean(user.identities?.some((identity) => identity.provider === 'google'));
}

/** Nombre y foto que manda Google. */
export function googleProfileOf(user: Pick<User, 'user_metadata'>): { fullName: string; avatarUrl: string } {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = String(meta.full_name || meta.name || '').trim().slice(0, 120);
  const avatar = String(meta.avatar_url || meta.picture || '').trim();
  return { fullName, avatarUrl: /^https:\/\//.test(avatar) ? avatar.slice(0, 500) : '' };
}

const synced = new Set<string>();

/** Completa nombre y foto del perfil con los de Google si están vacíos. Una vez por sesión. */
export async function syncProfileFromGoogle(user: User | null | undefined): Promise<void> {
  if (!user || !usesGoogle(user) || synced.has(user.id)) return;
  synced.add(user.id);
  const { fullName, avatarUrl } = googleProfileOf(user);
  if (!fullName && !avatarUrl) return;
  try {
    const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url, role').eq('user_id', user.id).maybeSingle();
    // Solo clientes: la foto de un profesional es la que ven sus clientes (se copia a su ficha) y la
    // elige él, no la de su cuenta personal de Google.
    if (!profile || profile.role !== 'client') return;
    const patch: { full_name?: string; avatar_url?: string } = {};
    if (fullName && !String(profile.full_name || '').trim()) patch.full_name = fullName;
    if (avatarUrl && !String(profile.avatar_url || '').trim()) patch.avatar_url = avatarUrl;
    if (Object.keys(patch).length === 0) return;
    await supabase.from('profiles').update(patch).eq('user_id', user.id);
  } catch (error) {
    // Completar el perfil no es imprescindible para entrar: se reintentará en la próxima sesión.
    synced.delete(user.id);
    console.warn('No se ha podido completar el perfil con los datos de Google:', error);
  }
}

export interface OAuthSignInResult {
  role: string | null;
  /** Cuenta creada ahora mismo (para darle la bienvenida). */
  isNew: boolean;
  firstName: string;
}

/**
 * Jardinero o empresa por Google (2026-10-28): la cuenta siempre nace 'client'
 * (provision_profile_on_signup no ve el rol elegido en el selector, al contrario que el alta por
 * correo). Si es una cuenta nueva y sigue en 'client', declara la intención real con
 * self_declare_signup_role antes de que el resto del flujo navegue a su panel — se usa tanto
 * desde el popup de Google (GoogleSignInButton) como desde la vuelta por redirección clásica
 * (AuthCallbackPage), así que vive aquí, no duplicada en los dos sitios.
 */
export async function declareSignupRoleIfNeeded(
  result: OAuthSignInResult,
  signupRole: 'gardener' | 'company' | null | undefined,
): Promise<OAuthSignInResult> {
  if (!signupRole || !result.isNew || result.role !== 'client') return result;
  const { error } = await supabase.rpc('self_declare_signup_role', { p_role: signupRole });
  if (error) {
    console.warn('No se ha podido declarar el rol tras el alta con Google:', error);
    return result;
  }
  return { ...result, role: signupRole };
}

/** Tras entrar con Google: tipo de cuenta, si es nueva y su nombre de pila. */
export async function describeOAuthSignIn(user: User, now: number = Date.now()): Promise<OAuthSignInResult> {
  await syncProfileFromGoogle(user);
  const role = await fetchCurrentUserProfileRole(user.id).catch(() => null);
  const createdAt = Date.parse(user.created_at || '');
  const isNew = Number.isFinite(createdAt) && now - createdAt < 2 * 60 * 1000;
  return { role, isNew, firstName: googleProfileOf(user).fullName.split(/\s+/)[0] || '' };
}

/** «¡Bienvenido a GarSer, Ana!» o «¡Hola de nuevo, Ana!». */
export function welcomeMessage(result: Pick<OAuthSignInResult, 'isNew' | 'firstName'>): string {
  const name = result.firstName ? `, ${result.firstName}` : '';
  return result.isNew ? `¡Bienvenido a GarSer${name}!` : `¡Hola de nuevo${name}!`;
}
