// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  load: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: mocks.rpc, from: () => { throw new Error('sin tabla en este test'); } },
}));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../utils/serviceActivation', () => ({
  loadServiceActivation: mocks.load,
  setServiceActive: mocks.setActive,
}));

import ProviderSetupChecklist from './ProviderSetupChecklist';
import { resetPublicBillingTermsCache } from '../../hooks/usePublicBillingTerms';

const fresh = (): ProviderSetupStatus => ({
  provider_id: 'prov-1',
  provider_kind: 'solo',
  suspended: false,
  window_days: 14,
  profile: { full_name: 'Ana', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: false, has_photo: false },
  services: [],
  schedule: { has_recurring: true, free_hours_14d: 10 },
  license: { status: null, active: false },
  team: null,
  push_enabled: false,
  fee_waiver_enabled: false,
});

const answer = () => mocks.rpc.mockImplementation(async (fn: string) =>
  fn === 'get_public_billing_terms'
    ? { data: null, error: { message: 'x' } }
    : { data: fresh(), error: null });

describe('ProviderSetupChecklist · activar servicios desde la ayuda (fallo 7.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetPublicBillingTermsCache();
    answer();
    mocks.setActive.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  const open = async (activation: Array<{ id: string; name: string; active: boolean; canActivate: boolean }>) => {
    mocks.load.mockResolvedValue(activation);
    const onNavigate = vi.fn();
    render(<ProviderSetupChecklist onNavigate={onNavigate} />);
    await screen.findByText('Servicios y precios');
    return onNavigate;
  };

  it('dice «tienes 2 servicios configurados pero sin activar» y enseña un botón «Activar» por servicio', async () => {
    await open([
      { id: 'a', name: 'Corte de césped', active: false, canActivate: true },
      { id: 'b', name: 'Poda de setos', active: false, canActivate: true },
    ]);
    expect(screen.getByText(/Tienes 2 servicios configurados pero sin activar: Corte de césped y Poda de setos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activar Corte de césped' }).getAttribute('data-state')).toBe('ready');
    expect(screen.getByRole('button', { name: 'Activar Poda de setos' }).getAttribute('data-state')).toBe('ready');
  });

  it('pulsar «Activar» activa ese servicio (solo la columna `active`) y avisa', async () => {
    await open([{ id: 'a', name: 'Corte de césped', active: false, canActivate: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Activar Corte de césped' }));
    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith('prov-1', 'a', true));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Corte de césped activado'));
  });

  it('tras activarlo, vuelve a pedir el estado (la ayuda se actualiza sola)', async () => {
    await open([{ id: 'a', name: 'Corte de césped', active: false, canActivate: true }]);
    const callsBefore = mocks.rpc.mock.calls.filter(([fn]) => fn === 'my_provider_setup_status').length;
    fireEvent.click(screen.getByRole('button', { name: 'Activar Corte de césped' }));
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([fn]) => fn === 'my_provider_setup_status').length).toBeGreaterThan(callsBefore));
  });

  it('un servicio a medias («locked»): no activa nada; explica y lleva a configurarlo', async () => {
    const onNavigate = await open([{ id: 'b', name: 'Poda de árboles', active: false, canActivate: false }]);
    fireEvent.click(screen.getByRole('button', { name: /Poda de árboles: primero hay que configurar su precio/ }));
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('Primero configura el precio de Poda de árboles.', expect.anything());
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'profile', tab: 'services' });
  });

  it('si falla, lo dice y el botón sigue disponible', async () => {
    mocks.setActive.mockRejectedValueOnce(new Error('red'));
    await open([{ id: 'a', name: 'Corte de césped', active: false, canActivate: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Activar Corte de césped' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('No se ha podido cambiar el servicio. Inténtalo de nuevo.'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Activar Corte de césped' }) as HTMLButtonElement).getAttribute('aria-busy')).toBeNull());
  });

  it('sin servicios empezados: el texto de siempre y ningún botón de servicio', async () => {
    await open([]);
    expect(screen.getByText(/Activa al menos un servicio con tus precios/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Tus servicios' })).toBeNull();
  });
});
