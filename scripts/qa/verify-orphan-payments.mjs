// QA-139 (PH-37): pagos que acaban SIN reserva, de punta a punta contra el entorno LOCAL y Stripe en modo TEST.
//
// Comprueba en STRIPE (no solo en nuestra base de datos) que ninguna tarjeta se queda con dinero retenido
// cuando no hay reserva, y que una tarjeta rechazada ya no tira el hueco:
//
//   O1  paga con el hueco caducado y llega el webhook → sin reserva, retención anulada en Stripe
//   O2  igual, pero la web pregunta antes que el webhook (sync_payment_state) → la respuesta ya lo dice
//   O3  el intento ya caducó al consultarlo → el PaymentIntent se anula y un pago tardío NO se puede hacer
//   O4  tarjeta rechazada (webhook payment_failed) y luego otra buena en el mismo formulario → SÍ hay reserva
//   O5  respaldo del reloj: un intento sin reserva que no se liberó al momento se libera en el tick, una vez
//   O6  dos webhooks repetidos y la web a la vez sobre el mismo pago → una sola anulación, sin errores
//   O7  desde el navegador ya no se puede liberar un intento de pago (antes cualquiera con sesión podía)
//   O8  el cliente abandona con el pago preparado y no vuelve: el reloj caduca el intento y anula el pago
//
//   supabase functions serve --env-file <env con STRIPE_WEBHOOK_SECRET>      # otra terminal
//   ORPHAN_FUNCTIONS_ENV=<ese mismo env> node scripts/qa/verify-orphan-payments.mjs
//
// Se niega a correr fuera de 127.0.0.1 o con una clave de Stripe que no sea de pruebas. Borra lo que crea.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env, sql, PROVIDER_ID } from '../readiness/_harness.mjs';

