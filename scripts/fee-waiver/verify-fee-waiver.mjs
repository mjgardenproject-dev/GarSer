// Lanzamiento (2026-10): verificación de punta a punta de «sin gastos de gestión para los clientes
// propios» contra el entorno LOCAL, por los caminos reales (booking-authority, booking-payment y las
// RPC), con Stripe en modo TEST.
//
//   supabase functions serve --workdir "$(pwd)"   # en otra terminal
//   node scripts/fee-waiver/verify-fee-waiver.mjs
//
// Escenarios (ver docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md, sección 24):
//   A  cliente nuevo desde el marketplace → 12,5 %, PaymentIntent de Stripe (sin cambios)
//   B  enlace del profesional → 0 €, sin Stripe, reserva waived_provider_link; aceptar → no_payment
//   C  cliente que repite (reserva completada) → waived_returning_client
//   D  interruptor apagado → el enlace paga
//   E  web antigua (sin declarar la capacidad) → paga
//   T  origen «enlace» de OTRO profesional → paga
//   F  visita de un plan → waived_maintenance_plan; el plan guarda la economía completa
//   G  cancelar una reserva exenta → sin Stripe
//   H  cambio de precio en una reserva exenta → sin Stripe
//   I  doble envío → una sola reserva
//
// Deja el interruptor como estaba y borra todo lo que crea.

import { randomUUID } from 'node:crypto';
import {
  env, sql, signIn, PROVIDER_ID, GARDENER_EMAIL,
} from '../readiness/_harness.mjs';

