// Comisiones configurables: el DINERO de punta a punta contra el entorno LOCAL, con Stripe en modo TEST.
//
// Cada escenario hace lo que haría la web y Stripe de verdad (API de pruebas, tarjetas de prueba):
// presupuestar → preparar el pago (PaymentIntent real, captura manual) → confirmar con una tarjeta →
// webhook firmado (como el de Stripe) → el profesional acepta/rechaza → captura/liberación → cancelaciones
// → devoluciones. Después MIRA EN STRIPE (no en nuestra base de datos) cuánto se autorizó, cuánto se
// cobró y cuánto se devolvió, y lo compara con lo que la configuración de comisiones dice que debía ser.
//
//   supabase functions serve --workdir "$(pwd)" --env-file <env con STRIPE_WEBHOOK_SECRET>   # otra terminal
//   COMMISSIONS_FUNCTIONS_ENV=<ese mismo env> node scripts/commissions/verify-commissions-stripe.mjs
//
// El env con el secreto del webhook es solo para esta prueba local (el webhook real de producción tiene el
// suyo). La clave de Stripe se lee de supabase/functions/.env y se niega a seguir si no es de PRUEBAS.
// Se niega a correr fuera de 127.0.0.1. Deja la configuración como estaba y borra lo que crea.
//
// NO cubre (necesitan un navegador): 3-D Secure, el formulario de Stripe Elements y la pantalla.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env, sql, signIn, PROVIDER_ID, GARDENER_EMAIL } from '../readiness/_harness.mjs';

const { apiUrl, functionsUrl, anonKey, serviceRoleKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea reservas, cobra y devuelve.`);
  process.exit(2);
}

const readEnvFile = (file) =>
  Object.fromEntries(
    readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  );
const projectEnv = readEnvFile('supabase/functions/.env');
const STRIPE_KEY = projectEnv.STRIPE_SECRET_KEY || '';
if (!STRIPE_KEY.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY no es una clave de PRUEBAS (sk_test_…). No sigo: esta prueba cobra y devuelve de verdad.');
  process.exit(2);
}
const WEBHOOK_SECRET = process.env.COMMISSIONS_FUNCTIONS_ENV ? readEnvFile(process.env.COMMISSIONS_FUNCTIONS_ENV).STRIPE_WEBHOOK_SECRET : '';
if (!WEBHOOK_SECRET) {
  console.error('Falta COMMISSIONS_FUNCTIONS_ENV (el env con STRIPE_WEBHOOK_SECRET con el que se sirvieron las funciones).');
  process.exit(2);
}
const TICK_SECRET = projectEnv.LIFECYCLE_TICK_SECRET || '';

// ── utilidades ────────────────────────────────────────────────────────────────────────────────
const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const INPUT = {
  serviceIds: [LAWN],
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};
const CAPS = { clientCapabilities: { feeWaiver: 1 } };
const COLUMNS = ['rate_garser_first', 'rate_link_first', 'rate_garser_repeat', 'rate_maintenance_visit', 'rate_link_repeat'];
const FACTORY = [12.5, 0, 3, 3, 0];

const created = { bookings: new Set(), attempts: new Set(), quotes: new Set(), plans: new Set(), users: new Set(), intents: new Set() };
const results = [];
const record = (id, description, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${String(detail).slice(0, 260)}` : ''}`);
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
const rest = (path, { method = 'GET', body, token } = {}) =>
  http(`${apiUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const rpc = (fn, args, token) => rest(`rpc/${fn}`, { method: 'POST', body: args, token });

// Stripe (modo prueba)
async function stripe(path, { method = 'GET', form } = {}) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: data };
}
const getIntent = async (id) => (await stripe(`/v1/payment_intents/${id}?expand[]=latest_charge`)).body;
const confirmIntent = (id, method = 'pm_card_visa') =>
  stripe(`/v1/payment_intents/${id}/confirm`, { method: 'POST', form: { payment_method: method, return_url: 'https://garser.es/pago-ok' } });

// Un webhook firmado como lo firma Stripe: `Stripe-Signature: t=<unix>,v1=<hmac_sha256(secreto, "<t>.<cuerpo>")>`.
function signedWebhook(event, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const payload = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return http(`${functionsUrl}/booking-payment-webhook`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
    body: payload,
  });
}
const eventFor = (intent, type = 'payment_intent.amount_capturable_updated', id = `evt_local_${randomUUID().replace(/-/g, '')}`) => ({
  id, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, type,
  data: { object: intent }, pending_webhooks: 1, request: { id: null, idempotency_key: null },
});

async function signUpTempClient(label) {
  const email = `cliente-${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@comisiones.local`;
  const res = await http(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role: 'client', full_name: `Cliente ${label}` } }),
  });
  const id = res.body?.user?.id ?? res.body?.id;
  if (!id || !res.body.access_token) throw new Error(`No se pudo crear el cliente de prueba: ${JSON.stringify(res.body).slice(0, 160)}`);
  created.users.add(id);
  return { id, token: res.body.access_token };
}

const readConfig = () => sql(`select ${COLUMNS.join(', ')} from public.commission_settings where id = 1`).split('|').map(Number);
const setRates = (values) => sql(`update public.commission_settings set ${COLUMNS.map((c, i) => `${c} = ${values[i]}`).join(', ')} where id = 1`);
const configVersion = () => Number(sql('select version from public.commission_settings where id = 1'));

// El cálculo, escrito aparte y a la antigua: céntimos enteros, redondeo «mitad hacia arriba» y suelo de 0,50 €.
function expectedFeeCents(grossEuros, percent) {
  const gross = Math.round(grossEuros * 100);
  const bps = Math.round(percent * 100);
  if (bps === 0) return 0;
  return Math.max(Math.floor((gross * bps + 5000) / 10000), 50);
}

function pickDates(count) {
  const dates = sql(`select date::text from public.availability
    where gardener_id='${PROVIDER_ID}' and date >= current_date + 3
    group by date having count(*) filter (where is_available) >= 10
    order by date limit ${count}`).split('\n').filter(Boolean);
  if (dates.length < count) throw new Error(`Hacen falta ${count} días con 10+ horas libres y hay ${dates.length}.`);
  return dates;
}

