// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { disableBrowserScrollRestoration } from './scrollRestoration';

// jsdom no trae `history.scrollRestoration`: se simula como lo hace un navegador real.
function stubScrollRestoration(initial: 'auto' | 'manual', setter?: () => void) {
  let value = initial;
  Object.defineProperty(window.history, 'scrollRestoration', {
    configurable: true,
    get: () => value,
    set: (v: 'auto' | 'manual') => { if (setter) setter(); else value = v; },
  });
}

describe('recargar empieza arriba (sin restaurar el scroll del navegador)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.history, 'scrollRestoration');
  });

  it('pasa la restauración del navegador a manual', () => {
    stubScrollRestoration('auto');
    disableBrowserScrollRestoration();
    expect(window.history.scrollRestoration).toBe('manual');
  });

  it('no rompe si el navegador no la soporta', () => {
    expect('scrollRestoration' in window.history).toBe(false);
    expect(() => disableBrowserScrollRestoration()).not.toThrow();
  });

  it('no rompe si el navegador la prohíbe (navegadores embebidos)', () => {
    stubScrollRestoration('auto', () => { throw new Error('prohibido'); });
    expect(() => disableBrowserScrollRestoration()).not.toThrow();
    expect(window.history.scrollRestoration).toBe('auto');
  });

  it('el HTML lo desactiva antes de que arranque la app, y main.tsx también', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toMatch(/history\.scrollRestoration\s*=\s*['"]manual['"]/);
    const main = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    expect(main).toContain('disableBrowserScrollRestoration()');
  });
});
