import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

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

// Email al cliente cuando el jardinero acepta/rechaza (fire-and-forget: el email
// jamás debe bloquear ni romper la respuesta a la solicitud).
//
// Solo se envía el id: los importes, el nombre del servicio, la fecha y los nombres de las
// partes los resuelve la edge function con la clave de servicio. Antes se componía aquí un
// `priceText` con toFixed(2) —un dato de dinero fabricado en el navegador, con un formato de
// euro distinto al de los demás correos— y se mandaba el precio del servicio bajo la etiqueta
// "Total", que es justo lo que hacía dudar al cliente de cuánto le quedaba por pagar.
async function notifyClientOfResponse(bookingId: string, response: 'accept' | 'reject'): Promise<void> {
  try {
    await supabase.functions.invoke('send-email-notification', {
      body: {
        type: response === 'accept' ? 'booking_accepted' : 'booking_rejected',
        bookingId,
      },
    });
  } catch (error) {
    // Solo telemetría: el flujo principal ya terminó bien
    reportBookingEvent('warn', {
      event: 'booking.response_email_failed',
      context: {
        bookingId,
        response,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
  }
}

// Aviso al cliente cuando el jardinero cancela una reserva YA CONFIRMADA (el rechazo de una
// solicitud pendiente ya lo cubre notifyClientOfResponse). Best-effort: no bloquea ni rompe.
export async function notifyClientOfCancellation(bookingId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-email-notification', {
      body: { type: 'booking_cancelled', bookingId },
    });
    if (error) throw error;
  } catch (error) {
    reportBookingEvent('warn', {
      event: 'booking.response_email_failed',
      context: {
        bookingId,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
  }
}

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
    // pago autorizado. Idempotente en el servidor. Si falla, no rompemos la respuesta al
    // jardinero (la reserva ya cambió de estado); la autorización de Stripe se captura al
    // reintentar o caduca sola a los 7 días, así que el cliente nunca paga de más.
    try {
      const { error: finalizeError } = await supabase.functions.invoke('booking-payment', {
        body: {
          action: 'finalize_booking_payment',
          bookingId: params.bookingId,
          decision: params.response,
        },
      });
      if (finalizeError) throw finalizeError;
    } catch (finalizeError) {
      reportBookingEvent('error', {
        event: 'booking.payment_finalize_failed',
        context: {
          bookingId: params.bookingId,
          response: params.response,
          operationId,
          message: finalizeError instanceof Error ? finalizeError.message : 'unknown',
        },
      });
    }
    // No await: el email no bloquea la respuesta al jardinero
    void notifyClientOfResponse(params.bookingId, params.response);
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

