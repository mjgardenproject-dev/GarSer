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
  if (error) throw error;
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