const { apiUrl, functionsUrl, anonKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea y borra reservas.`);
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
const CAPS = { clientCapabilities: { feeWaiver: 1 } };
const LINK = { bookingOrigin: 'provider_link', originProviderId: PROVIDER_ID };

const created = { bookings: new Set(), attempts: new Set(), quotes: new Set(), plans: new Set(), users: new Set() };
const results = [];
const record = (id, description, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
};
const ids = (set) => [...set].map((id) => `'${id}'`).join(',');

async function callFunction(name, body, token) {
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, body: data };
}
const authority = (body, token) => callFunction('booking-authority', body, token);
const payment = (body, token) => callFunction('booking-payment', body, token);
async function rpc(fn, args, token) {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, body: data };
}

async function signUpTempClient() {
  const email = `cliente-sin-gastos-${Date.now()}@fee-waiver.local`;
  const res = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role: 'client', full_name: 'Cliente sin gastos' } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id || !body.access_token) throw new Error(`No se pudo crear el cliente de prueba: ${JSON.stringify(body).slice(0, 160)}`);
  created.users.add(id);
  return { id, token: body.access_token };
}

const setFlag = (on) => sql(`update public.app_settings set own_clients_fee_waiver_enabled = ${on ? 'true' : 'false'} where id = 1`);

function pickSlots() {
  // Un día con muchas horas libres; cada escenario usa una hora distinta para no pisarse.
  const date = sql(`select date::text from public.availability
    where gardener_id='${PROVIDER_ID}' and date >= current_date + 3
    group by date having count(*) filter (where is_available) >= 10
    order by date limit 1`);
  if (!date) throw new Error('No hay ningún día con 10+ horas libres a partir de dentro de 3 días.');
  return date;
}

async function quoteFor({ token, date, hour, extra = {} }) {
  const q = await authority({
    action: 'create_quote', serviceId: LAWN, providerId: PROVIDER_ID, date,
    startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: INPUT, ...extra,
  }, token);
  if (q.body?.quoteId) created.quotes.add(q.body.quoteId);
  return q;
}

async function prepare(token, quoteId) {
  const res = await payment({ action: 'prepare_payment', quoteId }, token);
  const attempt = res.body?.attempt;
  if (attempt?.attemptId) created.attempts.add(attempt.attemptId);
  if (attempt?.bookingId) created.bookings.add(attempt.bookingId);
  return res;
}

const bookingRow = (id) => {
  const row = sql(`select management_fee, management_fee_source, status, coalesce(pricing_context->>'payment_gateway_source','') from public.bookings where id='${id}'`);
  const [fee, source, status, gateway] = row.split('|');
  return { fee: Number(fee), source, status, gateway };
};

async function main() {
  const flagBefore = sql('select own_clients_fee_waiver_enabled from public.app_settings where id = 1') === 't';
  console.log(`Interruptor antes: ${flagBefore ? 'encendido' : 'apagado'} (se restaura al final)\n`);
  try {
    const gardenerToken = await signIn(GARDENER_EMAIL);
    const client = await signUpTempClient();
    const date = pickSlots();
    const vh = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: PROVIDER_ID, date, bookingInput: INPUT });
    const hours = vh.body?.validHours ?? [];
    if (hours.length < 5) throw new Error(`El ${date} no tiene 5 horas válidas: ${JSON.stringify(hours)}`);
    const [hA, hB1, hB2] = [hours[0], hours[2], hours[4]];
    console.log(`Día de prueba ${date}; horas ${hours.join(',')}\n`);

    // ── D · interruptor apagado: el enlace paga ─────────────────────────────────────
    setFlag(false);
    const dPreview = await authority({ action: 'preview_providers', serviceId: LAWN, providerIds: [PROVIDER_ID], selectedDate: date, bookingInput: INPUT, ...CAPS, ...LINK });
    const dEcon = dPreview.body?.quotes?.[PROVIDER_ID]?.economics;
    record('D1', 'Interruptor apagado: «Profesionales» por el enlace lleva gastos', dEcon?.managementFee > 0 && !dEcon?.feeWaiver, `gestión ${dEcon?.managementFee}`);
    const dQuote = await quoteFor({ token: client.token, date, hour: hA, extra: { ...CAPS, ...LINK } });
    record('D2', 'Interruptor apagado: el presupuesto firmado por el enlace lleva gastos', dQuote.body?.economics?.managementFee > 0 && !dQuote.body?.economics?.feeWaiver, `status ${dQuote.status}`);

    // ── A · cliente nuevo desde el marketplace: 12,5 % y Stripe, como siempre ──────
    setFlag(true);
    const aQuote = await quoteFor({ token: client.token, date, hour: hA, extra: CAPS });
    const aFee = aQuote.body?.economics?.managementFee;
    record('A1', 'Cliente nuevo (marketplace): el presupuesto lleva el 12,5 %', aFee > 0 && Math.abs(aFee - aQuote.body.totalPrice * 0.125) < 0.011 && !aQuote.body?.economics?.feeWaiver, `gestión ${aFee} sobre ${aQuote.body?.totalPrice}`);
    const aPrep = await prepare(client.token, aQuote.body?.quoteId);
    const aAttempt = aPrep.body?.attempt;
    record('A2', 'Cliente nuevo: prepara un cobro de Stripe por la comisión', aPrep.ok && aAttempt?.status === 'payment_pending' && Boolean(aPrep.body?.clientSecret) && aAttempt?.payableNowAmountCents === Math.round(aFee * 100),
      `estado ${aAttempt?.status}, ${aAttempt?.payableNowAmountCents} cént.${aPrep.ok ? '' : ` (${JSON.stringify(aPrep.body).slice(0, 140)})`}`);
    // A3: el webhook de Stripe confirma el cobro (se simula su llamada, como verify-f1-schedule):
    // la reserva queda con la comisión cobrada y la pasarela de Stripe, igual que antes.
    if (aAttempt?.attemptId && aAttempt?.paymentIntentId) {
      const conf = JSON.parse(sql(`select public.confirm_booking_payment_attempt('${aAttempt.attemptId}', 'evt_fee_waiver_${randomUUID()}', '${aAttempt.paymentIntentId}', ${aAttempt.payableNowAmountCents}, 'eur', '{}'::jsonb)::text`));
      if (conf.bookingId) created.bookings.add(conf.bookingId);
      const row = conf.bookingId ? bookingRow(conf.bookingId) : null;
      record('A3', 'Cliente nuevo: tras el pago, la reserva lleva su comisión y la pasarela de Stripe', Boolean(row) && row.fee === aFee && row.source === 'payment_attempt' && row.gateway === 'stripe_elements', JSON.stringify(row));
    } else if (aAttempt?.attemptId) {
      await payment({ action: 'cancel_attempt', attemptId: aAttempt.attemptId }, client.token);
    }

    // ── E · web antigua (sin la capacidad): paga aunque venga del enlace ───────────
    // E y T solo piden presupuesto (no reservan): una hora libre que no use nadie.
    const hQuoteOnly = hours[hours.length - 1];
    const eQuote = await quoteFor({ token: client.token, date, hour: hQuoteOnly, extra: { ...LINK } });
    record('E1', 'Web antigua sin la capacidad declarada: el enlace paga (no se atasca en 0 €)', eQuote.body?.economics?.managementFee > 0 && !eQuote.body?.economics?.feeWaiver);

    // ── T · origen «enlace» de OTRO profesional ────────────────────────────────────
    const tQuote = await quoteFor({ token: client.token, date, hour: hQuoteOnly, extra: { ...CAPS, bookingOrigin: 'provider_link', originProviderId: randomUUID() } });
    record('T1', 'El enlace de otro profesional no exime con este', tQuote.body?.economics?.managementFee > 0 && !tQuote.body?.economics?.feeWaiver);

    // ── B · por el enlace del profesional: 0 €, sin Stripe ─────────────────────────
    const bPreview = await authority({ action: 'preview_providers', serviceId: LAWN, providerIds: [PROVIDER_ID], selectedDate: date, bookingInput: INPUT, ...CAPS, ...LINK });
    const bPrevEcon = bPreview.body?.quotes?.[PROVIDER_ID]?.economics;
    record('B1', '«Profesionales» por el enlace ya sale sin gastos', bPrevEcon?.managementFee === 0 && bPrevEcon?.feeWaiver?.reason === 'provider_link');
    const bQuote = await quoteFor({ token: client.token, date, hour: hB1, extra: { ...CAPS, ...LINK } });
    const bEcon = bQuote.body?.economics;
    record('B2', 'El presupuesto firmado por el enlace va sin gastos', bEcon?.managementFee === 0 && bEcon?.payableNow === 0 && bEcon?.feeWaiver?.reason === 'provider_link' && bEcon?.feeWaiver?.waivedFee > 0,
      `perdonados ${bEcon?.feeWaiver?.waivedFee}`);
    const bPrep = await prepare(client.token, bQuote.body?.quoteId);
    const bAttempt = bPrep.body?.attempt;
    record('B3', 'Confirmar sin pago crea la reserva YA, sin Stripe', bPrep.ok && bAttempt?.status === 'booking_created' && !bPrep.body?.clientSecret && !bAttempt?.paymentIntentId && Boolean(bAttempt?.bookingId),
      `estado ${bAttempt?.status}${bPrep.ok ? '' : ` (${JSON.stringify(bPrep.body).slice(0, 160)})`}`);
    const bBooking = bAttempt?.bookingId;
    if (bBooking) {
      const row = bookingRow(bBooking);
      record('B4', 'La reserva queda con comisión 0, fuente waived_provider_link y sin pasarela', row.fee === 0 && row.source === 'waived_provider_link' && row.gateway === 'none' && row.status === 'pending', JSON.stringify(row));
      // ── I · doble envío ──
      const again = await prepare(client.token, bQuote.body?.quoteId);
      const count = sql(`select count(*) from public.bookings where pricing_context->>'quote_id'='${bQuote.body.quoteId}'`);
      record('I1', 'Un doble envío no duplica la reserva', again.body?.attempt?.bookingId === bBooking && count === '1', `reservas del presupuesto: ${count}; 2.ª llamada → ${again.status} ${JSON.stringify(again.body).slice(0, 220)}`);
      // Aceptar y finalizar: no hay nada que capturar.
      const acc = await rpc('respond_booking_request', { p_booking_id: bBooking, p_response: 'accept', p_operation_id: randomUUID() }, gardenerToken);
      const fin = await payment({ action: 'finalize_booking_payment', bookingId: bBooking, decision: 'accept' }, gardenerToken);
      record('B5', 'El jardinero acepta y finalizar no toca Stripe (no_payment)', acc.ok && fin.body?.status === 'no_payment' && bookingRow(bBooking).status === 'confirmed', `finalize ${JSON.stringify(fin.body).slice(0, 100)}`);
    }

    // ── G/H · cambio de precio y cancelación en una reserva exenta ────────────────
    const gQuote = await quoteFor({ token: client.token, date, hour: hB2, extra: { ...CAPS, ...LINK } });
    const gPrep = await prepare(client.token, gQuote.body?.quoteId);
    const gBooking = gPrep.body?.attempt?.bookingId;
    if (gBooking) {
      const price = Number(sql(`select total_price from public.bookings where id='${gBooking}'`));
      const prop = await rpc('propose_booking_price_change', { p_booking_id: gBooking, p_proposed_total_price: price + 10, p_reason: 'Prueba sin gastos', p_operation_id: randomUUID(), p_expires_in_minutes: 60 }, gardenerToken);
      const resp = await rpc('respond_booking_price_change', { p_booking_id: gBooking, p_accept: true, p_operation_id: randomUUID() }, client.token);
      const finPc = await payment({ action: 'finalize_price_change_payment', bookingId: gBooking }, client.token);
      const afterPc = bookingRow(gBooking);
      record('H1', 'Cambio de precio aceptado en una exenta: sin Stripe y la comisión sigue en 0', prop.ok && resp.ok && finPc.body?.status === 'no_payment' && afterPc.fee === 0 && afterPc.source === 'waived_provider_link',
        `${prop.ok ? '' : `propuesta ${JSON.stringify(prop.body).slice(0, 100)}`} finalize ${JSON.stringify(finPc.body).slice(0, 80)}`);
      const cancel = await payment({ action: 'cancel_booking', bookingId: gBooking, reason: 'Prueba sin gastos' }, client.token);
      record('G1', 'Cancelar una reserva exenta no toca Stripe', cancel.ok && bookingRow(gBooking).status === 'cancelled' && JSON.stringify(cancel.body).includes('no_payment'),
        JSON.stringify(cancel.body).slice(0, 140));
    } else {
      record('G0', 'Reserva exenta para cambio de precio y cancelación', false, JSON.stringify(gPrep.body).slice(0, 160));
    }

    // ── C · cliente que repite ─────────────────────────────────────────────────────
    if (bBooking) {
      sql(`update public.bookings set status = 'completed' where id = '${bBooking}'`);
      const cHour = hours.find((h) => h > hB2 + 2) ?? hours[hours.length - 1];
      const cQuote = await quoteFor({ token: client.token, date, hour: cHour, extra: CAPS });
      const cEcon = cQuote.body?.economics;
      record('C1', 'Cliente con una reserva completada (desde el marketplace): sin gastos', cEcon?.managementFee === 0 && cEcon?.feeWaiver?.reason === 'returning_client', `status ${cQuote.status}`);
      const cPrep = await prepare(client.token, cQuote.body?.quoteId);
      const cBooking = cPrep.body?.attempt?.bookingId;
      record('C2', 'Su reserva queda como waived_returning_client', Boolean(cBooking) && bookingRow(cBooking).source === 'waived_returning_client', cBooking ? JSON.stringify(bookingRow(cBooking)) : JSON.stringify(cPrep.body).slice(0, 140));

      // ── F · plan de mantenimiento ────────────────────────────────────────────────
      const plan = await rpc('create_maintenance_plan', { p_booking_id: bBooking, p_frequency: 'weekly' }, client.token);
      const planId = plan.body?.planId;
      if (planId) {
        created.plans.add(planId);
        const planFee = Number(sql(`select economic_snapshot->>'managementFee' from public.maintenance_plans where id='${planId}'`));
        const planWaiver = sql(`select coalesce((economic_snapshot->'feeWaiver')::text, '') from public.maintenance_plans where id='${planId}'`);
        record('F1', 'El plan guarda la economía COMPLETA aunque nazca de una reserva exenta', planFee > 0 && planWaiver === '', `gestión del plan ${planFee}`);
        sql(`update public.maintenance_plans set next_visit_date = current_date + 3 where id='${planId}'`);
        sql('select public.generate_maintenance_proposals()');
        const visitQuote = sql(`select q.id from public.maintenance_visits v join public.booking_quotes q on q.id = v.quote_id where v.plan_id='${planId}' and v.status='proposed' limit 1`);
        if (visitQuote) {
          created.quotes.add(visitQuote);
          const vEcon = JSON.parse(sql(`select economic_snapshot::text from public.booking_quotes where id='${visitQuote}'`));
          const intact = sql(`select public.maintenance_quote_is_intact('${visitQuote}')`);
          record('F2', 'La propuesta de visita va sin gastos (maintenance_plan) y sigue «intacta»', vEcon.managementFee === 0 && vEcon.feeWaiver?.reason === 'maintenance_plan' && intact === 't');
          const fPrep = await prepare(client.token, visitQuote);
          const fBooking = fPrep.body?.attempt?.bookingId;
          record('F3', 'Confirmar la visita crea la reserva sin Stripe (waived_maintenance_plan)', Boolean(fBooking) && bookingRow(fBooking).source === 'waived_maintenance_plan', fBooking ? '' : JSON.stringify(fPrep.body).slice(0, 160));
        } else {
          record('F2', 'Propuesta de visita del plan', false, 'el generador no propuso visita (¿sin hueco esa semana?)');
        }
      } else {
        record('F0', 'Crear un plan desde la reserva completada', false, JSON.stringify(plan.body).slice(0, 160));
      }
    }
  } finally {
    cleanup(flagBefore);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
  process.exit(failed.length ? 1 : 0);
}

function cleanup(flagBefore) {
  try {
    setFlag(flagBefore);
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
      sql(`delete from public.bookings where id in (${ids(created.bookings)})`);
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
    console.log(`\nLimpieza hecha: interruptor ${flagBefore ? 'encendido' : 'apagado'} otra vez; ${created.bookings.size} reservas y ${created.quotes.size} presupuestos de prueba borrados.`);
  } catch (error) {
    console.error('Limpieza incompleta:', error.message);
  }
}

main().catch((error) => {
  console.error('ERROR', error);
  process.exit(1);
});
