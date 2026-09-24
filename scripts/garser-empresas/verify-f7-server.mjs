#!/usr/bin/env node
// GarSer Empresas · F7.1 — equipos y trabajos de varios días en el SERVIDOR (planificador SQL,
// pago, agenda), contra el Supabase LOCAL por los caminos reales.
//
// La web aún no ofrece estos trabajos (eso es F7.2): el presupuesto se pide por la web para un
// trabajo normal y luego se le ponen las horas de trabajo del caso (lo que hará el motor de la
// web). A partir de ahí, pago y agenda van por sus funciones reales.
//
// Empresa con Ana, Luis y Eva (césped). Uso: node scripts/garser-empresas/verify-f7-server.mjs

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, sql, why, authority,
  setAvailability, freeHoursOf, runVerification, LAWN, LAWN_INPUT, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('f7-server.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const D = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, day(20 + i)]));

/** Presupuesto real de la web para un trabajo normal, con L horas de trabajo. */
async function quote(provider, client, date, hour, labour) {
  const q = await authority(
    { action: 'create_quote', serviceId: LAWN, providerId: provider, date, startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: LAWN_INPUT },
    { accessToken: client.token },
  );
  if (!q.ok || !q.body?.quoteId) throw new Error(`create_quote ${q.status}${why(q)}`);
  sql(`update public.booking_quotes set estimated_hours = ${labour} where id = '${q.body.quoteId}'`);
  return q.body.quoteId;
}

async function payQuote(quoteId, client) {
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}`, prep };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId, p_stripe_event_id: `evt_f7_${randomUUID()}`, p_stripe_payment_intent_id: `pi_f7_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents, p_currency: 'eur', p_gateway_payload: {},
  });
  return { bookingId: conf.body?.bookingId ?? null, conf };
}

const plan = (provider, date, hour, labour, ignore = null) =>
  sql(`select coalesce(string_agg(date::text || '@' || hour_block || ':' || worker_id, ',' order by date, hour_block, worker_id), '')
       from public.plan_booking_cells('${provider}', '${LAWN}', '${date}', ${hour}, ${labour}, false, ${ignore ? `'${ignore}'` : 'null'})`);
