// @vitest-environment jsdom
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MarbellaLandingPage from './MarbellaLandingPage';

vi.mock('../../components/common/SeoHead', () => ({
  default: () => null,
}));

vi.mock('../../components/public/MarketingImageSlot', () => ({
  default: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

describe('MarbellaLandingPage', () => {
  it('renderiza la propuesta local de Marbella', () => {
    render(
      <MemoryRouter>
        <MarbellaLandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /reserva servicios de jardineria en marbella con una experiencia clara/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Empezar nueva reserva' }).length).toBeGreaterThan(0);
  });
});
