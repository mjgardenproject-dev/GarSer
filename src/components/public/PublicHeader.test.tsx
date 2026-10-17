// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PublicHeader from './PublicHeader';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PublicHeader />
    </MemoryRouter>,
  );

// En jsdom no se aplican los media queries: las dos <nav> (escritorio y móvil) están en el DOM.
const mobileNav = () => screen.getAllByRole('navigation', { name: 'Principal' })[1];

describe('PublicHeader', () => {
  afterEach(cleanup);

  it.each([
    ['/marbella', 'Marbella'],
    ['/para-jardineros', 'Soy jardinero'],
  ])('en %s marca «%s» como la página actual y nada más', (path, label) => {
    renderAt(path);
    const nav = mobileNav();

    expect(within(nav).getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // «Reservar» es una acción: nunca se pinta como la página actual.
    expect(within(nav).getByRole('button', { name: 'Reservar' }).className).not.toContain('bg-emerald-700');
  });

  it('en la portada no marca ninguna página', () => {
    renderAt('/');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('los tres botones del móvil usan la misma letra (mayúsculas)', () => {
    renderAt('/');
    const items = [
      within(mobileNav()).getByRole('button', { name: 'Reservar' }),
      within(mobileNav()).getByRole('link', { name: 'Marbella' }),
      within(mobileNav()).getByRole('link', { name: 'Soy jardinero' }),
    ];
    for (const item of items) {
      expect(item.className).toContain('uppercase');
      expect(item.className).toContain('text-xs');
    }
  });

  it('«Ayuda» baja al bloque de contacto del pie', () => {
    renderAt('/');
    const helpLinks = screen.getAllByRole('link', { name: /ayuda/i });
    expect(helpLinks.length).toBeGreaterThan(0);
    for (const link of helpLinks) expect(link.getAttribute('href')).toBe('#contacto');
  });
});
