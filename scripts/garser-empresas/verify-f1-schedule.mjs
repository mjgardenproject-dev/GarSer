#!/usr/bin/env node
// GarSer Empresas · F1 — verificación del registro de capacidad contra el Supabase LOCAL.
//
// Recorre los caminos REALES que escriben la agenda (booking_blocks), con las funciones de
// verdad y el motor de presupuestos de verdad (booking-authority):
//
//   pago       create_quote → prepare_booking_payment_attempt_for_client →
//              confirm_booking_payment_attempt (lo que hace el webhook de Stripe)
//   aceptar    respond_booking_request('accept')        → reserve_booking_schedule
//   alargar    propose/respond_booking_price_change      → resize_booking_schedule
//   cancelar   cancel_booking                            → release_booking_schedule
//
// y comprueba lo que dice docs/garser-empresas/03-PRUEBAS.md (F1-01 … F1-08, R-05, R-06):
// que cada hora vendida sabe QUIÉN la trabaja, y que la misma hora de la misma persona no
// se puede vender dos veces ni aunque la disponibilidad esté desincronizada.
//
// Uso:    node scripts/garser-empresas/verify-f1-schedule.mjs
// Salida: una línea por prueba; código 1 si alguna falla.
// Deshace todo lo que crea (reservas, intentos de pago, retenciones, presupuestos) y deja la
// disponibilidad como estaba. Solo corre contra 127.0.0.1.

import { randomUUID } from 'node:crypto';
import {
  createQuote, validHours, signIn, sql, env,
  PROVIDER_ID, CLIENT_EMAIL, GARDENER_EMAIL,
} from '../readiness/_harness.mjs';

const { apiUrl, anonKey, serviceRoleKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea y borra reservas.`);
  process.exit(2);
}

const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const INPUT = {
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};

const results = [];
const created = { bookings: new Set(), attempts: new Set(), quotes: new Set(), users: new Set() };
// Filas de availability_blocks del día de prueba, retiradas durante la prueba y repuestas al final.
let mirrorBackup = null;

function record(id, description, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
}

async function rpc(fn, args, token) {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: token ? anonKey : serviceRoleKey,
      Authorization: `Bearer ${token ?? serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

const hasAssignee = () =>
  sql("select count(*) from information_schema.columns where table_schema='public' and table_name='booking_blocks' and column_name='assignee_id'") === '1';

const blocksOf = (bookingId) =>
  sql(`select coalesce(string_agg(hour_block::text, ',' order by hour_block), '') from public.booking_blocks where booking_id='${bookingId}'`);

const assigneesOf = (bookingId) =>
  hasAssignee()
    ? sql(`select coalesce(string_agg(distinct coalesce(assignee_id::text, 'NULL'), ','), '') from public.booking_blocks where booking_id='${bookingId}'`)
    : '(no existe la columna assignee_id)';

const busyHours = (date) =>
  sql(`select coalesce(string_agg(extract(hour from start_time)::int::text, ',' order by start_time), '')
       from public.availability where gardener_id='${PROVIDER_ID}' and date='${date}' and not is_available`);

// Misma persona, misma hora, más de una reserva viva. Antes de F1 la persona se deduce de
// bookings.gardener_id; después, es assignee_id. Se miran las dos cosas.
const doubleBookedHours = () =>
  sql(`select count(*) from (
         select b.gardener_id, bb.date, bb.hour_block
         from public.booking_blocks bb join public.bookings b on b.id = bb.booking_id
         group by 1, 2, 3 having count(*) > 1) d`);

async function payBooking(date, startHour, clientToken, clientEmail = CLIENT_EMAIL) {
  const startTime = `${String(startHour).padStart(2, '0')}:00`;
  const q = await createQuote(LAWN, INPUT, { date, startTime, accessToken: clientToken });
  const quoteId = q.body?.quoteId ?? q.body?.quote?.quoteId ?? q.body?.quote?.id;
  if (!q.ok || !quoteId) return { error: `create_quote ${q.status}: ${JSON.stringify(q.body).slice(0, 160)}` };
  created.quotes.add(quoteId);

  const clientId = sql(`select id from auth.users where email='${clientEmail}'`);
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: clientId, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}: ${JSON.stringify(prep.body).slice(0, 160)}` };
  created.attempts.add(prep.body.attemptId);

  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId,
    p_stripe_event_id: `evt_f1_${randomUUID()}`,
    p_stripe_payment_intent_id: `pi_f1_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents,
    p_currency: 'eur',
    p_gateway_payload: {},
  });
  const bookingId = conf.body?.bookingId ?? null;
  if (bookingId) created.bookings.add(bookingId);
  return { bookingId, attemptId: prep.body.attemptId, confirm: conf };
}

