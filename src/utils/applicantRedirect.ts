// A dónde se lleva a un jardinero según su solicitud (la regla de App.tsx).
// - Pendiente o rechazada: a /status.
// - Aprobado: fuera de /apply y /status, a su panel.
// - Sin enviar: a /apply.
// «Mi cuenta» queda siempre abierta: antes también se redirigía, y quien esperaba respuesta o fue
// rechazado no podía cerrar su cuenta (PH-01), ni escribiendo la URL (pruebas en garser.es,
// 2026-10-12).

export type ApplicantStatus = 'pending' | 'denied' | 'active' | null;

// Las páginas legales también: tienen que poder leerse siempre (2026-10-21).
const ALWAYS_OPEN = ['/account', '/privacidad', '/terminos', '/cookies'];

/** La ruta a la que hay que llevarle, o `null` si puede quedarse donde está. */
export function applicantRedirect(status: ApplicantStatus, path: string): string | null {
  if (ALWAYS_OPEN.includes(path)) return null;
  if (status === 'pending' || status === 'denied') return path === '/status' ? null : '/status';
  if (status === 'active') return path === '/apply' || path === '/status' ? '/dashboard' : null;
  return path === '/apply' || path === '/auth' ? null : '/apply';
}
