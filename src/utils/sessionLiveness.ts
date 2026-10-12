// PH-35 (pruebas en garser.es, 2026-10-12): tras «Cerrar todas» en otro dispositivo, esta pestaña
// seguía dentro (leyendo y escribiendo) hasta que caducaba su token, hasta 1 hora: la web solo se
// enteraba al renovarlo. El servidor de acceso ya lo sabe (`/auth/v1/user` → 403
// `session_not_found`), así que se le pregunta:
// - al volver a la app (pestaña visible, foco o conexión recuperada);
// - al usarla (toque o tecla);
// - cada 5 minutos mientras se ve.
// Como mucho una vez por minuto, y solo con una sesión guardada. Un fallo de red no saca a nadie:
// solo la respuesta «esa sesión no existe».

export interface LivenessAuth {
  getSession: () => Promise<{ data: { session: unknown | null } }>;
  getUser: () => Promise<{ error: { code?: string; status?: number; message?: string } | null }>;
}

export const LIVENESS_MIN_GAP_MS = 60_000;
export const LIVENESS_INTERVAL_MS = 5 * 60_000;

export const isSessionGone = (error: { code?: string; status?: number; message?: string } | null) =>
  !!error && (error.code === 'session_not_found' || (error.status === 403 && /session_id claim/i.test(error.message || '')));

/** Empieza a vigilar la sesión; `onGone` se llama cada vez que la guardada ya no existe. Devuelve la función que para. */
export function startSessionLiveness(auth: LivenessAuth, onGone: () => void, now: () => number = Date.now): () => void {
  let lastCheck = 0;
  let running = false;
  let done = false;

  const check = async (force = false) => {
    if (done || running) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!force && now() - lastCheck < LIVENESS_MIN_GAP_MS) return;
    lastCheck = now();
    running = true;
    try {
      const { data } = await auth.getSession();
      if (!data?.session) return;
      const { error } = await auth.getUser();
      // No se apaga: tras salir no hay sesión guardada y no se pregunta; si vuelve a entrar sin
      // recargar la página, se vigila la sesión nueva.
      if (isSessionGone(error)) onGone();
    } catch {
      // Sin red o el servidor no responde: se vuelve a mirar más tarde.
    } finally {
      running = false;
    }
  };

  const onUse = () => { void check(); };
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  const timer = setInterval(() => { void check(true); }, LIVENESS_INTERVAL_MS);

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onUse);
  window.addEventListener('online', onUse);
  window.addEventListener('pointerdown', onUse, { passive: true });
  window.addEventListener('keydown', onUse);

  return () => {
    done = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onUse);
    window.removeEventListener('online', onUse);
    window.removeEventListener('pointerdown', onUse);
    window.removeEventListener('keydown', onUse);
  };
}