function pickDate() {
  const date = sql(`select date::text from public.availability
    where gardener_id='${PROVIDER_ID}' and date >= current_date + 3
    group by date having count(*) filter (where is_available) >= 10
    order by date limit 1`);
  if (!date) throw new Error('No hay ningún día con 10+ horas libres a partir de dentro de 3 días.');
  return date;
}

async function signUpTempClient() {
  const email = `segundo-cliente-${Date.now()}@f1-verify.local`;
  const res = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role: 'client', full_name: 'Segundo cliente F1' } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (id) created.users.add(id);
  if (!body?.access_token) throw new Error(`No se pudo crear el segundo cliente: ${JSON.stringify(body).slice(0, 160)}`);
  return { email, token: body.access_token };
}

// El jardinero, con la reserva PENDIENTE, propone otra duración en vez de aceptar; el cliente
// acepta y la reserva queda confirmada con la agenda redimensionada. Es el flujo real
// (respond_booking_price_change → resize_booking_schedule): el cambio de precio es una
// negociación previa a la confirmación, y rechazarlo CANCELA la reserva.
async function negotiateDuration(bookingId, newDuration, gardenerToken, clientToken) {
  const price = Number(sql(`select total_price from public.bookings where id='${bookingId}'`));
  const prop = await rpc('propose_booking_price_change', {
    p_booking_id: bookingId, p_proposed_total_price: price + 10, p_reason: 'Prueba F1: cambio de duración',
    p_operation_id: randomUUID(), p_expires_in_minutes: 60, p_proposed_duration_hours: newDuration,
  }, gardenerToken);
  if (!prop.ok) return prop;
  return rpc('respond_booking_price_change', { p_booking_id: bookingId, p_accept: true, p_operation_id: randomUUID() }, clientToken);
}

const range = (from, length) => Array.from({ length }, (_, i) => from + i).join(',');
const why = (res) => (res.ok ? '' : ` (${res.body?.message ?? JSON.stringify(res.body).slice(0, 140)})`);

