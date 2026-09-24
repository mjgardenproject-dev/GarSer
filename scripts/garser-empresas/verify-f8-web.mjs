#!/usr/bin/env node
// GarSer Empresas · F8.2 — la web (booking-authority) presupuesta varios servicios en una visita
// con el motor de siempre (cada uno con su tarifa) y solo ofrece a quien los hace todos; del
// presupuesto al pago y la reserva por los caminos reales. Contra el Supabase LOCAL.
//
// Césped 300 m² = 2 h / 54 €. Setos 2-4 m, 40 ml, 1 cara = 3 h / 220 €.
// Empresa A: Ana (césped y setos), Luis (solo césped). Empresa B: solo césped.
// Uso: node scripts/garser-empresas/verify-f8-web.mjs   (el contenedor de funciones, al día)

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, sql, why, authority,
  setAvailability, runVerification, LAWN, HEDGE, LAWN_INPUT,
} from './_company-harness.mjs';

const acc = accounts('f8-web.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const HEDGE_INPUT = {
  address: 'Marbella centro', addressCoordinates: { lat: 36.51, lng: -4.882 }, wasteRemoval: false,
  hedgeZones: [{ type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }],
};
const both = [{ serviceId: LAWN, bookingInput: LAWN_INPUT }, { serviceId: HEDGE, bookingInput: HEDGE_INPUT }];
const multi = (extra) => ({ serviceId: LAWN, bookingInput: LAWN_INPUT, items: both, ...extra });

async function payQuote(quoteId, client) {
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}` };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId, p_stripe_event_id: `evt_f8w_${randomUUID()}`, p_stripe_payment_intent_id: `pi_f8w_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents, p_currency: 'eur', p_gateway_payload: {},
  });
  return { bookingId: conf.body?.bookingId ?? null, fee: prep.body.payableNowAmountCents, error: conf.body?.bookingId ? null : JSON.stringify(conf.body).slice(0, 200) };
}

