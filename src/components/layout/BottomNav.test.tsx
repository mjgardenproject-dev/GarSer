// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ role: null as string | null, isTeam: false }));

vi.mock('../../contexts/AccountContext', () => ({
  useAccount: () => ({ role: mocks.role, loading: false, refresh: vi.fn() }),
}));

vi.mock('../../hooks/useUnreadChats', () => ({
  useUnreadChats: () => 0,
}));

// Modo del profesional (D31): en equipo su panel vive en /empresa.
vi.mock('../../hooks/useProviderMode', () => ({ useProviderMode: () => ({ isTeam: mocks.isTeam }) }));

import BottomNav from './BottomNav';

const renderNav = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );
const active = () => screen.getAllByRole('button').filter((b) => b.getAttribute('data-active') === 'true').map((b) => b.textContent);

describe('BottomNav', () => {
  beforeEach(() => { mocks.isTeam = false; });
  afterEach(() => cleanup());

  // Antes leía useAuth().profile, que no existe: el jardinero siempre veía «Inicio».
  it('un jardinero ve «Panel»', () => {
    mocks.role = 'gardener';
    renderNav();
    expect(screen.getByText('Panel')).toBeTruthy();
    expect(screen.queryByText('Inicio')).toBeNull();
  });

  it('un cliente ve «Inicio»', () => {
    mocks.role = 'client';
    renderNav();
    expect(screen.getByText('Inicio')).toBeTruthy();
    expect(screen.queryByText('Panel')).toBeNull();
  });

  it('sin rol legible se trata como cliente', () => {
    mocks.role = null;
    renderNav();
    expect(screen.getByText('Inicio')).toBeTruthy();
  });

  it('un profesional ve «Panel», «Reservas» y «Chat», con «Panel» marcado en /dashboard', () => {
    mocks.role = 'gardener';
    renderNav('/dashboard');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Panel', 'Reservas', 'Chat']);
    expect(active()).toEqual(['Panel']);
  });

  it('con equipo, estando en su panel (/empresa y sus pantallas) «Panel» sigue marcado: el menú apunta a /dashboard, que redirige', () => {
    mocks.role = 'gardener';
    mocks.isTeam = true;
    renderNav('/empresa');
    expect(active()).toEqual(['Panel']);
    cleanup();
    renderNav('/empresa/configuracion');
    expect(active()).toEqual(['Panel']);
  });

  it('en modo individual /empresa no marca nada, y las demás pantallas marcan la suya', () => {
    mocks.role = 'gardener';
    renderNav('/empresa');
    expect(active()).toEqual([]);
    cleanup();
    renderNav('/bookings');
    expect(active()).toEqual(['Reservas']);
  });

  it('un empleado tiene su propia barra: Mi trabajo, Horario y Cuenta', () => {
    mocks.role = 'employee';
    renderNav('/mi-trabajo');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mi trabajo', 'Horario', 'Cuenta']);
  });
});