async function main() {
  const clientToken = await signIn(CLIENT_EMAIL);
  const gardenerToken = await signIn(GARDENER_EMAIL);
  const date = pickDate();
  const vh = await validHours(LAWN, date, INPUT);
  const hours = vh.body?.validHours ?? [];
  // A ocupa hA..hA+2 tras alargarse; D empieza en hA+3; B en hA+5, justo donde D se querría alargar.
  const hA = hours[0];
  const hD = hA + 3;
  const hB = hA + 5;
  if (![hA, hD, hB].every((h) => hours.includes(h))) {
    throw new Error(`El ${date} no tiene las horas ${hA}, ${hD} y ${hB} libres: ${JSON.stringify(hours)}`);
  }
  console.log(`Día de prueba ${date}, horas válidas ${hours.join(',')}, ocupadas antes: [${busyHours(date)}]`);

  // H-01: la web, el pago y la confirmación miran `availability`; reserve/resize miraban
  // `availability_blocks`, que solo rellena el generador nocturno. Se reproduce SIEMPRE el
  // caso de un día sin esas filas (fuera de la ventana del generador, o disponibilidad
  // puesta a mano): la agenda tiene que funcionar igual, porque la web ofrece esas horas.
  mirrorBackup = { date, rows: sql(`select coalesce(json_agg(ab), '[]'::json) from public.availability_blocks ab
                                    where gardener_id='${PROVIDER_ID}' and date='${date}'`) };
  sql(`delete from public.availability_blocks where gardener_id='${PROVIDER_ID}' and date='${date}'`);
  console.log(`Día sin filas en availability_blocks (se retiran ${JSON.parse(mirrorBackup.rows).length} y se reponen al final)\n`);

  // ── A · pago → pendiente ─────────────────────────────────────────────────────
  const A = await payBooking(date, hA, clientToken);
  if (!A.bookingId) throw new Error(`No se pudo crear la reserva A: ${A.error ?? JSON.stringify(A.confirm?.body)}`);
  const durA = Number(sql(`select duration_hours from public.bookings where id='${A.bookingId}'`));
  record('F1-03a', 'Reserva pagada bloquea sus horas en la agenda', blocksOf(A.bookingId) === range(hA, durA),
    `bloques [${blocksOf(A.bookingId)}], esperado [${range(hA, durA)}], estado ${sql(`select status from public.bookings where id='${A.bookingId}'`)}`);
  record('F1-03b', 'Cada hora de la reserva pagada sabe quién la trabaja (assignee = jardinero)',
    assigneesOf(A.bookingId) === PROVIDER_ID, `assignee: ${assigneesOf(A.bookingId)}`);

  // ── A · negociación que CABE: +1 hora → confirmada y redimensionada ──────────
  {
    const res = await negotiateDuration(A.bookingId, durA + 1, gardenerToken, clientToken);
    record('F1-05', 'Alargar con horas libres redimensiona la agenda (y confirma la reserva)',
      res.ok && blocksOf(A.bookingId) === range(hA, durA + 1),
      `HTTP ${res.status}${why(res)}, bloques [${blocksOf(A.bookingId)}], esperado [${range(hA, durA + 1)}], estado ${sql(`select status from public.bookings where id='${A.bookingId}'`)}`);
    record('F1-05b', 'La hora añadida también sabe quién la trabaja', assigneesOf(A.bookingId) === PROVIDER_ID,
      `assignee: ${assigneesOf(A.bookingId)}`);
  }

  // ── B · pago → pendiente → el jardinero acepta (reserve_booking_schedule) ─────
  const B = await payBooking(date, hB, clientToken);
  if (!B.bookingId) throw new Error(`No se pudo crear la reserva B: ${B.error ?? JSON.stringify(B.confirm?.body)}`);
  const durB = Number(sql(`select duration_hours from public.bookings where id='${B.bookingId}'`));
  {
    const acc = await rpc('respond_booking_request', { p_booking_id: B.bookingId, p_response: 'accept', p_operation_id: randomUUID() }, gardenerToken);
    record('F1-03c', 'El jardinero acepta una reserva pendiente', acc.ok && blocksOf(B.bookingId) === range(hB, durB),
      `HTTP ${acc.status}${why(acc)}, estado ${sql(`select status from public.bookings where id='${B.bookingId}'`)}, bloques [${blocksOf(B.bookingId)}]`);
  }

  // ── E · reserva pendiente SIN horas bloqueadas → el jardinero acepta ───────────
  // Es el único camino que ejercita la comprobación de reserve_booking_schedule (el pago ya
  // inserta los bloques y reserve sale sin comprobar). Hoy solo lo alcanzaban las solicitudes
  // a varios jardineros, cuya función tiene el EXECUTE retirado a los clientes; por eso la
  // reserva pendiente se crea aquí directamente en la base, y la aceptación va por la API real.
  {
    const hE = hours[hours.length - 2];
    const clientId = sql(`select id from auth.users where email='${CLIENT_EMAIL}'`);
    const eId = sql(`insert into public.bookings
        (client_id, gardener_id, service_id, date, start_time, duration_hours, total_price,
         client_address, status, management_fee, management_fee_source)
      values ('${clientId}', '${PROVIDER_ID}', '${LAWN}', '${date}', '${String(hE).padStart(2, '0')}:00', 1, 45,
         'Marbella centro', 'pending', 5.63, 'unknown')
      returning id`).split('\n')[0].trim();
    created.bookings.add(eId);
    const acc = await rpc('respond_booking_request', { p_booking_id: eId, p_response: 'accept', p_operation_id: randomUUID() }, gardenerToken);
    record('F1-10', 'Aceptar una reserva sin horas aún bloqueadas reserva la agenda (reserve_booking_schedule)',
      acc.ok && blocksOf(eId) === String(hE) && assigneesOf(eId) === PROVIDER_ID && busyHours(date).split(',').includes(String(hE)),
      `HTTP ${acc.status}${why(acc)}, bloques [${blocksOf(eId)}], assignee ${assigneesOf(eId)}, horas ocupadas [${busyHours(date)}]`);
  }

  // ── D · negociación que NO CABE (pisaría B): falla entera ─────────────────────
  {
    const D = await payBooking(date, hD, clientToken);
    if (!D.bookingId) throw new Error(`No se pudo crear la reserva D: ${D.error ?? JSON.stringify(D.confirm?.body)}`);
    const durD = Number(sql(`select duration_hours from public.bookings where id='${D.bookingId}'`));
    const before = blocksOf(D.bookingId);
    const res = await negotiateDuration(D.bookingId, hB - hD + 1, gardenerToken, clientToken);
    const durAfter = Number(sql(`select duration_hours from public.bookings where id='${D.bookingId}'`));
    record('F1-06', 'Alargar sin horas libres falla entero y no deja nada a medias',
      !res.ok && blocksOf(D.bookingId) === before && durAfter === durD && blocksOf(B.bookingId) === range(hB, durB),
      `HTTP ${res.status}${why(res)}, bloques D [${blocksOf(D.bookingId)}] (antes [${before}]), duración ${durAfter} (antes ${durD}), B intacta [${blocksOf(B.bookingId)}]`);
  }

  // ── doble venta con disponibilidad DESINCRONIZADA, por OTRO cliente ──────────
  {
    const hoursA = blocksOf(A.bookingId);
    const second = await signUpTempClient();
    // Simula una disponibilidad corrupta: las horas de A figuran libres aunque A las tiene.
    sql(`update public.availability set is_available = true
         where gardener_id='${PROVIDER_ID}' and date='${date}' and extract(hour from start_time) in (${hoursA})`);
    sql(`update public.availability_blocks set is_available = true
         where gardener_id='${PROVIDER_ID}' and date='${date}' and hour_block in (${hoursA})`);
    const C = await payBooking(date, hA, second.token, second.email);
    const dupes = Number(doubleBookedHours());
    const cDetail = C.bookingId
      ? `reserva C CREADA ${C.bookingId === A.bookingId ? '(es A: prueba inválida)' : blocksOf(C.bookingId) ? `con bloques [${blocksOf(C.bookingId)}]` : 'SIN bloques (venta silenciosa)'}`
      : `reserva C no creada (${C.error ?? `pago en estado '${C.confirm?.body?.status}'`})`;
    record('F1-08', 'Aunque la disponibilidad mienta, la misma hora de la misma persona NO se vende dos veces',
      dupes === 0 && (!C.bookingId || blocksOf(C.bookingId) !== ''),
      `horas vendidas dos veces: ${dupes}; ${cDetail}`);
    sql(`update public.availability set is_available = false
         where gardener_id='${PROVIDER_ID}' and date='${date}' and extract(hour from start_time) in (${hoursA})`);
    sql(`update public.availability_blocks set is_available = false
         where gardener_id='${PROVIDER_ID}' and date='${date}' and hour_block in (${hoursA})`);
  }

  // ── concurrencia REAL: dos reservas de la misma hora aceptadas a la vez ────────
  // En secuencia esta prueba pasa siempre y no demuestra nada: las dos aceptaciones salen en
  // el mismo instante (Promise.all) y compiten por la misma hora del mismo jardinero.
  {
    const hP = hours[hours.length - 1];
    const second = await signUpTempClient();
    const clientA = sql(`select id from auth.users where email='${CLIENT_EMAIL}'`);
    const clientB = sql(`select id from auth.users where email='${second.email}'`);
    const mk = (clientId) => sql(`insert into public.bookings
        (client_id, gardener_id, service_id, date, start_time, duration_hours, total_price,
         client_address, status, management_fee, management_fee_source)
      values ('${clientId}', '${PROVIDER_ID}', '${LAWN}', '${date}', '${String(hP).padStart(2, '0')}:00', 1, 45,
         'Marbella centro', 'pending', 5.63, 'unknown')
      returning id`).split('\n')[0].trim();
    const p1 = mk(clientA);
    const p2 = mk(clientB);
    created.bookings.add(p1);
    created.bookings.add(p2);
    const [r1, r2] = await Promise.all([
      rpc('respond_booking_request', { p_booking_id: p1, p_response: 'accept', p_operation_id: randomUUID() }, gardenerToken),
      rpc('respond_booking_request', { p_booking_id: p2, p_response: 'accept', p_operation_id: randomUUID() }, gardenerToken),
    ]);
    const winners = [r1, r2].filter((r) => r.ok).length;
    const blocksAtHour = Number(sql(`select count(*) from public.booking_blocks where date='${date}' and hour_block=${hP}`));
    const loser = [r1, r2].find((r) => !r.ok);
    record('F1-11', 'Dos aceptaciones simultáneas de la misma hora: gana una y la otra recibe un error claro',
      winners === 1 && blocksAtHour === 1,
      `ganadoras ${winners}/2, bloques a las ${hP}h: ${blocksAtHour}${loser ? `, perdedora: HTTP ${loser.status}${why(loser)}` : ''}`);
  }

  // ── bloque sin ejecutante explícito / sin reserva atribuible ──────────────────
  if (hasAssignee()) {
    const filled = sql(`begin;
      insert into public.booking_blocks (booking_id, date, hour_block) values ('${B.bookingId}', '${date}', 23);
      select assignee_id from public.booking_blocks where booking_id='${B.bookingId}' and hour_block=23;
      rollback;`).split('\n').find((l) => /^[0-9a-f-]{36}$/.test(l.trim()));
    record('F1-07a', 'Un bloque insertado sin ejecutante lo hereda del proveedor de la reserva', filled === PROVIDER_ID, `assignee ${filled}`);
    let orphanRejected = false;
    try {
      sql(`begin; insert into public.booking_blocks (date, hour_block) values ('${date}', 22); rollback;`);
    } catch { orphanRejected = true; }
    record('F1-07b', 'Un bloque sin reserva ni ejecutante se rechaza', orphanRejected);
    record('F1-01', 'Ningún bloque de la agenda queda sin ejecutante (y la columna es NOT NULL)',
      sql('select count(*) from public.booking_blocks where assignee_id is null') === '0' &&
      sql("select is_nullable from information_schema.columns where table_name='booking_blocks' and column_name='assignee_id'") === 'NO');
  } else {
    for (const [id, d] of [['F1-07a', 'Un bloque insertado sin ejecutante lo hereda del proveedor de la reserva'], ['F1-07b', 'Un bloque sin reserva ni ejecutante se rechaza'], ['F1-01', 'Ningún bloque de la agenda queda sin ejecutante (y la columna es NOT NULL)']]) {
      record(id, d, false, 'no existe la columna assignee_id');
    }
  }

  // ── cancelar A (release_booking_schedule) ─────────────────────────────────────
  {
    const hoursA = blocksOf(A.bookingId).split(',').map(Number);
    const can = await rpc('cancel_booking', { p_booking_id: A.bookingId, p_reason: 'Prueba F1' }, clientToken);
    const stillBusy = busyHours(date).split(',').filter(Boolean).map(Number).filter((h) => hoursA.includes(h));
    record('F1-04', 'Cancelar libera las horas de quien las trabajaba',
      can.ok && blocksOf(A.bookingId) === '' && stillBusy.length === 0,
      `HTTP ${can.status}${why(can)}, bloques restantes [${blocksOf(A.bookingId)}], horas de A aún ocupadas [${stillBusy}]`);
  }
}

