#!/usr/bin/env node
// GarSer tras la fusión · H-40 — cambiar la duración aparta YA las horas nuevas de quien va
// (autónomo y empresa), no las deja comprar a otro, no pisa un pago en curso, y si la propuesta no
// se acepta las devuelve. Contra el Supabase LOCAL.
// Uso: node scripts/garser-empresas/verify-duration-holds.mjs

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, sql, why, runVerification, setAvailability,
  pay, workerOf, signIn, authority, LAWN, LAWN_INPUT, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('duration-holds.local');
const { results, record } = makeRecorder();
const D = sql('select (current_date + 40)::text;').trim();
const hoursOf = (id) => sql(`select coalesce(string_agg(hour_block::text, ',' order by hour_block), '') from public.booking_blocks where booking_id = '${id}'`);
const assigneesOf = (id) => sql(`select coalesce(string_agg(distinct assignee_id::text, ','), '') from public.booking_blocks where booking_id = '${id}'`);
const freeAt = (who, h) => sql(`select coalesce(bool_or(is_available)::text, 'sin fila') from public.availability where gardener_id = '${who}' and date = '${D}' and extract(hour from start_time) = ${h}`);
const durationOf = (id) => Number(sql(`select duration_hours from public.bookings where id = '${id}'`));
const propose = (id, price, hours, token) => rpc('propose_booking_price_change', {
  p_booking_id: id, p_proposed_total_price: price, p_reason: 'Prueba H-40', p_operation_id: randomUUID(), p_expires_in_minutes: 1440, p_proposed_duration_hours: hours,
}, token);
const respond = (id, accept, token) => rpc('respond_booking_price_change', { p_booking_id: id, p_accept: accept, p_operation_id: randomUUID() }, token);
const offered = async (providerId, hour) => {
  const r = await authority({ action: 'valid_hours', serviceId: LAWN, providerId, date: D, bookingInput: { ...LAWN_INPUT, lawnZones: [{ quantity: 50, state: 'normal' }] } });
  return (r.body?.validHours || []).includes(hour);
};

