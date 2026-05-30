import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import {
  createBroadcastBookingRequests,
  expireStaleBookingRequests,
  respondBookingRequest,
} from './bookingRequestService';

describe('bookingRequestService RPC integration', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('expira solicitudes pendientes con el RPC dedicado', async () => {
    rpcMock.mockResolvedValueOnce({ data: 2, error: null });

    const result = await expireStaleBookingRequests();

    expect(rpcMock).toHaveBeenCalledWith('expire_stale_booking_requests', {
      p_gardener_id: null,
    });
    expect(result).toBe(2);
  });

  it('responde solicitudes con payload transaccional e idempotente', async () => {
    rpcMock.mockResolvedValueOnce({ data: { booking_id: 'booking-1', status: 'confirmed' }, error: null });

    await respondBookingRequest({
      bookingId: 'booking-1',
      response: 'accept',
      operationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(rpcMock).toHaveBeenCalledWith('respond_booking_request', {
      p_booking_id: 'booking-1',
      p_response: 'accept',
      p_operation_id: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('crea solicitudes broadcast desde RPC sin inserts directos', async () => {
    rpcMock.mockResolvedValueOnce({ data: { status: 'pending', booking_ids: ['b1', 'b2'] }, error: null });

    await createBroadcastBookingRequests({
      gardenerIds: ['gardener-1', 'gardener-2'],
      serviceId: 'service-1',
      date: '2026-05-15',
      startTime: '09:00',
      durationHours: 2,
      totalPrice: 140,
      clientAddress: 'Calle Mayor 10',
      notes: 'Puerta verde',
      pricingContext: { source: 'test' },
      travelFee: 15,
      hourlyRate: 25,
    });

    expect(rpcMock).toHaveBeenCalledWith('create_broadcast_booking_requests', {
      p_gardener_ids: ['gardener-1', 'gardener-2'],
      p_service_id: 'service-1',
      p_date: '2026-05-15',
      p_start_time: '09:00',
      p_duration_hours: 2,
      p_total_price: 140,
      p_client_address: 'Calle Mayor 10',
      p_notes: 'Puerta verde',
      p_pricing_context: { source: 'test' },
      p_travel_fee: 15,
      p_hourly_rate: 25,
      p_operation_id: expect.any(String),
    });
  });
});
