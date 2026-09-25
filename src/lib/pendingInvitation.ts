// Invitación de empresa pendiente de aceptar (GarSer Empresas F3.3).
//
// Quien abre el enlace de invitación sin cuenta tiene que registrarse y confirmar su correo; el
// enlace de confirmación le devuelve a la portada y el token se perdería. Se guarda aquí unas
// horas para retomar la invitación en cuanto entre. Si se pierde (otro navegador, almacenamiento
// bloqueado) basta con volver a pulsar el enlace: el servidor sigue siendo quien decide.

const KEY = 'garser_pending_invitation';
const TTL_MS = 24 * 60 * 60 * 1000;

interface Stored { token: string; savedAt: number }

export function savePendingInvitation(token: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, savedAt: now } satisfies Stored));
  } catch {
    /* almacenamiento bloqueado: el enlace sigue funcionando */
  }
}

export function readPendingInvitation(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.token !== 'string' || !parsed.token || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export function clearPendingInvitation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada que limpiar */
  }
}

export function invitationPath(token: string): string {
  return `/invitacion?token=${encodeURIComponent(token)}`;
}
