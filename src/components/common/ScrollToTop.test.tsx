// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

const scrollTo = vi.fn();
const scrollIntoView = vi.fn();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ScrollToTop />
    </MemoryRouter>,
  );

const addSection = (id: string) => {
  const el = document.createElement('section');
  el.id = id;
  document.body.appendChild(el);
  return el;
};

describe('ScrollToTop', () => {
  beforeEach(() => {
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('sin ancla, va arriba como siempre', () => {
    renderAt('/para-jardineros');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('con ancla y la sección ya pintada, va a la sección', () => {
    const el = addSection('empresas');
    renderAt('/para-jardineros#empresas?utm_source=meta');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(el);
  });

  it('con ancla y la página cargándose en diferido, espera a que aparezca la sección', async () => {
    renderAt('/para-jardineros#empresas');
    expect(scrollIntoView).not.toHaveBeenCalled();

    let el!: HTMLElement;
    await act(async () => {
      el = addSection('empresas');
      await Promise.resolve();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(el);
  });

  it('si la sección no llega nunca, deja de esperar y no falla', async () => {
    vi.useFakeTimers();
    renderAt('/para-jardineros#no-existe');
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    addSection('no-existe');
    await act(async () => {
      await Promise.resolve();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
