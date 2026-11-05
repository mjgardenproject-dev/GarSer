// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AppHeader from './AppHeader';

describe('AppHeader', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('se pega DEBAJO de la barra general, no en top-0, y por debajo de ella (z-30 < Navbar z-40)', () => {
    render(<AppHeader title="Mi Cuenta" />);
    const header = screen.getByRole('banner');
    expect(header.style.top).toBe('var(--app-navbar-h, 0px)');
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('z-30');
    expect(header.className).not.toContain('z-40');
    expect(header.className).not.toContain('top-0');
  });

  it('el margen del notch solo lo pone si no hay barra general encima', () => {
    render(<AppHeader title="Mi Cuenta" />);
    expect(screen.getByRole('banner').style.paddingTop).toBe('var(--app-header-pad, env(safe-area-inset-top))');
  });

  it('publica su alto para que el scroll de anclas y el foco no lo dejen debajo', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: 161 } as DOMRect));
    render(<AppHeader title="Disponibilidad" />);
    expect(document.documentElement.style.getPropertyValue('--app-sticky-sub-h')).toBe('161px');
    cleanup();
    expect(document.documentElement.style.getPropertyValue('--app-sticky-sub-h')).toBe('');
  });

  it('título, botón de volver y filas extra', () => {
    const onBack = vi.fn();
    render(<AppHeader title="Mis Chats" onBack={onBack} backLabel="Salir"><p>Filtro</p></AppHeader>);
    expect(screen.getByRole('heading', { name: 'Mis Chats' })).toBeTruthy();
    expect(screen.getByText('Filtro')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onBack).toHaveBeenCalled();
  });
});
