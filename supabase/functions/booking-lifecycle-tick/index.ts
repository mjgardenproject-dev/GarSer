// Supabase Edge Function: el reloj del ciclo de vida de la reserva.
//
// Postgres no puede mandar correos ni hablar con Storage, y el cron del ciclo de vida es SQL
// puro. Esta funcion es el brazo del reloj: la llama `pg_net` desde ese mismo cron cada 15
// minutos y ejecuta lo que hay que hacer FUERA de la base de datos.
//
// La llamada HTTP es SOLO el timbre, nunca el registro. El estado de a quien hay que escribir
// vive en columnas de `bookings`, no en la peticion: si el POST se pierde, si esta funcion
// devuelve 500 o si Brevo esta caido, la fila sigue marcada como pendiente y la pasada de
// dentro de 15 minutos la vuelve a coger. No hay ningun camino en el que perder una llamada
// HTTP pierda un correo.
//
// Autorizacion: un secreto DEDICADO (`LIFECYCLE_TICK_SECRET`), no la clave de servicio. Si se
// filtrara, el radio de explosion es "alguien puede disparar el tick" —que es idempotente y no
// hace nada que no tocara hacer— en vez de "alguien es dueño de la base de datos".
//
// Tres trabajos independientes, cada uno con su try/catch: que falle el correo no puede
// impedir que se borren las fotos, ni al reves.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isInternalServiceCaller, resolveServiceRoleKey } from '../_shared/functionAuth.ts';
import { cleanupBookingMedia } from '../_shared/bookingMediaCleanup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-lifecycle-secret',
};

const BATCH_LIMIT = 50;

/**
 * Pide un correo a `send-email-notification`.
 *
 * Se llama con `fetch` y no con `functions.invoke` a proposito. `invoke` no lanza en errores
 * HTTP: devuelve un error cuyo `.message` es SIEMPRE "Edge Function returned a non-2xx status
 * code", sin el cuerpo. Registrar eso es no registrar nada, y este es el camino del que depende
 * que a un cliente se le avise ANTES de cobrarle: cuando en produccion no salga un correo, el
 * estado y el cuerpo reales son lo unico que habra para saber por que.
 */
