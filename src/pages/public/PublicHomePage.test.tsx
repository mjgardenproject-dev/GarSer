// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeBookingResume } from '../../utils/bookingResumeStorage';
import PublicHomePage from './PublicHomePage';

vi.mock('../../components/common/SeoHead', () => ({
  default: () => null,
}));

vi.mock('../../components/public/MarketingImageSlot', () => ({
  default: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

describe('PublicHomePage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('muestra los CTA principales de la portada publica', () => {
    render(
      <MemoryRouter>
        <PublicHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /descubre cuánto cuesta y cuándo hay disponibilidad para tu jardín/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Empezar nueva reserva' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /acceder/i }).length).toBeGreaterThan(0);
  });

  it('muestra continuar reserva cuando existe un borrador anonimo', () => {
    writeBookingResume('draft', 'wizard', { bookingData: { address: 'Calle Sol 4' }, currentStep: 2 });

    render(
      <MemoryRouter>
        <PublicHomePage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('button', { name: 'Continuar reserva' }).length).toBeGreaterThan(0);
  });
});
