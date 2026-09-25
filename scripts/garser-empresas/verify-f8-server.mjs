#!/usr/bin/env node
// GarSer Empresas · F8.1 — varios servicios en una reserva, en el SERVIDOR (booking_items, quién
// puede ir, pago), contra el Supabase LOCAL por los caminos reales.
//
// La web aún no pide presupuestos de varios servicios (F8.2): se pide uno de césped por la web y
// se le añaden los servicios del caso (lo que hará el motor de la web). Desde ahí, pago, agenda y
// permisos por sus funciones reales.
//
// Empresa: Ana (césped y setos), Luis (solo césped), Eva (solo setos).
// Uso: node scripts/garser-empresas/verify-f8-server.mjs

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, rest, sql, why, authority,
  setAvailability, freeHoursOf, runVerification, LAWN, HEDGE, PHYTO, LAWN_INPUT,
} from './_company-harness.mjs';

const acc = accounts('f8-server.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();

async function lawnQuote(provider, client, date, hour) {
  const q = await authority(
    { action: 'create_quote', serviceId: LAWN, providerId: provider, date, startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: LAWN_INPUT },
    { accessToken: client.token },
  );
  if (!q.ok || !q.body?.quoteId) throw new Error(`create_quote ${q.status}${why(q)}`);
  return q.body.quoteId;
}

/** Convierte el presupuesto en uno de varios servicios: [servicio, precio, horas, carnet]. */
function makeMulti(quoteId, parts, { total, hours } = {}) {
  const items = parts.map(([serviceId, price, h, license = false]) => ({
    serviceId, totalPrice: price, estimatedHours: h, requiresLicense: license,
    inputPayload: { wasteRemoval: false, note: `datos de ${serviceId.slice(0, 4)}` },
    breakdown: [{ desc: `Servicio ${serviceId.slice(0, 4)}`, price }],
  }));
  const sumPrice = total ?? parts.reduce((a, p) => a + p[1], 0);
  const sumHours = hours ?? parts.reduce((a, p) => a + p[2], 0);
  const license = parts.some((p) => p[3]);
  sql(`update public.booking_quotes set items = '${JSON.stringify(items).replace(/'/g, "''")}'::jsonb, total_price = ${sumPrice},
       estimated_hours = ${sumHours}, pricing_snapshot = pricing_snapshot || '{"requiresPhytosanitaryLicense": ${license}}'::jsonb where id = '${quoteId}'`);
}

async function payQuote(quoteId, client) {
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}` };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId, p_stripe_event_id: `evt_f8_${randomUUID()}`, p_stripe_payment_intent_id: `pi_f8_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents, p_currency: 'eur', p_gateway_payload: {},
  });
  return { bookingId: conf.body?.bookingId ?? null, conf, error: conf.body?.bookingId ? null : JSON.stringify(conf.body).slice(0, 200) };
}

