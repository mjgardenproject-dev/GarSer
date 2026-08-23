// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeBookingResume } from '../../utils/bookingResumeStorage';
import ClientBookingLauncher from './ClientBookingLauncher';

const useAuthMock = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

// La pantalla carga las reservas al montarse. Se aísla para que el test siga siendo sobre los
// accesos rápidos y no dependa de la red.
vi.mock('../../utils/clientBookingsOverview', () => ({
  fetchClientBookingsOverview: vi.fn().mockResolvedValue({
    upcoming: [], toReview: [], reviewed: [], isEmpty: true,
  }),
}));

const renderLauncher = () =>
  render(
    <MemoryRouter>
      <ClientBookingLauncher />
    </MemoryRouter>,
  );

describe('ClientBookingLauncher', () => {
  // El proyecto no tiene setupFile de testing-library, asi que la limpieza automatica entre
  // tests no esta registrada: sin esto los renders se acumulan y cada consulta encuentra
  // duplicados. El test original no lo notaba porque solo tenia un caso.
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      user: { id: 'user-123', user_metadata: { full_name: 'Javier Test' } },
    });
  });

  it('permite reanudar cuando el borrador pertenece al usuario autenticado', () => {
    writeBookingResume(
      'draft',
      'wizard',
      { bookingData: { address: 'Calle Sol 4' }, currentStep: 2 },
      { userId: 'user-123' },
    );

    renderLauncher();

    const resume = screen.getByRole('button', { name: 'Continuar una reserva' });
    expect(resume).toBeTruthy();
    // Lo que importa no es que exista, sino que se pueda pulsar: es lo que distingue
    // "tengo una reserva a medias" de "no la tengo".
    expect((resume as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Ver mis reservas' })).toBeTruthy();
  });

  it('deshabilita reanudar cuando no hay ningún borrador', () => {
    renderLauncher();

    const resume = screen.getByRole('button', { name: 'Continuar una reserva' });
    expect((resume as HTMLButtonElement).disabled).toBe(true);
    // Empezar una reserva nueva tiene que seguir disponible siempre.
    expect((screen.getByRole('button', { name: 'Empezar una reserva' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('saluda por el nombre de pila', () => {
    renderLauncher();
    expect(screen.getByRole('heading', { name: 'Hola de nuevo, Javier' })).toBeTruthy();
  });
});
