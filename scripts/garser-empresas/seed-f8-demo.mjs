#!/usr/bin/env node
// GarSer Empresas · F8 — datos para mirar en el navegador una reserva de varios servicios:
// empresa «Jardines Rosa» (césped y setos) con Ana, que hace los dos, libre dos semanas; y una
// clienta, Laura.
//
// Uso:  node scripts/garser-empresas/seed-f8-demo.mjs crear | borrar
// Solo contra el Supabase LOCAL. Contraseña de todas las cuentas: Test123456!

import { randomUUID } from 'node:crypto';
import { accounts, createCompany, joinTeam, sql, setAvailability, cleanupUsers, authority, rpc, LAWN, HEDGE, LAWN_INPUT } from './_company-harness.mjs';

const acc = accounts('f8-demo.local');
const mode = process.argv[2];

if (mode === 'borrar') {
  cleanupUsers(acc.stale());
  console.log('Demo de F8 borrada.');
} else if (mode === 'crear') {
  cleanupUsers(acc.stale());
  const owner = await createCompany(acc.newUser, 'rosa', [LAWN, HEDGE]);
  sql(`update public.gardener_profiles set full_name = 'Jardines Rosa' where user_id = '${owner.id}'`);
  sql(`update public.company_members set counts_as_labour = false where user_id = '${owner.id}'`);
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', [LAWN, HEDGE]);
  sql(`update public.profiles set full_name = 'Ana García' where user_id = '${ana.id}'`);
  for (let i = 1; i <= 14; i += 1) {
    setAvailability(ana.id, sql(`select (current_date + ${i})::text;`).trim(), [8, 9, 10, 11, 12, 13, 14, 15]);
  }
  const client = await acc.newUser('laura');
  sql(`update public.profiles set full_name = 'Laura Cliente' where user_id = '${client.id}'`);
  // Una reserva ya hecha de césped + setos, pagada y aceptada, para mirar las pantallas de después.
  const hedgeInput = { ...LAWN_INPUT, lawnZones: undefined, hedgeZones: [{ type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }] };
  const date = sql('select (current_date + 1)::text;').trim();
  const q = await authority({ action: 'create_quote', serviceId: LAWN, providerId: owner.id, date, startTime: '09:00', bookingInput: LAWN_INPUT,
    items: [{ serviceId: LAWN, bookingInput: LAWN_INPUT }, { serviceId: HEDGE, bookingInput: hedgeInput }] }, { accessToken: client.token });
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: q.body?.quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  const conf = await rpc('confirm_booking_payment_attempt', { p_attempt_id: prep.body?.attemptId, p_stripe_event_id: `evt_demo_${randomUUID()}`,
    p_stripe_payment_intent_id: `pi_demo_${randomUUID()}`, p_amount_total_cents: prep.body?.payableNowAmountCents, p_currency: 'eur', p_gateway_payload: {} });
  if (conf.body?.bookingId) await rpc('respond_booking_request', { p_booking_id: conf.body.bookingId, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  console.log(`Reserva de césped + setos para mañana a las 9: ${conf.body?.bookingId || JSON.stringify(q.body || prep.body).slice(0, 160)}`);
  console.log('Creada. Contraseña: Test123456!');
  console.log(`  Dueña:   ${owner.email}`);
  console.log(`  Ana:     ${ana.email}`);
  console.log(`  Clienta: ${client.email}`);
} else {
  console.error('Uso: crear | borrar');
  process.exit(2);
}
