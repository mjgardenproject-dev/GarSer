import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { normalizeAccountRole } from './accountRole';
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

/** Por qué no se ha podido dejar la cuenta como jardinero/empresa. */
export type RoleProblem = 'has_activity' | 'other_role' | 'failed';

export interface OAuthSignInResult {
  role: string | null;
  /** Cuenta creada ahora mismo (para darle la bienvenida). */
  isNew: boolean;
  firstName: string;
  /** Profesional que la persona eligió antes de entrar con Google. */
  requestedRole?: ProfessionalRole;
  /** Si lo que eligió no se pudo dejar hecho: el motivo (la pantalla lo explica, no se sigue). */
  roleProblem?: RoleProblem;
}

// Un solo tipo de profesional (D31): «company» ya no existe como tipo de cuenta. Un valor viejo que llegue
// (la URL de vuelta, el almacenamiento del navegador) se lee como 'gardener'.
export type ProfessionalRole = 'gardener';

/** Lo que contesta el servidor (self_declare_signup_role), o 'failed' si no llegó a contestar. */
export type DeclareStatus = 'declared' | 'unchanged' | 'blocked_activity' | 'blocked_role' | 'failed';

/**
 * Pide al servidor que la cuenta sea de profesional. Es el único sitio que llama a la
 * función: la decide el servidor (con su reloj y sus datos) y contesta con un estado, así que aquí
 * no se adivina nada. Un fallo no se traga: devuelve 'failed' para que la pantalla lo diga.
 */
export async function declareAccountType(role: ProfessionalRole): Promise<DeclareStatus> {
  const { data, error } = await supabase.rpc('self_declare_signup_role', { p_role: role });
  if (error) {
    console.warn('No se ha podido declarar el tipo de cuenta:', error);
    return 'failed';
  }
  // Una versión anterior de la función no devolvía nada (void): sin error, es que se hizo.
  const status = typeof data === 'string' ? data : 'declared';
  if (status === 'declared' || status === 'unchanged' || status === 'blocked_activity' || status === 'blocked_role') return status;
  return 'failed';
}

/**
 * Profesional por Google. Google no puede mandar el rol como sí hace el alta por correo
 * (supabase.auth.signUp con requested_role en los metadatos): la cuenta nace 'client'. Con el
 * tipo elegido antes de pulsar Google, se declara al servidor en cuanto hay sesión — desde el
 * popup (GoogleSignInButton) y desde la vuelta por redirección (AuthCallbackPage), que comparten
 * esta función — y el resultado dice la verdad: o la cuenta es del tipo elegido, o trae el motivo
 * (`roleProblem`). Nunca se sigue «como cliente» en silencio.
 *
 * Ya no depende de que la cuenta parezca nueva: una cuenta de cliente sin actividad (p. ej. la
 * que se creó por error al pulsar Google sin elegir) puede pasar a profesional si la persona
 * lo pide. Si ya tiene reservas o es de otro tipo, el servidor lo impide y se explica.
 */
export async function declareSignupRoleIfNeeded(
  result: OAuthSignInResult,
  signupRole: ProfessionalRole | null | undefined,
): Promise<OAuthSignInResult> {
  if (!signupRole) return result;
  if (result.role === signupRole) return { ...result, requestedRole: signupRole };
  const asked = { ...result, requestedRole: signupRole };
  if (result.role && result.role !== 'client') return { ...asked, roleProblem: 'other_role' };

  const status = await declareAccountType(signupRole);
  if (status === 'declared' || status === 'unchanged') return { ...asked, role: signupRole };
  if (status === 'blocked_activity') return { ...asked, roleProblem: 'has_activity' };
  if (status === 'blocked_role') return { ...asked, roleProblem: 'other_role' };
  return { ...asked, roleProblem: 'failed' };
}

// Si la vuelta de Google es por redirección (el script de Google no cargó), el tipo elegido viaja en
// la URL de vuelta (?role=). Por si esa URL pierde los parámetros (lista de direcciones permitidas,
// el navegador, una app), se guarda también aquí unos minutos. Se lee una sola vez.
const INTENT_KEY = 'garser:signup-intent';
const INTENT_TTL_MS = 15 * 60 * 1000;

export function rememberSignupIntent(role: ProfessionalRole | null | undefined): void {
  try {
    if (role) localStorage.setItem(INTENT_KEY, JSON.stringify({ role, at: Date.now() }));
    else localStorage.removeItem(INTENT_KEY);
  } catch { /* sin almacenamiento: queda la URL de vuelta */ }
}

export function takeSignupIntent(now: number = Date.now()): ProfessionalRole | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    localStorage.removeItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > INTENT_TTL_MS) return null;
    return normalizeAccountRole(parsed.role) === 'gardener' ? 'gardener' : null;
  } catch {
    return null;
  }
}

/**
 * ¿Es una cuenta recién creada? Mejor con las dos fechas del SERVIDOR (creación y primer acceso,
 * casi iguales si acaba de nacer) que con el reloj del móvil, que puede ir adelantado o atrasado.
 * Sin la segunda fecha, se compara con el reloj como antes.
 */
export function isFreshAccount(user: Pick<User, 'created_at' | 'last_sign_in_at'>, now: number = Date.now()): boolean {
  const created = Date.parse(user.created_at || '');
  if (!Number.isFinite(created)) return false;
  const last = Date.parse(user.last_sign_in_at || '');
  if (Number.isFinite(last)) return Math.abs(last - created) < 60 * 1000;
  return now - created < 2 * 60 * 1000;
}

/** Tras entrar con Google: tipo de cuenta, si es nueva y su nombre de pila. */
export async function describeOAuthSignIn(user: User, now: number = Date.now()): Promise<OAuthSignInResult> {
  await syncProfileFromGoogle(user);
  const role = await fetchCurrentUserProfileRole(user.id).catch(() => null);
  return { role, isNew: isFreshAccount(user, now), firstName: googleProfileOf(user).fullName.split(/\s+/)[0] || '' };
}

/** «cliente», «profesional»… para las frases de aviso. */
export function accountRoleLabel(role: string | null | undefined): string {
  switch (normalizeAccountRole(role)) {
    case 'gardener': return 'profesional';
    case 'employee': return 'empleado de una empresa';
    case 'admin': return 'administrador';
    default: return 'cliente';
  }
}

/** «¡Bienvenido a GarSer, Ana!» o «¡Hola de nuevo, Ana!». */
export function welcomeMessage(result: Pick<OAuthSignInResult, 'isNew' | 'firstName'>): string {
  const name = result.firstName ? `, ${result.firstName}` : '';
  return result.isNew ? `¡Bienvenido a GarSer${name}!` : `¡Hola de nuevo${name}!`;
}
