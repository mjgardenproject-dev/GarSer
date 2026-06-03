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

      if (table === 'gardener_profiles') {
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

  it('muestra al cliente el total de la reserva con la tarifa incluida', async () => {
    render(<ProvidersPage />);

    expect(await screen.findByText('Total de la reserva')).toBeTruthy();
    expect(screen.getByText('177,75 €')).toBeTruthy();
    expect(screen.getByText('Incluye tarifa de reserva de 19,75 €')).toBeTruthy();
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
});
