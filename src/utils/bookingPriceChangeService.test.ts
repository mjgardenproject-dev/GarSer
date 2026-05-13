import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { proposeBookingPriceChange, respondBookingPriceChange } from './bookingPriceChangeService';

describe('bookingPriceChangeService RPC integration', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('proposeBookingPriceChange llama al RPC con payload correcto', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    await proposeBookingPriceChange({
      bookingId: 'booking-1',
      proposedTotalPrice: 199.5,
      reason: 'Servicio de alta complejidad',
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('propose_booking_price_change', {
      p_booking_id: 'booking-1',
      p_proposed_total_price: 199.5,
      p_reason: 'Servicio de alta complejidad',
    });
  });

  it('proposeBookingPriceChange incluye idempotencia y expiración cuando se informan', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    await proposeBookingPriceChange({
      bookingId: 'booking-10',
      proposedTotalPrice: 160,
      reason: 'Ajuste por complejidad',
      operationId: '11111111-1111-1111-1111-111111111111',
      expiresInMinutes: 720,
    });

    expect(rpcMock).toHaveBeenCalledWith('propose_booking_price_change', {
      p_booking_id: 'booking-10',
      p_proposed_total_price: 160,
      p_reason: 'Ajuste por complejidad',
      p_operation_id: '11111111-1111-1111-1111-111111111111',
      p_expires_in_minutes: 720,
    });
  });

  it('proposeBookingPriceChange envía reason null si no se informa', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    await proposeBookingPriceChange({
      bookingId: 'booking-2',
      proposedTotalPrice: 120,
    });

    expect(rpcMock).toHaveBeenCalledWith('propose_booking_price_change', {
      p_booking_id: 'booking-2',
      p_proposed_total_price: 120,
      p_reason: null,
    });
  });

  it('respondBookingPriceChange llama al RPC con payload correcto', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    await respondBookingPriceChange({
      bookingId: 'booking-3',
      accept: true,
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('respond_booking_price_change', {
      p_booking_id: 'booking-3',
      p_accept: true,
    });
  });

  it('respondBookingPriceChange incluye operationId cuando se informa', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    await respondBookingPriceChange({
      bookingId: 'booking-30',
      accept: false,
      operationId: '22222222-2222-2222-2222-222222222222',
    });

    expect(rpcMock).toHaveBeenCalledWith('respond_booking_price_change', {
      p_booking_id: 'booking-30',
      p_accept: false,
      p_operation_id: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('propaga errores del RPC para bloqueo transaccional en UI', async () => {
    const rpcError = new Error('No autorizado');
    rpcMock.mockResolvedValueOnce({ error: rpcError });

    await expect(
      respondBookingPriceChange({
        bookingId: 'booking-4',
        accept: false,
      })
    ).rejects.toThrow('No autorizado');
  });
});
