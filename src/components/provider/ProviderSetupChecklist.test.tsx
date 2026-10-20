// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import ProviderSetupChecklist from './ProviderSetupChecklist';

function status(overrides: Partial<ProviderSetupStatus> = {}): ProviderSetupStatus {
  return {
    provider_id: 'prov-1',
    provider_kind: 'solo',
    suspended: false,
    window_days: 14,
    profile: { full_name: 'Miguel', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: true, has_photo: false },
    services: [{
      id: 'svc', name: 'Corte de césped', service_active: true, needs_license: false,
      workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true,
    }],
    schedule: { has_recurring: true, free_hours_14d: 20 },
    license: { status: null, active: false },
    team: null,
    push_enabled: true,
    fee_waiver_enabled: true,
    ...overrides,
  };
}

const fresh = () => status({
  profile: { full_name: 'Miguel', address: 'Marbella', max_distance: 25, has_coordinates: false, has_description: false, has_photo: false },
  services: [],
  schedule: { has_recurring: false, free_hours_14d: 0 },
});

const DISMISS_KEY = 'garser:provider-setup:dismissed:prov-1';

describe('ProviderSetupChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('cuenta recién aprobada: dice que no aparece, el progreso y lleva al primer paso', async () => {
    mocks.rpc.mockResolvedValue({ data: fresh(), error: null });
    const onNavigate = vi.fn();
    render(<ProviderSetupChecklist onNavigate={onNavigate} />);

    expect(await screen.findByRole('heading', { name: 'Todavía no apareces a los clientes' })).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('my_provider_setup_status');
    expect(screen.getByText('0 de 3')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    // El siguiente paso lleva botón principal; los demás, enlace.
    fireEvent.click(screen.getByRole('button', { name: 'Configurar servicios' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'profile', tab: 'services' });
    fireEvent.click(screen.getByRole('button', { name: 'Crear horario' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'schedule', tab: 'recurring' });
    // Sin servicios visibles, no se ofrece compartir el enlace.
    expect(screen.queryByRole('button', { name: /Compartir enlace/ })).toBeNull();
  });

  it('los recomendados van plegados aparte', async () => {
    mocks.rpc.mockResolvedValue({ data: fresh(), error: null });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    const toggle = await screen.findByRole('button', { name: /Para conseguir más reservas/ });
    expect(screen.queryByText('Foto de perfil')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Foto de perfil')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeTruthy();
  });

  it('todo lo obligatorio hecho: tarjeta pequeña con el enlace, que se puede cerrar', async () => {
    mocks.rpc.mockResolvedValue({ data: status(), error: null });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Ya apareces a los clientes' })).toBeTruthy();
    expect(screen.getByText(/sin gastos de gestión/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('heading', { name: 'Ya apareces a los clientes' })).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });

  it('cerrada sigue cerrada… hasta que algo obligatorio deja de estar bien', async () => {
    localStorage.setItem(DISMISS_KEY, '1');
    mocks.rpc.mockResolvedValueOnce({ data: status(), error: null });
    const { unmount } = render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading')).toBeNull();
    unmount();

    // Se queda sin horas libres: vuelve la lista completa y se olvida que la cerró.
    mocks.rpc.mockResolvedValueOnce({
      data: status({
        schedule: { has_recurring: true, free_hours_14d: 0 },
        services: [{ ...status().services[0], workers_with_hours: 0, visible: false }],
      }),
      error: null,
    });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Todavía no apareces a los clientes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir más horas' })).toBeTruthy();
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  it('compartir el enlace sin menú nativo lo copia', async () => {
    mocks.rpc.mockResolvedValue({ data: status(), error: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Compartir enlace/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reservar/prov-1`));
    expect(mocks.toast.success).toHaveBeenCalledWith('Enlace copiado');
  });

  it('si el servidor falla, no bloquea el panel y deja reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    mocks.rpc.mockResolvedValueOnce({ data: fresh(), error: null });
    await act(async () => { fireEvent.click(retry); });
    expect(await screen.findByRole('heading', { name: 'Todavía no apareces a los clientes' })).toBeTruthy();
  });
});
