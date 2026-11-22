// A dónde va cada cuenta al iniciar sesión (R-01b) y qué rutas de vuelta se aceptan.
//
// Antes todas pasaban por /dashboard, que redirige según el tipo de cuenta: el admin montaba un
// instante las barras de navegación (y su canal de chats) para desmontarlas al saltar a
// /admin. Ir directo a su panel evita ese montaje de ida y vuelta.

/** Solo rutas internas de la web: «/algo», nunca «//otro-dominio» ni URLs absolutas. */
export function safeRedirectPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
  if (trimmed === '/auth' || trimmed.startsWith('/auth?')) return null;
  // Pantallas de un solo uso: volver a ellas no tiene sentido (el enlace ya se gastó) y confundía a quien
  // acababa de cambiar su contraseña (volvía a «Elige tu nueva contraseña»).
  if (/^\/(reset-password|auth\/callback)(\/|\?|#|$)/.test(trimmed)) return null;
  return trimmed;
}

/**
 * ¿Esta ruta es de la zona de esta cuenta? La ruta de vuelta (la página en la que estaba quien volvió a
 * entrar, o la que quiso abrir antes de identificarse) solo vale si le corresponde: un cliente que
 * aterriza en una página de administrador veía «Acceso denegado» (QA-085).
 *   · /admin…       → solo el administrador, y el administrador solo vuelve a /admin…
 *   · /mi-trabajo…  → solo el empleado
 *   · /empresa…     → no el empleado (su zona es /mi-trabajo)
 */
export function isPathAllowedForRole(path: string, accountRole: string | null | undefined): boolean {
  const isAdminArea = /^\/admin(\/|\?|#|$)/.test(path);
  const isEmployeeArea = /^\/mi-trabajo(\/|\?|#|$)/.test(path);
  const isCompanyArea = /^\/empresa(\/|\?|#|$)/.test(path);
  if (accountRole === 'admin') return isAdminArea;
  if (isAdminArea) return false;
  if (accountRole === 'employee') return !isCompanyArea;
  return !isEmployeeArea;
}

export interface PostLoginContext {
  /** La cuenta cuya sesión se cerró y de la que viene la ruta de vuelta (si la ruta es de una sesión anterior). */
  redirectUserId?: string | null;
  /** La cuenta que acaba de entrar. */
  userId?: string | null;
}

// Un profesional entra por /dashboard, también si lleva un equipo: allí se decide el panel según su modo
// (individual o equipo, D31), que lee el servidor. Una cuenta «company» heredada va igual.
//
// La ruta de vuelta solo se respeta si es de la zona de la cuenta y, cuando viene de una sesión anterior,
// si entra la MISMA cuenta (QA-155): si entra otra persona en el mismo móvil, va a su inicio y no a la
// página de la anterior.
export function postLoginPath(accountRole: string | null | undefined, redirectTo?: unknown, context: PostLoginContext = {}): string {
  const back = safeRedirectPath(redirectTo);
  const sameAccount = context.redirectUserId == null || (context.userId != null && context.userId === context.redirectUserId);
  if (back && sameAccount && isPathAllowedForRole(back, accountRole)) return back;
  switch (accountRole) {
    case 'admin': return '/admin/dashboard';
    case 'employee': return '/mi-trabajo';
    default: return '/dashboard';
  }
}
