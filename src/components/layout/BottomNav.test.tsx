// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ role: null as string | null }));

vi.mock('../../contexts/AccountContext', () => ({
  useAccount: () => ({ role: mocks.role, loading: false, refresh: vi.fn() }),
}));

vi.mock('../../hooks/useUnreadChats', () => ({
  useUnreadChats: () => 0,
}));

import BottomNav from './BottomNav';

const renderNav = () =>
  render(
    <MemoryRouter>
      <BottomNav />
    </MemoryRouter>,
  );

describe('BottomNav', () => {
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
});
