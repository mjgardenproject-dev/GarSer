#!/usr/bin/env node
// Pendientes · fase C: el navegador ya no escribe las marcas de idempotencia (PH-05) y, al mover un
// trabajo de fecha, cada persona recibe un solo aviso (PH-08). Contra el Supabase LOCAL con las
// funciones servidas.
// Uso: node scripts/garser-empresas/verify-idempotency-notices.mjs

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  accounts, createCompany, joinTeam, makeRecorder, pay, rest, rpc, runVerification, setAvailability, signIn, sql, why, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('idempotency-notices.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const D1 = day(66);
const D2 = day(67);
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
const status = (id) => sql(`select status from public.bookings where id='${id}'`);
const outbox = (id, type) => sql(`select coalesce(string_agg(status, ',' order by created_at), '') from public.notification_outbox where booking_id='${id}' and type='${type}'`);
const waitOutbox = async (id, type, n) => {
  for (let i = 0; i < 30; i++) {
    const rows = outbox(id, type);
    if (rows.split(',').filter((x) => x === 'sent' || x === 'failed').length >= n) return rows;
    await new Promise((r) => setTimeout(r, 700));
  }
  return outbox(id, type);
};
// Todo el registro (sin `--since`): las cuentas son nuevas en cada pasada.
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const mailsTo = (email, subject) => edgeLog().split('MOCK EMAIL SEND').filter((c) => c.includes(email) && c.includes(subject)).length;
const accept = (id, token, op = randomUUID()) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: op }, token);

async function newFreelancer(label) {
  const u = await acc.newUser(label, 'gardener');
  sql(`update public.profiles set role = 'gardener', full_name = 'Autónomo ${label}' where user_id = '${u.id}'`);
  sql(`insert into public.gardener_profiles select * from jsonb_populate_record(null::public.gardener_profiles,
        (select to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(), 'user_id', '${u.id}', 'full_name', 'Autónomo ${label}')
         from public.gardener_profiles g where g.user_id = '${PROVIDER_ID}'))`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
       select '${u.id}', service_id, unit_type, price_per_unit, currency, true, additional_config from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}'`);
  return { ...u, token: await signIn(u.email) };
}

