// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMetaPixel, isMetaPixelLoaded, trackMetaEvent, resetMetaPixelForTests } from './metaPixel';

describe('metaPixel', () => {
  beforeEach(() => {
    resetMetaPixelForTests();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetMetaPixelForTests();
    document.head.innerHTML = '';
  });

  it('sin VITE_META_PIXEL_ID no instala nada', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    loadMetaPixel();
    expect(isMetaPixelLoaded()).toBe(false);
    expect(window.fbq).toBeUndefined();
    expect(document.head.querySelector('script[src*="fbevents.js"]')).toBeNull();
  });

  it('con el identificador, instala el script, llama a init y manda el PageView', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    expect(isMetaPixelLoaded()).toBe(true);
    expect(document.head.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeTruthy();
    expect(window.fbq).toBeTypeOf('function');
  });

  it('llamarlo dos veces no duplica el script', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    loadMetaPixel();
    expect(document.head.querySelectorAll('script[src*="fbevents.js"]').length).toBe(1);
  });

  it('trackMetaEvent no hace nada si el píxel no se ha cargado', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    const spy = vi.fn();
    Object.defineProperty(window, 'fbq', { value: spy, writable: true, configurable: true });
    trackMetaEvent('Lead');
    expect(spy).not.toHaveBeenCalled();
  });

  it('trackMetaEvent llama a fbq una vez cargado', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    const calls: unknown[][] = [];
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    trackMetaEvent('Lead', { value: 1 });
    expect(calls).toContainEqual(['track', 'Lead', { value: 1 }]);
  });

  it('con eventId, lo manda como cuarto argumento para que Meta deduplique con el CAPI', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    const calls: unknown[][] = [];
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    trackMetaEvent('Lead', undefined, 'evt-123');
    expect(calls).toContainEqual(['track', 'Lead', {}, { eventID: 'evt-123' }]);
  });
});