async function requestEmail(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const text = (await response.text().catch(() => '')).slice(0, 300);
    return { ok: false, reason: `HTTP ${response.status}: ${text || 'sin cuerpo'}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Comparacion en tiempo constante: un `===` sobre secretos filtra su longitud y sus prefijos. */
function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(req: Request): boolean {
  const presented = String(req.headers.get('x-lifecycle-secret') || '').trim();
  const expected = String(Deno.env.get('LIFECYCLE_TICK_SECRET') || '').trim();
  if (expected && presented && secretsMatch(presented, expected)) return true;
  // Segunda via: un componente interno con la clave de servicio (util para operar a mano).
  return isInternalServiceCaller(req);
}

// deno-lint-ignore no-explicit-any
async function logEvent(admin: any, level: string, event: string, context: Record<string, unknown>) {
  try {
    await admin.from('booking_funnel_events').insert({
      level, event, source: 'edge-lifecycle-tick', path: '/functions/v1/booking-lifecycle-tick', context,
    });
  } catch {
    // La telemetria nunca puede tumbar el reloj.
  }
}

/**
 * Trabajo 1 — pedirle al cliente que confirme que el trabajo se hizo.
 *
 * Es el correo del que depende que NO se cobre un servicio no prestado, asi que cada envio se
 * acusa explicitamente: `mark_confirmation_prompt_sent` al salir, `mark_confirmation_prompt_failed`
 * al fallar (que lo devuelve a la cola, hasta tres intentos).
 */
// deno-lint-ignore no-explicit-any
async function sendConfirmationPrompts(admin: any, supabaseUrl: string, serviceKey: string) {
  const { data: claimed, error } = await admin.rpc('claim_due_confirmation_prompts', { p_limit: BATCH_LIMIT });
  if (error) throw new Error(`claim_due_confirmation_prompts: ${error.message}`);

  const ids: string[] = (claimed || []).map((row: unknown) =>
    typeof row === 'string' ? row : String((row as { id?: string })?.id ?? ''),
  ).filter(Boolean);

  let sent = 0;
  let failed = 0;

  for (const bookingId of ids) {
    const outcome = await requestEmail(supabaseUrl, serviceKey, {
      type: 'booking_client_confirmation_request', bookingId,
    });
    if (outcome.ok) {
      await admin.rpc('mark_confirmation_prompt_sent', { p_booking_id: bookingId });
      sent += 1;
    } else {
      failed += 1;
      await admin.rpc('mark_confirmation_prompt_failed', { p_booking_id: bookingId, p_error: outcome.reason });
      await logEvent(admin, 'error', 'booking.confirmation_prompt_send_failed', {
        bookingId, message: outcome.reason,
      });
    }
  }

  return { claimed: ids.length, sent, failed };
}

/**
 * Trabajo 2 — cerrar las que vencieron sin respuesta, y hacer despues lo que el SQL no puede.
 *
 * `auto_complete_due_bookings()` ya existia y solo cambiaba el estado. Las reservas cerradas
 * por ese camino nunca recibian el correo de valoracion —solo lo mandaba el cierre manual— ni
 * borraban sus fotos. Aqui se salda esa deuda: se cierra, y despues se hace el trabajo de
 * fuera de la base de datos sobre las que acaban de cerrarse.
 */
// deno-lint-ignore no-explicit-any
async function closeDueBookings(admin: any, supabaseUrl: string, serviceKey: string) {
  const before = new Date().toISOString();
  const { data: closedCount, error } = await admin.rpc('auto_complete_due_bookings');
  if (error) throw new Error(`auto_complete_due_bookings: ${error.message}`);

  if (!closedCount) return { closed: 0, reviewEmails: 0, cleaned: 0 };

  const { data: rows } = await admin
    .from('bookings')
    .select('id')
    .eq('status', 'completed')
    .not('auto_completed_at', 'is', null)
    .gte('auto_completed_at', before)
    .limit(BATCH_LIMIT);

  let reviewEmails = 0;
  let cleaned = 0;

  for (const row of rows || []) {
    const bookingId = String(row.id);
    const mail = await requestEmail(supabaseUrl, serviceKey, { type: 'booking_review_request', bookingId });
    if (mail.ok) reviewEmails += 1;
    else await logEvent(admin, 'warn', 'booking.review_request_failed', { bookingId, message: mail.reason });

    const cleanup = await cleanupBookingMedia(admin, bookingId);
    if (cleanup.status === 'completed') cleaned += 1;
    if (cleanup.status === 'failed') {
      await logEvent(admin, 'warn', 'booking.media_cleanup_failed', { bookingId, ...cleanup });
    }
  }

  return { closed: Number(closedCount), reviewEmails, cleaned };
}

/** Trabajo 3 — caducar solicitudes sin responder. Ya existia; se conserva en el mismo reloj. */
// deno-lint-ignore no-explicit-any
async function expireStaleRequests(admin: any) {
  const { data, error } = await admin.rpc('expire_due_booking_requests');
  if (error) throw new Error(`expire_due_booking_requests: ${error.message}`);
  return { expired: Number(data || 0) };
}

/**
 * Trabajo 5 (T1 + D1) — caducar licencias fitosanitarias aprobadas cuya fecha ya pasó.
 *
 * El admin escribe la caducidad al aprobar (`review_gardener_license`), pero nadie más
 * mira el reloj: sin este job, una licencia caducada seguiría marcada 'approved' para
 * siempre y `isPhytosanitaryLicenseActive` (bookingEligibilityCore.ts) sólo la habría
 * excluido si comparara la fecha en cada evaluación — lo hace, pero D1 pide además que el
 * ESTADO visible cambie a 'expired' (el jardinero tiene que enterarse y volver a subir el
 * documento, no quedarse en un "approved" que ya no significa nada).
 */
// deno-lint-ignore no-explicit-any
async function expirePhytosanitaryLicenses(admin: any) {
  const { data, error } = await admin.rpc('expire_due_phytosanitary_licenses');
  if (error) throw new Error(`expire_due_phytosanitary_licenses: ${error.message}`);
  return { expired: Number(data || 0) };
}

/**
 * Trabajo 4 (F3) — respaldo de la captura/liberación diferida del pago.
 *
 * La captura de la comisión (al aceptar) y la liberación de la autorización (al
 * rechazar/cancelar) las dispara el navegador y, aunque ahora se reintenta desde el cliente,
 * si el navegador se cierra del todo nadie las recupera: la reserva queda `confirmed` con el
 * PaymentIntent en `requires_capture` y GarSer no cobra esa comisión.
 *
 * Aquí NO se decide política: la RPC ya devuelve QUÉ hacer según el estado de la reserva
 * (`capture` para `confirmed`, `release` para cancelada/rechazada/caducada). Esta función sólo
 * comprueba el estado REAL en Stripe y EJECUTA. Es idempotente y conservadora:
 *   · `capture`: sólo si el PI sigue `requires_capture`. Si ya está `succeeded`, se marca y ya.
 *   · `release`: sólo libera una autorización pendiente. NUNCA reembolsa un cargo capturado
 *     (eso rompería la política de las 24 h). Si el PI está `succeeded`, se marca y se avisa.
 */
// deno-lint-ignore no-explicit-any
async function reconcileStuckPayments(admin: any, stripeSecret: string | undefined) {
  if (!stripeSecret) {
    return { skipped: 'no_stripe_secret' as const };
  }

  const { data: rows, error } = await admin.rpc('list_bookings_pending_payment_reconciliation', {
    p_limit: BATCH_LIMIT,
  });
  if (error) throw new Error(`list_bookings_pending_payment_reconciliation: ${error.message}`);

  const candidates = (rows || []) as Array<{
    booking_id: string;
    attempt_id: string;
    booking_status: string;
    payment_intent_id: string;
    desired_action: 'capture' | 'release';
  }>;

  const stripeGet = async (path: string) => {
    const res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
    });
    return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const stripePost = async (path: string, idempotencyKey: string) => {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: '',
    });
    return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  let captured = 0;
  let released = 0;
  let alreadySettled = 0;
  let needsAttention = 0;
  let failed = 0;

  for (const row of candidates) {
    const pi = row.payment_intent_id;
    try {
      const { ok, body } = await stripeGet(`/v1/payment_intents/${encodeURIComponent(pi)}`);
      if (!ok) {
        failed += 1;
        await logEvent(admin, 'error', 'booking.payment_reconcile_stripe_get_failed', {
          bookingId: row.booking_id, paymentIntentId: pi, body,
        });
        continue;
      }
      const status = String(body.status || '');

      if (row.desired_action === 'capture') {
        if (status === 'requires_capture') {
          const cap = await stripePost(
            `/v1/payment_intents/${encodeURIComponent(pi)}/capture`,
            `garser_recon_capture_${row.booking_id}`,
          );
          if (!cap.ok) {
            failed += 1;
            await logEvent(admin, 'error', 'booking.payment_reconcile_capture_failed', {
              bookingId: row.booking_id, paymentIntentId: pi, body: cap.body,
            });
            continue;
          }
          captured += 1;
          await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'captured' });
          await logEvent(admin, 'warn', 'booking.payment_reconcile_captured', {
            bookingId: row.booking_id, paymentIntentId: pi,
          });
        } else if (status === 'succeeded') {
          alreadySettled += 1;
          await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'already_captured' });
        } else if (status === 'canceled') {
          // La autorización caducó/se canceló sin capturar: comisión perdida, nada que hacer.
          needsAttention += 1;
          await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'capture_lost' });
          await logEvent(admin, 'error', 'booking.payment_reconcile_capture_lost', {
            bookingId: row.booking_id, paymentIntentId: pi,
          });
        }
        // Otros estados (requires_payment_method, processing…): se reintenta en la próxima pasada.
      } else {
        // desired_action === 'release'
        if (['requires_capture', 'requires_payment_method', 'requires_confirmation'].includes(status)) {
          const rel = await stripePost(
            `/v1/payment_intents/${encodeURIComponent(pi)}/cancel`,
            `garser_recon_release_${row.booking_id}`,
          );
          if (!rel.ok) {
            failed += 1;
            await logEvent(admin, 'error', 'booking.payment_reconcile_release_failed', {
              bookingId: row.booking_id, paymentIntentId: pi, body: rel.body,
            });
            continue;
          }
          released += 1;
          await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'released' });
        } else if (status === 'canceled') {
          alreadySettled += 1;
          await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'already_released' });
        } else if (status === 'succeeded') {
          // Cargo capturado sobre una reserva cancelada. Distinguimos dos casos:
          //  · ya reembolsado (cancelación/rechazo del profesional → refund) → cierre limpio.
          //  · capturado y NO reembolsado → puede ser correcto (cancelación tardía del cliente
          //    conserva la tarifa) o no; NO se toca desde aquí, se marca y se avisa.
          const { body: refundList } = await stripeGet(
            `/v1/refunds?payment_intent=${encodeURIComponent(pi)}&limit=100`,
          );
          const refunded = Array.isArray((refundList as { data?: unknown[] }).data)
            && (refundList as { data: Array<Record<string, unknown>> }).data
              .some((r) => String(r.status) === 'succeeded');
          if (refunded) {
            alreadySettled += 1;
            await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'refunded_ok' });
          } else {
            needsAttention += 1;
            await admin.rpc('mark_booking_payment_settled', { p_attempt_id: row.attempt_id, p_result: 'captured_on_cancelled_review' });
            await logEvent(admin, 'warn', 'booking.payment_reconcile_captured_on_cancelled', {
              bookingId: row.booking_id, paymentIntentId: pi,
            });
          }
        }
      }
    } catch (rowError) {
      failed += 1;
      await logEvent(admin, 'error', 'booking.payment_reconcile_row_failed', {
        bookingId: row.booking_id,
        message: rowError instanceof Error ? rowError.message : String(rowError),
      });
    }
  }

  return { candidates: candidates.length, captured, released, alreadySettled, needsAttention, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = resolveServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'missing_supabase_secrets' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  // Cada trabajo va aislado: un fallo en el correo no puede dejar sin caducar las solicitudes.
  for (const [name, job] of [
    ['confirmationPrompts', (a: unknown) => sendConfirmationPrompts(a, supabaseUrl, serviceKey)],
    ['dueBookings', (a: unknown) => closeDueBookings(a, supabaseUrl, serviceKey)],
    ['staleRequests', (a: unknown) => expireStaleRequests(a)],
    ['stuckPayments', (a: unknown) => reconcileStuckPayments(a, stripeSecret)],
    ['phytosanitaryLicenses', (a: unknown) => expirePhytosanitaryLicenses(a)],
  ] as const) {
    try {
      result[name] = await job(admin);
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError);
      errors.push(`${name}: ${message}`);
      result[name] = { error: message };
      await logEvent(admin, 'error', 'booking.lifecycle_tick_job_failed', { job: name, message });
    }
  }

  await logEvent(admin, errors.length ? 'warn' : 'info', 'booking.lifecycle_tick', result);

  return new Response(JSON.stringify({ ok: errors.length === 0, ...result }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
