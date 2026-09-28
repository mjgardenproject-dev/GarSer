#!/usr/bin/env node
// Prueba real · F3: los avisos los apunta el servidor en la misma transacción que la acción y los
// envía notification-dispatch con reintentos (R-06 c, R-11); y el navegador ya no puede cambiar
// el estado de una reserva a mano (R-16). Contra el Supabase LOCAL, con el Vault local apuntando
// a las funciones (lifecycle_tick_url / lifecycle_tick_secret) y `supabase functions serve`.
// Uso: node scripts/garser-empresas/verify-notification-outbox.mjs

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  accounts, apiUrl, anonKey, createCompany, makeRecorder, pay, rest, rpc, runVerification, setAvailability,
  signIn, sql, why, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('outbox.local');
const { results, record } = makeRecorder();
const D = sql('select (current_date + 45)::text;').trim();
const D2 = sql('select (current_date + 46)::text;').trim();
const secret = (readFileSync(new URL('../../supabase/functions/.env', import.meta.url), 'utf8').match(/^LIFECYCLE_TICK_SECRET=(.*)$/m) || [])[1] || '';

const rowsFor = (bookingId) => sql(`select coalesce(string_agg(type || ':' || status, ',' order by created_at), '') from public.notification_outbox where booking_id = '${bookingId}'`);
const countType = (bookingId, type) => Number(sql(`select count(*) from public.notification_outbox where booking_id = '${bookingId}' and type = '${type}'`));
const propose = (id, price, token) => rpc('propose_booking_price_change', {
  p_booking_id: id, p_proposed_total_price: price, p_reason: 'Prueba outbox', p_operation_id: randomUUID(), p_expires_in_minutes: 1440,
}, token);
const respondPrice = (id, accept, token) => rpc('respond_booking_price_change', { p_booking_id: id, p_accept: accept, p_operation_id: randomUUID() }, token);
const respondRequest = (id, response, token, operationId = randomUUID()) =>
  rpc('respond_booking_request', { p_booking_id: id, p_response: response, p_operation_id: operationId }, token);
const dispatch = () => fetch(`${apiUrl}/functions/v1/notification-dispatch`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lifecycle-secret': secret }, body: '{}',
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const waitSent = async (bookingId, type, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = sql(`select coalesce(string_agg(status, ','), '') from public.notification_outbox where booking_id = '${bookingId}' and type = '${type}'`);
    if (s && !s.split(',').some((x) => x === 'pending' || x === 'sending')) return s;
    await new Promise((r) => setTimeout(r, 700));
  }
  return sql(`select coalesce(string_agg(status, ','), '') from public.notification_outbox where booking_id = '${bookingId}' and type = '${type}'`);
};

