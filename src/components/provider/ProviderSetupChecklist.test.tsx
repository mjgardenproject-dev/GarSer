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
import { resetPublicBillingTermsCache } from '../../hooks/usePublicBillingTerms';

const FACTORY_TERMS = { version: 1, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced' };

/** El estado del alta y, aparte, lo que dicen los ajustes de comisiones (null = no se pueden leer). */
const answer = (setup: unknown, billing: unknown = FACTORY_TERMS) =>
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_public_billing_terms') return billing ? { data: billing, error: null } : { data: null, error: { message: 'x' } };
    return { data: setup, error: null };
  });

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
    resetPublicBillingTermsCache();
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
    answer(status());
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Ya apareces a los clientes' })).toBeTruthy();
    // Lo que dice de los gastos de gestión sale de los ajustes vigentes.
    expect(await screen.findByText(/Tus clientes reservan contigo sin gastos de gestión \(salvo en las visitas de un plan de mantenimiento\)\./)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('heading', { name: 'Ya apareces a los clientes' })).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });

  it('si los ajustes cambian cambia la frase; si no se pueden leer, no promete nada', async () => {
    answer(status(), { ...FACTORY_TERMS, linkFirst: 'standard', linkRepeat: 'standard' });
    const { unmount } = render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Ya apareces a los clientes' })).toBeTruthy();
    expect(await screen.findByText('Tus clientes reservan directamente contigo.')).toBeTruthy();
    expect(screen.queryByText(/sin gastos de gestión/i)).toBeNull();
    unmount();

    resetPublicBillingTermsCache();
    answer(status(), null);
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    expect(await screen.findByText('Tus clientes reservan directamente contigo.')).toBeTruthy();
    expect(screen.queryByText(/sin gastos de gestión/i)).toBeNull();
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

  it('compartir el enlace sin menú nativo lo copia, con su clave', async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === 'my_booking_link'
        ? { data: { providerId: 'prov-1', code: '0123456789abcdef0123456789abcdef' }, error: null }
        : { data: status(), error: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    const share = await screen.findByRole('button', { name: /Compartir enlace/ });
    await waitFor(() => expect((share as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(share);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reservar/prov-1?c=0123456789abcdef0123456789abcdef`));
    expect(mocks.toast.success).toHaveBeenCalledWith('Enlace copiado');
  });

  it('sin la clave de su enlace no se puede compartir (un enlace sin clave no exime de nada)', async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === 'my_booking_link' ? { data: null, error: { message: 'x' } } : { data: status(), error: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ProviderSetupChecklist onNavigate={vi.fn()} />);
    const share = await screen.findByRole('button', { name: /Compartir enlace/ });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('my_booking_link'));
    expect((share as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(share);
    expect(writeText).not.toHaveBeenCalled();
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
