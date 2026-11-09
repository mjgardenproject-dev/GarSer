// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

const scrollTo = vi.fn();
const scrollIntoView = vi.fn();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ScrollToTop />
    </MemoryRouter>,
  );

// Navega a otra ruta desde dentro (como hace la web al pulsar un enlace).
let goTo: (to: string) => void = () => {};
const Navigator = () => {
  const navigate = useNavigate();
  goTo = (to) => navigate(to);
  return null;
};
const renderWithNavigator = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ScrollToTop />
      <Navigator />
    </MemoryRouter>,
  );
const setScrollY = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

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
    setScrollY(0);
    cleanup();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('al cargar o recargar NO toca el scroll (un documento recién cargado ya empieza arriba)', () => {
    setScrollY(0);
    renderAt('/para-jardineros');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('tampoco lo toca al cargar aunque el navegador ya traiga un scroll: eso lo decide el navegador, no la web', () => {
    setScrollY(240);
    renderAt('/account');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('al cambiar de pantalla desde una página scrolleada, la nueva abre arriba', async () => {
    renderWithNavigator('/dashboard');
    setScrollY(500);
    await act(async () => { goTo('/bookings'); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('al cambiar de pantalla estando ya arriba, no hace nada (no hay nada que subir)', async () => {
    renderWithNavigator('/dashboard');
    setScrollY(0);
    await act(async () => { goTo('/bookings'); });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('cambiar solo la búsqueda o el ancla de la MISMA pantalla no sube arriba', async () => {
    renderWithNavigator('/dashboard');
    setScrollY(500);
    await act(async () => { goTo('/dashboard?tab=profile'); });
    expect(scrollTo).not.toHaveBeenCalled();
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