async function main() {
  const gardenerToken = await signIn('jardinero.local@test.local');
  const client = await acc.newUser('cliente');
  setAvailability(PROVIDER_ID, D, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  setAvailability(PROVIDER_ID, D2, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  try {
    // ── Propuesta de precio con la sesión del proveedor REVOCADA (el caso de producción) ──────
    const b1 = (await pay(PROVIDER_ID, client, D, 8)).bookingId;
    const second = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jardinero.local@test.local', password: 'Test123456!' }),
    }).then((r) => r.json());
    await fetch(`${apiUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${second.access_token}` } });
    const p1 = await propose(b1, 70, gardenerToken); // token de una sesión ya revocada, aún sin caducar
    const sent1 = await waitSent(b1, 'booking_price_change_proposed');
    record('NO-01', 'Proponer precio con la sesión revocada (lo de producción): el aviso queda en la cola y se envía, sin que el navegador pida nada',
      p1.ok && countType(b1, 'booking_price_change_proposed') === 1 && sent1 === 'sent', `propuesta ${p1.status}${why(p1)} · aviso ${sent1 || 'ninguno'}`);

    const a1 = await respondPrice(b1, true, client.token);
    const sentA = await waitSent(b1, 'booking_price_change_accepted');
    record('NO-02', 'El cliente acepta: 1 aviso «aceptada» enviado, y NO un «reserva aceptada» (confirma el precio, no el proveedor)',
      a1.ok && sentA === 'sent' && countType(b1, 'booking_accepted') === 0, `[${rowsFor(b1)}]${why(a1)}`);

    // ── Aceptar / rechazar una solicitud (envoltura de respond_booking_request) ────────────────
    const b2 = (await pay(PROVIDER_ID, client, D, 11)).bookingId;
    const op = randomUUID();
    const r2 = await respondRequest(b2, 'accept', gardenerToken, op);
    const r2again = await respondRequest(b2, 'accept', gardenerToken, op); // reintento idempotente
    const sent2 = await waitSent(b2, 'booking_accepted');
    record('NO-03', 'Aceptar la solicitud: 1 solo «reserva aceptada», también si el navegador reintenta la misma operación',
      r2.ok && r2again.ok && countType(b2, 'booking_accepted') === 1 && sent2 === 'sent', `[${rowsFor(b2)}]${why(r2)}`);
    const late = await respondRequest(b2, 'reject', gardenerToken);
    record('NO-04', '«La reserva ya no está pendiente» no apunta ningún rechazo',
      late.ok && countType(b2, 'booking_rejected') === 0, `[${rowsFor(b2)}]`);

    const b3 = (await pay(PROVIDER_ID, client, D, 14)).bookingId;
    const r3 = await respondRequest(b3, 'reject', gardenerToken);
    const sent3 = await waitSent(b3, 'booking_rejected');
    record('NO-05', 'Rechazar la solicitud: 1 aviso «no ha podido aceptarla» enviado', r3.ok && sent3 === 'sent', `[${rowsFor(b3)}]${why(r3)}`);

    // ── R-11: la propuesta caduca ──────────────────────────────────────────────────────────────
    const b4 = (await pay(PROVIDER_ID, client, D, 16)).bookingId;
    await propose(b4, 90, await signIn('jardinero.local@test.local'));
    sql(`update public.bookings set proposed_price_expires_at = now() - interval '1 minute' where id = '${b4}'`);
    sql('select private.expire_overdue_price_changes();');
    const sent4 = await waitSent(b4, 'booking_price_change_expired');
    record('NO-06', 'R-11: al caducar la propuesta sale el aviso «ha caducado» (antes no avisaba a nadie)', sent4 === 'sent', `[${rowsFor(b4)}]`);

    // ── El navegador ya no puede pedir estos correos (web vieja en caché) ─────────────────────
    const legacy = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'booking_price_change_accepted', bookingId: b1 }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    record('NO-07', 'Una pestaña con la web vieja que pide el correo desde el navegador recibe «server_managed» (no se duplica)',
      legacy.status === 200 && legacy.body?.skipped === 'server_managed', JSON.stringify(legacy.body));

    // ── Nadie de fuera toca la cola ────────────────────────────────────────────────────────────
    const readQ = await rest('GET', '/rest/v1/notification_outbox?select=id&limit=1', client.token);
    const claimQ = await rpc('claim_notification_outbox', { p_limit: 5 }, client.token);
    const unauth = await fetch(`${apiUrl}/functions/v1/notification-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    record('NO-08', 'Un usuario no puede leer la cola ni reclamar avisos, y la función sin secreto responde 401',
      !readQ.ok && !claimQ.ok && unauth.status === 401, `leer ${readQ.status}, reclamar ${claimQ.status}, función ${unauth.status}`);

    // ── Reintentos y fallos ────────────────────────────────────────────────────────────────────
    const fakeBooking = randomUUID();
    sql(`select private.enqueue_notification('booking_accepted', 'prueba-404:${fakeBooking}', '${fakeBooking}', jsonb_build_object('bookingId', '${fakeBooking}'))`);
    const dup = sql(`select private.enqueue_notification('booking_accepted', 'prueba-404:${fakeBooking}', '${fakeBooking}', '{}'::jsonb)`);
    const failed = await waitSent(fakeBooking, 'booking_accepted');
    record('NO-09', 'La misma clave no se apunta dos veces, y un aviso sin arreglo (reserva inexistente, 404) queda «failed» sin reintentar',
      dup === '' && failed === 'failed' && countType(fakeBooking, 'booking_accepted') === 1, `estado ${failed}`);

    const retryId = sql(`select private.enqueue_notification('booking_accepted', 'prueba-reintento:${randomUUID()}', null, '{}'::jsonb)`);
    sql(`update public.notification_outbox set status = 'sending', attempts = 1, locked_until = now() + interval '5 minutes' where id = '${retryId}'`);
    const s1 = sql(`select public.complete_notification_outbox('${retryId}', false, 'HTTP 500: prueba', false)`);
    const gap = Number(sql(`select round(extract(epoch from next_attempt_at - now()) / 60) from public.notification_outbox where id = '${retryId}'`));
    sql(`update public.notification_outbox set attempts = 5 where id = '${retryId}'`);
    const s5 = sql(`select public.complete_notification_outbox('${retryId}', false, 'HTTP 500: prueba', false)`);
    record('NO-10', 'Un fallo pasajero vuelve a la cola (1 min tras el primer intento) y al quinto queda «failed»',
      s1 === 'pending' && gap === 1 && s5 === 'failed', `${s1} (+${gap} min) → ${s5}`);
    sql(`delete from public.notification_outbox where id = '${retryId}' or booking_id = '${fakeBooking}'`);

    // ── Dos pasadas a la vez no mandan el mismo aviso dos veces ────────────────────────────────
    const b5 = (await pay(PROVIDER_ID, client, D2, 8)).bookingId;
    await propose(b5, 75, await signIn('jardinero.local@test.local'));
    await Promise.all([dispatch(), dispatch(), dispatch()]);
    await waitSent(b5, 'booking_price_change_proposed');
    const attempts = sql(`select attempts || ':' || status from public.notification_outbox where booking_id = '${b5}' and type = 'booking_price_change_proposed'`);
    record('NO-11', 'Tres pasadas a la vez: el aviso se envía una sola vez (1 intento)', attempts === '1:sent', attempts);

    // ── R-16: el navegador ya no cambia estados ─────────────────────────────────────────────────
    const b6 = (await pay(PROVIDER_ID, client, D2, 11)).bookingId;
    const patchG = await rest('PATCH', `/rest/v1/bookings?id=eq.${b6}`, await signIn('jardinero.local@test.local'), { status: 'confirmed' });
    const patchC = await rest('PATCH', `/rest/v1/bookings?id=eq.${b6}`, client.token, { status: 'cancelled' });
    const statusAfter = sql(`select status from public.bookings where id = '${b6}'`);
    record('NO-12', 'R-16: ni el jardinero ni el cliente pueden cambiar el estado de la reserva por PostgREST',
      !patchG.ok && !patchC.ok && statusAfter === 'pending', `jardinero ${patchG.status}, cliente ${patchC.status}, estado ${statusAfter}`);
    await respondRequest(b6, 'reject', await signIn('jardinero.local@test.local'));

    // ── Incidencias y solicitudes de alta ───────────────────────────────────────────────────────
    const b7 = (await pay(PROVIDER_ID, client, D2, 14)).bookingId;
    sql(`insert into public.booking_incidents (booking_id, reported_by, reporter_role, kind, description, status)
         values ('${b7}', '${client.id}', 'client', 'other', 'Prueba de la cola de avisos', 'open')`);
    record('NO-13', 'Abrir una incidencia apunta el acuse «Hemos recibido tu incidencia»', countType(b7, 'booking_incident_received') === 1, `[${rowsFor(b7)}]`);
    sql(`delete from public.booking_incidents where booking_id = '${b7}'`);

    const company = await createCompany(acc.newUser, 'outbox-empresa');
    const appId = sql(`select id from public.company_applications where user_id = '${company.id}'`);
    const appRow = sql(`select type || ':' || (payload->>'companyApplicationId' = '${appId}')::text from public.notification_outbox where type = 'company_approved' and payload->>'companyApplicationId' = '${appId}'`);
    record('NO-14', 'Aprobar una empresa apunta su correo «ya estás dada de alta» (antes lo pedía la pestaña del admin)', appRow === 'company_approved:true', appRow || 'ninguno');
  } finally {
    for (const day of [D, D2]) {
      sql(`delete from public.availability where gardener_id = '${PROVIDER_ID}' and date = '${day}'`);
      sql(`delete from public.availability_blocks where gardener_id = '${PROVIDER_ID}' and date = '${day}'`);
    }
  }
}

await runVerification({ acc, results, main });