async function main() {
  // ── Autónomo (el jardinero de la semilla) ────────────────────────────────────
  const gardenerToken = await signIn('jardinero.local@test.local');
  const client = await acc.newUser('cliente');
  setAvailability(PROVIDER_ID, D, [9, 10, 11, 12, 13, 14, 15, 16]);
  try {
    const b = await pay(PROVIDER_ID, client, D, 9);
    const id = b.bookingId;
    const dur = id ? durationOf(id) : 0;
    const next = 9 + dur; // la primera hora de más
    const offeredBefore = await offered(PROVIDER_ID, next);
    const p = id ? await propose(id, 99, dur + 1, gardenerToken) : { ok: false };
    const offeredAfter = await offered(PROVIDER_ID, next);
    record('DH-01', 'Autónomo: proponer +1 h aparta ya esa hora (agenda y disponibilidad) y la web deja de ofrecerla; la duración aún no cambia',
      p.ok && hoursOf(id).split(',').map(Number).includes(next) && freeAt(PROVIDER_ID, next) === 'false' && offeredBefore && !offeredAfter && durationOf(id) === dur,
      `dur ${dur} → horas [${id ? hoursOf(id) : ''}], ${next}h libre ${freeAt(PROVIDER_ID, next)}, web antes ${offeredBefore} después ${offeredAfter}${why(p)}`);

    sql(`update public.bookings set proposed_price_expires_at = now() - interval '1 minute' where id = '${id}'`);
    const expired = sql('select private.expire_overdue_price_changes();');
    record('DH-02', 'Si la propuesta caduca (el reloj), la hora apartada vuelve a estar libre',
      Number(expired) >= 1 && !hoursOf(id).split(',').map(Number).includes(next) && freeAt(PROVIDER_ID, next) === 'true' && (await offered(PROVIDER_ID, next)),
      `caducadas ${expired}, horas [${hoursOf(id)}], ${next}h libre ${freeAt(PROVIDER_ID, next)}`);

    const p2 = await propose(id, 99, dur + 1, gardenerToken);
    const acc2 = await respond(id, true, client.token);
    record('DH-03', 'Proponer otra vez y el cliente acepta: la reserva dura una hora más con esa hora ya suya',
      p2.ok && acc2.ok && durationOf(id) === dur + 1 && hoursOf(id).split(',').map(Number).includes(next) && freeAt(PROVIDER_ID, next) === 'false',
      `dur ${durationOf(id)}, horas [${hoursOf(id)}]${why(p2)}${why(acc2)}`);

    // Una hora en un pago en curso de otro cliente no se puede usar para alargar (otra reserva,
    // aún pendiente: las propuestas son antes de aceptar).
    const second = await acc.newUser('segundo-cliente');
    const b2 = await pay(PROVIDER_ID, second, D, 13);
    const id2 = b2.bookingId;
    const next2 = 13 + (id2 ? durationOf(id2) : 0);
    const other = await acc.newUser('otro-cliente');
    const q = await authority({ action: 'create_quote', serviceId: LAWN, providerId: PROVIDER_ID, date: D, startTime: `${String(next2).padStart(2, '0')}:00`,
      bookingInput: { ...LAWN_INPUT, lawnZones: [{ quantity: 50, state: 'normal' }] } }, { accessToken: other.token });
    const prep = q.body?.quoteId ? await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: q.body.quoteId, p_client_id: other.id, p_hold_ttl_minutes: 15 }) : { ok: false };
    const p3 = id2 ? await propose(id2, 120, durationOf(id2) + 1, gardenerToken) : { ok: false, body: b2 };
    record('DH-04', 'No se puede alargar sobre una hora que otro cliente está pagando: falla al proponer, diciendo la hora',
      prep.ok && !p3.ok && new RegExp(`no tiene libre la hora de las ${next2}:00`).test(JSON.stringify(p3.body)),
      `pago en curso a las ${next2} ${prep.ok ? 'sí' : `no${why(prep)}`} · propuesta ${p3.status}${why(p3)}`);
  } finally {
    sql(`delete from public.availability where gardener_id = '${PROVIDER_ID}' and date = '${D}'`);
    sql(`delete from public.availability_blocks where gardener_id = '${PROVIDER_ID}' and date = '${D}'`);
  }

  // ── Empresa: la hora de más es de quien va ───────────────────────────────────
  {
    const company = await createCompany(acc.newUser, 'empresa-dh', [LAWN]);
    const ana = await joinTeam(acc.newUser, company.token, 'ana', [LAWN]);
    const cliente2 = await acc.newUser('cliente2');
    setAvailability(ana.id, D, [9, 10, 11, 12, 13, 14]);
    const b = await pay(company.id, cliente2, D, 9);
    const id = b.bookingId;
    const dur = id ? durationOf(id) : 0;
    const next = 9 + dur;
    const p = id ? await propose(id, 88, dur + 1, company.token) : { ok: false };
    record('DH-05', 'Empresa: proponer +1 h aparta esa hora a la persona que va (no a la cuenta de la empresa)',
      id && workerOf(id) === ana.id && p.ok && assigneesOf(id) === ana.id && hoursOf(id).split(',').map(Number).includes(next) && freeAt(ana.id, next) === 'false',
      `va ${workerOf(id || '') === ana.id ? 'Ana' : workerOf(id || '')}, horas [${id ? hoursOf(id) : ''}]${why(p)}`);
    const rej = await respond(id, false, cliente2.token);
    record('DH-06', 'Si el cliente la rechaza (se cancela la reserva), Ana queda libre también en esa hora',
      rej.ok && hoursOf(id) === '' && freeAt(ana.id, next) === 'true' && freeAt(ana.id, 9) === 'true', `libre ${next}h ${freeAt(ana.id, next)}${why(rej)}`);
  }
}

await runVerification({ acc, results, main });