const { apiUrl, functionsUrl, anonKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea pagos y los anula.`);
  process.exit(2);
}
const readEnvFile = (file) =>
  Object.fromEntries(
    readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  );
if (!process.env.ORPHAN_FUNCTIONS_ENV) {
  console.error('Falta ORPHAN_FUNCTIONS_ENV (el env con STRIPE_WEBHOOK_SECRET con el que se sirvieron las funciones).');
  process.exit(2);
}
const functionsEnv = readEnvFile(process.env.ORPHAN_FUNCTIONS_ENV);
const STRIPE_KEY = functionsEnv.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = functionsEnv.STRIPE_WEBHOOK_SECRET || '';
const TICK_SECRET = functionsEnv.LIFECYCLE_TICK_SECRET || '';
if (!STRIPE_KEY.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY no es una clave de PRUEBAS (sk_test_…). No sigo.');
  process.exit(2);
}

const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const INPUT = {
  serviceIds: [LAWN],
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};
const created = { bookings: new Set(), attempts: new Set(), quotes: new Set(), users: new Set(), intents: new Set() };
const results = [];
const record = (id, description, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${String(detail).slice(0, 300)}` : ''}`);
};
const ids = (set) => [...set].map((id) => `'${id}'`).join(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, body: data };
}
const callFunction = (name, body, token) =>
  http(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const authority = (body, token) => callFunction('booking-authority', body, token);
const payment = (body, token) => callFunction('booking-payment', body, token);
const rpc = (fn, args, token) =>
  http(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
const tick = () =>
  http(`${functionsUrl}/booking-lifecycle-tick`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'x-lifecycle-secret': TICK_SECRET, 'Content-Type': 'application/json' },
    body: '{}',
  });

async function stripe(path, { method = 'GET', form } = {}) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
const getIntent = async (id) => (await stripe(`/v1/payment_intents/${id}`)).body;
const confirmIntent = (id, method = 'pm_card_visa') =>
  stripe(`/v1/payment_intents/${id}/confirm`, { method: 'POST', form: { payment_method: method, return_url: 'https://garser.es/pago-ok' } });

function signedWebhook(event) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(event);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  return http(`${functionsUrl}/booking-payment-webhook`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
    body: payload,
  });
}
const eventFor = (intent, type) => ({
  id: `evt_local_${randomUUID().replace(/-/g, '')}`, object: 'event', api_version: '2024-06-20',
  created: Math.floor(Date.now() / 1000), livemode: false, type,
  data: { object: intent }, pending_webhooks: 1, request: { id: null, idempotency_key: null },
});

async function signUpTempClient(label) {
  const email = `cliente-${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@orphan.local`;
  const res = await http(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role: 'client', full_name: `Cliente ${label}` } }),
  });
  const id = res.body?.user?.id ?? res.body?.id;
  if (!id || !res.body.access_token) throw new Error(`No se pudo crear el cliente de prueba: ${JSON.stringify(res.body).slice(0, 160)}`);
  created.users.add(id);
  return { id, token: res.body.access_token };
}

let DATE; const HOURS = [];
function pickDate() {
  const dates = sql(`select date::text from public.availability
    where gardener_id='${PROVIDER_ID}' and date >= current_date + 3
    group by date having count(*) filter (where is_available) >= 10
    order by date limit 1`).split('\n').filter(Boolean);
  if (!dates.length) throw new Error('No hay un día con 10+ horas libres para el profesional de prueba.');
  return dates[0];
}

async function preparePayment(client, hour) {
  const q = await authority({
    action: 'create_quote', serviceId: LAWN, providerId: PROVIDER_ID, date: DATE,
    startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: INPUT, clientCapabilities: { feeWaiver: 1 },
  }, client.token);
  if (!q.body?.quoteId) throw new Error(`No se pudo presupuestar a las ${hour}:00: ${JSON.stringify(q.body).slice(0, 200)}`);
  created.quotes.add(q.body.quoteId);
  const res = await payment({ action: 'prepare_payment', quoteId: q.body.quoteId }, client.token);
  const attempt = res.body?.attempt;
  if (!attempt?.paymentIntentId) throw new Error(`No se preparó un pago con PaymentIntent: ${JSON.stringify(res.body).slice(0, 200)}`);
  created.attempts.add(attempt.attemptId);
  created.intents.add(attempt.paymentIntentId);
  return attempt;
}
// El hueco de 30 min «pasa»: se adelanta su caducidad (y la del intento) a hace un minuto.
function expireHold(attemptId) {
  sql(`update public.booking_schedule_holds set expires_at = now() - interval '1 minute' where payment_attempt_id = '${attemptId}'`);
  sql(`alter table public.booking_payment_attempts disable trigger trg_booking_payment_attempts_updated_at;
       update public.booking_payment_attempts set payment_expires_at = now() - interval '1 minute' where id = '${attemptId}';
       alter table public.booking_payment_attempts enable trigger trg_booking_payment_attempts_updated_at;`);
}
const attemptRow = (attemptId) => {
  const [status, code, bookingId, settlement] = sql(`select status, coalesce(last_error_code,''), coalesce(booking_id::text,''),
    coalesce(gateway_response->>'settlement','') from public.booking_payment_attempts where id='${attemptId}'`).split('|');
  return { status, code, bookingId, settlement };
};
const holdStatus = (attemptId) => sql(`select status from public.booking_schedule_holds where payment_attempt_id='${attemptId}'`);
async function waitFor(check, { timeoutMs = 20_000, everyMs = 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await check();
    if (last.done) return last;
    await sleep(everyMs);
  }
  return last;
}

async function main() {
  DATE = pickDate();
  const vh = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: PROVIDER_ID, date: DATE, bookingInput: INPUT, clientCapabilities: { feeWaiver: 1 } });
  HOURS.push(...(vh.body?.validHours ?? []));
  if (HOURS.length < 4) throw new Error(`El ${DATE} no tiene horas suficientes: ${JSON.stringify(vh.body).slice(0, 200)}`);
  console.log(`Día de prueba ${DATE}; horas ${HOURS.slice(0, 6).join(', ')}.\n`);
  const client = await signUpTempClient('huerfano');

  // ═══ O1 · paga con el hueco caducado y llega el webhook ═══════════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[0]);
    expireHold(a.attemptId);
    const confirm = await confirmIntent(a.paymentIntentId);
    const before = await getIntent(a.paymentIntentId);
    const hook = await signedWebhook(eventFor(before, 'payment_intent.amount_capturable_updated'));
    const after = await getIntent(a.paymentIntentId);
    // Stripe avisará también de la cancelación (`payment_intent.canceled`): se le da tiempo a llegar y
    // se manda una copia firmada, para comprobar que no pisa el estado «sin reserva».
    await signedWebhook(eventFor(after, 'payment_intent.canceled'));
    await sleep(3000);
    const row = attemptRow(a.attemptId);
    record('O1', 'Hueco caducado + webhook: no hay reserva, Stripe ANULA la retención y queda anotado',
      confirm.ok && before.status === 'requires_capture' && hook.ok && row.status === 'reconciliation_required'
      && row.code === 'hold_unavailable_after_payment' && !row.bookingId && after.status === 'canceled' && ['released_orphan', 'already_released'].includes(row.settlement),
      `antes ${before.status} · webhook ${hook.status} · intento ${row.status}/${row.code} · Stripe ${after.status} · ${row.settlement}`);
  }

  // ═══ O2 · la web pregunta antes de que llegue el webhook ══════════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[1]);
    expireHold(a.attemptId);
    await confirmIntent(a.paymentIntentId);
    const sync = await payment({ action: 'sync_payment_state', attemptId: a.attemptId }, client.token);
    const after = await getIntent(a.paymentIntentId);
    const summary = sync.body?.attempt || {};
    record('O2', 'La web consulta el pago: recibe «sin reserva» con el motivo, y Stripe ya está anulado',
      sync.ok && summary.status === 'reconciliation_required' && summary.lastErrorCode === 'hold_unavailable_after_payment'
      && !summary.bookingId && after.status === 'canceled',
      `respuesta ${sync.status} ${summary.status}/${summary.lastErrorCode} · Stripe ${after.status}`);
  }

  // ═══ O3 · el intento caducó antes de pagar: el pago tardío ya no se puede hacer ════════════════
  {
    const a = await preparePayment(client, HOURS[2]);
    expireHold(a.attemptId);
    const status = await payment({ action: 'get_attempt_status', attemptId: a.attemptId }, client.token);
    const afterExpire = await getIntent(a.paymentIntentId);
    const late = await confirmIntent(a.paymentIntentId);
    record('O3', 'Intento caducado: el PaymentIntent se anula y un pago tardío con la hoja abierta lo RECHAZA Stripe',
      status.body?.attempt?.status === 'expired' && afterExpire.status === 'canceled' && !late.ok,
      `intento ${status.body?.attempt?.status} · Stripe ${afterExpire.status} · pago tardío ${late.status} ${late.body?.error?.code || ''}`);
  }

  // ═══ O4 · tarjeta rechazada y luego otra buena ═══════════════════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[3]);
    const declined = await confirmIntent(a.paymentIntentId, 'pm_card_chargeDeclined');
    const failedIntent = await getIntent(a.paymentIntentId);
    const failHook = await signedWebhook(eventFor(failedIntent, 'payment_intent.payment_failed'));
    const afterDecline = attemptRow(a.attemptId);
    const holdAfterDecline = holdStatus(a.attemptId);
    const ok = await confirmIntent(a.paymentIntentId, 'pm_card_visa');
    const okIntent = await getIntent(a.paymentIntentId);
    const okHook = await signedWebhook(eventFor(okIntent, 'payment_intent.amount_capturable_updated'));
    const row = attemptRow(a.attemptId);
    if (row.bookingId) created.bookings.add(row.bookingId);
    record('O4a', 'Tarjeta rechazada: el intento sigue abierto y el hueco sigue guardado',
      !declined.ok && failHook.ok && afterDecline.status === 'payment_pending' && Boolean(afterDecline.code) && holdAfterDecline === 'active',
      `rechazo ${declined.body?.error?.decline_code || declined.status} · webhook ${failHook.status} · intento ${afterDecline.status}/${afterDecline.code} · hueco ${holdAfterDecline}`);
    record('O4b', 'Otra tarjeta en el mismo formulario: la reserva SE CREA y la autorización sigue para capturarla al aceptar',
      ok.ok && okHook.ok && row.status === 'booking_created' && Boolean(row.bookingId) && okIntent.status === 'requires_capture',
      `pago ${ok.status} · webhook ${okHook.status} · intento ${row.status} · reserva ${row.bookingId || '—'} · Stripe ${okIntent.status}`);
    // Se suelta ya esa reserva (y su autorización) para que los escenarios siguientes tengan horas libres.
    if (row.bookingId) {
      await stripe(`/v1/payment_intents/${a.paymentIntentId}/cancel`, { method: 'POST', form: {} });
      sql(`select public.release_booking_schedule('${row.bookingId}')`);
      sql(`set session_replication_role = replica; delete from public.booking_items where booking_id = '${row.bookingId}'; delete from public.bookings where id = '${row.bookingId}'`);
      created.bookings.delete(row.bookingId);
    }
  }

  // ═══ O5 · respaldo del reloj ══════════════════════════════════════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[4] ?? HOURS[0]);
    // Se cierra SIN pasar por booking-payment (como si Stripe hubiese fallado justo entonces) y «pasan» 5 minutos.
    sql(`select public.release_booking_payment_attempt('${a.attemptId}', 'reconciliation_required', 'booking_creation_failed', null, '{}'::jsonb)`);
    sql(`alter table public.booking_payment_attempts disable trigger trg_booking_payment_attempts_updated_at;
         update public.booking_payment_attempts set updated_at = now() - interval '5 minutes' where id = '${a.attemptId}';
         alter table public.booking_payment_attempts enable trigger trg_booking_payment_attempts_updated_at;`);
    const beforeTick = await getIntent(a.paymentIntentId);
    const t1 = await tick();
    const afterTick = await getIntent(a.paymentIntentId);
    const row = attemptRow(a.attemptId);
    const t2 = await tick();
    record('O5', 'El reloj libera la retención que se quedó viva, y en la segunda pasada ya no la toca',
      beforeTick.status !== 'canceled' && t1.ok && afterTick.status === 'canceled' && row.settlement === 'released_orphan'
      && t2.ok && !(t2.body?.orphanAuthorizations?.released),
      `antes ${beforeTick.status} · reloj ${t1.status} ${JSON.stringify(t1.body?.orphanAuthorizations)} · Stripe ${afterTick.status} · ${row.settlement} · 2ª ${JSON.stringify(t2.body?.orphanAuthorizations)}`);
  }

  // ═══ O6 · webhooks repetidos y la web a la vez ═══════════════════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[5] ?? HOURS[1]);
    expireHold(a.attemptId);
    await confirmIntent(a.paymentIntentId);
    const intent = await getIntent(a.paymentIntentId);
    const [h1, h2, s1] = await Promise.all([
      signedWebhook(eventFor(intent, 'payment_intent.amount_capturable_updated')),
      signedWebhook(eventFor(intent, 'payment_intent.amount_capturable_updated')),
      payment({ action: 'sync_payment_state', attemptId: a.attemptId }, client.token),
    ]);
    await sleep(1500);
    const after = await getIntent(a.paymentIntentId);
    const row = attemptRow(a.attemptId);
    const bookings = sql(`select count(*) from public.bookings where pricing_context->>'payment_attempt_id' = '${a.attemptId}'`);
    record('O6', 'Tres avisos a la vez sobre el mismo pago: ninguna reserva, una anulación y ninguna respuesta de error',
      h1.ok && h2.ok && s1.ok && after.status === 'canceled' && bookings === '0' && ['released_orphan', 'already_released'].includes(row.settlement),
      `webhooks ${h1.status}/${h2.status} · web ${s1.status} · Stripe ${after.status} · reservas ${bookings} · ${row.settlement}`);
  }

  // ═══ O8 · pago preparado y abandonado: nadie vuelve a la web ═════════════════════════════════
  {
    const a = await preparePayment(client, HOURS[6] ?? HOURS[2]);
    expireHold(a.attemptId);
    const t1 = await tick();
    const afterFirst = attemptRow(a.attemptId);
    sql(`alter table public.booking_payment_attempts disable trigger trg_booking_payment_attempts_updated_at;
         update public.booking_payment_attempts set updated_at = now() - interval '5 minutes' where id = '${a.attemptId}';
         alter table public.booking_payment_attempts enable trigger trg_booking_payment_attempts_updated_at;`);
    const t2 = await tick();
    const after = await getIntent(a.paymentIntentId);
    const row = attemptRow(a.attemptId);
    record('O8', 'Pago abandonado: el reloj caduca el intento y, en la pasada siguiente, anula el pago preparado en Stripe',
      t1.ok && afterFirst.status === 'expired' && t2.ok && after.status === 'canceled' && row.settlement === 'released_orphan',
      `1ª ${JSON.stringify(t1.body?.orphanAuthorizations)} → ${afterFirst.status} · 2ª ${JSON.stringify(t2.body?.orphanAuthorizations)} · Stripe ${after.status} · ${row.settlement}`);
  }

  // ═══ O7 · liberar intentos ya no se puede desde el navegador ═════════════════════════════════
  {
    const other = await signUpTempClient('otro');
    const victim = [...created.attempts][0];
    const res = await rpc('release_booking_payment_attempt', {
      p_attempt_id: victim, p_next_status: 'cancelled', p_reason: 'ataque', p_stripe_payment_intent_id: null, p_gateway_payload: {},
    }, other.token);
    const list = await rpc('list_orphan_payment_authorizations', { p_limit: 5 }, other.token);
    record('O7', 'Un usuario con sesión no puede liberar el pago de otro ni ver la lista de retenciones',
      !res.ok && !list.ok, `liberar ${res.status} · lista ${list.status}`);
  }
}

async function cleanup() {
  try {
    for (const intentId of created.intents) {
      const intent = await getIntent(intentId);
      if (['requires_capture', 'requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
        await stripe(`/v1/payment_intents/${intentId}/cancel`, { method: 'POST', form: {} });
      }
    }
    if (created.bookings.size) {
      for (const id of created.bookings) sql(`select public.release_booking_schedule('${id}')`);
      sql(`set session_replication_role = replica; delete from public.booking_items where booking_id in (${ids(created.bookings)}); delete from public.bookings where id in (${ids(created.bookings)})`);
    }
    if (created.attempts.size) {
      sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)}))`);
      sql(`delete from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)})`);
      sql(`delete from public.booking_payment_attempts where id in (${ids(created.attempts)})`);
    }
    if (created.quotes.size) sql(`delete from public.booking_quotes where id in (${ids(created.quotes)})`);
    if (created.users.size) sql(`delete from auth.users where id in (${ids(created.users)})`);
    console.log(`\nLimpieza hecha: ${created.intents.size} PaymentIntents de prueba cerrados, ${created.users.size} clientes de prueba borrados.`);
  } catch (error) {
    console.error('Limpieza incompleta:', error.message);
  }
}

main()
  .catch((error) => {
    console.error(error);
    results.push({ id: 'run', ok: false });
  })
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
    process.exit(failed.length ? 1 : 0);
  });
