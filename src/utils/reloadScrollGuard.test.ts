// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOOR_ATTR,
  GUARD_MAX_MS,
  GUARD_MAX_NUDGE_PX,
  clearScrollFloorCompensation,
  isReloadNavigation,
  releaseReloadScrollGuard,
  startReloadScrollGuard,
} from './reloadScrollGuard';

// jsdom no mueve el scroll de verdad: se simula `scrollY` y `scrollTo`.
let y = 0;
const scrollTo = vi.fn((_x: number, top: number) => { y = top; });

const setNavigationType = (type: string | null, legacyType?: number) => {
  Object.defineProperty(window.performance, 'getEntriesByType', {
    configurable: true,
    value: (kind: string) => (kind === 'navigation' && type ? [{ type }] : []),
  });
  Object.defineProperty(window.performance, 'navigation', { configurable: true, value: legacyType === undefined ? undefined : { type: legacyType } });
};

/** El navegador devuelve la pantalla desplazada (lo que hace Chrome del iPhone al recargar). */
const browserRestores = (px: number) => {
  y = px;
  window.dispatchEvent(new Event('scroll'));
};

describe('guardia de scroll al recargar', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    y = 0;
    scrollTo.mockReset();
    scrollTo.mockImplementation((_x: number, top: number) => { y = top; });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    stop();
    releaseReloadScrollGuard();
    clearScrollFloorCompensation();
    vi.useRealTimers();
  });

  describe('isReloadNavigation', () => {
    it('reconoce una recarga, y no una carga normal ni volver atrás', () => {
      setNavigationType('reload');
      expect(isReloadNavigation()).toBe(true);
      setNavigationType('navigate');
      expect(isReloadNavigation()).toBe(false);
      setNavigationType('back_forward');
      expect(isReloadNavigation()).toBe(false);
    });

    it('con navegadores antiguos usa la API vieja', () => {
      setNavigationType(null, 1);
      expect(isReloadNavigation()).toBe(true);
      setNavigationType(null, 0);
      expect(isReloadNavigation()).toBe(false);
    });

    it('si la API falla, no es una recarga (y no se rompe)', () => {
      Object.defineProperty(window.performance, 'getEntriesByType', { configurable: true, value: () => { throw new Error('x'); } });
      expect(isReloadNavigation()).toBe(false);
    });
  });

  it('en una recarga, si el navegador deja la pantalla desplazada unos píxeles, la devuelve arriba', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    browserRestores(61);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(y).toBe(0);
  });

  it('también lo corrige si el navegador lo hace tarde, sin avisar con un evento de scroll', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    y = 61; // desplazada sin evento
    vi.advanceTimersByTime(700);
    expect(y).toBe(0);
  });

  it('si el navegador lo repite varias veces durante la carga, lo corrige cada vez', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    browserRestores(61);
    vi.advanceTimersByTime(400);
    browserRestores(58);
    expect(y).toBe(0);
    vi.advanceTimersByTime(1000);
    browserRestores(61);
    expect(y).toBe(0);
  });

  it('en cuanto la persona toca la pantalla, la deja en paz (aunque baje un poco)', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    window.dispatchEvent(new Event('touchstart'));
    scrollTo.mockClear();
    browserRestores(120); // lo que baja con el dedo
    vi.advanceTimersByTime(GUARD_MAX_MS);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(y).toBe(120);
  });

  it.each(['pointerdown', 'mousedown', 'wheel', 'keydown'])('un gesto «%s» también la libera', (type) => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    window.dispatchEvent(new Event(type));
    browserRestores(100);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('un desplazamiento grande (chat que baja al último mensaje, restauración deliberada) no se toca', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    browserRestores(GUARD_MAX_NUDGE_PX + 1);
    vi.advanceTimersByTime(2000);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(y).toBe(GUARD_MAX_NUDGE_PX + 1);
  });

  it('pasado el tiempo máximo deja de vigilar', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    vi.advanceTimersByTime(GUARD_MAX_MS + 100);
    browserRestores(60);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('si la dirección trae un ancla, no hace nada (el ancla manda)', () => {
    setNavigationType('reload');
    window.history.replaceState(null, '', '/para-jardineros#empresas');
    stop = startReloadScrollGuard();
    browserRestores(61);
    vi.advanceTimersByTime(1000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('en una carga normal o al volver atrás, no hace nada', () => {
    for (const type of ['navigate', 'back_forward']) {
      setNavigationType(type);
      stop = startReloadScrollGuard();
      browserRestores(61);
      vi.advanceTimersByTime(1000);
      expect(scrollTo, type).not.toHaveBeenCalled();
      stop();
    }
  });

  it('con la pantalla ya arriba no llama a scrollTo (no hay nada que corregir)', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    vi.advanceTimersByTime(GUARD_MAX_MS);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('releaseReloadScrollGuard la para (para pantallas que restauran su propio scroll)', () => {
    setNavigationType('reload');
    stop = startReloadScrollGuard();
    releaseReloadScrollGuard();
    browserRestores(100);
    vi.advanceTimersByTime(1000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('releaseReloadScrollGuard sin guardia activa no falla', () => {
    expect(() => releaseReloadScrollGuard()).not.toThrow();
  });

  // Lo que hace Chrome del iPhone al recargar tirando de la pantalla: deja el scroll en 60 y no deja bajar de ahí.
  describe('suelo de scroll que el navegador no deja bajar', () => {
    const root = () => document.documentElement;
    const browserRefusesToScrollUp = () => scrollTo.mockImplementation(() => { /* el navegador lo ignora */ });

    it('si tras intentar subir sigue en el mismo sitio, añade ese hueco arriba para que el contenido no quede tapado', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(200);
      expect(scrollTo).toHaveBeenCalledWith(0, 0); // primero lo intenta
      expect(root().style.paddingTop).toBe('61px');
      expect(root().getAttribute(FLOOR_ATTR)).toBe('61');
    });

    it('no pone hueco si la web consigue subir (en cuanto sube no hay nada que compensar)', () => {
      setNavigationType('reload');
      stop = startReloadScrollGuard(); // scrollTo funciona
      y = 61;
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(y).toBe(0);
      expect(root().style.paddingTop).toBe('');
      expect(root().hasAttribute(FLOOR_ATTR)).toBe(false);
    });

    it('no lo pone con una sola comprobación: hace falta ver el mismo desfase dos veces seguidas', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(0);
      expect(root().style.paddingTop).toBe('');
    });

    it('si el navegador lo repite tarde (otro desfase a los 400 ms) también lo compensa', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      vi.advanceTimersByTime(400); // limpio al principio
      expect(root().style.paddingTop).toBe('');
      y = 60;
      vi.advanceTimersByTime(1500);
      expect(root().style.paddingTop).toBe('60px');
    });

    it('si el navegador cambia el suelo, ajusta el hueco a ese valor', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 60;
      vi.advanceTimersByTime(700);
      expect(root().style.paddingTop).toBe('60px');
      y = 72;
      vi.advanceTimersByTime(500);
      expect(root().style.paddingTop).toBe('72px');
    });

    it('si el navegador se recupera y deja bajar del hueco, lo quita', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(700);
      expect(root().style.paddingTop).toBe('61px');
      y = 0;
      window.dispatchEvent(new Event('scroll'));
      expect(root().style.paddingTop).toBe('');
      expect(root().hasAttribute(FLOOR_ATTR)).toBe(false);
    });

    it('un redondeo de un píxel no quita el hueco', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(700);
      y = 60;
      window.dispatchEvent(new Event('scroll'));
      expect(root().style.paddingTop).toBe('61px');
    });

    it('el hueco sigue ahí cuando la guardia termina, y se quita igual si luego baja del hueco', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(GUARD_MAX_MS + 100);
      expect(root().style.paddingTop).toBe('61px');
      y = 400; // la persona lee más abajo: no pasa nada
      window.dispatchEvent(new Event('scroll'));
      expect(root().style.paddingTop).toBe('61px');
      y = 10;
      window.dispatchEvent(new Event('scroll'));
      expect(root().style.paddingTop).toBe('');
    });

    it('no toca nada si no es una recarga', () => {
      setNavigationType('navigate');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(root().style.paddingTop).toBe('');
    });

    it('no toca nada si el desplazamiento es grande (no es el desfase de las barras)', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = GUARD_MAX_NUDGE_PX + 1;
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(root().style.paddingTop).toBe('');
    });

    it('no toca nada si la dirección trae un ancla', () => {
      setNavigationType('reload');
      window.history.replaceState(null, '', '/para-jardineros#empresas');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(root().style.paddingTop).toBe('');
    });

    it('si la persona ya tocó la pantalla, no decide nada (podría ser su propio scroll)', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      window.dispatchEvent(new Event('touchstart'));
      y = 61;
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(root().style.paddingTop).toBe('');
    });

    it('con la pantalla ya arriba no hay hueco', () => {
      setNavigationType('reload');
      stop = startReloadScrollGuard();
      vi.advanceTimersByTime(GUARD_MAX_MS);
      expect(root().style.paddingTop).toBe('');
    });

    it('releaseReloadScrollGuard no quita un hueco ya puesto', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(700);
      releaseReloadScrollGuard();
      expect(root().style.paddingTop).toBe('61px');
    });

    it('arrancar de nuevo (otra carga) empieza limpio, sin el hueco anterior', () => {
      setNavigationType('reload');
      browserRefusesToScrollUp();
      stop = startReloadScrollGuard();
      y = 61;
      vi.advanceTimersByTime(700);
      expect(root().style.paddingTop).toBe('61px');
      setNavigationType('navigate');
      stop = startReloadScrollGuard();
      expect(root().style.paddingTop).toBe('');
      expect(root().hasAttribute(FLOOR_ATTR)).toBe(false);
    });
  });
});
