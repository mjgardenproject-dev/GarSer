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
  return trimmed;
}

export function postLoginPath(accountRole: string | null | undefined, redirectTo?: unknown): string {
  const back = safeRedirectPath(redirectTo);
  if (back) return back;
  switch (accountRole) {
    case 'admin': return '/admin/dashboard';
    case 'company': return '/empresa';
    case 'employee': return '/mi-trabajo';
    default: return '/dashboard';
  }
}