let DATE; let HOUR;
async function quoteFor(token, extra = {}, { date = DATE, hour = HOUR } = {}) {
  const q = await authority({
    action: 'create_quote', serviceId: LAWN, providerId: PROVIDER_ID, date,
    startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: INPUT, ...CAPS, ...extra,
  }, token);
  if (q.body?.quoteId) created.quotes.add(q.body.quoteId);
  return q;
}
const prepare = async (token, quoteId) => {
  const res = await payment({ action: 'prepare_payment', quoteId }, token);
  const attempt = res.body?.attempt;
  if (attempt?.attemptId) created.attempts.add(attempt.attemptId);
  if (attempt?.bookingId) created.bookings.add(attempt.bookingId);
  if (attempt?.paymentIntentId) created.intents.add(attempt.paymentIntentId);
  return res;
};
const bookingRow = (id) => {
  const [fee, source, status, rule, bps, base, version, fixed, date, start] = sql(`select management_fee, management_fee_source, status,
    coalesce(commission_rule,''), coalesce(commission_rate_bps::text,''), coalesce(commission_base_amount::text,''),
    coalesce(commission_config_version::text,''), (commission_fixed_at is not null)::text, date::text, start_time::text
    from public.bookings where id='${id}'`).split('|');
  return { fee: Number(fee), source, status, rule, bps: Number(bps), base: Number(base), version: Number(version), fixed: fixed === 'true', date, start };
};
const attemptBooking = (attemptId) => sql(`select coalesce(booking_id::text,'') from public.booking_payment_attempts where id='${attemptId}'`);
const attemptStatus = (attemptId) => sql(`select status from public.booking_payment_attempts where id='${attemptId}'`);

