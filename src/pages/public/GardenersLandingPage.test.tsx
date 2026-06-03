// @vitest-environment jsdom
import React from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../components/common/SeoHead', () => ({
  default: () => null,
}));

vi.mock('../../components/public/MarketingImageSlot', () => ({
  default: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import GardenersLandingPage from './GardenersLandingPage';

describe('GardenersLandingPage', () => {
  it('envia al registro de jardinero con el estado correcto', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <GardenersLandingPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Registrarse como jardinero' }));

    expect(navigateMock).toHaveBeenCalledWith('/auth', {
      state: {
        initialMode: 'signup',
        preselectedRole: 'gardener',
      },
    });
  });
});