const items = (id) => sql(`select coalesce(string_agg(position || ':' || s.name || ':' || total_price || ':' || labour_hours, ' | ' order by position), '')
  from public.booking_items i join public.services s on s.id = i.service_id where booking_id = '${id}'`);

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-multi');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', [LAWN, HEDGE]);
  const luis = await joinTeam(acc.newUser, owner.token, 'luis', [LAWN]);
  const eva = await joinTeam(acc.newUser, owner.token, 'eva', [HEDGE]);
  const names = { [ana.id]: 'Ana', [luis.id]: 'Luis', [eva.id]: 'Eva' };
  const client = await acc.newUser('cliente');
  const stranger = await acc.newUser('otro');
  const D1 = day(20);
  const D2 = day(21);
  [ana, luis, eva].forEach((p) => { setAvailability(p.id, D1, [8, 9, 10, 11, 12, 13]); setAvailability(p.id, D2, [8, 9, 10, 11, 12, 13]); });

  {
    const r = await payQuote(await lawnQuote(owner.id, client, D1, 8), client);
    record('F8-01', 'Una reserva de un servicio queda con una fila en booking_items (lo de siempre)',
      r.bookingId && items(r.bookingId).startsWith('1:Corte de césped:') && items(r.bookingId).split('|').length === 1, r.bookingId ? items(r.bookingId) : r.error);
  }
  {
    const who = sql(`select coalesce(string_agg(distinct w::text, ','), '') from public.provider_workers_all('${owner.id}', array['${LAWN}','${HEDGE}']::uuid[], false) w`);
    const free = sql(`select coalesce(string_agg(distinct worker_id::text, ','), '') from public.provider_free_hours(array['${owner.id}']::uuid[], '${LAWN}', '${D2}', '${D2}', false, '{}', array['${HEDGE}']::uuid[])`);
    record('F8-02', 'Césped + setos: solo cuenta quien hace los dos (Ana), también para las horas libres',
      who === ana.id && free === ana.id, `personas [${who.split(',').map((x) => names[x] || x).join(',')}], horas libres de [${free.split(',').map((x) => names[x] || x).join(',')}]`);
  }
  let B;
  {
    const q = await lawnQuote(owner.id, client, D2, 8);
    makeMulti(q, [[LAWN, 54, 2], [HEDGE, 80, 3]]);
    const r = await payQuote(q, client);
    B = r.bookingId;
    const workers = B ? sql(`select string_agg(distinct assignee_id::text, ',') from public.booking_blocks where booking_id='${B}'`) : '';
    const row = B ? sql(`select service_id || '|' || total_price || '|' || duration_hours from public.bookings where id='${B}'`) : '';
    record('F8-03', 'Césped (2 h) + setos (3 h): una reserva de 134 € y 5 h, con sus dos servicios y la hace Ana',
      B && items(B) === '1:Corte de césped:54.00:2 | 2:Poda de setos:80.00:3' && row === `${LAWN}|134.00|5` && workers === ana.id,
      `${B ? `${items(B)} · ${row} · va ${names[workers] || workers}` : r.error}`);
    record('F8-04', 'Las horas de Ana quedan ocupadas; Luis y Eva, libres', freeHoursOf(ana.id, D2) === '13' && freeHoursOf(luis.id, D2) === '8,9,10,11,12,13',
      `Ana [${freeHoursOf(ana.id, D2)}], Luis [${freeHoursOf(luis.id, D2)}]`);
  }
  {
    const bad = [];
    for (const [label, parts, opts] of [
      ['el total no cuadra', [[LAWN, 54, 2], [HEDGE, 80, 3]], { total: 100 }],
      ['las horas no cuadran', [[LAWN, 54, 2], [HEDGE, 80, 3]], { hours: 4 }],
      ['el primero no es el del presupuesto', [[HEDGE, 80, 3], [LAWN, 54, 2]], {}],
      ['un servicio repetido', [[LAWN, 54, 2], [LAWN, 54, 2]], {}],
    ]) {
      setAvailability(ana.id, day(22), [8, 9, 10, 11, 12, 13]);
      const q = await lawnQuote(owner.id, client, day(22), 8);
      makeMulti(q, parts, opts);
      const r = await payQuote(q, client);
      if (r.bookingId || !/no es coherente/.test(r.error || '')) bad.push(`${label}: ${r.bookingId ? 'se vendió' : r.error}`);
    }
    record('F8-05', 'El pago rechaza presupuestos de varios servicios que no cuadran (total, horas, orden, repetidos)', bad.length === 0, bad.join(' · ') || '4 rechazados');
  }
  {
    const D3 = day(23);
    setAvailability(luis.id, D3, [8, 9, 10, 11, 12]);
    setAvailability(eva.id, D3, [8, 9, 10, 11, 12]);
    const q = await lawnQuote(owner.id, client, D3, 8);
    makeMulti(q, [[LAWN, 54, 2], [HEDGE, 80, 3]]);
    const r = await payQuote(q, client);
    record('F8-06', 'Si nadie hace los dos servicios (Luis solo césped, Eva solo setos), no se puede pagar', !r.bookingId && /ya no esta disponible/.test(r.error || ''), r.error || 'se vendió');
  }
  await rpc('respond_booking_request', { p_booking_id: B, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  {
    const cands = await rpc('booking_replace_candidates', { p_booking_id: B, p_from: ana.id }, owner.token);
    const toLuis = await rpc('replace_booking_worker', { p_booking_id: B, p_from: ana.id, p_to: luis.id }, owner.token);
    record('F8-07', 'En un trabajo de césped + setos no se puede poner a quien solo hace uno (Luis)',
      cands.ok && (cands.body || []).length === 0 && !toLuis.ok, `candidatos ${JSON.stringify(cands.body)}, a Luis ${toLuis.status}${why(toLuis)}`);
  }
  {
    const read = async (who) => (await rest('GET', `/rest/v1/booking_items?booking_id=eq.${B}&select=service_id`, who.token)).rows?.length ?? -1;
    const insert = await rest('POST', '/rest/v1/booking_items', client.token, { booking_id: B, position: 3, service_id: PHYTO, total_price: 1, labour_hours: 1 });
    const counts = { cliente: await read(client), dueña: await read(owner), Ana: await read(ana), Luis: await read(luis), otro: await read(stranger) };
    record('F8-08', 'Leen los servicios de la reserva el cliente, la empresa y quien va; nadie más; y nadie los escribe desde la web',
      counts.cliente === 2 && counts.dueña === 2 && counts.Ana === 2 && counts.Luis === 0 && counts.otro === 0 && !insert.ok,
      `${JSON.stringify(counts)}, escribir ${insert.status}`);
  }
  {
    const ids = sql(`select array_to_string(public.booking_service_ids('${B}'), ',')`);
    const old = sql(`select id from public.bookings where id <> '${B}' and not exists (select 1 from public.booking_items i where i.booking_id = bookings.id) limit 1`);
    const oldIds = old ? sql(`select array_to_string(public.booking_service_ids('${old}'), ',') = (select service_id::text from public.bookings where id='${old}')`) : 't';
    record('F8-09', 'booking_service_ids: los de la reserva en orden; en reservas anteriores (sin filas), el de la reserva',
      ids === `${LAWN},${HEDGE}` && oldIds === 't', `${ids} · anterior ${old ? oldIds : 'no hay'}`);
  }
  {
    // Mover de fecha: se vuelve a comprobar con los dos servicios.
    setAvailability(luis.id, day(24), [8, 9, 10, 11, 12]);
    const onlyLuis = await rpc('reschedule_options', { p_booking_id: B, p_date: day(24) }, owner.token);
    setAvailability(ana.id, day(24), [8, 9, 10, 11, 12]);
    const withAna = await rpc('reschedule_options', { p_booking_id: B, p_date: day(24) }, owner.token);
    record('F8-10', 'Mover de fecha un trabajo de césped + setos solo ofrece horas en que puede ir alguien que haga los dos',
      (onlyLuis.body || []).length === 0 && (withAna.body || []).join(',') === '8', `solo Luis [${(onlyLuis.body || []).join(',')}], con Ana [${(withAna.body || []).join(',')}]`);
  }
  {
    // Carnet: si uno de los servicios lo exige, lo exige el trabajo.
    const r = await rpc('set_company_member_services', { p_member_id: ana.memberId, p_service_ids: [LAWN, HEDGE, PHYTO] }, owner.token);
    const D5 = day(25);
    setAvailability(ana.id, D5, [8, 9, 10, 11, 12, 13]);
    const q = await lawnQuote(owner.id, client, D5, 8);
    makeMulti(q, [[LAWN, 54, 2], [PHYTO, 60, 2, true]]);
    const pay = await payQuote(q, client);
    record('F8-11', 'Césped + fitosanitario (con carnet): Ana, sin carnet aprobado, no puede ir → no se vende',
      !pay.bookingId && /ya no esta disponible/.test(pay.error || ''), `servicios de Ana ${r.status}${why(r)}; pago: ${pay.error || 'se vendió'}`);
  }
}

await runVerification({ acc, results, main });
