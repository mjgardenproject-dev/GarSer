import { describe, expect, it } from 'vitest';

import {
  BookingPaymentHttpError,
  classifyBookingPaymentError,
  extractBookingPaymentErrorDiagnostics,
} from './error-classification';

describe('booking-payment error classification', () => {
  it('clasifica errores RPC/PostgREST de negocio aunque el mensaje útil viva en details', () => {
    const error = Object.assign(new Error('Error al ejecutar la función RPC.'), {
      code: 'P0001',
      details: 'La franja seleccionada ya no esta disponible para iniciar el pago.',
      hint: null,
    });

    const classified = classifyBookingPaymentError(error, 422);

    expect(classified).toBeInstanceOf(BookingPaymentHttpError);
    expect(classified).toMatchObject({
      status: 409,
      code: 'slot_unavailable',
      message: 'La franja seleccionada ya no esta disponible para iniciar el pago.',
    });
    expect(classified.details).toMatchObject({
      upstreamCode: 'P0001',
      upstreamDetails: 'La franja seleccionada ya no esta disponible para iniciar el pago.',
    });
  });

  it('no degrada un P0001 desconocido a database_error', () => {
    const error = Object.assign(new Error('Error al ejecutar la función RPC.'), {
      code: 'P0001',
      details: 'No puedes confirmar el pago porque el hold requiere revalidacion manual.',
    });

    const classified = classifyBookingPaymentError(error, 422);

    expect(classified).toMatchObject({
      status: 422,
      code: 'business_rule_violation',
      message: 'No puedes confirmar el pago porque el hold requiere revalidacion manual.',
    });
  });

  it('extrae diagnósticos enriquecidos para telemetría y logs', () => {
    const diagnostics = extractBookingPaymentErrorDiagnostics(
      Object.assign(new Error('[object Object]'), {
        code: '23505',
        status: 409,
        details: { message: 'duplicate key value violates unique constraint' },
        hint: 'Revise la clave idempotente del intento.',
      }),
    );

    expect(diagnostics).toMatchObject({
      upstreamCode: '23505',
      upstreamStatus: 409,
      upstreamDetailsSummary: 'duplicate key value violates unique constraint',
      upstreamHint: 'Revise la clave idempotente del intento.',
      message: 'duplicate key value violates unique constraint',
    });
  });
});