/** Libera el hueco y borra una reserva de prueba para que el siguiente escenario pueda usar el mismo día. */
function dispose(bookingId) {
  if (!bookingId) return;
  try {
    sql(`select public.release_booking_schedule('${bookingId}')`);
    sql(`set session_replication_role = replica; delete from public.reviews where booking_id='${bookingId}'; delete from public.bookings where id='${bookingId}'`);
    created.bookings.delete(bookingId);
  } catch (error) {
    console.log(`   (aviso) no se pudo limpiar la reserva ${bookingId}: ${String(error.message).slice(0, 100)}`);
  }
}
/** Un pago preparado y no terminado deja su hueco retenido: se suelta para que el siguiente escenario pueda usarlo. */
function dropAttemptHolds(attemptId) {
  if (!attemptId) return;
  sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where payment_attempt_id = '${attemptId}')`);
  sql(`delete from public.booking_schedule_holds where payment_attempt_id = '${attemptId}'`);
}
const setStart = (bookingId, hoursAhead) =>
  sql(`set session_replication_role = replica; update public.bookings set
    date = ((now() at time zone 'Europe/Madrid') + interval '${hoursAhead} hours')::date,
    start_time = ((now() at time zone 'Europe/Madrid') + interval '${hoursAhead} hours')::time(0)
    where id='${bookingId}'`);

/**
 * El cliente paga: prepara el pago, confirma el PaymentIntent con la tarjeta y entrega el webhook firmado.
 * Devuelve lo que hay en Stripe y en la reserva. `card` = tarjeta de prueba.
 */
async function payQuote(client, quote, { card = 'pm_card_visa', webhook = true } = {}) {
  const prep = await prepare(client.token, quote.body?.quoteId);
  const attempt = prep.body?.attempt;
  const out = { prep, attempt, intentId: attempt?.paymentIntentId, cents: attempt?.payableNowAmountCents, bookingId: attempt?.bookingId || '' };
  if (!prep.ok) return out;
  if (!attempt?.paymentIntentId) { out.zero = true; return out; }
  const confirm = await confirmIntent(attempt.paymentIntentId, card);
  out.confirm = confirm;
  if (!confirm.ok) { out.declined = true; return out; }
  let intent = await getIntent(attempt.paymentIntentId);
  out.intent = intent;
  if (webhook && intent.status === 'requires_capture') {
    out.hook = await signedWebhook(eventFor(intent));
    out.bookingId = attemptBooking(attempt.attemptId);
    if (out.bookingId) created.bookings.add(out.bookingId);
  }
  return out;
}
const decide = async (gardenerToken, bookingId, response) => {
  const r = await rpc('respond_booking_request', { p_booking_id: bookingId, p_response: response, p_operation_id: randomUUID() }, gardenerToken);
  const fin = await payment({ action: 'finalize_booking_payment', bookingId, decision: response }, gardenerToken);
  return { rpc: r, fin };
};

async function main() {
  const configBefore = readConfig();
  console.log(`Configuración antes: ${configBefore.join(' / ')} % (versión ${configVersion()}); se restaura al final.\n`);
  try {
    setRates(FACTORY);
    const gardenerToken = await signIn(GARDENER_EMAIL);
    const myLink = await rpc('my_booking_link', {}, gardenerToken);
    const LINK = { bookingOrigin: 'provider_link', originProviderId: PROVIDER_ID, originLinkCode: myLink.body?.code };
    [DATE] = pickDates(1);
    const vh = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: PROVIDER_ID, date: DATE, bookingInput: INPUT, ...CAPS });
    const hours = vh.body?.validHours ?? [];
    if (hours.length < 4) throw new Error(`El ${DATE} no tiene horas válidas suficientes: ${JSON.stringify(hours)}`);
    HOUR = hours[0];
    console.log(`Día de prueba ${DATE}, hora ${HOUR}:00. Las reservas se borran entre escenarios para reutilizar el hueco.\n`);

    // ═══ S1–S3 · cliente de GarSer, 12,5 %: autorizar → webhook → aceptar → capturar ═══════════════════
    const c1 = await signUpTempClient('garser');
    const q1 = await quoteFor(c1.token);
    const fee1 = q1.body?.economics?.managementFee;
    const gross1 = q1.body?.economics?.commission?.baseAmount;
    const pay1 = await payQuote(c1, q1);
    const intent1 = pay1.intent;
    record('S1', 'Stripe autoriza EXACTAMENTE la comisión firmada (12,5 %), con captura manual y en euros',
      fee1 === expectedFeeCents(gross1, 12.5) / 100 && intent1?.amount === Math.round(fee1 * 100) && intent1?.capture_method === 'manual'
      && intent1?.currency === 'eur' && intent1?.status === 'requires_capture' && intent1?.amount_capturable === intent1?.amount,
      `fee ${fee1}, Stripe ${intent1?.amount} ${intent1?.currency} ${intent1?.status} (${intent1?.capture_method})`);
    const row1 = pay1.bookingId ? bookingRow(pay1.bookingId) : null;
    record('S1b', 'El webhook firmado crea la reserva (pendiente) con comisión, regla, porcentaje, base y versión',
      pay1.hook?.ok && row1?.status === 'pending' && row1.fee === fee1 && row1.rule === 'garser_first' && row1.bps === 1250 && row1.base === gross1 && row1.fixed
      && row1.source === 'payment_attempt', `${pay1.hook?.status} ${JSON.stringify(row1)}`);
    record('S1c', 'Autorizada pero NO cobrada: el cliente todavía no ha pagado nada', intent1?.amount_received === 0, `amount_received ${intent1?.amount_received}`);

    // S3 · seguridad del webhook (con la misma autorización)
    const before = sql(`select count(*) from public.bookings where pricing_context->>'quote_id'='${q1.body.quoteId}'`);
    const replay = await signedWebhook(eventFor(intent1, 'payment_intent.amount_capturable_updated', pay1.hook?.body?.eventId || undefined));
    const again = await signedWebhook(eventFor(intent1)); // otro evento con otro id para el mismo pago
    record('S3a', 'Un webhook repetido (mismo pago, otro id de evento) no duplica la reserva ni el cobro',
      again.status === 200 && sql(`select count(*) from public.bookings where pricing_context->>'quote_id'='${q1.body.quoteId}'`) === before && before === '1', `${replay.status}/${again.status}, reservas ${before}`);
    const badSig = await signedWebhook(eventFor(intent1), { secret: 'whsec_no_es_el_mio' });
    record('S3b', 'Un webhook con firma falsa se rechaza (400) y no procesa nada', badSig.status === 400, `${badSig.status} ${JSON.stringify(badSig.body).slice(0, 100)}`);
    const oldHook = await signedWebhook(eventFor(intent1), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    record('S3c', 'Un webhook firmado hace una hora (repetición) se rechaza', oldHook.status === 400, `${oldHook.status}`);
    const noSig = await http(`${functionsUrl}/booking-payment-webhook`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(eventFor(intent1)) });
    record('S3d', 'Un webhook sin firma se rechaza', noSig.status === 400, `${noSig.status}`);

    // S2 · el profesional acepta → se captura la comisión
    const acc = await decide(gardenerToken, pay1.bookingId, 'accept');
    const after1 = await getIntent(pay1.intentId);
    const rowAcc = bookingRow(pay1.bookingId);
    record('S2', 'Al aceptar el profesional se COBRA la comisión: en Stripe «succeeded» por el importe firmado, y la reserva se confirma',
      acc.fin.body?.status === 'captured' && after1.status === 'succeeded' && after1.amount_received === Math.round(fee1 * 100) && rowAcc.status === 'confirmed' && rowAcc.fee === fee1,
      `${acc.fin.status} ${JSON.stringify(acc.fin.body)} · Stripe ${after1.status} cobrado ${after1.amount_received}`);
    const acc2 = await payment({ action: 'finalize_booking_payment', bookingId: pay1.bookingId, decision: 'accept' }, gardenerToken);
    const after1b = await getIntent(pay1.intentId);
    record('S2b', 'Aceptar dos veces no cobra dos veces (idempotente)', acc2.body?.status === 'already_captured' && after1b.amount_received === Math.round(fee1 * 100), JSON.stringify(acc2.body));

    // S8 · cancelación del cliente con 24 h o más tras aceptar → se devuelve íntegra
    const canc = await payment({ action: 'cancel_booking', bookingId: pay1.bookingId, reason: 'prueba' }, c1.token);
    const afterCancel = await getIntent(pay1.intentId);
    record('S8', 'El cliente cancela con 24 h o más de una reserva ya cobrada → Stripe DEVUELVE la comisión entera',
      canc.body?.moneyAction === 'refund' && afterCancel.latest_charge?.amount_refunded === Math.round(fee1 * 100) && afterCancel.latest_charge?.refunded === true && canc.body?.penaltyApplied === false,
      `${JSON.stringify(canc.body)} · devuelto ${afterCancel.latest_charge?.amount_refunded}`);
    dispose(pay1.bookingId);

    // ═══ S9 · cancela con 24 h o más ANTES de que acepte → se libera, nunca se cobra ═════════════════
    const c9 = await signUpTempClient('cancela-pendiente');
    const p9 = await payQuote(c9, await quoteFor(c9.token));
    const cancel9 = await payment({ action: 'cancel_booking', bookingId: p9.bookingId, reason: 'prueba' }, c9.token);
    const i9 = await getIntent(p9.intentId);
    record('S9', 'Cancelar con 24 h o más una solicitud SIN aceptar: la autorización se libera y no se cobra nada',
      cancel9.body?.moneyAction === 'release' && i9.status === 'canceled' && i9.amount_received === 0, `${JSON.stringify(cancel9.body)} · Stripe ${i9.status} cobrado ${i9.amount_received}`);
    dispose(p9.bookingId);

    // ═══ S10 · cancela con MENOS de 24 h una solicitud SIN aceptar → se cobra (lo dicen los términos) ══
    const c10 = await signUpTempClient('cancela-tarde-pendiente');
    const p10 = await payQuote(c10, await quoteFor(c10.token));
    setStart(p10.bookingId, 5);
    const cancel10 = await payment({ action: 'cancel_booking', bookingId: p10.bookingId, reason: 'prueba' }, c10.token);
    const i10 = await getIntent(p10.intentId);
    record('S10', 'Cancelar con MENOS de 24 h una solicitud aún sin aceptar: se COBRA la comisión (los términos y el aviso lo dicen)',
      cancel10.body?.moneyAction === 'capture' && i10.status === 'succeeded' && i10.amount_received === p10.cents, `${JSON.stringify(cancel10.body)} · Stripe ${i10.status} cobrado ${i10.amount_received}`);
    dispose(p10.bookingId);

    // ═══ S11 · cancela con MENOS de 24 h tras aceptar → no se devuelve ═══════════════════════════════
    const c11 = await signUpTempClient('cancela-tarde-aceptada');
    const p11 = await payQuote(c11, await quoteFor(c11.token));
    await decide(gardenerToken, p11.bookingId, 'accept');
    setStart(p11.bookingId, 5);
    const cancel11 = await payment({ action: 'cancel_booking', bookingId: p11.bookingId, reason: 'prueba' }, c11.token);
    const i11 = await getIntent(p11.intentId);
    record('S11', 'Cancelar con MENOS de 24 h una reserva aceptada: la comisión NO se devuelve',
      cancel11.body?.moneyAction === 'none' && i11.status === 'succeeded' && (i11.latest_charge?.amount_refunded ?? 0) === 0, `${JSON.stringify(cancel11.body)} · devuelto ${i11.latest_charge?.amount_refunded}`);
    dispose(p11.bookingId);

    // ═══ S11b · justo en el límite de las 24 h ═══════════════════════════════════════════════════════
    for (const [label, hours, expected] of [['24 h y 5 min', 24 + 5 / 60, 'refund'], ['23 h 55 min', 24 - 5 / 60, 'none']]) {
      const cb = await signUpTempClient('limite');
      const pb = await payQuote(cb, await quoteFor(cb.token));
      await decide(gardenerToken, pb.bookingId, 'accept');
      setStart(pb.bookingId, hours);
      const cancelb = await payment({ action: 'cancel_booking', bookingId: pb.bookingId, reason: 'límite' }, cb.token);
      const ib = await getIntent(pb.intentId);
      record(`S11-${label}`, `Cancelar con ${label} de antelación → ${expected === 'refund' ? 'se devuelve' : 'no se devuelve'} (regla «24 h o más»)`,
        cancelb.body?.moneyAction === expected && ((ib.latest_charge?.amount_refunded ?? 0) > 0) === (expected === 'refund'), JSON.stringify(cancelb.body));
      dispose(pb.bookingId);
    }

    // ═══ S7 · el profesional rechaza → se libera, el cliente no paga nada ═════════════════════════
    const c7 = await signUpTempClient('rechazo');
    const p7 = await payQuote(c7, await quoteFor(c7.token));
    const rej = await decide(gardenerToken, p7.bookingId, 'reject');
    const i7 = await getIntent(p7.intentId);
    record('S7', 'El profesional RECHAZA: la autorización se libera y el cliente no paga nada',
      rej.fin.body?.status === 'released' && i7.status === 'canceled' && i7.amount_received === 0 && ['cancelled', 'rejected'].includes(bookingRow(p7.bookingId).status),
      `${JSON.stringify(rej.fin.body)} · Stripe ${i7.status} cobrado ${i7.amount_received} · reserva ${bookingRow(p7.bookingId).status}`);
    dispose(p7.bookingId);

    // ═══ S7b · caduca sin respuesta → se libera ════════════════════════════════════════════════════
    const c7b = await signUpTempClient('caduca');
    const p7b = await payQuote(c7b, await quoteFor(c7b.token));
    // La conciliación solo mira reservas cuyo último cambio tiene más de 20 min (margen para que el navegador
    // termine él): se envejece la caducidad para no esperar.
    sql(`set session_replication_role = replica; update public.bookings set created_at = now() - interval '25 hours' where id='${p7b.bookingId}'`);
    const exp = await http(`${apiUrl}/rest/v1/rpc/expire_stale_booking_requests`, {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const tick = await http(`${functionsUrl}/booking-lifecycle-tick`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'x-lifecycle-secret': TICK_SECRET, 'Content-Type': 'application/json' }, body: '{}' });
    sql(`set session_replication_role = replica; update public.bookings set updated_at = now() - interval '30 minutes' where id='${p7b.bookingId}'`);
    const tick2 = await http(`${functionsUrl}/booking-lifecycle-tick`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'x-lifecycle-secret': TICK_SECRET, 'Content-Type': 'application/json' }, body: '{}' });
    await sleep(500);
    const i7b = await getIntent(p7b.intentId);
    record('S7b', 'Una solicitud que el profesional deja caducar (24 h) NO se cobra: el reloj libera la autorización',
      bookingRow(p7b.bookingId).status === 'expired' && i7b.status === 'canceled' && i7b.amount_received === 0,
      `reserva ${bookingRow(p7b.bookingId).status} · Stripe ${i7b.status} · caducar ${exp.status} · reloj ${tick.status}/${tick2.status} ${JSON.stringify(tick2.body).slice(0, 160)}`);
    dispose(p7b.bookingId);

    // ═══ S12 · cancela el PROFESIONAL tras aceptar → devolución íntegra + penalización ══════════════
    const c12 = await signUpTempClient('cancela-profesional');
    const p12 = await payQuote(c12, await quoteFor(c12.token));
    await decide(gardenerToken, p12.bookingId, 'accept');
    const cancel12 = await payment({ action: 'cancel_booking', bookingId: p12.bookingId, reason: 'prueba' }, gardenerToken);
    const i12 = await getIntent(p12.intentId);
    record('S12', 'El profesional cancela una reserva aceptada: el cliente recupera la comisión entera y el profesional recibe la penalización',
      cancel12.body?.moneyAction === 'refund' && i12.latest_charge?.amount_refunded === p12.cents && cancel12.body?.penaltyApplied === true
      && sql(`select count(*) from public.reviews where booking_id='${p12.bookingId}' and is_system_penalty`) === '1',
      `${JSON.stringify(cancel12.body)} · devuelto ${i12.latest_charge?.amount_refunded}/${p12.cents}`);
    dispose(p12.bookingId);

    // ═══ S6 · tarjeta rechazada, y luego una buena ═════════════════════════════════════════════════
    const c6 = await signUpTempClient('tarjeta');
    const q6 = await quoteFor(c6.token);
    const p6 = await payQuote(c6, q6, { card: 'pm_card_chargeDeclined' });
    const i6 = await getIntent(p6.intentId);
    record('S6', 'Una tarjeta RECHAZADA no crea reserva ni cobra: el pago queda pendiente de otro método',
      p6.declined && !p6.bookingId && i6.status === 'requires_payment_method' && i6.amount_received === 0 && !attemptBooking(p6.attempt.attemptId), `${p6.confirm?.body?.error?.code} · Stripe ${i6.status}`);
    const retry = await confirmIntent(p6.intentId, 'pm_card_visa');
    const i6b = await getIntent(p6.intentId);
    const hook6 = await signedWebhook(eventFor(i6b));
    const b6 = attemptBooking(p6.attempt.attemptId);
    if (b6) created.bookings.add(b6);
    record('S6b', 'Reintentar con otra tarjeta sobre el MISMO pago funciona y crea la reserva una sola vez', retry.ok && i6b.status === 'requires_capture' && i6b.amount === p6.cents && hook6.ok && Boolean(b6), `${retry.status} ${i6b.status} ${hook6.status}`);
    dispose(b6);

    // ═══ S5 · un evento manipulado (importe distinto) no crea reserva ══════════════════════════════
    const c5 = await signUpTempClient('manipulado');
    const p5 = await payQuote(c5, await quoteFor(c5.token), { webhook: false });
    const tampered = JSON.parse(JSON.stringify(p5.intent));
    tampered.amount = tampered.amount + 100;
    tampered.amount_capturable = tampered.amount;
    const hook5 = await signedWebhook(eventFor(tampered));
    record('S5', 'Un evento firmado cuyo IMPORTE no es el de la comisión firmada NO crea la reserva',
      !attemptBooking(p5.attempt.attemptId) && attemptStatus(p5.attempt.attemptId) !== 'booking_created', `${hook5.status} · intento ${attemptStatus(p5.attempt.attemptId)}`);
    const okHook = await signedWebhook(eventFor(p5.intent));
    const b5 = attemptBooking(p5.attempt.attemptId);
    if (b5) created.bookings.add(b5);
    // Un intento marcado «a conciliar» por un importe que no cuadra queda BLOQUEADO: ni siquiera el evento
    // bueno posterior lo crea (decisión conservadora: lo revisa una persona). Nunca se cobra de más ni se confirma a medias.
    record('S5b', 'Tras un importe que no cuadra, el intento queda en «conciliación» y no se confirma solo (ni con el evento bueno)', okHook.ok && !b5 && attemptStatus(p5.attempt.attemptId) === 'reconciliation_required', `${okHook.status} ${attemptStatus(p5.attempt.attemptId)}`);
    dropAttemptHolds(p5.attempt.attemptId);
    // Otra divisa en un evento firmado (USD en lugar de EUR) tampoco se acepta.
    const c5c = await signUpTempClient('divisa');
    const p5c = await payQuote(c5c, await quoteFor(c5c.token), { webhook: false });
    const usd = JSON.parse(JSON.stringify(p5c.intent));
    usd.currency = 'usd';
    await signedWebhook(eventFor(usd));
    record('S5c', 'Un evento firmado en otra DIVISA no crea la reserva', !attemptBooking(p5c.attempt.attemptId) && attemptStatus(p5c.attempt.attemptId) !== 'booking_created', `intento ${attemptStatus(p5c.attempt.attemptId)}`);
    dropAttemptHolds(p5c.attempt.attemptId);

    // ═══ S4 · el mismo presupuesto preparado dos veces: un solo PaymentIntent y un solo importe ═════
    const c4 = await signUpTempClient('doble');
    const q4 = await quoteFor(c4.token);
    const a4 = await prepare(c4.token, q4.body.quoteId);
    const a4b = await prepare(c4.token, q4.body.quoteId);
    record('S4', 'Preparar el mismo pago dos veces reutiliza el mismo PaymentIntent e importe',
      a4.body?.attempt?.paymentIntentId && a4.body.attempt.paymentIntentId === a4b.body?.attempt?.paymentIntentId && a4.body.attempt.payableNowAmountCents === a4b.body?.attempt?.payableNowAmountCents,
      `${a4.body?.attempt?.paymentIntentId} / ${a4b.body?.attempt?.paymentIntentId}`);
    dropAttemptHolds(a4.body?.attempt?.attemptId);

    // ═══ S4b · cinco peticiones simultáneas del mismo pago: un solo PaymentIntent ═════════════════════
    const c4b = await signUpTempClient('simultaneo');
    const q4b = await quoteFor(c4b.token);
    const burst = await Promise.all(Array.from({ length: 5 }, () => prepare(c4b.token, q4b.body.quoteId)));
    const intents = new Set(burst.map((r) => r.body?.attempt?.paymentIntentId).filter(Boolean));
    const attempts = new Set(burst.map((r) => r.body?.attempt?.attemptId).filter(Boolean));
    record('S4b', 'Cinco peticiones simultáneas de pago del mismo presupuesto crean UN solo intento y UN solo PaymentIntent',
      intents.size === 1 && attempts.size === 1 && burst.some((r) => r.ok),
      `${intents.size} PaymentIntent, ${attempts.size} intento, estados ${burst.map((r) => r.status).join(',')} · ${burst.filter((r) => !r.ok).map((r) => JSON.stringify(r.body).slice(0, 110)).join(' | ')}`);
    dropAttemptHolds([...attempts][0]);

    // ═══ S13 · reserva por el enlace (con su clave): 0 € → NO existe pago en Stripe ═════════════════
    const c13 = await signUpTempClient('enlace');
    const q13 = await quoteFor(c13.token, LINK);
    const p13 = await payQuote(c13, q13);
    record('S13', 'Reserva por el enlace del profesional (con su clave): 0 € y NO se crea ningún pago en Stripe',
      q13.body?.economics?.managementFee === 0 && p13.zero === true && !p13.intentId && Boolean(p13.bookingId) && bookingRow(p13.bookingId).source === 'waived_provider_link'
      && sql(`select coalesce(stripe_payment_intent_id,'') from public.booking_payment_attempts where id='${p13.attempt.attemptId}'`) === '',
      JSON.stringify(p13.attempt ?? p13.prep?.body ?? {}).slice(0, 200));
    const acc13 = await decide(gardenerToken, p13.bookingId, 'accept');
    record('S13b', 'Aceptarla no intenta cobrar nada («sin pago») y la reserva queda confirmada', acc13.fin.body?.status === 'no_payment' && bookingRow(p13.bookingId).status === 'confirmed', JSON.stringify(acc13.fin.body));
    const cancel13 = await payment({ action: 'cancel_booking', bookingId: p13.bookingId, reason: 'prueba' }, c13.token);
    record('S13c', 'Cancelarla tampoco mueve dinero', cancel13.ok && (cancel13.body?.moneyStatus === 'no_payment' || cancel13.body?.moneyAction === 'none' || !cancel13.body?.moneyAction), JSON.stringify(cancel13.body));
    dispose(p13.bookingId);

    // ═══ S13d · cambiar la clave con un presupuesto del enlace YA firmado: ese presupuesto se respeta ════
    const c13d = await signUpTempClient('rotacion');
    const q13d = await quoteFor(c13d.token, LINK);
    const rot = await rpc('rotate_my_booking_link', {}, gardenerToken);
    LINK.originLinkCode = rot.body?.code;
    const p13d = await payQuote(c13d, q13d);
    dispose(p13d.bookingId);
    // (Un cliente NUEVO: el que ya reservó por el enlace conserva su origen, que se fija en la primera reserva.)
    const c13e = await signUpTempClient('rotacion-2');
    const q13e = await quoteFor(c13e.token, { bookingOrigin: 'provider_link', originProviderId: PROVIDER_ID, originLinkCode: myLink.body?.code });
    record('S13d', 'Cambiar la clave del enlace: el presupuesto ya firmado se respeta (0 €), pero con la clave ANTIGUA ya no se firma ninguno nuevo exento',
      q13d.body?.economics?.managementFee === 0 && p13d.zero === true && Boolean(p13d.bookingId) && q13e.body?.economics?.managementFee > 0 && q13e.body.economics.commission.linkClaim === 'rejected',
      `firmado ${q13d.body?.economics?.managementFee} · nuevo con clave vieja ${q13e.status} ${q13e.body?.economics?.managementFee} ${q13e.body?.economics?.commission?.linkClaim}`);

    // ═══ S14 · la clave falsa del enlace SÍ paga, con Stripe de verdad ═══════════════════════════════
    const c14 = await signUpTempClient('clave-falsa');
    const q14 = await quoteFor(c14.token, { bookingOrigin: 'provider_link', originProviderId: PROVIDER_ID, originLinkCode: '1'.repeat(32) });
    const p14 = await payQuote(c14, q14);
    record('S14', 'Un enlace con clave falsa paga la comisión de GarSer (12,5 %) en Stripe de verdad',
      q14.body?.economics?.commission?.linkClaim === 'rejected' && p14.intent?.amount === expectedFeeCents(q14.body.economics.commission.baseAmount, 12.5) && p14.intent?.status === 'requires_capture',
      `${JSON.stringify(q14.body?.economics?.commission?.linkClaim)} · Stripe ${p14.intent?.amount}`);
    dispose(p14.bookingId);

    // ═══ S15 · suelo de 0,50 € y 100 % con Stripe de verdad ═════════════════════════════════════════
    setRates([0.01, 0, 3, 3, 0]);
    const c15 = await signUpTempClient('suelo');
    const q15 = await quoteFor(c15.token);
    const p15 = await payQuote(c15, q15);
    await decide(gardenerToken, p15.bookingId, 'accept');
    const i15 = await getIntent(p15.intentId);
    record('S15', 'Comisión calculada por debajo de 0,50 €: Stripe autoriza y cobra 0,50 € (su mínimo) y la reserva lo anota',
      p15.cents === 50 && i15.amount_received === 50 && q15.body.economics.commission.adjustment === 'minimum_charge' && bookingRow(p15.bookingId).fee === 0.5, `${p15.cents} / cobrado ${i15.amount_received}`);
    dispose(p15.bookingId);
    setRates([100, 0, 3, 3, 0]);
    const c15b = await signUpTempClient('cien');
    const q15b = await quoteFor(c15b.token);
    const p15b = await payQuote(c15b, q15b);
    await decide(gardenerToken, p15b.bookingId, 'accept');
    const i15b = await getIntent(p15b.intentId);
    record('S15b', 'Comisión del 100 %: Stripe cobra el precio entero del servicio (y la reserva lo guarda)',
      p15b.cents === Math.round(q15b.body.economics.commission.baseAmount * 100) && i15b.amount_received === p15b.cents && i15b.status === 'succeeded', `${p15b.cents} / cobrado ${i15b.amount_received}`);
    dispose(p15b.bookingId);
    setRates(FACTORY);

    // ═══ S16 · decimales: cada porcentaje cobra lo que dice un cálculo independiente ═════════════════
    const grid = [0, 0.01, 0.05, 0.5, 1, 2.5, 3, 3.33, 5, 7.77, 10, 12.34, 12.5, 12.51, 15, 20, 33.33, 50, 66.67, 99.99, 100];
    const cg = await signUpTempClient('rejilla');
    const wrong = [];
    for (const percent of grid) {
      setRates([percent, 0, 3, 3, 0]);
      const qg = await quoteFor(cg.token);
      const e = qg.body?.economics;
      const expected = expectedFeeCents(e?.commission?.baseAmount, percent);
      const got = Math.round((e?.managementFee ?? -1) * 100);
      const coherent = e?.payableNow === e?.managementFee && (got === 0 ? Boolean(e?.feeWaiver) : !e?.feeWaiver);
      if (got !== expected || !coherent) wrong.push(`${percent} % → ${got} (esperado ${expected})`);
    }
    setRates(FACTORY);
    record('S16', `${grid.length} porcentajes con decimales (0 % a 100 %) cobran lo que dice un cálculo independiente (céntimos, mitad hacia arriba, suelo 0,50 €)`, wrong.length === 0, wrong.join(' | '));

    // ═══ S17 · cambiar los ajustes con un pago en curso: manda lo FIRMADO ═══════════════════════════
    const c17 = await signUpTempClient('en-curso');
    const q17 = await quoteFor(c17.token);
    const fee17 = q17.body.economics.managementFee;
    setRates([40, 0, 3, 3, 0]);
    const p17 = await payQuote(c17, q17);
    await decide(gardenerToken, p17.bookingId, 'accept');
    const i17 = await getIntent(p17.intentId);
    record('S17', 'Cambiar la comisión (12,5 → 40 %) con un presupuesto ya firmado: Stripe cobra lo firmado (12,5 %), no lo nuevo',
      p17.cents === Math.round(fee17 * 100) && i17.amount_received === Math.round(fee17 * 100) && bookingRow(p17.bookingId).bps === 1250, `firmado ${fee17}, Stripe ${i17.amount_received}`);
    dispose(p17.bookingId);
    const c17n = await signUpTempClient('en-curso-nuevo');
    const q17n = await quoteFor(c17n.token);
    record('S17b', 'Y un presupuesto nuevo, ya con el 40 %', q17n.body?.economics?.commission?.rateBps === 4000 && q17n.body.economics.managementFee > fee17, `${q17n.status} ${q17n.body?.economics?.managementFee ?? JSON.stringify(q17n.body).slice(0, 120)}`);
    setRates(FACTORY);

    // ═══ S18 · cambio de precio del profesional: la comisión ya pagada no cambia ════════════════════
    const c18 = await signUpTempClient('cambio-precio');
    const p18 = await payQuote(c18, await quoteFor(c18.token));
    const base18 = bookingRow(p18.bookingId);
    const prop = await rpc('propose_booking_price_change', { p_booking_id: p18.bookingId, p_proposed_total_price: base18.base + 20, p_reason: 'Medidas reales verificadas en el jardín' }, gardenerToken);
    const resp = await rpc('respond_booking_price_change', { p_booking_id: p18.bookingId, p_accept: true }, c18.token);
    const fin18 = await payment({ action: 'finalize_price_change_payment', bookingId: p18.bookingId }, c18.token);
    const i18 = await getIntent(p18.intentId);
    record('S18', 'El cliente ACEPTA un nuevo precio: la reserva se confirma y se cobra la MISMA comisión que se autorizó (no se recalcula)',
      prop.ok && resp.ok && fin18.body?.status === 'captured' && i18.amount_received === p18.cents && bookingRow(p18.bookingId).fee === base18.fee && bookingRow(p18.bookingId).status === 'confirmed',
      `${prop.status}/${resp.status} ${JSON.stringify(fin18.body)} · cobrado ${i18.amount_received}/${p18.cents}`);
    dispose(p18.bookingId);
    const c18b = await signUpTempClient('cambio-precio-no');
    const p18b = await payQuote(c18b, await quoteFor(c18b.token));
    const base18b = bookingRow(p18b.bookingId);
    await rpc('propose_booking_price_change', { p_booking_id: p18b.bookingId, p_proposed_total_price: base18b.base + 20, p_reason: 'Medidas reales verificadas en el jardín' }, gardenerToken);
    await rpc('respond_booking_price_change', { p_booking_id: p18b.bookingId, p_accept: false }, c18b.token);
    const fin18b = await payment({ action: 'finalize_price_change_payment', bookingId: p18b.bookingId }, c18b.token);
    const i18b = await getIntent(p18b.intentId);
    record('S18b', 'El cliente RECHAZA un nuevo precio: la reserva se cancela y NO se cobra nada («no se cobran los gastos de gestión»)',
      fin18b.body?.status === 'released' && i18b.status === 'canceled' && i18b.amount_received === 0 && bookingRow(p18b.bookingId).status === 'cancelled', `${JSON.stringify(fin18b.body)} · Stripe ${i18b.status}`);
    dispose(p18b.bookingId);

    // ═══ S19 · visita de un plan de mantenimiento: 3 % también para un cliente del enlace ═════════════
    const c19 = await signUpTempClient('plan');
    const q19 = await quoteFor(c19.token, LINK);
    const p19 = await payQuote(c19, q19);
    await decide(gardenerToken, p19.bookingId, 'accept');
    sql(`set session_replication_role = replica; update public.bookings set status = 'completed' where id = '${p19.bookingId}'`);
    const plan = await rpc('create_maintenance_plan', { p_booking_id: p19.bookingId, p_frequency: 'weekly' }, c19.token);
    const planId = plan.body?.planId;
    let visitOk = false; let visitDetail = JSON.stringify(plan.body).slice(0, 160);
    if (planId) {
      created.plans.add(planId);
      sql(`update public.maintenance_plans set next_visit_date = current_date + 3 where id='${planId}'`);
      sql('select public.generate_maintenance_proposals()');
      const visitQuote = sql(`select q.id from public.maintenance_visits v join public.booking_quotes q on q.id = v.quote_id where v.plan_id='${planId}' and v.status='proposed' limit 1`);
      if (visitQuote) {
        created.quotes.add(visitQuote);
        const econ = JSON.parse(sql(`select economic_snapshot::text from public.booking_quotes where id='${visitQuote}'`));
        const pv = await payQuote(c19, { body: { quoteId: visitQuote } });
        if (pv.bookingId) await decide(gardenerToken, pv.bookingId, 'accept');
        const iv = pv.intentId ? await getIntent(pv.intentId) : null;
        visitOk = econ.commission?.rule === 'maintenance_visit' && econ.commission?.origin === 'provider_link' && pv.cents === Math.round(econ.managementFee * 100) && iv?.amount_received === pv.cents && iv?.status === 'succeeded';
        visitDetail = `${econ.commission?.rule}/${econ.commission?.origin} · Stripe ${iv?.amount_received}/${pv.cents}`;
        dispose(pv.bookingId);
      } else visitDetail = 'el generador no propuso visita';
    }
    record('S19', 'La visita de un plan de un cliente del enlace paga la regla del plan (3 %): Stripe autoriza y cobra ese importe', visitOk, visitDetail);
    dispose(p19.bookingId);

    // ═══ S20 · todo a 0 %: ningún pago en Stripe para nadie ════════════════════════════════════════════
    setRates([0, 0, 0, 0, 0]);
    const c20 = await signUpTempClient('todo-cero');
    const q20 = await quoteFor(c20.token);
    const p20 = await payQuote(c20, q20);
    record('S20', 'Todas las comisiones a 0 %: ni siquiera un cliente de GarSer paga; no se crea ningún pago en Stripe',
      q20.body?.economics?.managementFee === 0 && q20.body.economics.feeWaiver?.reason === 'zero_commission' && p20.zero === true && Boolean(p20.bookingId), `${q20.body?.economics?.feeWaiver?.reason} ${p20.zero}`);
    dispose(p20.bookingId);
    setRates(FACTORY);

    // ═══ S21 · sin configuración: nada se cobra ni se firma ═══════════════════════════════════════════
    const c21 = await signUpTempClient('sin-config');
    const q21 = await quoteFor(c21.token);
    const saved = sql(`select version, ${COLUMNS.join(', ')}, created_at from public.commission_settings where id = 1`).split('|');
    let prep21; let q21b;
    try {
      sql('alter table public.commission_settings disable trigger trg_commission_settings_no_delete');
      sql('delete from public.commission_settings');
      q21b = await quoteFor(c21.token);
      prep21 = await prepare(c21.token, q21.body.quoteId);
    } finally {
      sql('alter table public.commission_settings disable trigger trg_commission_settings_versioning');
      sql(`insert into public.commission_settings (id, version, ${COLUMNS.join(', ')}, created_at) values (1, ${saved[0]}, ${saved.slice(1, 6).join(', ')}, '${saved[6]}')`);
      sql('alter table public.commission_settings enable trigger trg_commission_settings_versioning');
      sql('alter table public.commission_settings enable trigger trg_commission_settings_no_delete');
    }
    const signedAmount = Math.round(q21.body.economics.managementFee * 100);
    record('S21', 'Sin configuración: no se firma ningún presupuesto nuevo (503) y un pago ya firmado o bien se bloquea o bien cobra EXACTAMENTE lo firmado',
      q21b.status === 503 && (prep21.status >= 500 || prep21.body?.attempt?.payableNowAmountCents === signedAmount), `nuevo ${q21b.status} · preparar ${prep21.status} ${prep21.body?.attempt?.payableNowAmountCents}`);
    if (prep21.body?.attempt?.paymentIntentId) {
      await stripe(`/v1/payment_intents/${prep21.body.attempt.paymentIntentId}/cancel`, { method: 'POST', form: {} });
    }
  } finally {
    await cleanup(configBefore);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
  process.exit(failed.length ? 1 : 0);
}

async function cleanup(configBefore) {
  try {
    setRates(configBefore);
    // Autorizaciones que hayan quedado abiertas en Stripe (modo prueba): se cancelan para no dejar basura.
    for (const intentId of created.intents) {
      const intent = await getIntent(intentId);
      if (['requires_capture', 'requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
        await stripe(`/v1/payment_intents/${intentId}/cancel`, { method: 'POST', form: {} });
      }
    }
    if (created.plans.size) {
      sql(`delete from public.maintenance_visits where plan_id in (${ids(created.plans)})`);
      sql(`delete from public.maintenance_plans where id in (${ids(created.plans)})`);
    }
    const quoteBookings = created.quotes.size
      ? sql(`select coalesce(string_agg(id::text, ','), '') from public.bookings where pricing_context->>'quote_id' in (${ids(created.quotes)})`)
      : '';
    quoteBookings.split(',').filter(Boolean).forEach((id) => created.bookings.add(id));
    if (created.bookings.size) {
      for (const id of created.bookings) sql(`select public.release_booking_schedule('${id}')`);
      sql(`set session_replication_role = replica; delete from public.reviews where booking_id in (${ids(created.bookings)}); delete from public.bookings where id in (${ids(created.bookings)})`);
    }
    if (created.quotes.size) {
      const attemptIds = sql(`select coalesce(string_agg(id::text, ','), '') from public.booking_payment_attempts where quote_id in (${ids(created.quotes)})`);
      attemptIds.split(',').filter(Boolean).forEach((id) => created.attempts.add(id));
    }
    if (created.attempts.size) {
      sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)}))`);
      sql(`delete from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)})`);
      sql(`delete from public.booking_payment_attempts where id in (${ids(created.attempts)})`);
    }
    if (created.quotes.size) sql(`delete from public.booking_quotes where id in (${ids(created.quotes)})`);
    if (created.users.size) sql(`delete from auth.users where id in (${ids(created.users)})`);
    console.log(`\nLimpieza hecha: configuración vuelta a ${configBefore.join(' / ')} % (la versión sube: el historial no se borra); autorizaciones abiertas en Stripe canceladas; ${created.users.size} clientes de prueba borrados.`);
  } catch (error) {
    console.error('Limpieza incompleta:', error.message);
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanup(readConfig());
  process.exit(1);
});
