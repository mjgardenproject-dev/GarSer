#!/usr/bin/env node
// GarSer Empresas · F5.1 — horarios del equipo, contra el Supabase LOCAL y por la API (con el
// token de cada persona, como lo haría la pantalla de horario).
//
// D22 (2026-09-28): el horario de cada empleado lo pone el dueño (a mano y con el horario fijo), y
// el empleado ya no puede escribirlo. Comprueba eso, que una hora
// ya vendida no se puede volver a abrir por ningún camino, que el horario del dueño que trabaja no
// se cierra por los trabajos de su equipo, que cancelar libera, y la antelación de la empresa.
//
// Uso:    node scripts/garser-empresas/verify-f5-schedules.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import {
  accounts, createCompany, joinTeam, makeRecorder, rest, rpc, sql, why,
  freeHoursOf, validHours, pay, workerOf, runVerification, LAWN,
} from './_company-harness.mjs';

const acc = accounts('f5-verify.local');
const { results, record } = makeRecorder();
const D1 = sql('select (current_date + 9)::text;').trim();
const DOW = Number(sql(`select extract(dow from date '${D1}')::int;`).trim());

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-f5');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');
  const luis = await joinTeam(acc.newUser, owner.token, 'luis');
  const client = await acc.newUser('cliente');

  // ── D22 (2026-09-28): el horario de cada empleado lo pone el dueño ──────────
  {
    const own = await rest('POST', '/rest/v1/availability', ana.token, {
      gardener_id: ana.id, date: D1, start_time: '09:00', end_time: '10:00', is_available: true,
    });
    const set = await rpc('set_member_day_availability', { p_member_id: ana.memberId, p_date: D1, p_hours: [9, 10, 11, 12] }, owner.token);
    const byMate = await rpc('set_member_day_availability', { p_member_id: luis.memberId, p_date: D1, p_hours: [15] }, ana.token);
    record('F5-20', 'El dueño pone el horario de un día de Ana; Ana no puede escribir el suyo ni el de un compañero',
      !own.ok && set.ok && freeHoursOf(ana.id, D1) === '9,10,11,12' && !byMate.ok && freeHoursOf(luis.id, D1) === '',
      `Ana el suyo ${own.status}, dueño ${set.status}${why(set)}, Ana el de Luis ${byMate.status}`);
  }
  {
    const byHimself = await rest('POST', '/rest/v1/recurring_schedules', luis.token, { gardener_id: luis.id, day_of_week: DOW, start_time: '09:00', end_time: '13:00' });
    const set = await rpc('set_member_recurring_schedule', {
      p_member_id: luis.memberId, p_rules: [{ day_of_week: DOW, start_time: '09:00', end_time: '13:00' }], p_weeks: 2,
    }, owner.token);
    const read = await rpc('member_recurring_schedule', { p_member_id: luis.memberId }, owner.token);
    record('F5-21', 'El dueño guarda el horario fijo de Luis y se generan sus horas; Luis no puede guardarlo',
      !byHimself.ok && set.ok && freeHoursOf(luis.id, D1) === '9,10,11,12' && (read.body?.rules || []).length === 1,
      `Luis ${byHimself.status}, dueño ${set.status}${why(set)}, horas [${freeHoursOf(luis.id, D1)}]`);
  }

  // ── Una hora vendida no se reabre ────────────────────────────────────────────
  const sold = await pay(owner.id, client, D1, 9);
  const soldTo = sold.bookingId ? workerOf(sold.bookingId) : '';
  const seller = soldTo === ana.id ? ana : luis;
  {
    // Lo que hace la pantalla del dueño al guardar un día: el día entero con sus horas marcadas.
    const reset = await rpc('set_member_day_availability', { p_member_id: seller.memberId, p_date: D1, p_hours: [9, 10, 11, 12] }, owner.token);
    record('F5-22', 'Quien tiene vendido 9-11 no vuelve a quedar libre aunque el dueño guarde el día entero',
      !!sold.bookingId && reset.ok && freeHoursOf(seller.id, D1) === '11,12',
      `${sold.error || ''}vendido a ${seller === ana ? 'Ana' : 'Luis'}, libres [${freeHoursOf(seller.id, D1)}]`);
  }
  {
    const gen = await rpc('set_member_recurring_schedule', {
      p_member_id: seller.memberId, p_rules: [{ day_of_week: DOW, start_time: '09:00', end_time: '13:00' }], p_weeks: 2,
    }, owner.token);
    record('F5-23', 'Regenerar su horario fijo tampoco reabre las horas vendidas', gen.ok && freeHoursOf(seller.id, D1) === '11,12',
      `generar ${gen.status}${why(gen)}, libres [${freeHoursOf(seller.id, D1)}]`);
  }
  {
    const sellerHours = sql(`select coalesce(string_agg(hour::text, ',' order by hour), '')
      from public.provider_free_hours(array['${owner.id}']::uuid[], '${LAWN}', '${D1}', '${D1}') where worker_id = '${seller.id}'`);
    record('F5-24', 'La empresa ya no cuenta con esa persona en sus horas vendidas (sí en las demás)', sellerHours === '11,12',
      `horas de ${seller === ana ? 'Ana' : 'Luis'} para vender [${sellerHours}]`);
  }

  // ── El dueño que trabaja ─────────────────────────────────────────────────────
  {
    await rpc('set_company_owner_works', { p_works: true }, owner.token);
    await rpc('set_company_member_services', { p_member_id: owner.memberId, p_service_ids: [] }, owner.token);
    await rest('POST', '/rest/v1/recurring_availability_settings', owner.token, { gardener_id: owner.id, weeks_to_maintain: 2, min_notice_hours: 0 });
    await rest('POST', '/rest/v1/recurring_schedules', owner.token, { gardener_id: owner.id, day_of_week: DOW, start_time: '09:00', end_time: '13:00' });
    const gen = await rpc('generate_recurring_slots', { target_gardener_id: owner.id, force_regenerate: true }, owner.token);
    sql(`update public.bookings set status = 'confirmed' where id = '${sold.bookingId}'`);
    const gen2 = await rpc('generate_recurring_slots', { target_gardener_id: owner.id, force_regenerate: true }, owner.token);
    record('F5-25', 'Al dueño que trabaja no se le cierran las horas por los trabajos de su equipo',
      gen.ok && gen2.ok && freeHoursOf(owner.id, D1) === '9,10,11,12', `libres de la dueña [${freeHoursOf(owner.id, D1)}]`);
  }

  // ── Mis horas ocupadas ───────────────────────────────────────────────────────
  {
    const other = seller === ana ? luis : ana;
    const mine = await rpc('my_busy_hours', { p_start: D1, p_end: D1 }, seller.token);
    const theirs = await rpc('my_busy_hours', { p_start: D1, p_end: D1 }, other.token);
    const mineHours = (mine.body || []).map((r) => r.hour).join(',');
    record('F5-26', 'Cada persona ve sus horas ocupadas (para pintarlas en su horario); un compañero no ve las suyas',
      mine.ok && mineHours === '9,10' && theirs.ok && (theirs.body || []).length === 0, `suyas [${mineHours}], del compañero ${(theirs.body || []).length}`);
  }

  // ── Cancelar libera ──────────────────────────────────────────────────────────
  {
    const can = await rpc('cancel_booking', { p_booking_id: sold.bookingId, p_reason: 'Prueba F5' }, client.token);
    record('F5-27', 'Cancelar vuelve a dejar libres las horas de quien iba', can.ok && freeHoursOf(seller.id, D1) === '9,10,11,12',
      `HTTP ${can.status}${why(can)}, libres [${freeHoursOf(seller.id, D1)}]`);
  }

  // ── Antelación mínima de la empresa ──────────────────────────────────────────
  {
    const before = (await validHours(owner.id, D1)).hours;
    const set = await rest('PATCH', `/rest/v1/recurring_availability_settings?gardener_id=eq.${owner.id}`, owner.token,
      { min_notice_hours: 24 * 14 });
    const after = (await validHours(owner.id, D1)).hours;
    const byEmployee = await rest('PATCH', `/rest/v1/recurring_availability_settings?gardener_id=eq.${owner.id}`, ana.token, { min_notice_hours: 0 });
    const kept = sql(`select min_notice_hours from public.recurring_availability_settings where gardener_id='${owner.id}'`);
    record('F5-28', 'La antelación mínima la fija la empresa (14 días: ese día deja de ofrecerse); un empleado no la cambia',
      before !== '' && set.ok && after === '' && kept === String(24 * 14), `antes [${before}], después [${after}], empleada ${byEmployee.status} → ${kept}`);
  }
}

await runVerification({ acc, results, main });
