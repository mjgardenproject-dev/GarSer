#!/usr/bin/env node
// GarSer Empresas · F7.2 — la web (booking-authority) ofrece trabajos de equipo y de varios
// días con la MISMA regla que aparta las horas al pagar (plan_booking_cells), contra el
// Supabase LOCAL por los caminos reales (presupuesto de la web → pago → agenda).
//
// Césped: 300 m² = 2 h, 1200 m² = 8 h, 3000 m² = 18 h, 6000 m² = 36 h de trabajo.
// Uso: node scripts/garser-empresas/verify-f7-web.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, sql, why, authority, pay, rpc,
  setAvailability, runVerification, LAWN, LAWN_INPUT, PROVIDER_ID, apiUrl, anonKey,
} from './_company-harness.mjs';

const acc = accounts('f7-web.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const lawn = (m2) => ({ ...LAWN_INPUT, lawnZones: [{ quantity: m2, state: 'normal' }] });
const valid = async (provider, date, m2) => {
  const r = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: provider, date, bookingInput: lawn(m2) });
  return { r, hours: (r.body?.validHours || []).join(','), labour: Math.ceil(Number(r.body?.quote?.estimatedHours || 0)) };
};
const quoteAt = (provider, client, date, hour, m2) => authority(
  { action: 'create_quote', serviceId: LAWN, providerId: provider, date, startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: lawn(m2) },
  { accessToken: client.token },
);
const sqlValidHours = (provider, date, labour) => sql(`select coalesce(string_agg(h::text, ',' order by h), '') from generate_series(0, 19) h
  where exists (select 1 from public.plan_booking_cells('${provider}', '${LAWN}', '${date}', h, ${labour}, false, null))`);

const mail = async (token, body) => {
  const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, body: data };
};

