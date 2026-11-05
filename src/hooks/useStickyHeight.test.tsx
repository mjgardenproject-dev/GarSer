// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { HEADER_PAD_VAR, NAVBAR_HEIGHT_VAR, SUB_HEIGHT_VAR, usePublishStickyHeight } from './useStickyHeight';

const Bar: React.FC<{ variable: string; extra?: Record<string, string> }> = ({ variable, extra }) => {
  const ref = useRef<HTMLDivElement>(null);
  usePublishStickyHeight(ref, variable, extra);
  return <div ref={ref} data-testid="bar" />;
};

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('usePublishStickyHeight', () => {
  let height = 65;
  beforeEach(() => {
    height = 65;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height } as DOMRect));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('publica el alto real de la barra en la variable del <html>', () => {
    render(<Bar variable={NAVBAR_HEIGHT_VAR} />);
    expect(rootVar(NAVBAR_HEIGHT_VAR)).toBe('65px');
  });

  it('lo retira al desmontarse (sin barra, la de debajo vuelve a pegarse arriba del todo)', () => {
    const { unmount } = render(<Bar variable={NAVBAR_HEIGHT_VAR} extra={{ [HEADER_PAD_VAR]: '0px' }} />);
    expect(rootVar(HEADER_PAD_VAR)).toBe('0px');
    unmount();
    expect(rootVar(NAVBAR_HEIGHT_VAR)).toBe('');
    expect(rootVar(HEADER_PAD_VAR)).toBe('');
  });

  it('cada barra usa su propia variable', () => {
    render(<><Bar variable={NAVBAR_HEIGHT_VAR} /><Bar variable={SUB_HEIGHT_VAR} /></>);
    expect(rootVar(NAVBAR_HEIGHT_VAR)).toBe('65px');
    expect(rootVar(SUB_HEIGHT_VAR)).toBe('65px');
  });

  it('se actualiza si la barra cambia de alto (ResizeObserver)', () => {
    let notify: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} });
    render(<Bar variable={NAVBAR_HEIGHT_VAR} />);
    height = 112; // p. ej. con el margen del notch
    notify();
    expect(rootVar(NAVBAR_HEIGHT_VAR)).toBe('112px');
  });

  it('sin ResizeObserver (navegadores antiguos) se actualiza al girar el móvil', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Bar variable={NAVBAR_HEIGHT_VAR} />);
    height = 80;
    window.dispatchEvent(new Event('resize'));
    expect(rootVar(NAVBAR_HEIGHT_VAR)).toBe('80px');
  });
});
