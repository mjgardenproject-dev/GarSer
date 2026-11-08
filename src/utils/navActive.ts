// Qué entrada del menú está marcada como la actual.
//
// El panel de un profesional con equipo vive en /empresa (D31), pero el menú sigue ofreciendo «Panel»
// (/dashboard, que redirige allí). Sin esta regla, estando en su propio panel no habría ninguna entrada
// marcada.
export function isNavItemActive(itemPath: string, pathname: string, isTeam: boolean): boolean {
  if (pathname === itemPath) return true;
  return isTeam && itemPath === '/dashboard' && (pathname === '/empresa' || pathname.startsWith('/empresa/'));
}
