// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useVisualViewportBox } from './useVisualViewportHeight';

type VV = EventTarget & { height: number; offsetTop: number };
const setViewport = (vv: VV | undefined) => Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
const makeVV = (height: number, offsetTop = 0): VV => Object.assign(new EventTarget(), { height, offsetTop });

describe('useVisualViewportBox (QA-135: la hoja de pago debe caber en lo que VE el cliente, no bajo el teclado)', () => {
  afterEach(() => setViewport(undefined));

  it('sin visualViewport (escritorio antiguo) devuelve null y no rompe', () => {
    setViewport(undefined);
    const { result } = renderHook(() => useVisualViewportBox());
    expect(result.current).toBeNull();
  });

  it('da la altura visible y se actualiza cuando sale el teclado', () => {
    const vv = makeVV(667);
    setViewport(vv);
    const { result } = renderHook(() => useVisualViewportBox());
    expect(result.current).toEqual({ height: 667, offsetTop: 0 });
    act(() => { vv.height = 407; vv.dispatchEvent(new Event('resize')); });
    expect(result.current).toEqual({ height: 407, offsetTop: 0 });
  });

  it('sigue el desplazamiento del visor (iOS lo mueve al abrir el teclado)', () => {
    const vv = makeVV(407, 0);
    setViewport(vv);
    const { result } = renderHook(() => useVisualViewportBox());
    act(() => { vv.offsetTop = 120; vv.dispatchEvent(new Event('scroll')); });
    expect(result.current).toEqual({ height: 407, offsetTop: 120 });
  });

  it('deja de escuchar al desmontar', () => {
    const vv = makeVV(667);
    setViewport(vv);
    const { unmount } = renderHook(() => useVisualViewportBox());
    unmount();
    expect(() => vv.dispatchEvent(new Event('resize'))).not.toThrow();
  });
});
