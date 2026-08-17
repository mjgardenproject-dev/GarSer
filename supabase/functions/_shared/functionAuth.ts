// Autorización de llamantes para las edge functions.
//
// Definición ÚNICA de "quién puede llamar a esto". Antes vivía duplicada en
// send-email-notification y booking-confirmation-email; en código de seguridad la duplicación
// es una trampa: se arregla una copia y la otra se queda abierta.
//
// Contexto de por qué esto se valida aquí dentro y no en el gateway: varias funciones se
// despliegan con `verify_jwt = false` porque el proyecto usa las claves modernas
// (`sb_secret_...`), que NO son JWT, y el gateway las rechazaba con 401 ANTES de ejecutar la
// función (así se perdieron los emails de reserva durante semanas, en silencio). Al desactivar
// esa comprobación, la puerta la tiene que guardar la propia función.

/** Todas las claves de servicio válidas del proyecto (formato moderno y legacy). */
export function collectInternalServiceKeys(): string[] {
  const keys: string[] = [];
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const parsed = JSON.parse(modern) as Record<string, string>;
      Object.values(parsed).forEach((value) => { if (value) keys.push(String(value)); });
    } catch {
      keys.push(modern);
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.push(legacy);
  return keys.filter(Boolean);
}

/** La clave de servicio preferente, para crear el cliente admin. */
export function resolveServiceRoleKey(): string | undefined {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // cae al legacy de abajo
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

/** El token presentado en la cabecera Authorization, sin el prefijo `Bearer`. */
export function presentedToken(req: Request): string {
  const header = String(req.headers.get('Authorization') || req.headers.get('authorization') || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
}

/** ¿Llama otro componente nuestro con la clave de servicio? */
export function isInternalServiceCaller(req: Request): boolean {
  const token = presentedToken(req);
  if (!token) return false;
  return collectInternalServiceKeys().some((key) => key === token);
}

/**
 * Resuelve el usuario final que llama, o `null`.
 *
 * OJO con la trampa: la clave `anon` es pública (va dentro del JavaScript de la web) y, en el
 * formato legacy, es un JWT válido — así que pasa el `verify_jwt` del gateway. "Traer un JWT
 * válido" NO significa "ser un usuario". Solo un token que resuelve a un usuario real cuenta.
 */
// deno-lint-ignore no-explicit-any
export async function resolveCallerUserId(req: Request, admin: any): Promise<string | null> {
  const token = presentedToken(req);
  if (!token) return null;
  if (collectInternalServiceKeys().some((key) => key === token)) return null;
  try {
    const { data } = await admin.auth.getUser(token);
    return data?.user?.id || null;
  } catch {
    return null;
  }
}
