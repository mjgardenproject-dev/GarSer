import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { BookingAuthorityError, createAuthoritativeQuote } from './bookingAuthorityService';

function createFunctionsHttpError(status: number, body: Record<string, unknown> | string) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const headers =
    typeof body === 'string'
      ? { 'Content-Type': 'text/plain' }
      : { 'Content-Type': 'application/json' };

  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: new Response(payload, { status, headers }),
  });
}

describe('bookingAuthorityService', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('envia fecha y hora seleccionadas al crear el quote autoritativo persistible', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        totalPrice: 120,
        estimatedHours: 2,
        breakdown: [{ desc: 'Servicio base', price: 120 }],
        warnings: [],
        metadata: {},
        economics: {
          currency: 'EUR',
          taxRate: 0.21,
          serviceGrossTotal: 120,
          serviceNetSubtotal: 99.17,
          serviceTaxAmount: 20.83,
          managementFee: 15,
          payableNow: 15,
          payableLater: 120,
          lines: [],
          stripeLineItems: [],
        },
        availability: {
          requestedDate: '2026-05-20',
          validStartHours: [9],
          selectedSlot: {
            date: '2026-05-20',
            startHour: 9,
            startTime: '09:00:00',
            endTime: '11:00:00',
            durationHours: 2,
          },
        },
      },
      error: null,
    });

    await createAuthoritativeQuote({
      bookingData: {
        address: 'Calle Mayor 1',
        serviceIds: ['svc-1'],
        photos: [],
        description: 'Poda ligera',
        preferredDate: '2026-05-20',
        timeSlot: '09:00 - 11:00',
        providerId: 'gardener-1',
        estimatedHours: 2,
        totalPrice: 120,
      } as any,
      serviceId: 'svc-1',
      providerId: 'gardener-1',
      selectedDate: '2026-05-20',
      startTime: '09:00:00',
    });

    expect(invokeMock).toHaveBeenCalledWith('booking-authority', {
      body: expect.objectContaining({
        action: 'create_quote',
        serviceId: 'svc-1',
        providerId: 'gardener-1',
        date: '2026-05-20',
        startTime: '09:00:00',
      }),
    });
  });

  it('propaga el status y el mensaje backend real cuando booking-authority rechaza la apikey', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: createFunctionsHttpError(401, { error: 'apikey no autorizada.' }),
    });

    await expect(
      createAuthoritativeQuote({
        bookingData: {
          address: 'Calle Mayor 1',
          serviceIds: ['svc-1'],
          photos: [],
          description: 'Poda ligera',
          preferredDate: '2026-05-20',
          timeSlot: '09:00 - 11:00',
          providerId: 'gardener-1',
          estimatedHours: 2,
          totalPrice: 120,
        } as any,
        serviceId: 'svc-1',
        providerId: 'gardener-1',
        selectedDate: '2026-05-20',
        startTime: '09:00:00',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BookingAuthorityError>>({
        name: 'BookingAuthorityError',
        source: 'booking-authority',
        status: 401,
        backendMessage: 'apikey no autorizada.',
        message: 'apikey no autorizada.',
      }),
    );
  });
});
