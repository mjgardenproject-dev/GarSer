#!/usr/bin/env node
// GarSer Empresas · F6.1 — planificación (servidor), contra el Supabase LOCAL por los caminos
// reales: trabajos partidos al vender (D10), repartir y reasignar, alargar/acortar un trabajo
// repartido y la agenda de la empresa.
//
// Equipo de prueba (día D): Ana (césped) libre 9 · Luis (césped) libre 10 · Pepe (césped) libre
// 9-12 más tarde. Trabajo de césped de 2 horas.
//
// Uso:    node scripts/garser-empresas/verify-f6-planning.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rest, rpc, sql, why,
  setAvailability, freeHoursOf, validHours, pay, runVerification, apiUrl, anonKey,
} from './_company-harness.mjs';

const acc = accounts('f6-verify.local');
const { results, record } = makeRecorder();
const D = sql('select (current_date + 10)::text;').trim();

const hoursOf = (bookingId) =>
  sql(`select coalesce(string_agg(hour_block || ':' || assignee_id, ',' order by hour_block), '') from public.booking_blocks where booking_id='${bookingId}'`);

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-f6');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  const pepe = await joinTeam(acc.newUser, owner.token, 'pepe');
  const names = { [ana.id]: 'Ana', [luis.id]: 'Luis', [pepe.id]: 'Pepe' };
  const readable = (bookingId) => hoursOf(bookingId).split(',').filter(Boolean).map((x) => { const [h, w] = x.split(':'); return `${h}${names[w] ? names[w] : w}`; }).join(' ');
  setAvailability(ana.id, D, [9]);
  setAvailability(luis.id, D, [10]);
  const client = await acc.newUser('cliente');

  // ── D10: trabajos partidos al vender ─────────────────────────────────────────
  {
    const off = await validHours(owner.id, D);
    record('F6-10', 'Sin «aceptar trabajos partidos» (por defecto), Ana 9 + Luis 10 no venden un trabajo de 2 h', off.r.ok && !off.hours.split(',').includes('9'), `horas [${off.hours}]`);
    const byEmployee = await rpc('set_company_allow_split_jobs', { p_allow: true }, ana.token);
    const on = await rpc('set_company_allow_split_jobs', { p_allow: true }, owner.token);
    const after = await validHours(owner.id, D);
    record('F6-11', 'Con el ajuste encendido (solo lo cambia la dueña) sí se ofrece a las 9, por turnos',
      !byEmployee.ok && on.ok && after.hours.split(',').includes('9'), `empleada ${byEmployee.status}, dueña ${on.status}, horas [${after.hours}]`);
  }

  const sale = await pay(owner.id, client, D, 9);
  const B = sale.bookingId;
  record('F6-12', 'Se vende por turnos: la hora de las 9 a Ana y la de las 10 a Luis; las dos agendas, ocupadas',
    !!B && readable(B) === '9Ana 10Luis' && freeHoursOf(ana.id, D) === '' && freeHoursOf(luis.id, D) === '',
    `${sale.error || ''}reparto [${B ? readable(B) : ''}]`);
  if (!B) return;
  {
    const a = await rpc('my_jobs', { p_from: D, p_to: D }, ana.token);
    const l = await rpc('my_jobs', { p_from: D, p_to: D }, luis.token);
    record('F6-13', 'Cada uno ve el trabajo con SUS horas', a.body?.[0]?.my_hours?.join(',') === '9' && l.body?.[0]?.my_hours?.join(',') === '10',
      `Ana ${JSON.stringify(a.body?.[0]?.my_hours)}, Luis ${JSON.stringify(l.body?.[0]?.my_hours)}`);
  }

  // ── Alargar y acortar un trabajo repartido (negociación previa a aceptar) ────
  {
    setAvailability(luis.id, D, [11]);
    const price = Number(sql(`select total_price from public.bookings where id='${B}'`));
    const prop = await rpc('propose_booking_price_change', {
      p_booking_id: B, p_proposed_total_price: price + 10, p_reason: 'Prueba F6: una hora más', p_operation_id: randomUUID(),
      p_expires_in_minutes: 60, p_proposed_duration_hours: 3,
    }, owner.token);
    const resp = prop.ok ? await rpc('respond_booking_price_change', { p_booking_id: B, p_accept: true, p_operation_id: randomUUID() }, client.token) : prop;
    record('F6-14', 'Alargar un trabajo repartido: la hora nueva la hace quien hace la última (Luis)',
      resp.ok && readable(B) === '9Ana 10Luis 11Luis', `HTTP ${resp.status}${why(resp)}, reparto [${readable(B)}]`);
  }

  // ── Repartir y reasignar (dueña) ─────────────────────────────────────────────
  {
    setAvailability(pepe.id, D, [9, 10, 11, 12]);
    const bad = await rpc('assign_booking_hours', { p_booking_id: B, p_workers: [pepe.id] }, owner.token);
    const byEmployee = await rpc('assign_booking_hours', { p_booking_id: B, p_workers: [pepe.id, pepe.id, pepe.id] }, ana.token);
    record('F6-15', 'Repartir exige decir quién hace cada hora, y solo lo hace la dueña', !bad.ok && !byEmployee.ok, `incompleto ${bad.status}${why(bad)}, empleada ${byEmployee.status}`);
  }
  {
    const r = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: pepe.id }, owner.token);
    record('F6-01', 'Reasignar todo a alguien libre (Pepe): quienes iban quedan libres',
      r.ok && readable(B) === '9Pepe 10Pepe 11Pepe' && freeHoursOf(ana.id, D) === '9' && freeHoursOf(luis.id, D) === '10,11' &&
      JSON.stringify([...(r.body?.removedWorkerIds || [])].sort()) === JSON.stringify([ana.id, luis.id].sort()),
      `HTTP ${r.status}${why(r)}, reparto [${readable(B)}], libres Ana [${freeHoursOf(ana.id, D)}] Luis [${freeHoursOf(luis.id, D)}]`);
  }
  {
    const r = await rpc('assign_booking_hours', { p_booking_id: B, p_workers: [ana.id, luis.id, luis.id] }, owner.token);
    record('F6-05', 'Repartir a mano (Ana 9, Luis 10-11): el total de horas no cambia y cada una tiene a una persona',
      r.ok && readable(B) === '9Ana 10Luis 11Luis' && sql(`select duration_hours from public.bookings where id='${B}'`) === '3' && freeHoursOf(pepe.id, D) === '9,10,11,12',
      `HTTP ${r.status}${why(r)}, reparto [${readable(B)}]`);
  }
  {
    sql(`update public.availability set is_available = false where gardener_id='${pepe.id}' and date='${D}' and start_time='10:00'`);
    const r = await rpc('assign_booking_hours', { p_booking_id: B, p_workers: [pepe.id, pepe.id, luis.id] }, owner.token);
    record('F6-02', 'Pasar una hora a alguien ocupado: rechazado con la hora concreta, y nada cambia',
      !r.ok && /10:00/.test(r.body?.message || '') && readable(B) === '9Ana 10Luis 11Luis', `HTTP ${r.status}${why(r)}`);
  }

  // ── Aviso a cada persona de un trabajo repartido ─────────────────────────────
  {
    const acceptRes = await rpc('respond_booking_request', { p_booking_id: B, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
    const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'job_assigned', bookingId: B }),
    });
    const body = await res.json();
    record('F6-18', 'Al confirmarse un trabajo repartido, cada persona recibe su aviso (Ana y Luis: 2)', acceptRes.ok && res.ok && body?.sent === 2,
      `aceptar ${acceptRes.status}${why(acceptRes)}, correo ${res.status} ${JSON.stringify(body)}`);
  }

  // ── Agenda de la empresa ─────────────────────────────────────────────────────
  {
    const s = await rpc('company_schedule', { p_from: D, p_to: D }, owner.token);
    const job = (s.body?.jobs || []).find((j) => j.booking_id === B);
    const byEmployee = await rpc('company_schedule', { p_from: D, p_to: D }, ana.token);
    const tooLong = await rpc('company_schedule', { p_from: D, p_to: sql(`select (date '${D}' + 60)::text`) }, owner.token);
    record('F6-16', 'La dueña recibe su agenda en una llamada (equipo, horas libres y trabajos con quién hace cada hora); un empleado no',
      s.ok && (s.body?.members || []).length === 4 && job?.hours?.length === 3 && (s.body?.free || []).some((f) => f.user_id === pepe.id) &&
      !byEmployee.ok && !tooLong.ok,
      `HTTP ${s.status}${why(s)}, personas ${(s.body?.members || []).length}, horas del trabajo ${job?.hours?.length}, empleada ${byEmployee.status}, 60 días ${tooLong.status}`);
  }

  // ── Acortar (tras aceptar no se negocia; se prueba antes con otra venta) ─────
  {
    const client2 = await acc.newUser('cliente2');
    setAvailability(ana.id, D, [14]);
    setAvailability(luis.id, D, [15]);
    const s2 = await pay(owner.id, client2, D, 14);
    const before = s2.bookingId ? readable(s2.bookingId) : '';
    const price = s2.bookingId ? Number(sql(`select total_price from public.bookings where id='${s2.bookingId}'`)) : 0;
    const prop = s2.bookingId ? await rpc('propose_booking_price_change', {
      p_booking_id: s2.bookingId, p_proposed_total_price: Math.max(1, price - 5), p_reason: 'Prueba F6: una hora menos', p_operation_id: randomUUID(),
      p_expires_in_minutes: 60, p_proposed_duration_hours: 1,
    }, owner.token) : { ok: false };
    const resp = prop.ok ? await rpc('respond_booking_price_change', { p_booking_id: s2.bookingId, p_accept: true, p_operation_id: randomUUID() }, client2.token) : prop;
    record('F6-17', 'Acortar un trabajo repartido libera la hora a quien la tenía (Luis a las 15), no a otro',
      resp.ok && before === '14Ana 15Luis' && readable(s2.bookingId) === '14Ana' && freeHoursOf(luis.id, D).split(',').includes('15'),
      `${s2.error || ''}antes [${before}], después [${s2.bookingId ? readable(s2.bookingId) : ''}], Luis libre [${freeHoursOf(luis.id, D)}]`);
  }
}

await runVerification({ acc, results, main });
