// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Servicios» cuando la reserva viene del enlace de un profesional: solo los servicios que él
 * ofrece. Antes salía el catálogo entero y se podía acabar en «No hay profesionales disponibles».
 */

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  linkProfile: vi.fn(),
}));

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
}));

vi.mock('../../hooks/useProviderLinkProfile', () => ({
  useProviderLinkProfile: (id?: string) => mocks.linkProfile(id),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  { id: 'svc-lawn', name: 'Corte de césped', image_url: null, image_id: null },
                  { id: 'svc-hedge', name: 'Poda de setos', image_url: null, image_id: null },
                  { id: 'svc-palm', name: 'Poda de palmeras', image_url: null, image_id: null },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: async () => ({ data: [] }) };
    },
  },
}));

vi.mock('../../utils/marketingAssets', () => ({
  getMarketingAssetUrl: (slot: string) => `https://cdn.example.com/${slot}.webp`,
}));

import ServicesPage from './ServicesPage';

describe('ServicesPage — reserva desde el enlace de un profesional', () => {
  const setBookingData = vi.fn();
  const setCurrentStep = vi.fn();

  const withBooking = (bookingData: Record<string, unknown>) => {
    mocks.useBooking.mockReturnValue({ bookingData, setBookingData, saveProgress: vi.fn(), setCurrentStep });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkProfile.mockImplementation((id?: string) =>
      id
        ? { profile: { userId: id, fullName: 'Ana Jardines', serviceIds: ['svc-lawn', 'svc-hedge'], maxDistanceKm: 25 }, status: 'ready' }
        : { profile: null, status: 'idle' },
    );
  });

  afterEach(() => cleanup());

  it('solo enseña los servicios que ofrece el profesional y recuerda con quién se reserva', async () => {
    withBooking({ serviceIds: [], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    expect(await screen.findByRole('button', { name: 'Seleccionar Corte de césped' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seleccionar Poda de setos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seleccionar Poda de palmeras' })).toBeNull();
    expect(screen.getByText(/Solo ves los servicios que hace este profesional/)).toBeTruthy();
    expect(document.body.textContent).toContain('Reserva con Ana Jardines');
  });

  it('quita de la selección los que no hace, lo dice y no los manda a «Detalles»', async () => {
    withBooking({ serviceIds: ['svc-palm', 'svc-lawn'], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    expect(await screen.findByText(/No hace «Poda de palmeras»/)).toBeTruthy();
    expect(document.body.textContent).toContain('lo hemos quitado de tu selección');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a los detalles del servicio' }));
    expect(setBookingData).toHaveBeenCalledWith(expect.objectContaining({ serviceIds: ['svc-lawn'] }));
    expect(setCurrentStep).toHaveBeenCalledWith(2);
  });

  it('«Ver todos los servicios» deja de ligar la reserva al profesional', async () => {
    withBooking({ serviceIds: [], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ver todos los servicios' }));
    expect(setBookingData).toHaveBeenCalledWith({ restrictedGardenerId: undefined });
  });

  it('mientras llega el perfil del profesional no pinta el catálogo entero', async () => {
    mocks.linkProfile.mockReturnValue({ profile: null, status: 'loading' });
    withBooking({ serviceIds: [], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: /^Seleccionar / })).toBeNull();
  });

  it('si no se ha podido saber qué ofrece, enseña el catálogo entero (el servidor decide después)', async () => {
    mocks.linkProfile.mockReturnValue({ profile: null, status: 'error' });
    withBooking({ serviceIds: [], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    expect(await screen.findByRole('button', { name: 'Seleccionar Poda de palmeras' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Solo ves los servicios');
  });

  it('sin ningún servicio configurado lo dice y ofrece ver otros profesionales', async () => {
    mocks.linkProfile.mockReturnValue({
      profile: { userId: 'gardener-B', fullName: 'Ana Jardines', serviceIds: [], maxDistanceKm: 25 },
      status: 'ready',
    });
    withBooking({ serviceIds: [], restrictedGardenerId: 'gardener-B' });

    render(<ServicesPage />);

    expect(await screen.findByText('Ana Jardines todavía no tiene servicios para reservar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver otros profesionales' }));
    expect(setBookingData).toHaveBeenCalledWith({ restrictedGardenerId: undefined });
  });

  it('sin enlace, todo como siempre', async () => {
    withBooking({ serviceIds: [] });

    render(<ServicesPage />);

    expect(await screen.findByRole('button', { name: 'Seleccionar Poda de palmeras' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Solo ves los servicios');
    expect(document.body.textContent).not.toContain('Reserva con');
    expect(screen.queryByRole('button', { name: 'Ver todos los servicios' })).toBeNull();
  });
});
