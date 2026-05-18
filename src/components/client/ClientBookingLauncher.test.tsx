// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeBookingResume } from '../../utils/bookingResumeStorage';
import ClientBookingLauncher from './ClientBookingLauncher';

const useAuthMock = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('./ServiceCatalog', () => ({
  default: () => <div>catalogo</div>,
}));

describe('ClientBookingLauncher', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthMock.mockReset();
  });

  it('permite reanudar cuando el borrador pertenece al usuario autenticado', () => {
    writeBookingResume(
      'draft',
      'wizard',
      { bookingData: { address: 'Calle Sol 4' }, currentStep: 2 },
      { userId: 'user-123' },
    );

    useAuthMock.mockReturnValue({
      user: {
        id: 'user-123',
        user_metadata: { full_name: 'Javier Test' },
      },
    });

    render(
      <MemoryRouter>
        <ClientBookingLauncher />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Continuar reserva' })).toBeTruthy();
  });
});
