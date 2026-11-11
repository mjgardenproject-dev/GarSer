// Recargar tirando de la pantalla en Chrome del iPhone (2026-11-11).
//
// Qué pasa (confirmado con el registro de `?scrolldebug=1` y con Wikipedia, que falla igual): en Chrome del iPhone
// con iOS 26, al recargar TIRANDO de la pantalla hacia abajo, Chrome deja la página desplazada ≈ 60 px (lo que miden
// sus barras) y NO deja volver al 0: la web pide `scrollTo(0,0)` varias veces y Chrome vuelve a poner 60 o lo ignora.
// La primera sección queda tapada por el encabezado fijo y tirar de nuevo ya no recarga. Recargar desde el menú «…»
// → Actualizar NO lo provoca, ni tampoco Safari. Es un fallo de Chrome, no de la web ni de que sea una PWA.
//
// Lo que la web SÍ puede hacer es no quedarse con la primera sección tapada:
//   1. En una recarga sin ancla, durante unos segundos, si la pantalla queda desplazada UN POCO (1-160 px),
//      intenta devolverla arriba (a veces funciona: en otros navegadores sí).
//   2. Si el navegador mantiene ese desplazamiento tras comprobarlo dos veces seguidas, es que ese 0 es inalcanzable:
//      entonces el documento «empieza» donde empieza el navegador. Se añade ese mismo hueco arriba del todo
//      (`padding-top` del <html>) y el contenido queda justo bajo el encabezado, como si estuviera arriba.
//      Solo se activa en ese estado atascado: una carga normal no se toca.
//   3. Si el navegador se recupera después (la pantalla baja por debajo de ese hueco), se quita el hueco.
//
// Un desplazamiento grande (chat que baja al último mensaje, una restauración deliberada) no se toca, y en cuanto
// la persona toca la pantalla se deja de decidir nada.
//
// Si una pantalla restaura su propio scroll (Mi perfil), debe llamar a `releaseReloadScrollGuard()` antes.

export const GUARD_MAX_MS = 5000;
/** Por encima de esto no es el desfase de las barras sino un scroll deliberado: no se toca. */
export const GUARD_MAX_NUDGE_PX = 160;
/** Atributo del <html> mientras haya hueco compensando (lo enseña el diagnóstico `?scrolldebug=1`). */
export const FLOOR_ATTR = 'data-scroll-floor';
/** Margen para no quitar el hueco por un redondeo de medio píxel. */
const FLOOR_TOLERANCE_PX = 2;
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

// ── Hueco que compensa un suelo de scroll que el navegador no deja bajar ────────────────────────────────────────────

let appliedFloor = 0;
let floorWatcher: { win: Win; onScroll: () => void } | null = null;

/** Quita el hueco (si lo hay) y deja de vigilar el scroll. */
export function clearScrollFloorCompensation(): void {
  if (floorWatcher) {
    floorWatcher.win.removeEventListener('scroll', floorWatcher.onScroll);
    const root = floorWatcher.win.document.documentElement;
    root.style.removeProperty('padding-top');
    root.removeAttribute(FLOOR_ATTR);
  }
  floorWatcher = null;
  appliedFloor = 0;
}

/** Pone (o corrige) el hueco de `px` píxeles arriba del documento. */
function applyScrollFloorCompensation(win: Win, px: number): void {
  const root = win.document.documentElement;
  root.style.setProperty('padding-top', `${px}px`);
  root.setAttribute(FLOOR_ATTR, String(px));
  appliedFloor = px;
  if (floorWatcher?.win !== win) {
    // Si el navegador se recupera y deja bajar del hueco, el hueco sobra: se quita (y deja de vigilarse).
    const onScroll = () => {
      if (appliedFloor > 0 && win.scrollY < appliedFloor - FLOOR_TOLERANCE_PX) clearScrollFloorCompensation();
    };
    win.addEventListener('scroll', onScroll, { passive: true });
    floorWatcher = { win, onScroll };
  }
}

// ── Guardia ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let release: (() => void) | null = null;

/** Para la guardia ya (la llama una pantalla que restaura su propio scroll). Sin guardia activa, no hace nada. */
export function releaseReloadScrollGuard(): void {
  release?.();
}

/** Arranca la guardia si esta carga es una recarga sin ancla. Devuelve cómo pararla (para las pruebas). */
export function startReloadScrollGuard(win: Win = window): () => void {
  release?.();
  clearScrollFloorCompensation();
  if (!isReloadNavigation(win) || win.location.hash) return () => {};

  let active = true;
  const timers: number[] = [];
  let lastCheckY = 0;

  const displaced = (y: number) => y > 0 && y <= GUARD_MAX_NUDGE_PX;

  /** Se llama con cada scroll, carga o pageshow: si hay desfase pequeño, intenta devolver la pantalla arriba. */
  const pin = () => {
    if (!active || appliedFloor > 0) return;
    if (displaced(win.scrollY)) win.scrollTo(0, 0);
  };

  /** Solo con el reloj: decide si el desfase es un suelo que el navegador no deja bajar. */
  const check = () => {
    if (!active) return;
    const y = Math.round(win.scrollY);
    if (appliedFloor > 0) {
      // Ya hay hueco: se ajusta si el navegador cambia el suelo; se quita si se recupera.
      if (displaced(y) && y !== appliedFloor) applyScrollFloorCompensation(win, y);
      else if (y < appliedFloor - FLOOR_TOLERANCE_PX) clearScrollFloorCompensation();
      return;
    }
    if (!displaced(y)) {
      lastCheckY = 0;
      return;
    }
    if (y === lastCheckY) {
      // El mismo desfase en dos comprobaciones seguidas, tras intentar bajarlo: el 0 no se puede alcanzar.
      applyScrollFloorCompensation(win, y);
      return;
    }
    lastCheckY = y;
    win.scrollTo(0, 0);
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
  CHECK_AT_MS.forEach((ms) => timers.push(win.setTimeout(check, ms)));
  timers.push(win.setTimeout(stop, GUARD_MAX_MS));
  return stop;
}