const bookingRow = (id) => sql(`select date::text || '|' || duration_hours || '|' || coalesce(labour_hours::text, '-') || '|' || coalesce(end_date::text, '-') || '|' || total_price from public.bookings where id='${id}'`);

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-equipo');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  const eva = await joinTeam(acc.newUser, owner.token, 'eva');
  const names = { [ana.id]: 'Ana', [luis.id]: 'Luis', [eva.id]: 'Eva' };
  // «8Ana 8Luis 9Ana…»: por día y hora, y dentro de la misma hora por nombre.
  const who = (s) => s.split(',').filter(Boolean).map((x) => { const [dh, w] = x.split(':'); const [d, h] = dh.split('@'); return { d, h: Number(h), n: names[w] || '?' }; })
    .sort((a, b) => a.d.localeCompare(b.d) || a.h - b.h || a.n.localeCompare(b.n)).map((c) => `${c.h}${c.n}`).join(' ');
  const cellsOf = (id) => sql(`select coalesce(string_agg(date::text || '@' || hour_block || ':' || assignee_id, ',' order by date, hour_block, assignee_id), '') from public.booking_blocks where booking_id='${id}'`);
  const client = await acc.newUser('cliente');

  // ── El límite de la empresa (D11) ──
  {
    const byEmployee = await rpc('set_company_max_crew', { p_max: 3 }, ana.token);
    const bad = await rpc('set_company_max_crew', { p_max: 0 }, owner.token);
    const ok = await rpc('set_company_max_crew', { p_max: 2 }, owner.token);
    const overview = await rpc('company_team_overview', {}, owner.token);
    record('F7-10', 'Solo la dueña fija cuántas personas van a la vez (1 a 10) y lo ve en su panel',
      !byEmployee.ok && !bad.ok && ok.ok && overview.body?.company?.max_crew === 2,
      `empleada ${byEmployee.status}, 0 → ${bad.status}, 2 → ${ok.status}, panel ${overview.body?.company?.max_crew}`);
  }

  // ── Equipo en un día ──
  setAvailability(ana.id, D[1], [8, 9, 10, 11, 14, 15]);
  setAvailability(luis.id, D[1], [8, 9, 10, 11]);
  {
    sql(`update public.companies set max_crew = 1 where provider_user_id = '${owner.id}'`);
    const alone = plan(owner.id, D[1], 8, 8);
    sql(`update public.companies set max_crew = 2 where provider_user_id = '${owner.id}'`);
    const crew = plan(owner.id, D[1], 8, 8);
    record('F7-11', 'Con límite 1 un trabajo de 8 h no cabe (nadie tiene 8 h); con límite 2 van Ana y Luis a la vez',
      alone === '' && who(crew) === '8Ana 8Luis 9Ana 9Luis 10Ana 10Luis 11Ana 11Luis', `límite 1 [${who(alone)}], límite 2 [${who(crew)}]`);
  }
  const q1 = await quote(owner.id, client, D[1], 8, 8);
  const quotePrice = sql(`select total_price from public.booking_quotes where id='${q1}'`);
  const sale = await payQuote(q1, client);
  const B1 = sale.bookingId;
  if (!B1) throw new Error(`No se pudo vender el trabajo de equipo: ${sale.error || why(sale.conf)}`);
  {
    const [date, dur, labour, end, price] = bookingRow(B1).split('|');
    const cells = cellsOf(B1).split(',');
    record('F7-01', 'Trabajo de 8 h de trabajo con 2 personas: 4 h de reloj y 8 filas en la agenda',
      date === D[1] && dur === '4' && labour === '8' && end === '-' && cells.length === 8, `${bookingRow(B1)} · ${cells.length} filas [${who(cellsOf(B1))}]`);
    record('F7-02', 'Cuesta lo que dice el presupuesto: ir dos personas no cambia el precio', Number(price) === Number(quotePrice), `reserva ${price}, presupuesto ${quotePrice}`);
    record('F7-03', 'A cada una se le descuentan 4 h, no 8 (a Ana le quedan las 14 y 15)',
      freeHoursOf(ana.id, D[1]) === '14,15' && freeHoursOf(luis.id, D[1]) === '', `Ana [${freeHoursOf(ana.id, D[1])}], Luis [${freeHoursOf(luis.id, D[1])}]`);
  }
  {
    setAvailability(ana.id, D[2], [8, 9, 10, 11]);
    const q = await quote(owner.id, client, D[2], 8, 8);
    const r = await payQuote(q, client);
    record('F7-07', 'Trabajo que necesita 2 personas con solo 1 libre: no se puede pagar', !r.bookingId && /ya no esta disponible/.test(r.error || ''), r.error || 'se vendió');
  }

  // ── Trabajos de equipo: qué se puede cambiar ──
  await rpc('respond_booking_request', { p_booking_id: B1, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  {
    const split = await rpc('assign_booking_hours', { p_booking_id: B1, p_workers: [ana.id, ana.id, ana.id, ana.id] }, owner.token);
    const all = await rpc('assign_booking_worker', { p_booking_id: B1, p_worker_id: eva.id }, owner.token);
    let resized = '';
    try { sql(`select public.resize_booking_schedule('${B1}', 6)`); resized = 'alargado'; } catch (e) { resized = /varias personas/.test(String(e.message)) ? 'rechazado' : String(e.message).slice(0, 80); }
    record('F7-12', 'En un trabajo de equipo no se reparte por horas, no se da «todo a una persona» ni se alarga',
      !split.ok && !all.ok && resized === 'rechazado', `repartir ${split.status}, todo a Eva ${all.status}, alargar ${resized}`);
  }
  {
    setAvailability(eva.id, D[1], [8, 9, 10]);
    const busy = await rpc('replace_booking_worker', { p_booking_id: B1, p_from: luis.id, p_to: eva.id }, owner.token);
    setAvailability(eva.id, D[1], [11]);
    const cands = await rpc('booking_replace_candidates', { p_booking_id: B1, p_from: luis.id }, owner.token);
    const byEmployee = await rpc('replace_booking_worker', { p_booking_id: B1, p_from: luis.id, p_to: eva.id }, ana.token);
    const ok = await rpc('replace_booking_worker', { p_booking_id: B1, p_from: luis.id, p_to: eva.id }, owner.token);
    record('F7-13', 'Cambiar a Luis por Eva en todo el trabajo: solo si Eva está libre en todas sus horas y solo la dueña',
      !busy.ok && /no está libre/.test(why(busy)) && (cands.body || []).some((c) => c.user_id === eva.id && c.is_free) && !byEmployee.ok && ok.ok &&
      who(cellsOf(B1)) === '8Ana 8Eva 9Ana 9Eva 10Ana 10Eva 11Ana 11Eva' && freeHoursOf(luis.id, D[1]) === '8,9,10,11' && freeHoursOf(eva.id, D[1]) === '' &&
      JSON.stringify(ok.body?.removedWorkerIds) === JSON.stringify([luis.id]) && JSON.stringify(ok.body?.addedWorkerIds) === JSON.stringify([eva.id]),
      `ocupada ${busy.status}${why(busy)}, empleada ${byEmployee.status}, dueña ${ok.status}${why(ok)} → [${who(cellsOf(B1))}], Luis libre [${freeHoursOf(luis.id, D[1])}]`);
  }
  // (Que el cliente ve a las dos personas se comprueba en F7.3: solo se enseña el día antes.)
  {
    setAvailability(ana.id, D[3], [10, 11, 12, 13]);
    setAvailability(luis.id, D[3], [10, 11, 12, 13]);
    const opts = await rpc('reschedule_options', { p_booking_id: B1, p_date: D[3] }, owner.token);
    const prop = await rpc('propose_booking_reschedule', { p_booking_id: B1, p_date: D[3], p_start_hour: 10, p_reason: 'lluvia' }, owner.token);
    const ans = await rpc('respond_booking_reschedule', { p_booking_id: B1, p_accept: true }, client.token);
    record('F7-15', 'Mover de fecha un trabajo de equipo vuelve a planificarlo: el día 3 a las 10 con Ana y Luis; las horas viejas quedan libres',
      (opts.body || []).join(',') === '10' && prop.ok && ans.body?.outcome === 'accepted' &&
      who(cellsOf(B1)) === '10Ana 10Luis 11Ana 11Luis 12Ana 12Luis 13Ana 13Luis' && bookingRow(B1).startsWith(`${D[3]}|4|8|-`) &&
      freeHoursOf(eva.id, D[1]) === '8,9,10,11' && freeHoursOf(ana.id, D[1]) === '8,9,10,11,14,15',
      `opciones [${(opts.body || []).join(',')}], ${prop.status}${why(prop)}, ${JSON.stringify(ans.body)} → ${bookingRow(B1)} [${who(cellsOf(B1))}]`);
  }

  // ── Varios días (D12, D13) ──
  // Días 5, 6, 8, 9 y 10 con Ana y Luis 4 h cada uno (el 7 no hay nadie). El día 6 Luis
  // trabaja por la tarde (desde su primera hora libre).
  for (const n of [5, 6, 8, 9, 10]) {
    setAvailability(ana.id, D[n], [8, 9, 10, 11]);
    setAvailability(luis.id, D[n], n === 6 ? [15, 16, 17, 18] : [8, 9, 10, 11]);
  }
  setAvailability(eva.id, D[5], [16, 17]);
  let B2;
  {
    const small = plan(owner.id, D[11], 8, 10);
    setAvailability(ana.id, D[11], [8, 9, 10, 11]);
    setAvailability(ana.id, D[12], [8, 9, 10, 11, 12, 13]);
    const noSplit = plan(owner.id, D[11], 8, 10);
    record('F7-16', 'Un trabajo de 12 h o menos nunca se parte en varios días', small === '' && noSplit === '', `[${who(small)}] [${who(noSplit)}]`);

    const q = await quote(owner.id, client, D[5], 8, 40);
    const r = await payQuote(q, client);
    B2 = r.bookingId;
    if (!B2) throw new Error(`No se pudo vender el trabajo de 40 h: ${r.error || why(r.conf)}`);
    const [, dur, labour, end] = bookingRow(B2).split('|');
    const perDay = sql(`select string_agg(date::text || ':' || n, ',' order by date) from (select date, count(*) n from public.booking_blocks where booking_id='${B2}' group by date) x`);
    record('F7-04', 'Trabajo de 40 h con 2 personas: 5 días (se salta el día sin nadie), del día 5 al 10',
      labour === '40' && end === D[10] && dur === '4' && perDay === [5, 6, 8, 9, 10].map((n) => `${D[n]}:8`).join(','),
      `${bookingRow(B2)} · por día ${perDay}`);
    const day6 = sql(`select string_agg(hour_block::text, ',' order by hour_block) from public.booking_blocks where booking_id='${B2}' and date='${D[6]}' and assignee_id='${luis.id}'`);
    const maxDay = sql(`select max(n) from (select assignee_id, date, count(*) n from public.booking_blocks where booking_id='${B2}' group by 1, 2) x`);
    record('F7-05', 'Ninguna persona pasa de 12 h en un día; el primer día dura ≤ 12 h; cada una sus horas libres seguidas (Luis el día 6, de 15 a 19)',
      Number(maxDay) <= 12 && Number(dur) <= 12 && day6 === '15,16,17,18' && freeHoursOf(eva.id, D[5]) === '16,17',
      `máx ${maxDay} h/día, primer día ${dur} h, Luis día 6 [${day6}]`);
  }
  {
    const luisJobs = await rpc('my_jobs', { p_from: D[8], p_to: D[8] }, luis.token);
    const job = (luisJobs.body || []).find((j) => j.booking_id === B2);
    const sched = await rpc('company_schedule', { p_from: D[9], p_to: D[9] }, owner.token);
    const sj = (sched.body?.jobs || []).find((j) => j.booking_id === B2);
    record('F7-17', 'Agendas: Luis ve el trabajo aunque empezó antes (sus horas por día, van 2); la empresa, con fin y horas de cada día',
      job && job.end_date === D[10] && job.team_size === 2 && (job.my_days || []).length === 5 && sj && sj.end_date === D[10] && sj.labour_hours === 40 &&
      (sj.hours || []).filter((h) => h.date === D[9]).length === 8,
      `empleado ${job ? `fin ${job.end_date}, equipo ${job.team_size}, días ${(job.my_days || []).length}` : 'no lo ve'}; empresa ${sj ? `fin ${sj.end_date}, L ${sj.labour_hours}` : 'no lo ve'}`);
  }
  {
    const due = sql(`select to_char(confirmation_prompt_due_at at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24') from public.bookings where id='${B2}'`);
    await rpc('respond_booking_request', { p_booking_id: B2, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
    const due2 = sql(`select to_char(confirmation_prompt_due_at at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24') from public.bookings where id='${B2}'`);
    record('F7-18', 'El aviso de «¿se hizo el trabajo?» es tras el último día, no tras el primero', due2 === `${D[10]} 21`, `antes de aceptar ${due || '-'}, aceptado ${due2}`);
  }
  {
    sql(`select public.release_booking_schedule('${B2}')`);
    const left = sql(`select count(*) from public.booking_blocks where booking_id='${B2}'`);
    const freeAll = [5, 6, 8, 9, 10].every((n) => freeHoursOf(ana.id, D[n]) === '8,9,10,11');
    record('F7-19', 'Al cancelar un trabajo de varios días quedan libres las horas de todos los días', left === '0' && freeAll && freeHoursOf(luis.id, D[6]) === '15,16,17,18', `bloques ${left}, Ana libre todos los días ${freeAll}`);
  }

  // ── Autónomo (D12): también varios días; siempre una persona ──
  {
    const far = [day(60), day(61)];
    sql(`delete from public.availability where gardener_id='${PROVIDER_ID}' and date in ('${far[0]}','${far[1]}')`);
    try {
      setAvailability(PROVIDER_ID, far[0], [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
      setAvailability(PROVIDER_ID, far[1], [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
      const p = plan(PROVIDER_ID, far[0], 8, 16).split(',');
      const people = new Set(p.map((x) => x.split(':')[1]));
      const days = new Set(p.map((x) => x.split('@')[0]));
      record('F7-20', 'Un autónomo también puede tener un trabajo de 16 h en 2 días (10 h + 6 h), él solo',
        p.length === 16 && people.size === 1 && people.has(PROVIDER_ID) && days.size === 2 &&
        p.filter((x) => x.startsWith(far[1])).map((x) => x.split('@')[1].split(':')[0]).join(',') === '8,9,10,11,12,13',
        `${p.length} horas, ${people.size} persona, ${days.size} días`);
    } finally {
      sql(`delete from public.availability where gardener_id='${PROVIDER_ID}' and date in ('${far[0]}','${far[1]}')`);
    }
  }
}

await runVerification({ acc, results, main });
