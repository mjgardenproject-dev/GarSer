import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './navActive';

describe('isNavItemActive', () => {
  it('marca la entrada cuya ruta es la actual', () => {
    expect(isNavItemActive('/bookings', '/bookings', false)).toBe(true);
    expect(isNavItemActive('/bookings', '/chat', false)).toBe(false);
  });

  it('con equipo, el panel (/empresa y sus pantallas) marca «Panel», que apunta a /dashboard', () => {
    for (const path of ['/empresa', '/empresa/configuracion', '/empresa/horario', '/empresa/equipo/abc/horario']) {
      expect(isNavItemActive('/dashboard', path, true)).toBe(true);
    }
  });

  it('en modo individual /empresa no marca nada (no es su panel)', () => {
    expect(isNavItemActive('/dashboard', '/empresa', false)).toBe(false);
  });

  it('solo «Panel» se marca con las pantallas de equipo; las demás entradas no', () => {
    expect(isNavItemActive('/bookings', '/empresa', true)).toBe(false);
    expect(isNavItemActive('/chat', '/empresa/horario', true)).toBe(false);
  });

  it('no confunde una ruta que solo empieza igual', () => {
    expect(isNavItemActive('/dashboard', '/empresariales', true)).toBe(false);
  });
});
