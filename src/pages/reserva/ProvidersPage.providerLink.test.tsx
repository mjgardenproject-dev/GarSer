// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Profesionales» cuando la reserva viene del enlace de un profesional y ese profesional no sale.
 * Antes: «No hay profesionales disponibles», sin decir que solo se miraba a uno ni por qué.
 */

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  linkProfileMissing: false,
  previewProviderQuotes: vi.fn(),
  fetchProviderMonthDays: vi.fn(),
  fetchProviderValidHours: vi.fn(),
  pricedGardeners: [] as string[],
}));

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}));

vi.mock('../../utils/bookingAuthorityService', () => ({
  previewProviderQuotes: mocks.previewProviderQuotes,
  fetchProviderMonthDays: mocks.fetchProviderMonthDays,
  fetchProviderValidHours: mocks.fetchProviderValidHours,
}));

vi.mock('../../hooks/useProviderLinkProfile', () => ({
  useProviderLinkProfile: (id?: string) => ({
    profile: id && !mocks.linkProfileMissing ? { userId: id, fullName: 'Ana Jardines', serviceIds: ['svc-palm'], maxDistanceKm: 25 } : null,
    status: id ? 'ready' : 'idle',
  }),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('./PartialServiceModal', () => ({ PartialServiceModal: () => null }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (table: string) => {
      if (table === 'gardener_service_prices') {
        return {
          select: () => ({
            eq: async () => ({ data: mocks.pricedGardeners.map((gardener_id) => ({ gardener_id })) }),
          }),
        };
      }
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Poda de palmeras' } }) }) }) };
      }
      if (table === 'public_gardener_directory') {
        return {
          select: () => ({
            in: async (_field: string, ids: string[]) => ({
              data: ids.map((user_id) => ({ user_id, full_name: user_id === 'gardener-B' ? 'Ana Jardines' : 'Otro Profesional' })),
            }),
          }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [] }), in: async () => ({ data: [] }) }) };
    },
  },
}));

import ProvidersPage from './ProvidersPage';

const quoteFor = (providerId: string) => ({
  providerId,
  totalPrice: 90,
  estimatedHours: 2,
  breakdown: [],
  warnings: [],
  metadata: { pricingContext: { serviceType: 'standard', allowsPriceChange: false, palmGroups: [] } },
  economics: {
    currency: 'EUR' as const,
    taxRate: 0.21,
    serviceGrossTotal: 90,
    serviceNetSubtotal: 74.38,
    serviceTaxAmount: 15.62,
    managementFee: 11.25,
    payableNow: 11.25,
    payableLater: 90,
    lines: [],
    stripeLineItems: [],
  },
  availability: {
    requestedDate: '2026-10-17',
    validStartHours: [9],
    calendarDays: [{ date: '2026-10-17', day: 17, disabled: false, count: 1 }],
    earliestSlot: { date: '2026-10-17', startHour: 9, startTime: '09:00:00', endTime: '11:00:00', durationHours: 2 },
    selectedSlot: null,
  },
  eligibility: { isEligible: true },
});

