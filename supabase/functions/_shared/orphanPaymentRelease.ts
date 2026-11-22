// Anula en Stripe la retención de un pago que se quedó SIN reserva (QA-139 / PH-37).
//
// Cuándo pasa: el cliente paga cuando su hueco ya caducó, o el hueco se ocupó mientras pagaba, o la
// reserva no se pudo crear. Stripe ha AUTORIZADO los gastos de gestión (captura diferida), pero no
// hay reserva que capturar: si nadie anula esa autorización, la tarjeta del cliente queda con el
// importe retenido hasta 7 días.
//
// La usan tres sitios, y el resultado es el mismo se llame las veces que se llame:
//   · booking-payment, al momento, en cuanto ve el intento sin reserva;
//   · booking-payment-webhook, cuando el aviso de Stripe llega antes;
//   · booking-lifecycle-tick, como respaldo, con list_orphan_payment_authorizations().
//
// Es conservadora: vuelve a leer el intento antes de tocar nada, solo actúa si el PaymentIntent es
// de ESE intento (metadata.attempt_id) y deja la marca `settlement` en el intento para no repetir.
// Un cargo ya capturado sin reserva no debería existir con captura diferida; si aparece, se devuelve
// (no hay ningún servicio por el que cobrar) y se avisa en el registro.

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type OrphanReleaseOutcome =
  | 'released'
  | 'already_released'
  | 'refunded'
  | 'already_refunded'
  | 'pending'
  | 'not_orphan'
  | 'needs_review'
  | 'error';

export type OrphanReleaseLog = (level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>) => Promise<void> | void;

