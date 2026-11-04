// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  billing: { data: null, error: null } as { data: unknown; error: unknown },
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
import { resetPublicBillingTermsCache } from '../../hooks/usePublicBillingTerms';

const FACTORY_TERMS = { version: 1, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced' };

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

const LINK_CODE = '0123456789abcdef0123456789abcdef';

const setStatus = (value: ProviderSetupStatus, link: { data: unknown; error: unknown } = { data: { code: LINK_CODE }, error: null }) =>
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'my_provider_setup_status') return { data: value, error: null };
    if (fn === 'my_booking_link') return link;
    if (fn === 'get_public_billing_terms') return mocks.billing;
    return { data: 1, error: null };
  });

describe('MarketingHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetPublicBillingTermsCache();
    mocks.billing = { data: FACTORY_TERMS, error: null };
    mocks.profileRow = {
      user_id: 'prov-1', full_name: 'Pablo Gómez', avatar_url: null, rating_average: 4.8, rating_count: 3, city_zone: 'Marbella', provider_kind: 'solo',
    };
  });
  afterEach(() => cleanup());

  it('enseña todo: QR y enlace, redes, materiales, mensajes e ideas', async () => {
    setStatus(status());
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Marketing' })).toBeTruthy();
    // Lo que dice de los gastos de gestión sale de los ajustes vigentes (aquí, los de fábrica).
    expect(await screen.findByText('Tus clientes reservan contigo sin gastos de gestión (salvo en las visitas de un plan de mantenimiento).')).toBeTruthy();
    expect(screen.getByText(`https://garser.es/reservar/prov-1?c=${LINK_CODE}&utm_source=enlace`)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Para tus redes' })).toBeTruthy();
    for (const title of ['Tarjetas de visita', 'Tarjeta «Próxima visita»', 'Flyer para buzonear', 'Vinilo para la furgoneta', 'Cartel con pestañas', 'Pegatinas con QR', 'Cartel para la valla']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    // Mensajes: WhatsApp sin teléfono (elige el contacto) y con el enlace con su origen.
    const whatsapp = screen.getAllByRole('link', { name: /WhatsApp/ });
    expect(whatsapp).toHaveLength(3);
    const href = whatsapp[0].getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href)).toContain(`https://garser.es/reservar/prov-1?c=${LINK_CODE}&utm_source=whatsapp`);
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

  it('si los ajustes cambian, cambia lo que dice; si no se pueden leer, no promete nada', async () => {
    mocks.billing = { data: { ...FACTORY_TERMS, linkFirst: 'standard', linkRepeat: 'standard' }, error: null };
    setStatus(status());
    const { unmount } = render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Marketing' })).toBeTruthy();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_public_billing_terms'));
    expect(await screen.findByText('Tus clientes reservan directamente contigo.')).toBeTruthy();
    expect(screen.queryByText(/sin gastos de gestión/i)).toBeNull();
    unmount();

    resetPublicBillingTermsCache();
    mocks.billing = { data: null, error: { message: 'offline' } };
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);
    expect(await screen.findByText('Tus clientes reservan directamente contigo.')).toBeTruthy();
    expect(screen.queryByText(/sin gastos de gestión/i)).toBeNull();
  });

  it('los mensajes para copiar nunca hablan de gastos de gestión (no se pueden corregir una vez enviados)', async () => {
    setStatus(status());
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);
    const messages = (await screen.findByRole('heading', { name: 'Mensajes para tus clientes' })).closest('section') as HTMLElement;
    expect(messages.textContent ?? '').not.toMatch(/gesti[oó]n|comisi[oó]n|gratis/i);
  });

  it('sin la clave de su enlace no genera ningún material (un QR sin clave no exime de nada)', async () => {
    setStatus(status(), { data: null, error: { message: 'boom' } });
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);
    expect(await screen.findByText(/No hemos podido cargar tu enlace de reserva/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Descargar QR/ })).toBeNull();
    expect(screen.queryByText(/reservar\/prov-1/)).toBeNull();
  });

  it('una clave mal formada se trata como si no hubiera clave', async () => {
    setStatus(status(), { data: { code: 'no-es-una-clave' }, error: null });
    render(<MarketingHub onBack={vi.fn()} onCompleteAccount={vi.fn()} />);
    expect(await screen.findByText(/No hemos podido cargar tu enlace de reserva/)).toBeTruthy();
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
    expect(await screen.findByText(/reserva con vosotros online/)).toBeTruthy();
    const messages = screen.getByRole('heading', { name: 'Mensajes para tus clientes' }).closest('section') as HTMLElement;
    expect(within(messages).getAllByText(/con nosotros|en nosotros|pasemos/).length).toBeGreaterThan(0);
  });
});
