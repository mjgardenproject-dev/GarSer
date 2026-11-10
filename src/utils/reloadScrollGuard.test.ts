// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUARD_MAX_MS,
  GUARD_MAX_NUDGE_PX,
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
    scrollTo.mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    stop();
    releaseReloadScrollGuard();
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
});
