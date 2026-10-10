#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
// GarSer Empresas · F6.3 — mover un trabajo de fecha con propuesta al cliente (D9), contra el
// Supabase LOCAL por los caminos reales.
//
// Ana (césped) libre D1 9-10 y D2 9-12; Luis (césped) libre D2 14-15. Trabajo de 2 h vendido el
// D1 a las 9 (Ana) y aceptado.
//
// Uso:    node scripts/garser-empresas/verify-f6-reschedule.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, sql, why,
  setAvailability, freeHoursOf, pay, runVerification, apiUrl, anonKey,
} from './_company-harness.mjs';

const acc = accounts('f6-move.local');
const { results, record } = makeRecorder();
const D1 = sql('select (current_date + 11)::text;').trim();
const D2 = sql('select (current_date + 12)::text;').trim();
const mail = async (token, body) => {
  const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, body: data };
};

// Prueba real · F3 (D24): los avisos del cambio de fecha los apunta el servidor al proponer y al
// responder (notification_outbox) y los envía notification-dispatch. Una llamada desde el
// navegador ya no envía nada.
// Todo el registro, sin `--since` (si el Mac duerme, el reloj de Docker se retrasa); las cuentas
// son nuevas en cada pasada, así que se busca por su correo.
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** Cuántos correos simulados ha recibido `email` cuyo asunto contiene `subject`. */
const mailsTo = (email, subject) => edgeLog().split('MOCK EMAIL SEND').filter((c) => c.includes(email) && c.includes(subject)).length;
const outboxOf = (bookingId, type) => sql(`select coalesce(string_agg(status, ',' order by created_at), '') from public.notification_outbox where booking_id='${bookingId}' and type='${type}'`);
const waitOutbox = async (bookingId, type, count) => {
  for (let i = 0; i < 30; i++) {
    const rows = outboxOf(bookingId, type);
    if (rows.split(',').filter((x) => x === 'sent' || x === 'failed').length >= count) return rows;
    await new Promise((r) => setTimeout(r, 700));
  }
  return outboxOf(bookingId, type);
};

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-mover');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  const names = { [ana.id]: 'Ana', [luis.id]: 'Luis' };
  setAvailability(ana.id, D1, [9, 10]);
  setAvailability(ana.id, D2, [9, 10, 11, 12]);
  setAvailability(luis.id, D2, [14, 15]);
  const client = await acc.newUser('cliente');
  const stranger = await acc.newUser('otro');

  const sale = await pay(owner.id, client, D1, 9);
  const B = sale.bookingId;
  if (!B) throw new Error(`No se pudo vender: ${sale.error || why(sale.confirm)}`);
  await rpc('respond_booking_request', { p_booking_id: B, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  const state = () => sql(`select date::text || ' ' || to_char(start_time, 'HH24') || ' ' || reschedule_status from public.bookings where id='${B}'`);
  const agenda = () => sql(`select coalesce(string_agg(date::text || '@' || hour_block || ':' || assignee_id, ',' order by date, hour_block), '') from public.booking_blocks where booking_id='${B}'`)
    .split(',').filter(Boolean).map((x) => { const [dh, w] = x.split(':'); return `${dh.split('@')[1]}${names[w] || w}`; }).join(' ');

  {
    const opts = await rpc('reschedule_options', { p_booking_id: B, p_date: D2 }, owner.token);
    const byClient = await rpc('reschedule_options', { p_booking_id: B, p_date: D2 }, client.token);
    record('F6-30', 'La dueña ve a qué horas se podría mover (quien pueda hacerlo entero): 9, 10, 11 (Ana) y 14 (Luis)',
      opts.ok && (opts.body || []).join(',') === '9,10,11,14' && !byClient.ok, `horas [${(opts.body || []).join(',')}], cliente ${byClient.status}`);
  }
  {
    const byEmployee = await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 10, p_reason: 'x' }, ana.token);
    const nobody = await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 16, p_reason: 'x' }, owner.token);
    const ok = await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 10, p_reason: 'Llueve el día 1' }, owner.token);
    record('F6-31', 'Solo la dueña propone, y solo a una franja en la que alguien puede hacerlo',
      !byEmployee.ok && !nobody.ok && ok.ok && state().endsWith('pending_client'), `empleada ${byEmployee.status}, sin nadie ${nobody.status}${why(nobody)}, válida ${ok.status}${why(ok)}`);
  }
  {
    const rows = await waitOutbox(B, 'booking_reschedule_proposed', 1);
    const byOwner = await mail(owner.token, { type: 'booking_reschedule_proposed', bookingId: B });
    const byClient = await mail(client.token, { type: 'booking_reschedule_proposed', bookingId: B });
    record('F6-32', 'El aviso de la propuesta lo envía el servidor al cliente una sola vez; pedirlo desde el navegador no manda otro',
      rows === 'sent' && edgeLog().includes(client.email) && byOwner.body?.skipped === 'server_managed' && byClient.body?.skipped === 'server_managed',
      `cola [${rows}], empresa ${JSON.stringify(byOwner.body)}, cliente ${JSON.stringify(byClient.body)}`);
  }
  {
    const other = await rpc('respond_booking_reschedule', { p_booking_id: B, p_accept: true }, stranger.token);
    const reject = await rpc('respond_booking_reschedule', { p_booking_id: B, p_accept: false }, client.token);
    record('F6-33', 'Otro cliente no puede responder; si el cliente rechaza, NO cambia nada (ni se cancela)',
      !other.ok && reject.ok && state() === `${D1} 09 rejected` && agenda() === '9Ana 10Ana' && sql(`select status from public.bookings where id='${B}'`) === 'confirmed',
      `otro ${other.status}, rechazo ${reject.status} → ${state()} [${agenda()}]`);
    const rows = await waitOutbox(B, 'booking_reschedule_answered', 1);
    record('F6-34', 'La respuesta avisa a la empresa (rechazo: solo a ella), desde el servidor', rows === 'sent' && edgeLog().includes(owner.email), `cola [${rows}]`);
  }
  {
    await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 14, p_reason: null }, owner.token);
    const accept = await rpc('respond_booking_reschedule', { p_booking_id: B, p_accept: true }, client.token);
    record('F6-04', 'El cliente acepta: la reserva pasa a D2 a las 14 con Luis; las horas viejas de Ana quedan libres y las nuevas, ocupadas',
      accept.ok && accept.body?.outcome === 'accepted' && state() === `${D2} 14 accepted` && agenda() === '14Luis 15Luis' &&
      freeHoursOf(ana.id, D1) === '9,10' && freeHoursOf(luis.id, D2) === '',
      `HTTP ${accept.status}${why(accept)} ${JSON.stringify(accept.body)} → ${state()} [${agenda()}], Ana D1 libre [${freeHoursOf(ana.id, D1)}]`);
    const rows = await waitOutbox(B, 'booking_reschedule_answered', 2);
    await waitOutbox(B, 'job_assigned', 2);
    await waitOutbox(B, 'job_unassigned', 1);
    // PH-08: quien entra (Luis) recibe solo «Nuevo trabajo», que ya trae la fecha nueva; antes le
    // llegaba también «Tu trabajo cambia de fecha». La empresa, «acepta la nueva fecha»; Ana, «Ya no vas».
    const m = {
      luisNew: mailsTo(luis.email, 'Nuevo trabajo:'), luisMoved: mailsTo(luis.email, 'Tu trabajo cambia de fecha'),
      owner: mailsTo(owner.email, 'El cliente acepta la nueva fecha'), anaOut: mailsTo(ana.email, 'Ya no vas a este trabajo'),
    };
    record('F6-35', 'Al aceptar: la empresa recibe «acepta la nueva fecha», Luis (entra) solo «Nuevo trabajo» y Ana «Ya no vas»; desde el servidor',
      rows === 'sent,sent' && m.luisNew === 1 && m.luisMoved === 0 && m.owner === 1 && m.anaOut === 1, `cola [${rows}] ${JSON.stringify(m)}`);
  }
  {
    await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 10, p_reason: null }, owner.token);
    sql(`update public.availability set is_available = false where gardener_id='${ana.id}' and date='${D2}' and start_time='11:00'`);
    const late = await rpc('respond_booking_reschedule', { p_booking_id: B, p_accept: true }, client.token);
    record('F6-36', 'Si al aceptar ya no hay nadie libre, no se mueve nada y la propuesta caduca',
      late.ok && late.body?.outcome === 'no_longer_available' && state() === `${D2} 14 expired` && agenda() === '14Luis 15Luis',
      `${JSON.stringify(late.body)} → ${state()} [${agenda()}]`);
  }
  {
    await rpc('propose_booking_reschedule', { p_booking_id: B, p_date: D2, p_start_hour: 9, p_reason: null }, owner.token);
    sql(`update public.bookings set reschedule_expires_at = now() - interval '1 minute' where id='${B}'`);
    const expired = await rpc('respond_booking_reschedule', { p_booking_id: B, p_accept: true }, client.token);
    record('F6-37', 'Una propuesta caducada (48 h) ya no se puede aceptar', expired.ok && expired.body?.outcome === 'expired' && state() === `${D2} 14 expired`, JSON.stringify(expired.body));
  }
}

await runVerification({ acc, results, main });