const RELEASABLE_STATUSES = new Set([
  'requires_capture',
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

const CLOSED_ATTEMPT_STATUSES = new Set(['reconciliation_required', 'expired', 'cancelled', 'failed']);

// El PaymentIntent no cuadra con el intento: lo revisa una persona, nunca se anula ni devuelve solo.
// (Misma lista que excluye list_orphan_payment_authorizations.)
const MANUAL_REVIEW_CODES = new Set([
  'stripe_metadata_incomplete',
  'stripe_metadata_mismatch',
  'stripe_payment_intent_binding_mismatch',
]);

async function stripeRequest(
  stripeSecret: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: URLSearchParams; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${stripeSecret}` };
  if (options.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.method === 'POST' ? (options.body || new URLSearchParams()).toString() : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

async function markSettled(admin: AdminClient, attemptId: string, result: string) {
  const { error } = await admin.rpc('mark_booking_payment_settled', { p_attempt_id: attemptId, p_result: result });
  if (error) throw new Error(`mark_booking_payment_settled: ${error.message}`);
}

export async function releaseOrphanAuthorization(
  admin: AdminClient,
  params: {
    attemptId: string;
    stripeSecret: string;
    source: string;
    log?: OrphanReleaseLog;
  },
): Promise<{ outcome: OrphanReleaseOutcome; paymentIntentStatus?: string }> {
  const log: OrphanReleaseLog = params.log || (() => undefined);
  const { attemptId, stripeSecret, source } = params;

  try {
    // 1) Releer el intento: solo se actúa si de verdad está cerrado SIN reserva y sin liberar.
    const { data: row, error: rowError } = await admin
      .from('booking_payment_attempts')
      .select('id, status, booking_id, stripe_payment_intent_id, gateway_response, last_error_code')
      .eq('id', attemptId)
      .maybeSingle();
    if (rowError) throw new Error(`leer intento: ${rowError.message}`);

    const attempt = row as {
      id: string;
      status: string;
      booking_id: string | null;
      stripe_payment_intent_id: string | null;
      gateway_response: Record<string, unknown> | null;
      last_error_code: string | null;
    } | null;
    const paymentIntentId = String(attempt?.stripe_payment_intent_id || '');
    const settlement = String((attempt?.gateway_response || {}).settlement || '');

    if (!attempt || attempt.booking_id || !CLOSED_ATTEMPT_STATUSES.has(attempt.status) || !paymentIntentId) {
      return { outcome: 'not_orphan' };
    }
    if (settlement) {
      return { outcome: settlement.startsWith('refunded') ? 'already_refunded' : 'already_released' };
    }
    if (MANUAL_REVIEW_CODES.has(String(attempt.last_error_code || ''))) {
      return { outcome: 'needs_review' };
    }

    // 2) Estado real en Stripe.
    const pi = await stripeRequest(stripeSecret, `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
    if (!pi.ok) {
      await log('error', 'booking.orphan_authorization_stripe_get_failed', { attemptId, paymentIntentId, source, body: pi.body });
      return { outcome: 'error' };
    }
    const piStatus = String(pi.body.status || '');
    const metadata = (pi.body.metadata || {}) as Record<string, unknown>;

    // Solo si el PaymentIntent es de este intento. Si no cuadra, lo revisa una persona.
    if (String(metadata.attempt_id || '') !== attemptId) {
      await markSettled(admin, attemptId, 'needs_review_metadata');
      await log('error', 'booking.orphan_authorization_metadata_mismatch', {
        attemptId, paymentIntentId, source, metadataAttemptId: metadata.attempt_id ?? null,
      });
      return { outcome: 'needs_review', paymentIntentStatus: piStatus };
    }

    // 3) Ejecutar.
    if (RELEASABLE_STATUSES.has(piStatus)) {
      const cancel = await stripeRequest(stripeSecret, `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {
        method: 'POST',
        idempotencyKey: `garser_orphan_release_${attemptId}`,
      });
      if (!cancel.ok) {
        // Puede haberse cancelado en paralelo (otro de los tres sitios): se comprueba otra vez.
        const again = await stripeRequest(stripeSecret, `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
        if (again.ok && String(again.body.status || '') === 'canceled') {
          await markSettled(admin, attemptId, 'already_released');
          return { outcome: 'already_released', paymentIntentStatus: 'canceled' };
        }
        await log('error', 'booking.orphan_authorization_release_failed', { attemptId, paymentIntentId, source, body: cancel.body });
        return { outcome: 'error', paymentIntentStatus: piStatus };
      }
      await markSettled(admin, attemptId, 'released_orphan');
      await log('warn', 'booking.orphan_authorization_released', { attemptId, paymentIntentId, source, piStatus });
      return { outcome: 'released', paymentIntentStatus: 'canceled' };
    }

    if (piStatus === 'canceled') {
      await markSettled(admin, attemptId, 'already_released');
      return { outcome: 'already_released', paymentIntentStatus: piStatus };
    }

    if (piStatus === 'succeeded') {
      const refunds = await stripeRequest(stripeSecret, `/v1/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100`);
      const refundList = Array.isArray((refunds.body as { data?: unknown[] }).data)
        ? (refunds.body as { data: Array<Record<string, unknown>> }).data
        : [];
      if (refundList.some((r) => ['succeeded', 'pending'].includes(String(r.status)))) {
        await markSettled(admin, attemptId, 'refunded_orphan_ok');
        return { outcome: 'already_refunded', paymentIntentStatus: piStatus };
      }
      const body = new URLSearchParams();
      body.append('payment_intent', paymentIntentId);
      body.append('metadata[reason]', 'payment_without_booking');
      body.append('metadata[attempt_id]', attemptId);
      const refund = await stripeRequest(stripeSecret, '/v1/refunds', {
        method: 'POST',
        body,
        idempotencyKey: `garser_orphan_refund_${attemptId}`,
      });
      if (!refund.ok) {
        await log('error', 'booking.orphan_charge_refund_failed', { attemptId, paymentIntentId, source, body: refund.body });
        return { outcome: 'error', paymentIntentStatus: piStatus };
      }
      await markSettled(admin, attemptId, 'refunded_orphan');
      await log('warn', 'booking.orphan_charge_refunded', { attemptId, paymentIntentId, source });
      return { outcome: 'refunded', paymentIntentStatus: piStatus };
    }

    // `processing` u otro estado transitorio: el reloj lo vuelve a mirar en la próxima pasada.
    return { outcome: 'pending', paymentIntentStatus: piStatus };
  } catch (error) {
    await log('error', 'booking.orphan_authorization_failed', {
      attemptId,
      source,
      message: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'error' };
  }
}