async function main() {
  const a = await createCompany(acc.newUser, 'empresa-a', [LAWN, HEDGE]);
  const ana = await joinTeam(acc.newUser, a.token, 'ana', [LAWN, HEDGE]);
  const luis = await joinTeam(acc.newUser, a.token, 'luis', [LAWN]);
  const b = await createCompany(acc.newUser, 'empresa-b', [LAWN]);
  const bea = await joinTeam(acc.newUser, b.token, 'bea', [LAWN]);
  const client = await acc.newUser('cliente');
  const D1 = day(20);
  [ana, luis, bea].forEach((p) => setAvailability(p.id, D1, [8, 9, 10, 11, 12, 13]));

  {
    const lawnOnly = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: a.id, date: D1, bookingInput: LAWN_INPUT });
    const r = await authority({ action: 'valid_hours', providerId: a.id, date: D1, ...multi() });
    const q = r.body?.quote || {};
    record('F8-20', 'Césped + setos con la empresa A: 274 € (54 + 220), 5 h, gestión sobre el total; horas en que Ana puede hacer las 5',
      r.ok && q.totalPrice === 274 && q.estimatedHours === 5 && q.economics?.managementFee === 34.25 && (r.body?.validHours || []).join(',') === '8,9' &&
      (q.items || []).map((i) => i.totalPrice).join('+') === '54+220' && (lawnOnly.body?.validHours || []).join(',') === '8,9,10,11,12',
      `${q.totalPrice} € · ${q.estimatedHours} h · gestión ${q.economics?.managementFee} · horas [${(r.body?.validHours || []).join(',')}] · solo césped [${(lawnOnly.body?.validHours || []).join(',')}]${why(r)}`);
  }
  {
    const r = await authority({ action: 'preview_providers', providerIds: [a.id, b.id], selectedDate: D1, windowDays: 3, ...multi() });
    record('F8-21', 'La lista solo ofrece a quien hace los dos servicios (D15): sale A, no B (solo césped)',
      r.ok && (r.body?.eligibleProviderIds || []).join(',') === a.id && r.body?.exclusions?.[b.id]?.code === 'inactive_service',
      `elegibles ${(r.body?.eligibleProviderIds || []).map((id) => (id === a.id ? 'A' : 'B')).join(',')}, B → ${r.body?.exclusions?.[b.id]?.code}${why(r)}`);
  }
  {
    const bad1 = await authority({ action: 'valid_hours', providerId: a.id, date: D1, serviceId: HEDGE, bookingInput: HEDGE_INPUT, items: both });
    const bad2 = await authority({ action: 'valid_hours', providerId: a.id, date: D1, ...multi({ items: [both[0], both[0]] }) });
    record('F8-22', 'La web rechaza listas de servicios mal formadas (el primero no es el principal, repetidos)',
      bad1.status === 400 && bad2.status === 400, `${bad1.status} / ${bad2.status}`);
  }
  let B;
  {
    const q = await authority({ action: 'create_quote', providerId: a.id, date: D1, startTime: '08:00', ...multi() }, { accessToken: client.token });
    const stored = q.body?.quoteId ? sql(`select jsonb_array_length(items) || '|' || total_price || '|' || estimated_hours || '|' || (input_payload ? 'lawnZones' and input_payload ? 'hedgeZones') from public.booking_quotes where id='${q.body.quoteId}'`) : '';
    record('F8-23', 'El presupuesto guarda los dos servicios, el total, las horas y los datos de ambos juntos', stored === '2|274|5|true', `${stored}${why(q)}`);
    const r = q.body?.quoteId ? await payQuote(q.body.quoteId, client) : { error: why(q) };
    B = r.bookingId;
    const its = B ? sql(`select string_agg(s.name || ':' || i.total_price, ' + ' order by position) from public.booking_items i join public.services s on s.id = i.service_id where booking_id='${B}'`) : '';
    const workers = B ? sql(`select string_agg(distinct assignee_id::text, ',') from public.booking_blocks where booking_id='${B}'`) : '';
    record('F8-24', 'Se paga una sola vez (34,25 € de gestión) y la reserva lleva césped + setos, con Ana',
      B && r.fee === 3425 && its === 'Corte de césped:54.00 + Poda de setos:220.00' && workers === ana.id, `${its || r.error} · gestión ${r.fee} · va ${workers === ana.id ? 'Ana' : workers}`);
  }
  {
    const details = B ? await rpc('get_booking_service_details', { p_booking_id: B }, a.token) : null;
    record('F8-25', 'El profesional ve los datos de los dos servicios (zonas de césped y de setos)',
      Boolean(details?.body?.lawnZones?.length && details?.body?.hedgeZones?.length), JSON.stringify(Object.keys(details?.body || {})));
  }
  {
    // Coherencia web ↔ pago con varios servicios (la regla de F7, con las personas que hacen todos).
    const mismatches = [];
    for (const [i, hours] of [[21, [8, 9, 10, 11, 12]], [22, [9, 10, 11, 12, 13, 14]], [23, [8, 9, 10]]]) {
      setAvailability(ana.id, day(i), hours);
      setAvailability(luis.id, day(i), [8, 9, 10, 11, 12, 13, 14, 15]);
      const web = await authority({ action: 'valid_hours', providerId: a.id, date: day(i), ...multi() });
      const db = sql(`select coalesce(string_agg(h::text, ',' order by h), '') from generate_series(0, 19) h
        where exists (select 1 from public.plan_booking_cells('${a.id}', '${LAWN}', '${day(i)}', h, 5, false, null, array['${HEDGE}']::uuid[]))`);
      const w = (web.body?.validHours || []).join(',');
      if (w !== db) mismatches.push(`día ${i}: web [${w}] pago [${db}]`);
    }
    record('F8-26', 'La web ofrece con varios servicios exactamente las horas que el pago puede apartar', mismatches.length === 0, mismatches.join(' · ') || 'iguales en 3 días');
  }
  {
    const single = await authority({ action: 'create_quote', serviceId: LAWN, providerId: a.id, date: day(21), startTime: '09:00', bookingInput: LAWN_INPUT }, { accessToken: client.token });
    const row = single.body?.quoteId ? sql(`select coalesce(items::text, 'null') from public.booking_quotes where id='${single.body.quoteId}'`) : '';
    record('F8-27', 'Un solo servicio: el presupuesto sigue siendo el de siempre (sin lista de servicios)', row === 'null', `${row}${why(single)}`);
  }
}

await runVerification({ acc, results, main });
