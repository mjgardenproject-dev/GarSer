#!/usr/bin/env node
// GarSer Empresas · F5.2 — asignar y ejecutar, contra el Supabase LOCAL y por la API con el token
// de cada persona (dueña, empleados, cliente).
//
// Empresa de prueba: Ana (césped, con carnet), Luis (césped), Pepe (sin césped). Todos libres de
// 9 a 13 el día de prueba. Se vende un trabajo de 2 h a las 9.
//
// Uso:    node scripts/garser-empresas/verify-f5-assign.mjs
// Requisito: el contenedor de funciones sirve el código actual.

import {
  accounts, createCompany, joinTeam, makeRecorder, rest, rpc, sql, why,
  setAvailability, freeHoursOf, pay, workerOf, runVerification, LAWN, PHYTO,
} from './_company-harness.mjs';

const acc = accounts('f5-assign.local');
const { results, record } = makeRecorder();
const D = sql('select (current_date + 8)::text;').trim();

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-asig');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', []);
  sql(`insert into public.gardener_licenses (gardener_id, license_number, document_url, status, expires_at, terms_accepted)
       values ('${ana.id}', 'F5-${acc.run}', '${ana.id}/c.pdf', 'approved', now() + interval '1 year', true)`);
  await rpc('set_company_member_services', { p_member_id: ana.memberId, p_service_ids: [LAWN, PHYTO] }, owner.token);
  const luis = await joinTeam(acc.newUser, owner.token, 'luis', [LAWN]);
  const pepe = await joinTeam(acc.newUser, owner.token, 'pepe', []);
  for (const p of [ana, luis, pepe]) setAvailability(p.id, D, [9, 10, 11, 12]);
  const client = await acc.newUser('cliente');

  const sale = await pay(owner.id, client, D, 9);
  if (!sale.bookingId) throw new Error(`No se pudo vender: ${sale.error || why(sale.confirm)}`);
  const B = sale.bookingId;
  const first = workerOf(B) === ana.id ? ana : luis;
  const second = first === ana ? luis : ana;
  const name = (p) => (p === ana ? 'Ana' : p === luis ? 'Luis' : 'Pepe');

  // ── Lo que ve cada uno ───────────────────────────────────────────────────────
  {
    const mine = await rpc('my_jobs', { p_from: D, p_to: D }, first.token);
    const job = (mine.body || [])[0];
    const other = await rpc('my_jobs', { p_from: D, p_to: D }, second.token);
    record('F5-01', `Quien va (${name(first)}) ve su trabajo con dirección, hora, servicio y cliente`,
      mine.ok && job?.booking_id === B && job?.client_address === 'Marbella centro' && job?.service_name === 'Corte de césped' && job?.start_time?.startsWith('09'),
      `HTTP ${mine.status}${why(mine)}, ${JSON.stringify(job || {}).slice(0, 140)}`);
    const table = await rest('GET', `/rest/v1/bookings?select=id,client_address,total_price&id=eq.${B}`, second.token);
    const tableFirst = await rest('GET', `/rest/v1/bookings?select=id,total_price&id=eq.${B}`, first.token);
    record('F5-02', 'Un compañero no lo ve; y ni quien va puede leer la reserva completa (precios, pago) en la tabla',
      other.ok && (other.body || []).length === 0 && table.rows.length === 0 && tableFirst.rows.length === 0,
      `compañero ${(other.body || []).length} trabajos, tabla compañero ${table.rows.length}, tabla quien va ${tableFirst.rows.length}`);
    const details = await rpc('get_booking_service_details', { p_booking_id: B }, first.token);
    const detailsOther = await rpc('get_booking_service_details', { p_booking_id: B }, second.token);
    record('F5-34', 'Quien va ve el detalle de lo que hay que hacer; un compañero no',
      details.ok && Array.isArray(details.body?.lawnZones) && !detailsOther.ok, `quien va ${details.status}, compañero ${detailsOther.status}`);
  }

  // ── Quién puede ir ───────────────────────────────────────────────────────────
  {
    const c = await rpc('booking_assignment_candidates', { p_booking_id: B }, owner.token);
    const list = (c.body || []).map((r) => `${name([ana, luis, pepe].find((p) => p.id === r.user_id))}${r.is_current ? '*' : ''}${r.is_free ? '' : '(ocupado)'}`).join(',');
    const byEmployee = await rpc('booking_assignment_candidates', { p_booking_id: B }, first.token);
    record('F5-09', 'La dueña ve como posibles solo a quienes hacen césped (no Pepe), marcando a quien va; un empleado no puede verlo',
      c.ok && (c.body || []).length === 2 && !(c.body || []).some((r) => r.user_id === pepe.id) && !byEmployee.ok, `lista [${list}], empleado ${byEmployee.status}`);
  }
  {
    const toPepe = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: pepe.id }, owner.token);
    const byEmployee = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: second.id }, first.token);
    record('F5-10', 'Asignar por la API a quien no hace el servicio, o que lo intente un empleado: rechazado',
      !toPepe.ok && !byEmployee.ok && workerOf(B) === first.id, `a Pepe ${toPepe.status}${why(toPepe)}, empleado ${byEmployee.status}`);
  }
  {
    sql(`update public.availability set is_available = false where gardener_id = '${second.id}' and date = '${D}' and start_time = '10:00'`);
    const busy = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: second.id }, owner.token);
    sql(`update public.availability set is_available = true where gardener_id = '${second.id}' and date = '${D}' and start_time = '10:00'`);
    record('F5-35', 'Asignar a alguien que no está libre todas las horas: rechazado con explicación, sin cambiar nada',
      !busy.ok && workerOf(B) === first.id && /no está libre/.test(busy.body?.message || ''), `HTTP ${busy.status}${why(busy)}`);
  }

  // ── Cambiar quién va ─────────────────────────────────────────────────────────
  {
    const r = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: second.id }, owner.token);
    const oldSees = await rpc('my_jobs', { p_from: D, p_to: D }, first.token);
    const newSees = await rpc('my_jobs', { p_from: D, p_to: D }, second.token);
    record('F5-03', `Al pasárselo a ${name(second)}, ${name(first)} deja de verlo al momento y ${name(second)} lo ve`,
      r.ok && workerOf(B) === second.id && (oldSees.body || []).length === 0 && (newSees.body || []).length === 1,
      `HTTP ${r.status}${why(r)}, antes ve ${(oldSees.body || []).length}, ahora ve ${(newSees.body || []).length}`);
    record('F5-32', 'Las horas se mueven: quien iba queda libre y quien va, ocupado',
      freeHoursOf(first.id, D) === '9,10,11,12' && freeHoursOf(second.id, D) === '11,12',
      `libres ${name(first)} [${freeHoursOf(first.id, D)}], ${name(second)} [${freeHoursOf(second.id, D)}]`);
  }
  {
    sql(`update public.bookings set assignment_pending = true where id = '${B}'`);
    const keep = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: second.id }, owner.token);
    record('F5-33', 'Confirmar la propuesta (misma persona) solo la deja confirmada',
      keep.ok && keep.body?.changed === false && sql(`select assignment_pending from public.bookings where id='${B}'`) === 'f' && workerOf(B) === second.id,
      `HTTP ${keep.status}`);
  }

  // ── Carnet (D4) ──────────────────────────────────────────────────────────────
  {
    sql(`update public.bookings set pricing_context = jsonb_set(pricing_context, '{quote_snapshot,requiresPhytosanitaryLicense}', 'true') where id = '${B}'`);
    const c = await rpc('booking_assignment_candidates', { p_booking_id: B }, owner.token);
    const r = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: luis.id }, owner.token);
    const names = (c.body || []).map((row) => name([ana, luis, pepe].find((p) => p.id === row.user_id))).join(',');
    record('F5-06', 'Trabajo que exige carnet: solo sale quien lo tiene (Ana), y asignarlo por la API a Luis se rechaza',
      c.ok && names === 'Ana' && !r.ok, `posibles [${names}], a Luis ${r.status}${why(r)}`);
    const toAna = await rpc('assign_booking_worker', { p_booking_id: B, p_worker_id: ana.id }, owner.token);
    if (!toAna.ok) throw new Error(`No se pudo pasar a Ana: ${why(toAna)}`);
  }

  // ── Lo que no puede hacer un empleado, y lo que sí ───────────────────────────
  {
    const can = await rpc('cancel_booking', { p_booking_id: B, p_reason: 'Prueba' }, ana.token);
    record('F5-04', 'Un empleado no puede cancelar una reserva', !can.ok && sql(`select status from public.bookings where id='${B}'`) !== 'cancelled', `HTTP ${can.status}`);
  }
  {
    const deact = await rpc('deactivate_company_member', { p_member_id: ana.memberId }, owner.token);
    record('F5-07', 'Dar de baja a quien tiene trabajos futuros: bloqueado hasta reasignar', !deact.ok, `HTTP ${deact.status}${why(deact)}`);
  }
  {
    sql(`update public.bookings set status = 'confirmed', date = current_date - 1 where id = '${B}'`);
    const byLuis = await rpc('mark_gardener_finished', { p_booking_id: B }, luis.token);
    const byAna = await rpc('mark_gardener_finished', { p_booking_id: B }, ana.token);
    record('F5-05', 'Quien va marca que ha terminado; un compañero no puede',
      !byLuis.ok && byAna.ok && sql(`select gardener_finished_at is not null from public.bookings where id='${B}'`) === 't',
      `Luis ${byLuis.status}, Ana ${byAna.status}${why(byAna)}`);
  }
}

await runVerification({ acc, results, main });
