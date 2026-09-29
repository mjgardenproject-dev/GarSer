import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prueba real · F3 (D24): estos correos los apunta el servidor en la misma transacción que la
// acción. El navegador ya no los pide: si lo hiciera y la sesión estuviera revocada (lo que pasó
// en producción el 2026-09-28), el correo se perdía; y con la cola, además, saldría dos veces.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('./bookingPaymentFinalize', () => ({ finalizeBookingPaymentWithRetry: vi.fn(async () => undefined) }));
vi.mock('./bookingTelemetry', () => ({ reportBookingEvent: vi.fn() }));

import { proposeBookingPriceChange, respondBookingPriceChange } from './bookingPriceChangeService';
import { respondBookingRequest } from './bookingRequestService';
import { respondBookingReschedule } from './bookingRescheduleService';

describe('correos que envía el servidor (F3)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: { status: 'confirmed', outcome: 'accepted' }, error: null });
    mocks.invoke.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it('proponer y responder un cambio de precio no pide correos desde el navegador', async () => {
    await proposeBookingPriceChange({ bookingId: 'b1', proposedTotalPrice: 80 });
    await respondBookingPriceChange({ bookingId: 'b1', accept: true });
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'send-email-notification')).toHaveLength(0);
  });

  it('aceptar una solicitud no pide el correo «reserva aceptada» desde el navegador', async () => {
    await respondBookingRequest({ bookingId: 'b2', response: 'accept' });
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'send-email-notification')).toHaveLength(0);
  });

  it('responder a otra fecha no pide el correo desde el navegador', async () => {
    await respondBookingReschedule('b3', true);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
