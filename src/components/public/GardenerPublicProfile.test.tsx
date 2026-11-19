// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row, error: null }) }), in: async () => ({ data: [] }) }),
    }),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../reviews/ReviewList', () => ({ default: () => <div /> }));
vi.mock('../../utils/providerLinkProfile', () => ({ rememberProviderLinkProfile: vi.fn() }));
vi.mock('../../utils/providerLinkCode', () => ({ recallProviderLinkCode: vi.fn(() => null) }));

import GardenerPublicProfile from './GardenerPublicProfile';

const open = async (row: Record<string, unknown>) => {
  mocks.row = row;
  const view = render(
    <MemoryRouter initialEntries={['/profesional/p1']}>
      <Routes><Route path="/profesional/:gardenerId" element={<GardenerPublicProfile />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText('Perfil público del profesional');
  return view;
};

describe('Perfil público del profesional · QA-023', () => {
  afterEach(() => cleanup());

  it('sin foto: iniciales, no un icono de imagen rota', async () => {
    const { container } = await open({ user_id: 'p1', full_name: 'Rosa López', avatar_url: null, rating_count: 0, services: [] });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('RL')).toBeTruthy();
  });

  it('con foto: la foto', async () => {
    const { container } = await open({ user_id: 'p1', full_name: 'Rosa López', avatar_url: 'https://x.test/rosa.jpg', rating_count: 0, services: [] });
    expect((container.querySelector('img') as HTMLImageElement).src).toBe('https://x.test/rosa.jpg');
  });
});
