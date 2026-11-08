// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// La puerta de las pantallas de equipo según el modo de la cuenta (D31): en equipo se entra; en individual
// (o sin ser profesional) se vuelve al panel de siempre; mientras se lee, espera.

const mocks = vi.hoisted(() => ({
  onboarding: { loading: false, stage: 'not_company' as string },
}));

vi.mock('../../hooks/useCompanyOnboarding', () => ({ useCompanyOnboarding: () => mocks.onboarding }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() }, auth: {} } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../components/gardener/GardenerReviews', () => ({ default: () => <p>Lista de reseñas</p> }));
vi.mock('../../components/common/AppHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../../components/gardener/ProfileSettings', () => ({ default: () => <p>Servicios, precios y zona</p> }));
vi.mock('../../hooks/useCompanyTeam', () => ({
  PHYTO_SERVICE_NAME: 'Servicios fitosanitarios',
  useCompanyTeam: () => ({ data: null, loading: true, error: null, refresh: vi.fn() }),
}));

import CompanyHomePage from './CompanyHomePage';
import CompanyConfigPage from './CompanyConfigPage';
import CompanyReviewsPage from './CompanyReviewsPage';

const at = (path: string, element: React.ReactNode, route: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={route} element={element} />
      <Route path="/dashboard" element={<p>Panel de siempre</p>} />
      <Route path="/empresa" element={<p>Panel de equipo</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('pantallas de /empresa según el modo', () => {
  beforeEach(() => { mocks.onboarding = { loading: false, stage: 'not_company' }; });
  afterEach(cleanup);

  it('/empresa en modo individual (o sin ser profesional) vuelve al panel de siempre', () => {
    at('/empresa', <CompanyHomePage />, '/empresa');
    expect(screen.getByText('Panel de siempre')).toBeTruthy();
  });

  it('/empresa mientras se lee el modo espera, sin saltar a ningún sitio', () => {
    mocks.onboarding = { loading: true, stage: 'not_company' };
    at('/empresa', <CompanyHomePage />, '/empresa');
    expect(screen.queryByText('Panel de siempre')).toBeNull();
    expect(screen.getByLabelText('Cargando')).toBeTruthy();
  });

  it('las demás pantallas de equipo, sin equipo, vuelven a /empresa (que a su vez lleva al panel de siempre)', () => {
    at('/empresa/configuracion', <CompanyConfigPage />, '/empresa/configuracion');
    expect(screen.getByText('Panel de equipo')).toBeTruthy();
    cleanup();
    at('/empresa/resenas', <CompanyReviewsPage />, '/empresa/resenas');
    expect(screen.getByText('Panel de equipo')).toBeTruthy();
  });

  it('en modo equipo, las reseñas propias se pueden leer desde el panel de equipo', () => {
    mocks.onboarding = { loading: false, stage: 'approved' };
    at('/empresa/resenas', <CompanyReviewsPage />, '/empresa/resenas');
    expect(screen.getByText('Reseñas')).toBeTruthy();
    expect(screen.getByText('Lista de reseñas')).toBeTruthy();
  });

  it('en modo equipo, la configuración de servicios y precios es la misma pantalla de un autónomo', () => {
    mocks.onboarding = { loading: false, stage: 'approved' };
    at('/empresa/configuracion', <CompanyConfigPage />, '/empresa/configuracion');
    expect(screen.getByText('Servicios, precios y zona')).toBeTruthy();
  });
});
