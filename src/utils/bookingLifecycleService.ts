import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

// Ciclo de vida de la reserva (paso 8C).
//
// Todo pasa por la edge function `booking-payment`, nunca por un UPDATE directo desde el
// navegador: la autorización y la política económica viven en la RPC (`cancel_booking` /
// `report_booking_no_show`) y la ejecución en Stripe en la función. El front solo pide la
// acción y muestra el resultado.

export type BookingMoneyStatus =
  | 'refunded'
  | 'captured'
  | 'released'
  | 'already_captured'
  | 'already_released'
  | 'no_payment'
  | 'none'
  | 'failed'
  | string;

export interface BookingLifecycleResult {
  status: string;
  bookingId: string;
  moneyAction: string;
  moneyStatus: BookingMoneyStatus;
  penaltyApplied?: boolean;
}

/**
 * Códigos cuyo mensaje del servidor SÍ se le puede enseñar al cliente: son reglas de negocio
 * que le afectan y que puede entender ("esta reserva ya no se puede cancelar").
 *
 * El resto NO se enseña. La función devuelve cosas como "Falta STRIPE_SECRET_KEY para resolver
 * el dinero de la reserva": es un problema de configuración nuestro, y enseñárselo a alguien
 * que solo quería cancelar su reserva no le sirve de nada y expone las tripas del sistema.
 */
const CODIGOS_CON_MENSAJE_PARA_EL_CLIENTE = new Set([
  'lifecycle_rpc_rejected',
  'price_change_unresolved',
  'slot_unavailable',
  'not_booking_client',
  'not_booking_gardener',
  'booking_not_found',
  'invalid_lifecycle_request',
  'auth_required',
]);

interface ErrorDeFuncion {
  mensaje: string;
  code: string | null;
}

/**
 * Traduce el error de `functions.invoke` a algo legible.
 *
 * `invoke` no lanza en errores HTTP: devuelve un `FunctionsHttpError` cuyo `.message` es
 * siempre "Edge Function returned a non-2xx status code". Eso es lo que veía el cliente al
 * fallar una cancelación. El cuerpo de la respuesta sí trae `{ error, code }`, y vive en
 * `.context` como Response sin consumir.
 */
async function leerErrorDeFuncion(error: unknown): Promise<ErrorDeFuncion> {
  const generico = 'No hemos podido completar la operación. Vuelve a intentarlo y, si sigue fallando, escríbenos.';
  const contexto = (error as { context?: Response })?.context;
  if (!contexto || typeof contexto.json !== 'function') {
    return { mensaje: generico, code: null };
  }
  try {
    const cuerpo = (await contexto.json()) as { error?: string; code?: string };
    const code = cuerpo?.code || null;
    const delServidor = typeof cuerpo?.error === 'string' ? cuerpo.error.trim() : '';
    return {
      mensaje: code && CODIGOS_CON_MENSAJE_PARA_EL_CLIENTE.has(code) && delServidor ? delServidor : generico,
      code,
    };
  } catch {
    return { mensaje: generico, code: null };
  }
}

async function invokeLifecycle(
  action: 'cancel_booking' | 'report_no_show',
  bookingId: string,
  reason?: string,
): Promise<BookingLifecycleResult> {
  const { data, error } = await supabase.functions.invoke('booking-payment', {
    body: { action, bookingId, reason: reason || null },
  });
  // functions.invoke NO lanza en errores HTTP: devuelve { error }. Sin comprobarlo, una
  // cancelación rechazada parecería exitosa.
  if (error) {
    const { mensaje, code } = await leerErrorDeFuncion(error);
    // El código va al registro aunque no se le enseñe al cliente: es lo que hace falta para
    // diagnosticar por qué falló una cancelación real.
    reportBookingEvent('error', {
      event: 'booking.lifecycle_action_failed',
      context: { action, bookingId, errorCode: code },
    });
    throw new Error(mensaje);
  }
  const result = (data || {}) as BookingLifecycleResult;

  reportBookingEvent(result.moneyStatus === 'failed' ? 'error' : 'info', {
    event: 'booking.lifecycle_action',
    context: {
      action,
      bookingId,
      status: result.status,
      moneyAction: result.moneyAction,
      moneyStatus: result.moneyStatus,
    },
  });
  return result;
}

/** Cancela la reserva. El desenlace económico lo decide el servidor según quién cancela. */
export async function cancelBooking(bookingId: string, reason?: string) {
  return invokeLifecycle('cancel_booking', bookingId, reason);
}

/** Reporta que la otra parte no apareció. Solo válido desde que el servicio debió terminar. */
export async function reportNoShow(bookingId: string, reason?: string) {
  return invokeLifecycle('report_no_show', bookingId, reason);
}

/**
 * Fin real del servicio reservado. Es la frontera de la ventana de completado: antes de esta
 * hora no se puede dar por finalizado (ni desde la UI ni por API), porque supondría cobrar un
 * servicio que todavía no se ha prestado.
 */
export function getBookingServiceEnd(booking: {
  date?: string | null;
  start_time?: string | null;
  duration_hours?: number | null;
}): Date | null {
  if (!booking?.date || !booking?.start_time) return null;
  const end = new Date(`${booking.date}T${String(booking.start_time).slice(0, 8)}`);
  if (Number.isNaN(end.getTime())) return null;
  end.setHours(end.getHours() + Math.max(Number(booking.duration_hours) || 1, 1));
  return end;
}

/** ¿Se puede ya marcar como completada? Solo desde que el servicio terminó. */
export function canCompleteBooking(booking: {
  status?: string | null;
  date?: string | null;
  start_time?: string | null;
  duration_hours?: number | null;
}): boolean {
  if (booking?.status !== 'confirmed') return false;
  const end = getBookingServiceEnd(booking);
  if (!end) return false;
  return Date.now() >= end.getTime();
}
