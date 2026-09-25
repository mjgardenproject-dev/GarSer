// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useBooking: vi.fn(),
  previewProviderQuotes: vi.fn(),
  fetchProviderMonthDays: vi.fn(),
  fetchProviderValidHours: vi.fn(),
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('../../contexts/BookingContext', () => ({
  useBooking: () => mocks.useBooking(),
}));

vi.mock('../../utils/bookingAuthorityService', () => ({
  previewProviderQuotes: mocks.previewProviderQuotes,
  fetchProviderMonthDays: mocks.fetchProviderMonthDays,
  fetchProviderValidHours: mocks.fetchProviderValidHours,
}));

vi.mock('react-hot-toast', () => ({
  default: mocks.toast,
}));

vi.mock('./PartialServiceModal', () => ({
  PartialServiceModal: () => null,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'gardener_service_prices') {
        return {
          select: () => ({
            eq(field: string) {
              if (field === 'service_id') {
                return Promise.resolve({
                  data: [
                    {
                      gardener_id: 'gardener-1',
                    },
                  ],
                });
              }
              return Promise.resolve({ data: [] });
            },
          }),
        };
      }

      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  name: 'Corte de césped',
                },
              }),
            }),
          }),
        };
      }

      if (table === 'gardener_profiles' || table === 'public_gardener_directory') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  user_id: 'gardener-1',
                  full_name: 'Jardinero Test',
                  rating_average: 4.8,
                  rating_count: 12,
                  has_phytosanitary_license: true,
                },
              ],
            }),
            eq: async () => ({
              data: [
                {
                  user_id: 'gardener-1',
                  full_name: 'Jardinero Test',
                  rating_average: 4.8,
                  rating_count: 12,
                  has_phytosanitary_license: true,
                },
              ],
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: async () => ({ data: [] }),
          in: async () => ({ data: [] }),
        }),
      };
    },
  },
}));

import ProvidersPage from './ProvidersPage';

