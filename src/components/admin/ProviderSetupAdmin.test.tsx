// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import ProviderSetupAdmin from './ProviderSetupAdmin';
import { buildAdminProviderEntries, type AdminProviderRow } from './providerSetupEntries';

const lawn = {
  id: 'svc', name: 'Corte de césped', service_active: true, needs_license: false,
  workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true,
};

function status(overrides: Partial<ProviderSetupStatus> = {}): ProviderSetupStatus {
  return {
    provider_id: 'p', provider_kind: 'solo', suspended: false, window_days: 14,
    profile: { full_name: 'X', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: true, has_photo: true },
    services: [lawn],
    schedule: { has_recurring: true, free_hours_14d: 10 },
    license: { status: null, active: false },
    team: null, push_enabled: true, fee_waiver_enabled: false,
    ...overrides,
  };
}

const row = (overrides: Partial<AdminProviderRow>): AdminProviderRow => ({
  user_id: 'u', name: 'Nombre', provider_kind: 'solo', email: 'p@x.es', phone: '+34600000000',
  approved_at: '2026-10-01T10:00:00Z', status: status(), ...overrides,
});

const rows: AdminProviderRow[] = [
  row({ user_id: 'ok', name: 'Ana Completa', approved_at: '2026-10-10T10:00:00Z' }),
  row({
    user_id: 'hidden-old', name: 'Beto Sinhorario', approved_at: '2026-09-01T10:00:00Z',
    status: status({ schedule: { has_recurring: false, free_hours_14d: 0 }, services: [{ ...lawn, workers_with_hours: 0, visible: false }] }),
  }),
  row({
    user_id: 'hidden-new', name: 'Carla Nueva', provider_kind: 'company', approved_at: '2026-10-15T10:00:00Z',
    status: status({ provider_kind: 'company', services: [], team: { company_status: 'active', owner_works: false, employees: 0, pending_invitations: 0, members: [] } }),
  }),
  row({
    user_id: 'partial', name: 'Dani Parcial', approved_at: '2026-10-05T10:00:00Z',
    status: status({ services: [lawn, { ...lawn, id: 'phy', name: 'Servicios fitosanitarios', needs_license: true, visible_chemical: false }] }),
  }),
];

describe('buildAdminProviderEntries', () => {
  it('primero los que no aparecen (los más recientes antes), luego los que les falta algo, luego los completos', () => {
    expect(buildAdminProviderEntries(rows).map((e) => [e.user_id, e.category])).toEqual([
      ['hidden-new', 'hidden'],
      ['hidden-old', 'hidden'],
      ['partial', 'pending'],
      ['ok', 'complete'],
    ]);
  });

  it('una cuenta suspendida no aparece aunque lo tenga todo', () => {
    expect(buildAdminProviderEntries([row({ status: status({ suspended: true }) })])[0].category).toBe('hidden');
  });
});

describe('ProviderSetupAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
  });
  afterEach(() => cleanup());

  it('resume, filtra y dice qué le falta a cada uno', async () => {
    render(<ProviderSetupAdmin />);
    expect(await screen.findByText(/aprobados/)).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_provider_setup_overview');
    expect(screen.getByRole('tab', { name: 'No aparecen (2)' }).getAttribute('aria-selected')).toBe('true');

    // Por defecto, solo los que no aparecen.
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Beto Sinhorario')).toBeTruthy();
    expect(screen.getAllByText('No aparece a los clientes')).toHaveLength(2);
    expect(screen.getByText(/Horario/, { selector: 'p' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Llamar/ })[0].getAttribute('href')).toBe('tel:+34600000000');

    fireEvent.click(screen.getByRole('tab', { name: 'Les falta algo (3)' }));
    expect(screen.getByText('Dani Parcial')).toBeTruthy();
    expect(screen.getByText('Carnet fitosanitario', { exact: false, selector: 'p' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Todos (4)' }));
    expect(screen.getByText('Ana Completa')).toBeTruthy();
    expect(screen.getByText('Aparece en Corte de césped')).toBeTruthy();
  });

  it('un error del servidor se ve', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Acceso denegado' } });
    render(<ProviderSetupAdmin />);
    expect(await screen.findByText('Acceso denegado')).toBeTruthy();
  });
});
