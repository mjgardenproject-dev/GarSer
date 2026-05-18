import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { createAtomicBooking } from './bookingAtomicService';

describe('bookingAtomicService RPC integration', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('llama al RPC create_atomic_booking con el payload esperado', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        booking_id: 'booking-1',
        status: 'pending',
        date: '2026-05-15',
        start_time: '09:00:00',
        duration_hours: 2,
      },
      error: null,
    });

    const result = await createAtomicBooking({
      providerId: 'gardener-1',
      serviceId: 'service-1',
      date: '2026-05-15',
      startTime: '09:00:00',
      durationHours: 2,
      totalPrice: 125,
      clientAddress: 'Calle Mayor 10',
      notes: 'Acceso por portón lateral',
      pricingContext: { source: 'test' },
      travelFee: 15,
      hourlyRate: 25,
      operationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(rpcMock).toHaveBeenCalledWith('create_atomic_booking', {
      p_booking_id: null,
      p_gardener_id: 'gardener-1',
      p_service_id: 'service-1',
      p_date: '2026-05-15',
      p_start_time: '09:00:00',
      p_duration_hours: 2,
      p_total_price: 125,
      p_client_address: 'Calle Mayor 10',
      p_notes: 'Acceso por portón lateral',
      p_pricing_context: { source: 'test' },
      p_quote_id: null,
      p_travel_fee: 15,
      p_hourly_rate: 25,
      p_operation_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.booking_id).toBe('booking-1');
  });

  it('propaga errores del RPC para bloquear confirmaciones inconsistentes', async () => {
    rpcMock.mockResolvedValueOnce({ error: new Error('La franja seleccionada ya no está disponible.') });

    await expect(
      createAtomicBooking({
        providerId: 'gardener-2',
        serviceId: 'service-2',
        date: '2026-05-16',
        startTime: '11:00:00',
        durationHours: 1,
        totalPrice: 80,
        clientAddress: 'Calle Luna 4',
      })
    ).rejects.toThrow('La franja seleccionada ya no está disponible.');
  });
});
