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

});
