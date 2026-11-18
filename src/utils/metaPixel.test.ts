// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMetaPixel, isMetaPixelLoaded, revokeMetaPixel, trackMetaEvent, resetMetaPixelForTests } from './metaPixel';

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

  it('QA-007 · retirar el consentimiento: avisa a Meta (revoke), borra sus cookies y deja de mandar eventos', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    document.cookie = '_fbp=fb.1.123; path=/';
    const calls: unknown[][] = [];
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    revokeMetaPixel();
    expect(calls).toContainEqual(['consent', 'revoke']);
    expect(document.cookie).not.toContain('_fbp');
    expect(isMetaPixelLoaded()).toBe(false);
    calls.length = 0;
    trackMetaEvent('Lead');
    expect(calls).toEqual([]);
  });

  it('QA-007 · sin haberlo cargado nunca, retirar no rompe nada', () => {
    expect(() => revokeMetaPixel()).not.toThrow();
  });

  it('QA-007 · volver a aceptar después de retirar vuelve a conceder y manda el PageView, sin duplicar el script', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    loadMetaPixel();
    const calls: unknown[][] = [];
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    revokeMetaPixel();
    calls.length = 0;
    loadMetaPixel();
    expect(calls.map((c) => c.slice(0, 2).join(':'))).toEqual(['consent:grant', 'init:2034090553963036', 'track:PageView']);
    expect(isMetaPixelLoaded()).toBe(true);
    expect(document.head.querySelectorAll('script[src*="fbevents.js"]').length).toBe(1);
  });
});
