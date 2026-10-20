// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  profileRow: null as Record<string, unknown> | null,
  renderMaterial: vi.fn(async () => undefined),
  renderToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profileRow, error: null }) }) }),
    }),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'prov-1' } }) }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../utils/marketing/renderMaterial', () => ({
  renderMaterial: mocks.renderMaterial,
  renderToBlob: mocks.renderToBlob,
  loadImage: async () => null,
}));

import MarketingHub from './MarketingHub';

const lawn = {
  id: 'svc', name: 'Corte de césped', service_active: true, needs_license: false,
  workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true,
};

function status(overrides: Partial<ProviderSetupStatus> = {}): ProviderSetupStatus {
  return {
    provider_id: 'prov-1', provider_kind: 'solo', suspended: false, window_days: 14,
    profile: { full_name: 'Pablo', address: 'Marbella', max_distance: 25, has_coordinates: true, has_description: true, has_photo: false },
    services: [lawn],
    schedule: { has_recurring: true, free_hours_14d: 10 },
    license: { status: null, active: false },
    team: null, push_enabled: true, fee_waiver_enabled: true,
    ...overrides,
  };
}

const setStatus = (value: ProviderSetupStatus) =>
  mocks.rpc.mockImplementation(async (fn: string) => (fn === 'my_provider_setup_status' ? { data: value, error: null } : { data: 1, error: null }));

describe('MarketingHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.profileRow = {
      user_id: 'prov-1', full_name: 'Pablo Gómez', avatar_url: null, rating_average: 4.8, rating_count: 3, city_zone: 'Marbella', provider_kind: 'solo',
    };
  });
  afterEach(() => cleanup());

  it('enseña todo: QR y enlace, redes, materiales, mensajes e ideas', async () => {
    setStatus(status());
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Marketing' })).toBeTruthy();
    expect(screen.getByText(/Tus clientes reservan sin gastos de gestión/)).toBeTruthy();
    expect(screen.getByText('https://garser.es/reservar/prov-1?utm_source=enlace')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Para tus redes' })).toBeTruthy();
    for (const title of ['Tarjetas de visita', 'Tarjeta «Próxima visita»', 'Flyer para buzonear', 'Vinilo para la furgoneta', 'Cartel con pestañas', 'Pegatinas con QR', 'Cartel para la valla']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    // Mensajes: WhatsApp sin teléfono (elige el contacto) y con el enlace con su origen.
    const whatsapp = screen.getAllByRole('link', { name: /WhatsApp/ });
    expect(whatsapp).toHaveLength(3);
    const href = whatsapp[0].getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('https://garser.es/reservar/prov-1?utm_source=whatsapp');
    expect(screen.getByRole('heading', { name: 'Ideas para promocionarte' })).toBeTruthy();
    // Aparece: no hay aviso de bloqueo y se puede descargar el QR.
    expect(screen.queryByText(/Todavía no apareces a los clientes/)).toBeNull();
    expect((screen.getByRole('button', { name: /Descargar QR/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sin aparecer a los clientes: se ve, pero no se descarga, y lleva a completar la cuenta', async () => {
    setStatus(status({ services: [{ ...lawn, visible: false }] }));
    const onCompleteAccount = vi.fn();
    render(<MarketingHub onCompleteAccount={onCompleteAccount} />);

    expect(await screen.findByText(/Todavía no apareces a los clientes/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Descargar QR/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Completar mi cuenta' }));
    expect(onCompleteAccount).toHaveBeenCalled();
  });

  it('abre el editor de un material y vuelve', async () => {
    setStatus(status());
    render(<MarketingHub onCompleteAccount={vi.fn()} />);
    fireEvent.click(await screen.findByText('Vinilo para la furgoneta'));
    expect(await screen.findByRole('heading', { name: 'Vinilo para la furgoneta' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lateral' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Portón' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Marketing/ }));
    expect(await screen.findByRole('heading', { name: 'Para imprimir' })).toBeTruthy();
  });

  it('descarga el QR y lo apunta', async () => {
    setStatus(status());
    const createObjectURL = vi.fn(() => 'blob:qr');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MarketingHub onCompleteAccount={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Descargar QR/ }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.renderToBlob).toHaveBeenCalledWith(expect.objectContaining({ material: 'qr_code' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('log_marketing_download', { p_material: 'qr_code', p_formats: ['qr'] }));
    click.mockRestore();
  });

  it('una empresa habla en plural', async () => {
    mocks.profileRow = { ...mocks.profileRow, provider_kind: 'company', full_name: 'Jardines Sol' };
    setStatus(status({ provider_kind: 'company' }));
    render(<MarketingHub onCompleteAccount={vi.fn()} />);
    expect(await screen.findByText(/reserva con vosotros en un minuto/)).toBeTruthy();
    const messages = screen.getByRole('heading', { name: 'Mensajes para tus clientes' }).closest('section') as HTMLElement;
    expect(within(messages).getAllByText(/con nosotros|en nosotros|pasemos/).length).toBeGreaterThan(0);
  });
});
