// Al recargar, la pantalla no se queda desplazada unos píxeles (2026-11-10).
//
// Qué pasaba: en Chrome del iPhone (también el de dentro de Gmail), al recargar la web la pantalla «se iba
// sola» ≈ 60 px hacia abajo —lo que mide la barra de Chrome— con la primera sección tapada por el
// encabezado, y al subirla volvía a bajar. En Safari no pasa.
//
// Causa más probable: Chrome guarda y VUELVE A APLICAR por su cuenta el scroll de la página al recargar (lo
// hace en la parte nativa del navegador, no en JavaScript), y lo aplica con el desfase de sus barras. Por eso
// no lo evitaban ni `history.scrollRestoration = 'manual'` ni quitar el `scrollTo` del arranque: la web no
// manda sobre esa restauración. Lo único que sí puede hacer es CORREGIR el resultado.
//
// Qué hace: SOLO en una recarga y SOLO sin ancla (#seccion) en la dirección, durante unos segundos o hasta
// que la persona toque la pantalla (lo que pase antes), si la pantalla queda desplazada UN POCO (de 1 a 160 px:
// el tamaño de ese desfase), la devuelve arriba. Un desplazamiento grande (chat que baja al último mensaje,
// una restauración deliberada) no se toca, y en cuanto hay un gesto de la persona se deja en paz.
//
// Si una pantalla restaura su propio scroll (Mi perfil), debe llamar a `releaseReloadScrollGuard()` antes.

export const GUARD_MAX_MS = 5000;
/** Por encima de esto no es el desfase de las barras sino un scroll deliberado: no se toca. */
export const GUARD_MAX_NUDGE_PX = 160;
const CHECK_AT_MS = [0, 60, 150, 300, 600, 1000, 1600, 2500, 4000];
const USER_EVENTS = ['touchstart', 'pointerdown', 'mousedown', 'wheel', 'keydown'] as const;

type Win = Window & typeof globalThis;

/** ¿Esta carga es una recarga? (con respaldo para navegadores que aún no tienen la API nueva). */
export function isReloadNavigation(win: Win = window): boolean {
  try {
    const entry = win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (entry && typeof entry.type === 'string') return entry.type === 'reload';
    const legacy = (win.performance as unknown as { navigation?: { type?: number } }).navigation;
    return legacy?.type === 1;
  } catch {
    return false;
  }
}

let release: (() => void) | null = null;

/** Para la guardia ya (la llama una pantalla que restaura su propio scroll). Sin guardia activa, no hace nada. */
export function releaseReloadScrollGuard(): void {
  release?.();
}

/** Arranca la guardia si esta carga es una recarga sin ancla. Devuelve cómo pararla (para las pruebas). */
export function startReloadScrollGuard(win: Win = window): () => void {
  release?.();
  if (!isReloadNavigation(win) || win.location.hash) return () => {};

  let active = true;
  const timers: number[] = [];

  const pin = () => {
    if (!active) return;
    const y = win.scrollY;
    if (y > 0 && y <= GUARD_MAX_NUDGE_PX) win.scrollTo(0, 0);
  };
  const stop = () => {
    if (!active) return;
    active = false;
    timers.forEach((t) => win.clearTimeout(t));
    USER_EVENTS.forEach((name) => win.removeEventListener(name, stop, true));
    win.removeEventListener('scroll', pin);
    win.removeEventListener('load', pin);
    win.removeEventListener('pageshow', pin);
    if (release === stop) release = null;
  };

  release = stop;
  USER_EVENTS.forEach((name) => win.addEventListener(name, stop, { capture: true, passive: true }));
  win.addEventListener('scroll', pin, { passive: true });
  win.addEventListener('load', pin);
  win.addEventListener('pageshow', pin);
  CHECK_AT_MS.forEach((ms) => timers.push(win.setTimeout(pin, ms)));
  timers.push(win.setTimeout(stop, GUARD_MAX_MS));
  return stop;
}
