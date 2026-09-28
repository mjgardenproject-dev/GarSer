#!/usr/bin/env node
// GarSer Empresas · F5.4 — qué ve el cliente de quién va (D6) y los correos al empleado cuando le
// asignan o le quitan un trabajo. Contra el Supabase LOCAL, con el token de cada persona.
//
// En local no hay clave de Brevo: los correos salen en modo simulado y se comprueban en el
// registro del contenedor de funciones (destinatario y asunto).
//
// Uso:    node scripts/garser-empresas/verify-f5-client.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import { execFileSync } from 'node:child_process';
import {
  accounts, createCompany, joinTeam, makeRecorder, rest, rpc, sql, why,
  setAvailability, pay, workerOf, runVerification, PROVIDER_ID, apiUrl, anonKey,
} from './_company-harness.mjs';

const acc = accounts('f5-client.local');
const { results, record } = makeRecorder();
const TOMORROW = sql("select ((now() at time zone 'Europe/Madrid')::date + 1)::text;").trim();
const LATER = sql("select ((now() at time zone 'Europe/Madrid')::date + 3)::text;").trim();
const EDGE = 'supabase_edge_runtime_GarSer-main_4';
const edgeLog = () => execFileSync('sh', ['-c', `docker logs --since 3m ${EDGE} 2>&1`], { encoding: 'utf8' });
const mail = async (token, body) => {
  const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, body: data };
};
const accept = (bookingId, token) => rpc('respond_booking_request', { p_booking_id: bookingId, p_response: 'accept', p_operation_id: crypto.randomUUID() }, token);

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-d6');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  sql(`update public.profiles set full_name = 'Ana García', phone = '600111222', avatar_url = 'https://example.com/ana.jpg' where user_id = '${ana.id}'`);
  sql(`update public.profiles set full_name = 'Luis Pérez', phone = '600333444' where user_id = '${luis.id}'`);
  setAvailability(ana.id, TOMORROW, [16, 17, 18, 19]);
  setAvailability(ana.id, LATER, [9, 10, 11, 12]);
  setAvailability(luis.id, TOMORROW, [16, 17, 18, 19]);
  const client = await acc.newUser('cliente');
  const stranger = await acc.newUser('otro');

  const soon = await pay(owner.id, client, TOMORROW, 16);
  if (!soon.bookingId) throw new Error(`No se pudo vender para mañana: ${soon.error || why(soon.confirm)}`);
  const later = await pay(owner.id, client, LATER, 9);
  const who = (b) => (workerOf(b) === ana.id ? 'Ana' : workerOf(b) === luis.id ? 'Luis' : workerOf(b));

  // ── D6 ───────────────────────────────────────────────────────────────────────
  {
    const pending = await rpc('booking_worker_for_client', { p_booking_id: soon.bookingId }, client.token);
    record('F5-40', 'Mientras la empresa no acepta, el cliente aún no ve quién va', pending.ok && pending.body === null, JSON.stringify(pending.body));
  }
  // Que vaya Ana, para comprobar nombre y foto.
  if (workerOf(soon.bookingId) !== ana.id) await rpc('assign_booking_worker', { p_booking_id: soon.bookingId, p_worker_id: ana.id }, owner.token);
  await accept(soon.bookingId, owner.token);
  if (later.bookingId) await accept(later.bookingId, owner.token);
  {
    const r = await rpc('booking_worker_for_client', { p_booking_id: soon.bookingId }, client.token);
    record('F5-11', 'El día antes, el cliente ve nombre (sin apellido completo) y foto de quien va, y nada más',
      // F6: también «workers» (todas las personas si el trabajo está repartido), con los mismos dos datos.
      r.ok && r.body?.name === 'Ana G.' && r.body?.avatar_url === 'https://example.com/ana.jpg' &&
      Object.keys(r.body || {}).every((k) => ['name', 'avatar_url', 'workers'].includes(k)) &&
      (r.body?.workers || []).every((w) => Object.keys(w).every((k) => ['name', 'avatar_url'].includes(k))) &&
      !/600111222|@/.test(JSON.stringify(r.body)),
      JSON.stringify(r.body));
  }
  {
    const early = later.bookingId ? await rpc('booking_worker_for_client', { p_booking_id: later.bookingId }, client.token) : { ok: false, body: 'sin reserva' };
    const other = await rpc('booking_worker_for_client', { p_booking_id: soon.bookingId }, stranger.token);
    const blocks = await rest('GET', `/rest/v1/booking_blocks?select=assignee_id&booking_id=eq.${soon.bookingId}`, client.token);
    const ownerBlocks = await rest('GET', `/rest/v1/booking_blocks?select=assignee_id&booking_id=eq.${soon.bookingId}`, owner.token);
    const profile = await rest('GET', `/rest/v1/profiles?select=phone&user_id=eq.${ana.id}`, client.token);
    record('F5-12', 'Tres días antes no lo ve; otro cliente tampoco; ni el id en la agenda (H-28) ni el teléfono de quien va',
      early.ok && early.body === null && other.ok && other.body === null && blocks.rows.length === 0 && ownerBlocks.rows.length > 0 && profile.rows.length === 0,
      `3 días ${JSON.stringify(early.body)}, otro ${JSON.stringify(other.body)}, agenda cliente ${blocks.rows.length} / dueña ${ownerBlocks.rows.length}, teléfono ${profile.rows.length}`);
  }
  {
    const soloBooking = sql(`select coalesce(max(id::text), '') from public.bookings where gardener_id = '${PROVIDER_ID}' and status = 'confirmed' limit 1`);
    const solo = soloBooking ? await rpc('booking_worker_for_client', { p_booking_id: soloBooking }, client.token) : { ok: true, body: null };
    record('F5-41', 'Con un autónomo no aplica (ya sabe quién va)', solo.ok && solo.body === null, JSON.stringify(solo.body));
  }

  // ── Correos al empleado ──────────────────────────────────────────────────────
  // Prueba real · F4 (R-07): quién va lo compara el SERVIDOR al final de cada cambio y apunta los
  // avisos en la cola; ya no los pide la pestaña de la dueña (antes no salían si la reserva se
  // confirmaba porque el cliente aceptaba una propuesta).
  const jobNotices = (b) => sql(`select coalesce(string_agg(type || '>' || (payload->>'workerId') || ':' || status, ',' order by created_at), '') from public.notification_outbox where booking_id = '${b}' and type in ('job_assigned','job_unassigned')`);
  const waitJobs = async (b) => {
    for (let i = 0; i < 30; i++) {
      if (!/:(pending|sending)/.test(jobNotices(b))) return jobNotices(b);
      await new Promise((r) => setTimeout(r, 700));
    }
    return jobNotices(b);
  };
  {
    const rows = await waitJobs(soon.bookingId);
    const byClient = await mail(client.token, { type: 'job_assigned', bookingId: soon.bookingId });
    const byEmployee = await mail(luis.token, { type: 'job_assigned', bookingId: soon.bookingId });
    const byOwner = await mail(owner.token, { type: 'job_assigned', bookingId: soon.bookingId, to: 'victima@ejemplo.com' });
    const log = edgeLog();
    record('F5-08', 'Al aceptar, el servidor avisa a quien va (Ana); nadie puede pedir el correo desde fuera ni cambiar el destinatario',
      rows === `job_assigned>${ana.id}:sent` && log.includes(ana.email) && /Nuevo trabajo: Corte de césped/.test(log) && !log.includes('victima@ejemplo.com')
        && [byClient, byEmployee, byOwner].every((r) => r.body?.skipped === 'server_managed'),
      `cola [${rows}], cliente ${JSON.stringify(byClient.body)}, dueña ${JSON.stringify(byOwner.body)}`);
  }
  {
    const r = await rpc('assign_booking_worker', { p_booking_id: soon.bookingId, p_worker_id: luis.id }, owner.token);
    const rows = await waitJobs(soon.bookingId);
    const log = edgeLog();
    record('F5-42', 'Al cambiar quién va: aviso a quien deja de ir (Ana) y a quien pasa a ir (Luis), una vez cada uno',
      r.ok && rows.split(',').sort().join(',') === [`job_assigned>${ana.id}:sent`, `job_unassigned>${ana.id}:sent`, `job_assigned>${luis.id}:sent`].sort().join(',')
        && log.includes('Ya no vas a este trabajo') && log.includes(luis.email),
      `cambio ${r.status}${why(r)} (ahora ${who(soon.bookingId)}), cola [${rows}]`);
  }
  {
    const pendingSale = await pay(owner.id, stranger, TOMORROW, 18);
    const rows = pendingSale.bookingId ? jobNotices(pendingSale.bookingId) : 'sin venta';
    record('F5-43', 'Un trabajo aún sin aceptar no genera aviso', rows === '', `cola [${rows}]${pendingSale.error ? ` ${pendingSale.error}` : ''}`);
  }
}

await runVerification({ acc, results, main });
