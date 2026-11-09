// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLogLine, enableScrollDebugIfRequested, installScrollDebug, scrollDebugRequested } from './scrollDebug';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

describe('scrollDebugRequested', () => {
  it('sin la marca no se activa', () => {
    expect(scrollDebugRequested('', memoryStorage())).toBe(false);
    expect(scrollDebugRequested('?utm_source=meta', memoryStorage())).toBe(false);
  });

  it('?scrolldebug=1 lo activa y lo recuerda para la siguiente carga', () => {
    const storage = memoryStorage();
    expect(scrollDebugRequested('?scrolldebug=1', storage)).toBe(true);
    expect(scrollDebugRequested('', storage)).toBe(true);
  });

  it('?scrolldebug=0 lo apaga y borra lo apuntado', () => {
    const storage = memoryStorage();
    scrollDebugRequested('?scrolldebug=1', storage);
    storage.setItem('garser.scrolldebug.log', '["x"]');
    expect(scrollDebugRequested('?scrolldebug=0', storage)).toBe(false);
    expect(scrollDebugRequested('', storage)).toBe(false);
    expect(storage.getItem('garser.scrolldebug.log')).toBeNull();
  });

  it('si el almacenamiento falla, solo la marca de esa carga lo activa y no se rompe', () => {
    const broken = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    expect(scrollDebugRequested('?scrolldebug=1', broken)).toBe(true);
    expect(scrollDebugRequested('', broken)).toBe(false);
  });

  it('otra marca con un valor raro no lo activa', () => {
    expect(scrollDebugRequested('?scrolldebug=si', memoryStorage())).toBe(false);
  });
});

describe('appendLogLine', () => {
  it('añade y recorta a las últimas líneas', () => {
    let lines: string[] = [];
    for (let i = 0; i < 10; i++) lines = appendLogLine(lines, `l${i}`, 4);
    expect(lines).toEqual(['l6', 'l7', 'l8', 'l9']);
  });
});

describe('installScrollDebug', () => {
  let undo: (() => void) | null = null;
  let originalScrollTo: typeof window.scrollTo;

  beforeEach(() => {
    window.sessionStorage.clear();
    originalScrollTo = window.scrollTo;
    window.scrollTo = (() => {}) as typeof window.scrollTo;
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    undo?.();
    undo = null;
    window.scrollTo = originalScrollTo;
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  const overlayText = () => document.getElementById('garser-scroll-debug')?.textContent ?? '';

  it('apunta quién llama a scrollTo / scrollIntoView / focus y deja pasar la llamada', () => {
    let called: unknown[] | null = null;
    window.scrollTo = ((...args: unknown[]) => { called = args; }) as typeof window.scrollTo;
    undo = installScrollDebug();

    window.scrollTo(0, 0);
    const button = document.createElement('button');
    button.id = 'boton';
    document.body.appendChild(button);
    button.scrollIntoView();
    button.focus();

    expect(called).toEqual([0, 0]); // la llamada original se ejecutó
    const text = overlayText();
    expect(text).toContain('scrollTo(0,0)');
    expect(text).toContain('scrollIntoView button#boton');
    expect(text).toContain('focus button#boton');
    expect(text).toMatch(/── carga/);
  });

  it('el historial sobrevive a la recarga (sessionStorage) y marca cada carga', () => {
    undo = installScrollDebug();
    window.scrollTo(0, 120);
    undo();
    document.body.innerHTML = '';

    undo = installScrollDebug(); // «recarga»
    const text = overlayText();
    expect(text).toContain('scrollTo(0,120)');
    expect((text.match(/── carga/g) || []).length).toBe(2);
  });

  it('al deshacerlo deja las funciones del navegador como estaban y quita la franja', () => {
    const before = window.scrollTo;
    const focusBefore = HTMLElement.prototype.focus;
    undo = installScrollDebug();
    expect(window.scrollTo).not.toBe(before);
    undo();
    undo = null;
    expect(window.scrollTo).toBe(before);
    expect(HTMLElement.prototype.focus).toBe(focusBefore);
    expect(document.getElementById('garser-scroll-debug')).toBeNull();
  });

  it('enableScrollDebugIfRequested: sin la marca no instala nada', () => {
    const before = window.scrollTo;
    enableScrollDebugIfRequested();
    expect(window.scrollTo).toBe(before);
    expect(document.getElementById('garser-scroll-debug')).toBeNull();
  });
});
