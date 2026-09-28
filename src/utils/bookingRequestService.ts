import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';
import { finalizeBookingPaymentWithRetry } from './bookingPaymentFinalize';

export interface RespondBookingRequestParams {
  bookingId: string;
  response: 'accept' | 'reject';
  operationId?: string;
}


const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export async function expireStaleBookingRequests(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('expire_stale_booking_requests', {
      p_gardener_id: null,
    });
    if (error) throw error;
    const expiredCount = Number(data || 0);
    reportBookingEvent('info', {
      event: 'booking.requests_expired',
      context: {
        expiredCount,
        scope: 'manual_or_dashboard',
      },
    });
    return expiredCount;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.requests_expire_failed',
      context: {
        scope: 'manual_or_dashboard',
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

// El correo al cliente («ha aceptado tu reserva» / «no ha podido aceptarla») lo apunta el
// servidor dentro de respond_booking_request (notification_outbox, prueba real F3). Antes se
// pedía desde aquí y se perdía si la pestaña se cerraba o la sesión estaba revocada.

export async function respondBookingRequest(params: RespondBookingRequestParams) {
  const operationId = params.operationId || randomId();
  try {
    const { data, error } = await supabase.rpc('respond_booking_request', {
      p_booking_id: params.bookingId,
      p_response: params.response,
      p_operation_id: operationId,
    });

    if (error) throw error;
    const result = data as { booking_id: string; status: string; message?: string };
    reportBookingEvent('info', {
      event: 'booking.request_responded',
      context: {
        bookingId: params.bookingId,
        response: params.response,
        operationId,
        status: result.status,
      },
    });
    // Captura diferida: tras cambiar el estado, capturamos (accept) o liberamos (reject) el
    // pago autorizado. Idempotente en el servidor y CON REINTENTOS (F3): si falla, no
    // rompemos la respuesta al jardinero (la reserva ya cambió de estado), pero ya no
    // dependemos de un único intento del navegador. Lo que no se recupere aquí lo recoge la
    // reconciliación de `booking-lifecycle-tick`.
    await finalizeBookingPaymentWithRetry(
      {
        action: 'finalize_booking_payment',
        bookingId: params.bookingId,
        decision: params.response,
      },
      { bookingId: params.bookingId, response: params.response, operationId },
    );
    return result;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.request_response_failed',
      context: {
        bookingId: params.bookingId,
        response: params.response,
        operationId,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