describe('ProvidersPage — reserva desde el enlace de un profesional', () => {
  const setBookingData = vi.fn();
  const setCurrentStep = vi.fn();

  const useLinkedBooking = (overrides: Record<string, unknown> = {}) => {
    mocks.useBooking.mockReturnValue({
      bookingData: {
        address: 'Calle Verde 1',
        addressCoordinates: { lat: 36.5, lng: -4.9 },
        serviceIds: ['svc-palm'],
        restrictedGardenerId: 'gardener-B',
        preferredDate: '2026-10-17',
        providerId: '',
        timeSlot: '',
        estimatedHours: 0,
        totalPrice: 0,
        wasteRemoval: true,
        palmGroups: [],
        lawnZones: [],
        weedingZones: [],
        ...overrides,
      },
      setBookingData,
      setCurrentStep,
    });
  };

  const excluded = (code: string) => ({
    quotes: {},
    eligibleProviderIds: [],
    earliestByProvider: { 'gardener-B': null },
    exclusions: { 'gardener-B': { code, message: '' } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkProfileMissing = false;
    mocks.pricedGardeners = ['gardener-A', 'gardener-B'];
    useLinkedBooking();
    mocks.fetchProviderMonthDays.mockResolvedValue({ quote: null, days: [] });
    mocks.fetchProviderValidHours.mockResolvedValue({ quote: null, validHours: [] });
  });

  afterEach(() => cleanup());

  it('solo pregunta por el profesional del enlace y mira un mes entero de agenda', async () => {
    mocks.previewProviderQuotes.mockResolvedValue({
      quotes: { 'gardener-B': quoteFor('gardener-B') },
      eligibleProviderIds: ['gardener-B'],
      earliestByProvider: { 'gardener-B': { date: '2026-10-17', startHour: 9 } },
    });

    render(<ProvidersPage />);

    expect(await screen.findByText('Ana Jardines')).toBeTruthy();
    expect(mocks.previewProviderQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ providerIds: ['gardener-B'], windowDays: 31 }),
    );
    expect(screen.queryByText('Otro Profesional')).toBeNull();
  });

  it('si no hace el servicio lo dice, propone cambiarlo y ofrece ver otros profesionales', async () => {
    mocks.pricedGardeners = ['gardener-A'];

    render(<ProvidersPage />);

    expect(await screen.findByRole('heading', { name: 'Ana Jardines no hace este servicio' })).toBeTruthy();
    expect(screen.getByText('Ana Jardines no ofrece «Poda de palmeras». Puedes elegir otro de sus servicios.')).toBeTruthy();
    expect(screen.queryByText('No hay profesionales disponibles')).toBeNull();
    // Sin tarifa no hace falta preguntar al servidor.
    expect(mocks.previewProviderQuotes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro servicio' }));
    expect(setCurrentStep).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ver otros profesionales' }));
    expect(setBookingData).toHaveBeenCalledWith({ restrictedGardenerId: undefined });
  });

  it('si no cubre la zona lo dice con su radio, propone cambiar la dirección y ofrece ver otros', async () => {
    mocks.previewProviderQuotes.mockResolvedValue(excluded('outside_coverage'));

    render(<ProvidersPage />);

    expect(await screen.findByRole('heading', { name: 'Ana Jardines no trabaja en tu zona' })).toBeTruthy();
    expect(document.body.textContent).toContain('fuera de su radio de trabajo (25 km)');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar la dirección' }));
    expect(setCurrentStep).toHaveBeenCalledWith(0);
    expect(screen.getByRole('button', { name: 'Ver otros profesionales' })).toBeTruthy();
  });

  it('si solo le faltan huecos NO enseña a otros: ofrece buscar a partir del mes siguiente', async () => {
    mocks.previewProviderQuotes.mockResolvedValueOnce(excluded('no_reservable_availability'));
    mocks.previewProviderQuotes.mockResolvedValueOnce({
      quotes: { 'gardener-B': quoteFor('gardener-B') },
      eligibleProviderIds: ['gardener-B'],
      earliestByProvider: { 'gardener-B': { date: '2026-11-20', startHour: 9 } },
    });

    render(<ProvidersPage />);

    expect(await screen.findByRole('heading', { name: 'Ana Jardines no tiene huecos para este trabajo' })).toBeTruthy();
    expect(document.body.textContent).toContain('entre el 17 de octubre y el 16 de noviembre');
    expect(screen.queryByRole('button', { name: 'Ver otros profesionales' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar a partir del 17 de noviembre' }));

    await waitFor(() => {
      expect(mocks.previewProviderQuotes).toHaveBeenLastCalledWith(
        expect.objectContaining({ providerIds: ['gardener-B'], selectedDate: '2026-11-17', windowDays: 31 }),
      );
    });
    expect(await screen.findByText('Ana Jardines')).toBeTruthy();
  });

  it('si ya no está en el directorio (cuenta cerrada) no dice que «no hace el servicio»', async () => {
    mocks.linkProfileMissing = true;
    mocks.pricedGardeners = ['gardener-A'];

    render(<ProvidersPage />);

    expect(await screen.findByRole('heading', { name: 'Este profesional no admite reservas ahora mismo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver otros profesionales' })).toBeTruthy();
  });

  it('sin licencia para el químico: revisar detalles (tratamiento ecológico) u otros profesionales', async () => {
    mocks.previewProviderQuotes.mockResolvedValue(excluded('missing_phytosanitary_license'));

    render(<ProvidersPage />);

    expect(await screen.findByRole('heading', { name: 'Ana Jardines no puede hacer este tratamiento ahora mismo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar los detalles' }));
    expect(setCurrentStep).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: 'Ver otros profesionales' })).toBeTruthy();
  });

  it('al pulsar «Ver otros profesionales» vuelve a cargar la lista con todos (y con dos semanas)', async () => {
    mocks.previewProviderQuotes.mockResolvedValueOnce(excluded('outside_coverage'));
    mocks.previewProviderQuotes.mockResolvedValueOnce({
      quotes: { 'gardener-A': quoteFor('gardener-A'), 'gardener-B': quoteFor('gardener-B') },
      eligibleProviderIds: ['gardener-A', 'gardener-B'],
      earliestByProvider: {},
    });

    const { rerender } = render(<ProvidersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver otros profesionales' }));
    expect(setBookingData).toHaveBeenCalledWith({ restrictedGardenerId: undefined });

    // El contexto aplica el cambio: la reserva ya no está ligada a nadie.
    useLinkedBooking({ restrictedGardenerId: undefined });
    rerender(<ProvidersPage />);

    expect(await screen.findByText('Otro Profesional')).toBeTruthy();
    expect(mocks.previewProviderQuotes).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerIds: ['gardener-A', 'gardener-B'], windowDays: 14 }),
    );
  });
});