function cleanup() {
  if (mirrorBackup) {
    sql(`delete from public.availability_blocks where gardener_id='${PROVIDER_ID}' and date='${mirrorBackup.date}'`);
    sql(`insert into public.availability_blocks select * from json_populate_recordset(null::public.availability_blocks, '${mirrorBackup.rows.replace(/'/g, "''")}'::json)`);
  }
  const ids = (set) => [...set].map((id) => `'${id}'`).join(',');
  if (created.bookings.size) {
    for (const id of created.bookings) sql(`select public.release_booking_schedule('${id}')`);
    sql(`delete from public.bookings where id in (${ids(created.bookings)})`);
  }
  if (created.attempts.size) {
    sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)}))`);
    sql(`delete from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)})`);
    sql(`delete from public.booking_payment_attempts where id in (${ids(created.attempts)})`);
  }
  if (created.quotes.size) sql(`delete from public.booking_quotes where id in (${ids(created.quotes)})`);
  if (created.users.size) {
    // Reservas, intentos y presupuestos del cliente temporal que no se hayan registrado arriba.
    sql(`select public.release_booking_schedule(id) from public.bookings where client_id in (${ids(created.users)})`);
    sql(`delete from public.bookings where client_id in (${ids(created.users)})`);
    sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where client_id in (${ids(created.users)}))`);
    sql(`delete from public.booking_schedule_holds where client_id in (${ids(created.users)})`);
    sql(`delete from public.booking_payment_attempts where client_id in (${ids(created.users)})`);
    sql(`delete from public.booking_quotes where client_id in (${ids(created.users)})`);
    sql(`delete from public.profiles where user_id in (${ids(created.users)})`);
    sql(`delete from auth.users where id in (${ids(created.users)})`);
  }
}

try {
  await main();
} catch (error) {
  console.error('Error ejecutando la verificación:', error.message);
  results.push({ id: 'error', ok: false });
} finally {
  try { cleanup(); } catch (error) { console.error('Error limpiando:', error.message); results.push({ id: 'cleanup', ok: false }); }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} en verde. Reservas de prueba creadas y borradas: ${created.bookings.size}.`);
process.exit(failed ? 1 : 0);