async function main() {
  const owner = await createCompany(acc.newUser, 'empresa-ic');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  setAvailability(ana.id, D1, HOURS);
  setAvailability(ana.id, D2, HOURS);
  const client = await acc.newUser('cliente');

  // ── PH-05: el navegador no escribe marcas ──────────────────────────────────────────────────
  const B1 = (await pay(owner.id, client, D1, 8)).bookingId;
  const op = randomUUID();
  const forged = await rest('POST', '/rest/v1/booking_rpc_idempotency', owner.token, {
    actor_id: owner.id, action: 'respond_booking_request', operation_id: op, booking_id: B1, payload_signature: `${B1}|accept`, response_payload: { status: 'confirmed' },
  });
  const forgedBatch = await rest('POST', '/rest/v1/booking_batch_rpc_idempotency', owner.token, { actor_id: owner.id, action: 'x', operation_id: randomUUID() });
  const helperReg = await rpc('register_booking_operation_once', { p_action: 'respond_booking_request', p_booking_id: B1, p_operation_id: op, p_payload_signature: `${B1}|accept` }, owner.token);
  const helperDone = await rpc('complete_booking_operation', { p_action: 'respond_booking_request', p_operation_id: op, p_response_payload: { status: 'confirmed' } }, owner.token);
  record('IC-01', 'Ni la empresa ni nadie puede escribir una marca de operación (ni de lotes) ni llamar a los ayudantes internos',
    !!B1 && !forged.ok && !forgedBatch.ok && !helperReg.ok && !helperDone.ok && count0(B1),
    `marca ${forged.status}, lotes ${forgedBatch.status}, registrar ${helperReg.status}, completar ${helperDone.status}`);

  // ── Aceptar dos veces con la misma operación: una sola vez, un solo correo ─────────────────
  const a1 = await accept(B1, owner.token, op);
  const a2 = await accept(B1, owner.token, op);
  const sentAccepted = await waitOutbox(B1, 'booking_accepted', 1);
  const mine = await rest('GET', `/rest/v1/booking_rpc_idempotency?operation_id=eq.${op}&select=action,completed_at`, owner.token);
  record('IC-02', 'Aceptar con la misma operación dos veces: se confirma una vez, las dos respuestas coinciden, 1 solo «aceptada» al cliente; la empresa lee su marca',
    a1.ok && a2.ok && JSON.stringify(a1.body) === JSON.stringify(a2.body) && status(B1) === 'confirmed' && sentAccepted === 'sent'
      && mailsTo(client.email, 'ha sido aceptada') === 1 && mine.rows.length === 1 && !!mine.rows[0].completed_at,
    `${JSON.stringify(a1.body).slice(0, 60)} / ${JSON.stringify(a2.body).slice(0, 60)}, estado ${status(B1)}, cola [${sentAccepted}], marca ${mine.rows.length}`);

  // ── Los demás caminos que usan marcas siguen igual (proponer y responder un precio) ────────
  // (Se propone sobre una solicitud aún pendiente, que es cuando se puede.)
  const B4 = (await pay(owner.id, client, D1, 14)).bookingId;
  const pop = randomUUID();
  const p1 = await rpc('propose_booking_price_change', { p_booking_id: B4, p_proposed_total_price: 70, p_reason: 'Más trabajo', p_operation_id: pop, p_expires_in_minutes: 1440 }, owner.token);
  const p2 = await rpc('propose_booking_price_change', { p_booking_id: B4, p_proposed_total_price: 70, p_reason: 'Más trabajo', p_operation_id: pop, p_expires_in_minutes: 1440 }, owner.token);
  const rop = randomUUID();
  const c1 = await rpc('respond_booking_price_change', { p_booking_id: B4, p_accept: false, p_operation_id: rop }, client.token);
  const c2 = await rpc('respond_booking_price_change', { p_booking_id: B4, p_accept: false, p_operation_id: rop }, client.token);
  record('IC-03', 'Proponer un precio y rechazarlo (cancela la solicitud), cada uno repetido con la misma operación: funcionan y la repetición no hace nada más',
    !!B4 && p1.ok && p2.ok && c1.ok && c2.ok && JSON.stringify(c1.body) === JSON.stringify(c2.body) && status(B4) === 'cancelled',
    `proponer ${p1.status}/${p2.status}${why(p1)}, responder ${c1.status}/${c2.status}${why(c1)} → ${status(B4)}`);

  // ── PH-08: mover de fecha con la MISMA persona → ella recibe «cambia de fecha», sin «Nuevo» ─
  const B2 = (await pay(owner.id, client, D1, 12)).bookingId;
  await accept(B2, owner.token);
  await waitOutbox(B2, 'job_assigned', 1);
  const prop = await rpc('propose_booking_reschedule', { p_booking_id: B2, p_date: D2, p_start_hour: 9, p_reason: null }, owner.token);
  const yes = await rpc('respond_booking_reschedule', { p_booking_id: B2, p_accept: true }, client.token);
  await waitOutbox(B2, 'booking_reschedule_answered', 1);
  const worker = sql(`select coalesce(string_agg(distinct assignee_id::text, ','), '') from public.booking_blocks where booking_id='${B2}'`);
  const m = { moved: mailsTo(ana.email, 'Tu trabajo cambia de fecha'), newJob: mailsTo(ana.email, `Nuevo trabajo: Corte de césped, `), owner: mailsTo(owner.email, 'El cliente acepta la nueva fecha') };
  record('IC-04', 'Mover de fecha cuando sigue yendo la misma persona (Ana): a Ana 1 «Tu trabajo cambia de fecha» (y ningún «Nuevo trabajo» de más), a la empresa 1',
    prop.ok && yes.ok && yes.body?.outcome === 'accepted' && worker === ana.id && m.moved === 1 && m.owner === 1 && m.newJob === 2,
    `${why(prop)}${why(yes)} ${JSON.stringify(m)} (los 2 «Nuevo trabajo» de Ana son de B1 y B2 al aceptarlas)`);

  // ── Regla 2: un autónomo acepta igual, también repitiendo la operación ─────────────────────
  const solo = await newFreelancer('solo');
  setAvailability(solo.id, D1, HOURS);
  const buyer = await acc.newUser('comprador');
  const B3 = (await pay(solo.id, buyer, D1, 9)).bookingId;
  const sop = randomUUID();
  const s1 = await accept(B3, solo.token, sop);
  const s2 = await accept(B3, solo.token, sop);
  const soloMail = await waitOutbox(B3, 'booking_accepted', 1);
  record('IC-05', 'Un autónomo acepta su solicitud (repitiendo la operación): confirmada una vez y 1 correo al cliente; sin avisos de equipo',
    !!B3 && s1.ok && s2.ok && status(B3) === 'confirmed' && soloMail === 'sent' && outbox(B3, 'job_assigned') === '',
    `${s1.status}/${s2.status}${why(s1)}, estado ${status(B3)}, cola [${soloMail}]`);
}

/** Ninguna marca para esa reserva antes de aceptar (la del intento falso no llegó a escribirse). */
function count0(bookingId) {
  return sql(`select count(*) from public.booking_rpc_idempotency where booking_id='${bookingId}'`) === '0';
}

await runVerification({ acc, results, main });
