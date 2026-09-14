import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';
import { finalizeBookingPaymentWithRetry } from './bookingPaymentFinalize';

export type PriceChangeStatus = 'none' | 'pending_client_acceptance' | 'accepted' | 'rejected' | 'expired';

type PriceChangeRpcResponse = {
  status: PriceChangeStatus | 'idempotent_replayed';
  booking_id?: string;
  proposed_total_price?: number;
  final_total_price?: number;
  expires_at?: string;
  // D5 (2026-09-13): cambio de duración adjunto a la propuesta de precio. Solo mueve la
  // hora de FIN — start_time nunca cambia en este flujo.
  proposed_duration_hours?: number | null;
  final_duration_hours?: number | null;
};

// Aviso por email de cada movimiento del cambio de precio (paso 8B).
//
// Best-effort: el cambio de precio ya está persistido y no debe romperse porque falle un
// correo. Pero el { error } SÍ se comprueba (functions.invoke no lanza en errores HTTP), para
// que un aviso perdido deje rastro en lugar de desaparecer en silencio.
//
// Contrato del paso 8: solo { type, bookingId }. Los importes y el motivo los resuelve la
// edge function con la clave de servicio; jamás se componen aquí.
async function notifyPriceChange(
  bookingId: string,
  type:
    | 'booking_price_change_proposed'
    | 'booking_price_change_accepted'
    | 'booking_price_change_rejected',
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('send-email-notification', {
      body: { type, bookingId },
    });
    if (error) throw error;
  } catch (error) {
    reportBookingEvent('warn', {
      event: 'booking.price_change_email_failed',
      context: {
        bookingId,
        type,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
  }
}

export async function proposeBookingPriceChange(params: {
  bookingId: string;
  proposedTotalPrice: number;
  reason?: string;
  expiresInMinutes?: number;
  operationId?: string;
  /**
   * D5 — nueva duración total del servicio (en horas), solo si el jardinero también pide
   * alargar o acortar. Mueve únicamente la hora de FIN; el motor de la RPC valida el rango
   * 1-12h y, al aceptar, que las horas de más (si alarga) sigan libres.
   */
  proposedDurationHours?: number;
}) {
  const payload: Record<string, any> = {
    p_booking_id: params.bookingId,
    p_proposed_total_price: params.proposedTotalPrice,
    p_reason: params.reason || null,
  };
  if (typeof params.expiresInMinutes === 'number') payload.p_expires_in_minutes = params.expiresInMinutes;
  if (params.operationId) payload.p_operation_id = params.operationId;
  if (typeof params.proposedDurationHours === 'number') {
    payload.p_proposed_duration_hours = params.proposedDurationHours;
  }

  const { data, error } = await supabase.rpc('propose_booking_price_change', payload);
  if (error) throw error;

  // El cliente tiene que enterarse: sin notificaciones in-app, el email es el único canal.
  // Proponer sólo dispara el aviso de PROPUESTA; el de aceptada/rechazada lo envía
  // `respondBookingPriceChange`, que es quien conoce el desenlace.
  void notifyPriceChange(params.bookingId, 'booking_price_change_proposed');

  return (data || null) as PriceChangeRpcResponse | null;
}

export async function respondBookingPriceChange(params: {
  bookingId: string;
  accept: boolean;
  operationId?: string;
}) {
  const payload: Record<string, any> = {
    p_booking_id: params.bookingId,
    p_accept: params.accept,
  };
  if (params.operationId) payload.p_operation_id = params.operationId;
  const { data, error } = await supabase.rpc('respond_booking_price_change', payload);
  if (error) throw error;

  // Aviso del desenlace. `accept` sí existe aquí (a diferencia de proposeBookingPriceChange,
  // donde se colaba una referencia a un campo inexistente que mandaba SIEMPRE el email de
  // "rechazado" al proponer). Best-effort: nunca rompe el flujo.
  void notifyPriceChange(
    params.bookingId,
    params.accept ? 'booking_price_change_accepted' : 'booking_price_change_rejected',
  );

  // Captura diferida. Aceptar la propuesta confirma la reserva y rechazarla la cancela, así que
  // este es el momento de cobrar o liberar los gastos de gestión retenidos. Sin esta llamada la
  // autorización de Stripe caducaba a los 7 días: la reserva quedaba confirmada y GarSer no
  // cobraba nada. La decisión la deriva el servidor de price_change_status, no de aquí.
  // Idempotente y CON REINTENTOS (F3); lo que no se recupere aquí lo recoge la reconciliación
  // de `booking-lifecycle-tick`.
  await finalizeBookingPaymentWithRetry(
    { action: 'finalize_price_change_payment', bookingId: params.bookingId },
    { bookingId: params.bookingId, accept: params.accept },
  );

  return (data || null) as PriceChangeRpcResponse | null;
}
