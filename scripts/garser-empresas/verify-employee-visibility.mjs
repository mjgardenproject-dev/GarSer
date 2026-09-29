#!/usr/bin/env node
// Prueba real · F4: el empleado solo ve (y solo puede abrir) los trabajos que ya son suyos —
// confirmados y con la persona decidida— (R-07, R-10); y el aviso de trabajo asignado/quitado lo
// apunta el servidor en todos los caminos, también cuando se confirma porque el cliente acepta una
// propuesta de precio (el caso del 2026-09-28). Contra el Supabase LOCAL con las funciones
// servidas y el Vault local configurado (ver verify-notification-outbox.mjs).
// Uso: node scripts/garser-empresas/verify-employee-visibility.mjs

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  accounts, createCompany, joinTeam, makeRecorder, pay, rpc, runVerification, setAvailability, signIn, sql,
  why, workerOf, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('employee-visibility.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const D1 = day(50);
const D2 = day(51);
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs --since 3m supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8' });

const jobs = async (token) => ((await rpc('my_jobs', { p_from: D1, p_to: D2 }, token)).body || []).map((j) => j.booking_id);
const notices = (bookingId) => sql(`select coalesce(string_agg(type || '>' || (payload->>'workerId'), ',' order by created_at), '') from public.notification_outbox where booking_id = '${bookingId}' and type in ('job_assigned','job_unassigned')`);
const accept = (id, token) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: randomUUID() }, token);
const waitSent = async (bookingId) => {
  for (let i = 0; i < 30; i++) {
    const open = Number(sql(`select count(*) from public.notification_outbox where booking_id = '${bookingId}' and type in ('job_assigned','job_unassigned') and status in ('pending','sending')`));
    if (open === 0) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
};

async function main() {
  const owner = await createCompany(acc.newUser, 'empresa-ev');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const client = await acc.newUser('cliente');
  const name = (id) => (id === ana.id ? 'Ana' : id);
  for (const d of [D1, D2]) setAvailability(ana.id, d, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

  // ── Solicitud pendiente: Ana tiene las horas apartadas, pero no la ve ni la abre ─────────────
  const b1 = (await pay(owner.id, client, D1, 8)).bookingId;
  const canOpen = await rpc('is_booking_assignee', { p_booking_id: b1 }, ana.token);
  const items = await rpc('can_read_booking_items', { p_booking_id: b1 }, ana.token);
  record('EV-01', 'Solicitud aún sin aceptar: Ana tiene las horas apartadas pero no la ve en «Mi trabajo» ni puede abrir sus datos (R-07, R-10)',
    workerOf(b1) === ana.id && !(await jobs(ana.token)).includes(b1) && canOpen.body === false && items.body === false && notices(b1) === '',
    `va ${name(workerOf(b1))}, abrir ${JSON.stringify(canOpen.body)}, ítems ${JSON.stringify(items.body)}, avisos [${notices(b1)}]`);

  const r1 = await accept(b1, owner.token);
  await waitSent(b1);
  record('EV-02', 'La empresa la acepta: Ana la ve y le llega 1 aviso «Nuevo trabajo»',
    r1.ok && (await jobs(ana.token)).includes(b1) && notices(b1) === `job_assigned>${ana.id}` && (await rpc('is_booking_assignee', { p_booking_id: b1 }, ana.token)).body === true,
    `avisos [${notices(b1)}]${why(r1)}`);

  // ── El caso de producción: se confirma porque el cliente acepta una propuesta de precio ──────
  const b2 = (await pay(owner.id, client, D1, 12)).bookingId;
  const p2 = await rpc('propose_booking_price_change', { p_booking_id: b2, p_proposed_total_price: 70, p_reason: 'Más trabajo', p_operation_id: randomUUID(), p_expires_in_minutes: 1440 }, owner.token);
  const a2 = await rpc('respond_booking_price_change', { p_booking_id: b2, p_accept: true, p_operation_id: randomUUID() }, client.token);
  await waitSent(b2);
  record('EV-03', 'Se confirma porque el cliente acepta la propuesta de precio: a Ana le llega su aviso (antes no)',
    p2.ok && a2.ok && notices(b2) === `job_assigned>${ana.id}` && (await jobs(ana.token)).includes(b2),
    `avisos [${notices(b2)}]${why(p2)}${why(a2)}`);

  // ── Modo «yo elijo quién va»: confirmada pero sin persona decidida ────────────────────────────
  sql(`update public.companies set assignment_mode = 'manual' where provider_user_id = '${owner.id}'`);
  const b3 = (await pay(owner.id, client, D2, 8)).bookingId;
  await accept(b3, owner.token);
  const pendingSeen = (await jobs(ana.token)).includes(b3);
  const pendingNotices = notices(b3);
  const decide = await rpc('assign_booking_worker', { p_booking_id: b3, p_worker_id: ana.id }, owner.token);
  await waitSent(b3);
  record('EV-04', 'Modo manual: confirmada pero sin decidir, Ana no la ve ni recibe aviso; al decidirla, la ve y recibe 1 aviso',
    !pendingSeen && pendingNotices === '' && decide.ok && (await jobs(ana.token)).includes(b3) && notices(b3) === `job_assigned>${ana.id}`,
    `antes: ve ${pendingSeen}, avisos [${pendingNotices}] · después [${notices(b3)}]${why(decide)}`);
  sql(`update public.companies set assignment_mode = 'auto' where provider_user_id = '${owner.id}'`);

  // ── Cambio de persona y repetición ───────────────────────────────────────────────────────────
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  setAvailability(luis.id, D2, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const toLuis = await rpc('assign_booking_worker', { p_booking_id: b3, p_worker_id: luis.id }, owner.token);
  await waitSent(b3);
  const afterMove = notices(b3);
  const again = await rpc('assign_booking_worker', { p_booking_id: b3, p_worker_id: luis.id }, owner.token);
  await waitSent(b3);
  record('EV-05', 'Pasar el trabajo de Ana a Luis: aviso «ya no vas» a Ana y «nuevo trabajo» a Luis; repetirlo no manda nada más',
    toLuis.ok && [...afterMove.split(',')].sort().join(',') === [`job_assigned>${ana.id}`, `job_unassigned>${ana.id}`, `job_assigned>${luis.id}`].sort().join(',')
      && again.ok && notices(b3) === afterMove && !(await jobs(ana.token)).includes(b3),
    `[${notices(b3)}]${why(toLuis)}`);

  // ── Cancelación: a quien iba se le avisa ─────────────────────────────────────────────────────
  // Como la cancelación real: liberar la agenda y cancelar en la MISMA transacción.
  sql(`select public.release_booking_schedule('${b3}'); update public.bookings set status = 'cancelled', cancellation_actor = 'client', cancelled_at = now() where id = '${b3}';`);
  await waitSent(b3);
  const cancelledRow = sql(`select status from public.notification_outbox where booking_id = '${b3}' and type = 'job_unassigned' and payload->>'workerId' = '${luis.id}'`);
  record('EV-06', 'Si el trabajo se cancela, a Luis le llega «Trabajo cancelado: no tienes que ir»',
    cancelledRow === 'sent' && /Trabajo cancelado/.test(edgeLog()), `aviso ${cancelledRow || 'ninguno'}`);

  // ── El autónomo no cambia (Regla 2) ──────────────────────────────────────────────────────────
  const gardenerToken = await signIn('jardinero.local@test.local');
  setAvailability(PROVIDER_ID, D1, [8, 9, 10]);
  try {
    const b4 = (await pay(PROVIDER_ID, client, D1, 8)).bookingId;
    const r4 = await accept(b4, gardenerToken);
    record('EV-07', 'Autónomo: aceptar funciona igual y no genera avisos de «trabajo asignado»',
      r4.ok && notices(b4) === '' && sql(`select status from public.bookings where id = '${b4}'`) === 'confirmed', `avisos [${notices(b4)}]${why(r4)}`);
  } finally {
    sql(`delete from public.availability where gardener_id = '${PROVIDER_ID}' and date = '${D1}'`);
  }
}

await runVerification({ acc, results, main });
