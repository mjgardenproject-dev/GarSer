import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

/**
 * Captura / liberación diferida del pago de una reserva (`finalize_booking_payment` y
 * `finalize_price_change_payment` de la edge function `booking-payment`).
 *
 * F3 — hasta ahora esta llamada era "best-effort" a UN solo intento desde el navegador. Si
 * fallaba (red, 500 transitorio, pestaña cerrada) la reserva quedaba `confirmed` con el
 * PaymentIntent en `requires_capture` y GarSer no cobraba nunca la comisión: sólo se
 * recuperaba si alguien volvía a disparar la acción, cosa que no pasaba.
 *
 * Ahora se reintenta con backoff. La acción es IDEMPOTENTE en el servidor (consulta el
 * estado real en Stripe antes de actuar: si ya está capturado/liberado, no hace nada), así
 * que reintentar es seguro. Si aun así se agotan los intentos, queda registrado para que la
 * reconciliación del servidor (`booking-lifecycle-tick`) lo recoja.
 */
const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function finalizeBookingPaymentWithRetry(
  body: Record<string, unknown>,
  context: Record<string, unknown> = {},
  attempts = DEFAULT_ATTEMPTS,
): Promise<{ ok: boolean; lastError?: string }> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { error } = await supabase.functions.invoke('booking-payment', { body });
      if (error) throw error;
      if (attempt > 1) {
        reportBookingEvent('info', {
          event: 'booking.payment_finalize_recovered',
          context: { ...context, attempt },
        });
      }
      return { ok: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unknown';
      if (attempt < attempts) {
        await sleep(BASE_DELAY_MS * attempt);
      }
    }
  }

  reportBookingEvent('error', {
    event: 'booking.payment_finalize_failed',
    context: { ...context, attempts, message: lastError },
  });
  return { ok: false, lastError };
}