// Generador pseudoaleatorio con semilla (la prueba se puede repetir igual).
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-web');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  const eva = await joinTeam(acc.newUser, owner.token, 'eva');
  const client = await acc.newUser('cliente');
  sql(`update public.companies set max_crew = 2 where provider_user_id = '${owner.id}'`);

  // ── Equipo en un día ──
  const D1 = day(20);
  const D2 = day(21);
  setAvailability(ana.id, D1, [8, 9, 10, 11]);
  setAvailability(luis.id, D1, [8, 9, 10, 11]);
  setAvailability(ana.id, D2, [8, 9, 10, 11, 12, 13, 14, 15]);
  {
    sql(`update public.companies set max_crew = 1 where provider_user_id = '${owner.id}'`);
    const alone = await valid(owner.id, D1, 1200);
    sql(`update public.companies set max_crew = 2 where provider_user_id = '${owner.id}'`);
    const crew = await valid(owner.id, D1, 1200);
    record('F7-21', 'La web ofrece un trabajo de 8 h a las 8 con dos personas a la vez (con límite 1, ninguna hora)',
      alone.hours === '' && crew.hours === '8' && crew.labour === 8, `límite 1 [${alone.hours}], límite 2 [${crew.hours}] (${crew.labour} h)`);
  }
  let B1;
  {
    const q = await quoteAt(owner.id, client, D1, 8, 1200);
    const slot = q.body?.availability?.selectedSlot || {};
    const solo = await quoteAt(owner.id, client, D2, 8, 1200);
    record('F7-02', 'Mismo trabajo: con dos personas (4 h de reloj) cuesta lo mismo que con una (8 h)',
      q.ok && solo.ok && q.body.totalPrice === solo.body.totalPrice && slot.durationHours === 4 && slot.crew === 2 && slot.labourHours === 8 &&
      solo.body?.availability?.selectedSlot?.crew === 1 && solo.body?.availability?.selectedSlot?.durationHours === 8,
      `equipo ${q.body?.totalPrice} € (${slot.durationHours} h, ${slot.crew} pers.), solo ${solo.body?.totalPrice} € (${solo.body?.availability?.selectedSlot?.durationHours} h)${why(q)}`);
    const sale = await pay(owner.id, client, D1, 8, { input: lawn(1200) });
    B1 = sale.bookingId;
    const shape = B1 ? sql(`select duration_hours || '|' || labour_hours || '|' || (select count(*) from public.booking_blocks where booking_id='${B1}') from public.bookings where id='${B1}'`) : '';
    record('F7-22', 'Del presupuesto de la web al pago: la reserva sale con 4 h de reloj, 8 de trabajo y 8 filas', shape === '4|8|8', `${shape || sale.error || why(sale.confirm)}`);
  }

  // ── Varios días (D12) ──
  const M = [30, 31, 33, 34, 35].map(day); // el día 32 no hay nadie
  M.forEach((d) => { setAvailability(ana.id, d, [8, 9, 10, 11]); setAvailability(luis.id, d, [8, 9, 10, 11]); });
  {
    const v = await valid(owner.id, M[0], 6000);
    const q = await quoteAt(owner.id, client, M[0], 8, 6000);
    const slot = q.body?.availability?.selectedSlot || {};
    record('F7-23', 'Trabajo de 36 h: la web lo ofrece de 8 a 10 (a las 11 ya no llega) y el presupuesto dice del día 30 al 35 (saltando el 32), 2 personas',
      v.hours === '8,9,10' && q.ok && slot.endDate === M[4] && slot.crew === 2 && slot.labourHours === 36 && (slot.planDays || []).length === 5 &&
      !(slot.planDays || []).some((d) => d.date === day(32)),
      `horas [${v.hours}], fin ${slot.endDate}, ${slot.crew} pers., días ${(slot.planDays || []).map((d) => `${d.date.slice(8)}:${d.hours}`).join(' ')}${why(q)}`);
    const sale = await pay(owner.id, client, M[0], 8, { input: lawn(6000) });
    const row = sale.bookingId ? sql(`select coalesce(end_date::text, '-') || '|' || labour_hours from public.bookings where id='${sale.bookingId}'`) : '';
    record('F7-24', 'Se paga y la reserva queda del día 30 al 35 con 36 h de trabajo', row === `${M[4]}|36`, row || sale.error || why(sale.confirm));
    if (sale.bookingId) {
      await rpc('respond_booking_request', { p_booking_id: sale.bookingId, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
      const sent = await mail(owner.token, { type: 'job_assigned', bookingId: sale.bookingId });
      const accepted = await mail(owner.token, { type: 'booking_accepted', bookingId: sale.bookingId });
      record('F7-27', 'Al aceptar un trabajo de varios días se avisa a cada persona que va (2) y al cliente', sent.ok && sent.body?.sent === 2 && accepted.ok,
        `empleados ${JSON.stringify(sent.body)}, cliente ${accepted.status}`);
    }
  }
  {
    // F7-14: el cliente ve quién va el día antes, también cuando van dos.
    const T = day(1);
    setAvailability(ana.id, T, [15, 16, 17, 18]);
    setAvailability(luis.id, T, [15, 16, 17, 18]);
    const sale = await pay(owner.id, client, T, 15, { input: lawn(1200) });
    if (sale.bookingId) await rpc('respond_booking_request', { p_booking_id: sale.bookingId, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
    const people = sale.bookingId ? await rpc('booking_worker_for_client', { p_booking_id: sale.bookingId }, client.token) : null;
    record('F7-14', 'El día antes, el cliente ve a las dos personas que van', (people?.body?.workers || []).length === 2,
      people ? JSON.stringify(people.body?.workers?.map((w) => w.name)) : (sale.error || why(sale.confirm)));
  }
  {
    const mailDay = day(40);
    setAvailability(eva.id, mailDay, [8, 9, 10, 11]);
    const v = await valid(owner.id, mailDay, 3000);
    record('F7-25', 'Si no hay días suficientes en 3 semanas, no se ofrece (18 h con solo 4 h libres)', v.hours === '' && v.r.body?.exclusion?.code === 'no_reservable_availability',
      `[${v.hours}] ${v.r.body?.exclusion?.code || ''}`);
  }

  // ── Autónomo (D12) ──
  {
    const far = [day(60), day(61)];
    sql(`delete from public.availability where gardener_id='${PROVIDER_ID}' and date in ('${far[0]}','${far[1]}')`);
    try {
      setAvailability(PROVIDER_ID, far[0], [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
      setAvailability(PROVIDER_ID, far[1], [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
      const v = await valid(PROVIDER_ID, far[0], 3000);
      const sale = await pay(PROVIDER_ID, client, far[0], 8, { input: lawn(3000) });
      const row = sale.bookingId ? sql(`select duration_hours || '|' || coalesce(end_date::text, '-') || '|' || labour_hours from public.bookings where id='${sale.bookingId}'`) : '';
      record('F7-26', 'Un autónomo con 10 h libres dos días seguidos: la web le ofrece un trabajo de 18 h de 8 a 10 (antes imposible, T7) y se reserva del día 60 al 61',
        v.hours === '8,9,10' && row === `10|${far[1]}|18`, `horas [${v.hours}], reserva ${row || sale.error || why(sale.confirm)}`);
      if (sale.bookingId) {
        sql(`select public.release_booking_schedule('${sale.bookingId}')`);
        sql(`delete from public.bookings where id='${sale.bookingId}'`);
      }
    } finally {
      sql(`delete from public.availability where gardener_id='${PROVIDER_ID}' and date in ('${far[0]}','${far[1]}')`);
    }
  }

  // ── La web y el pago dicen lo mismo (A-40) ──
  // Horarios al azar (con semilla) para las tres personas durante 26 días; para cada límite,
  // con y sin trabajos partidos, y para trabajos de 2, 8, 18 y 36 h: las horas que ofrece la web
  // son exactamente las horas en las que el planificador del pago encuentra un plan.
  {
    const rand = rng(20260924);
    const base = 45;
    for (let i = 0; i < 26; i += 1) {
      for (const w of [ana, luis, eva]) {
        if (rand() < 0.25) continue;
        const from = 7 + Math.floor(rand() * 6);
        const len = 1 + Math.floor(rand() * 9);
        const hours = Array.from({ length: len }, (_, k) => from + k).filter((h) => h < 20 && rand() > 0.1);
        setAvailability(w.id, day(base + i), hours);
      }
    }
    const mismatches = [];
    let checks = 0;
    for (const crew of [1, 2, 3]) {
      for (const split of [false, true]) {
        sql(`update public.companies set max_crew = ${crew}, allow_split_jobs = ${split} where provider_user_id = '${owner.id}'`);
        for (const m2 of [300, 1200, 3000, 6000]) {
          for (const offset of [0, 2, 5]) {
            const d = day(base + offset);
            const web = await valid(owner.id, d, m2);
            const db = sqlValidHours(owner.id, d, web.labour);
            checks += 1;
            if (web.hours !== db) mismatches.push(`límite ${crew}${split ? ' partidos' : ''} ${web.labour} h ${d}: web [${web.hours}] pago [${db}]`);
          }
        }
      }
    }
    record('F7-08', `La web ofrece exactamente las horas que el pago puede apartar (${checks} combinaciones)`,
      mismatches.length === 0, mismatches.slice(0, 3).join(' · ') || 'todas iguales');
  }
}

await runVerification({ acc, results, main });
