/**
 * Dónde se pinta la barra inferior de navegación del móvil (`BottomNav`).
 *
 * Fuente única para App.tsx. Va aparte para poder probarla: QA-187 fue una pantalla con su propio
 * botón fijo abajo («Enviar incidencia») sobre la que también se pintaba la barra, que lo tapaba
 * entero en cualquier móvil en vertical. Las pantallas de UNA sola tarea con su botón fijo abajo
 * (reserva, incidencia) no llevan la barra: tienen su propia flecha de volver.
 */

const AUTH_PATHS = new Set(['/auth', '/auth/callback', '/confirmar-servicio', '/invitacion']);
const APPLY_PATHS = new Set(['/apply', '/empresa/solicitud', '/empresa/estado']);
const MARKETING_PATHS = new Set(['/', '/marbella', '/costa-del-sol', '/para-jardineros', '/privacidad', '/terminos', '/cookies']);

export const isAuthPath = (pathname: string) => AUTH_PATHS.has(pathname);
export const isBookingPath = (pathname: string) => pathname.startsWith('/reserva') || pathname.startsWith('/reservar');
export const isApplyPath = (pathname: string) => APPLY_PATHS.has(pathname);
export const isAdminPath = (pathname: string) => pathname.startsWith('/admin');
export const isMarketingPath = (pathname: string) => MARKETING_PATHS.has(pathname);

/** Formularios de una sola tarea con su propio botón fijo abajo (fuera del proceso de reserva). */
export const isFocusedTaskPath = (pathname: string) => pathname.startsWith('/incidencias/');

export function shouldShowBottomNav(pathname: string, hasUser: boolean): boolean {
  if (!hasUser) return false;
  return !(
    isAuthPath(pathname) ||
    isBookingPath(pathname) ||
    isApplyPath(pathname) ||
    isAdminPath(pathname) ||
    isMarketingPath(pathname) ||
    isFocusedTaskPath(pathname)
  );
}