describe('ProvidersPage', () => {
  const setBookingData = vi.fn();
  const setCurrentStep = vi.fn();
  const quote = {
    providerId: 'gardener-1',
    totalPrice: 158,
    estimatedHours: 2,
    breakdown: [{ desc: 'Servicio base', price: 158 }],
    warnings: [],
    metadata: {
      pricingContext: {
        serviceType: 'standard',
        allowsPriceChange: true,
        palmGroups: [],
      },
    },
    economics: {
      currency: 'EUR' as const,
      taxRate: 0.21,
      serviceGrossTotal: 158,
      serviceNetSubtotal: 130.58,
      serviceTaxAmount: 27.42,
      managementFee: 19.75,
      payableNow: 19.75,
      payableLater: 158,
      lines: [],
      stripeLineItems: [],
    },
    availability: {
      requestedDate: '2026-05-20',
      validStartHours: [9, 10],
      calendarDays: [
        {
          date: '2026-05-20',
          day: 20,
          disabled: false,
          count: 2,
        },
      ],
      earliestSlot: {
        date: '2026-05-20',
        startHour: 9,
        startTime: '09:00:00',
        endTime: '11:00:00',
        durationHours: 2,
      },
      selectedSlot: null,
    },
    eligibility: {
      isEligible: true,
      reasons: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useBooking.mockReturnValue({
      bookingData: {
        address: 'Calle Verde 1',
        serviceIds: ['svc-1'],
        preferredDate: '2026-05-20',
        providerId: '',
        timeSlot: '',
        estimatedHours: 0,
        totalPrice: 0,
        wasteRemoval: true,
        weedingZones: [],
        palmGroups: [],
        lawnZones: [],
      },
      setBookingData,
      setCurrentStep,
    });

    mocks.previewProviderQuotes.mockResolvedValue({
      quotes: {
        'gardener-1': quote,
      },
      eligibleProviderIds: ['gardener-1'],
      earliestByProvider: {
        'gardener-1': {
          date: '2026-05-20',
          startHour: 9,
        },
      },
    });
    mocks.fetchProviderMonthDays.mockResolvedValue({
      quote,
      days: quote.availability.calendarDays,
    });
    mocks.fetchProviderValidHours.mockResolvedValue({
      quote,
      validHours: [9, 10],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('desglosa lo que el cliente paga hoy y lo que abona al profesional', async () => {
    render(<ProvidersPage />);

    expect(await screen.findByText('Total de la reserva')).toBeTruthy();
    expect(screen.getByText('177,75 €')).toBeTruthy();
    // Ya desde la elección de profesional se separan los dos importes: antes solo se decía
    // "Incluye tarifa de reserva de X", sin indicar cuánto acababa cobrando el jardinero.
    const rendered = document.body.textContent || '';
    expect(rendered).toContain('Pagas hoy 19,75 € de gastos de gestión');
    expect(rendered).toContain('158,00 € al profesional');
    expect(rendered).not.toContain('Incluye tarifa de reserva');
  });

  it('consume el preview backend sin reenviar minimos globales legacy', async () => {
    render(<ProvidersPage />);

    await waitFor(() => {
      expect(mocks.previewProviderQuotes).toHaveBeenCalledWith(
        expect.not.objectContaining({
          globalMinPrice: expect.anything(),
        }),
      );
    });
  });

  it('persiste el snapshot autoritativo al seleccionar una franja válida', async () => {
    render(<ProvidersPage />);

    const hourButton = await screen.findByRole('button', { name: '09:00' });
    fireEvent.click(hourButton);

    await waitFor(() => {
      expect(setBookingData).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'gardener-1',
          preferredDate: '2026-05-20',
          timeSlot: '09:00 - 11:00',
          authoritativeQuoteSnapshot: expect.objectContaining({
            totalPrice: 158,
            estimatedHours: 2,
            breakdown: [{ desc: 'Servicio base', price: 158 }],
            metadata: quote.metadata,
            economics: quote.economics,
            availability: expect.objectContaining({
              requestedDate: '2026-05-20',
              validStartHours: [9, 10],
              selectedSlot: expect.objectContaining({
                date: '2026-05-20',
                startHour: 9,
                startTime: '09:00:00',
                endTime: '11:00:00',
                durationHours: 2,
              }),
            }),
          }),
        })
      );
    });
  });

  // H-35: un mes (o un día) sin horas reservables llega del servidor con `quote: null`. Antes la
  // pantalla lo leía como un presupuesto → «No se ha podido cargar la disponibilidad» y la
  // tarjeta en «No disponible». Visto en garser.es con un profesional de 168 h de antelación.
  describe('mes sin días reservables (H-35)', () => {
    const juneQuote = {
      ...quote,
      availability: {
        ...quote.availability,
        requestedDate: '2026-06-03',
        calendarDays: [{ date: '2026-06-03', day: 3, disabled: false, count: 2 }],
        earliestSlot: { ...quote.availability.earliestSlot, date: '2026-06-03' },
      },
    };

    beforeEach(() => {
      mocks.previewProviderQuotes.mockResolvedValue({
        quotes: { 'gardener-1': juneQuote },
        eligibleProviderIds: ['gardener-1'],
        earliestByProvider: { 'gardener-1': { date: '2026-06-03', startHour: 9 } },
      });
      mocks.fetchProviderMonthDays.mockImplementation(async ({ monthDate }: { monthDate: string }) => (
        monthDate === '2026-06-01'
          ? { quote: juneQuote, days: juneQuote.availability.calendarDays }
          : { quote: null, days: [] }
      ));
      mocks.fetchProviderValidHours.mockImplementation(async ({ date }: { date: string }) => (
        date === '2026-06-03' ? { quote: juneQuote, validHours: [9, 10] } : { quote: null, validHours: [] }
      ));
    });

    it('no da error, conserva el presupuesto y salta al mes del primer hueco', async () => {
      render(<ProvidersPage />);

      expect(await screen.findByRole('button', { name: '09:00' })).toBeTruthy();
      expect(mocks.fetchProviderMonthDays).toHaveBeenCalledWith(expect.objectContaining({ monthDate: '2026-05-01' }));
      expect(mocks.fetchProviderMonthDays).toHaveBeenCalledWith(expect.objectContaining({ monthDate: '2026-06-01' }));
      const rendered = document.body.textContent || '';
      expect(rendered).not.toContain('No se ha podido cargar la disponibilidad');
      expect(rendered).not.toContain('No disponible');
      expect(rendered).toContain('177,75 €');
    });

    it('si el cliente vuelve al mes vacío, lo ve vacío y sin error (no le devuelve al otro)', async () => {
      render(<ProvidersPage />);
      await screen.findByRole('button', { name: '09:00' });

      fireEvent.click(screen.getByRole('button', { name: 'Ver mes anterior' }));
      await waitFor(() => {
        expect(mocks.fetchProviderMonthDays.mock.calls.filter(([p]) => p.monthDate === '2026-05-01').length).toBe(2);
      });
      await waitFor(() => expect(document.body.textContent).toMatch(/mayo/i));
      const rendered = document.body.textContent || '';
      expect(rendered).not.toContain('No se ha podido cargar la disponibilidad');
      expect(rendered).toContain('177,75 €');
    });
  });
});
