#!/usr/bin/env node
// GarSer Empresas · F4.1 — verificación de la VENTA a una empresa contra el Supabase LOCAL, por
// los caminos reales: booking-authority (horas y presupuesto), prepare/confirm del pago (lo que
// hace el webhook de Stripe), alargar y cancelar.
//
// Monta una empresa desechable con tres personas y horarios pensados para cazar los fallos
// típicos (H-26):
//
//   Ana   (césped)            libre 9, 13, 14, 15, 18, 19
//   Luis  (césped)            libre 10, 16, 17, 18, 19
//   Pepe  (sin césped)        libre 7, 8                → no cuenta para césped
//   Dueña (no trabaja)        libre 11, 12              → no cuenta
//
// El trabajo de prueba dura 2 horas. Horas válidas esperadas: 13, 14, 18 (Ana) y 16, 17, 18
// (Luis). NO 9 ni 10: Ana 9 + Luis 10 no son una persona.
//
// Uso:    node scripts/garser-empresas/verify-f4-sell.mjs
// Requisito: el contenedor de funciones sirve el código actual
//            (docker restart supabase_edge_runtime_GarSer-main_4 tras cambiarlo).
// Salida: una línea por prueba; código 1 si alguna falla. Lo borra todo al terminar.

import { randomUUID } from 'node:crypto';
import { authority, sql, env, PROVIDER_ID } from '../readiness/_harness.mjs';

const { apiUrl, anonKey, serviceRoleKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea y borra cuentas y reservas.`);
  process.exit(2);
}

const RUN = Date.now();
const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const PHYTO = sql("select id from public.services where name = 'Servicios fitosanitarios' limit 1;").trim();
const HEDGE = sql("select id from public.services where name = 'Poda de setos' limit 1;").trim();
const INPUT = {
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};
const DATE = sql('select (current_date + 6)::text;').trim();

const results = [];
const createdUsers = [];
const createdBookings = new Set();

function record(id, description, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
}

async function rest(method, path, token, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: token ? anonKey : serviceRoleKey,
      Authorization: `Bearer ${token ?? serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, body: data, rows: Array.isArray(data) ? data : [] };
}
const rpc = (fn, args, token) => rest('POST', `/rest/v1/rpc/${fn}`, token, args);
const why = (r) => (r.ok ? '' : ` (${r.body?.message ?? r.body?.error ?? JSON.stringify(r.body).slice(0, 140)})`);

async function signIn(email) {
  const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return (await res.json()).access_token;
}

async function newUser(label, role = 'client') {
  const email = `${label}-${RUN}@f4-verify.local`;
  const res = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role, requested_role: role } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id) throw new Error(`No se pudo crear ${label}: ${JSON.stringify(body).slice(0, 160)}`);
  createdUsers.push(id);
  return { id, email, token: body.access_token };
}

async function joinTeam(ownerToken, label) {
  const person = await newUser(label);
  const inv = await rpc('create_company_invitation', { p_email: person.email }, ownerToken);
  const acc = await rpc('accept_company_invitation', { p_token: inv.body?.token }, person.token);
  if (!acc.ok) throw new Error(`${label} no pudo unirse: ${why(acc)}`);
  const memberId = sql(`select id from public.company_members where user_id='${person.id}'`);
  return { ...person, memberId };
}

function setAvailability(userId, hours) {
  const values = hours.map((h) => `('${userId}', '${DATE}', '${String(h).padStart(2, '0')}:00', '${String(h + 1).padStart(2, '0')}:00', true)`).join(',');
  sql(`insert into public.availability (gardener_id, date, start_time, end_time, is_available) values ${values}
       on conflict (gardener_id, date, start_time) do update set is_available = true`);
}

const validHoursOf = async (providerId) => {
  const r = await authority({ action: 'valid_hours', serviceId: LAWN, providerId, date: DATE, bookingInput: INPUT });
  return { r, hours: (r.body?.validHours || []).join(',') };
};

async function pay(providerId, client, startHour, { confirm = true } = {}) {
  const q = await authority(
    { action: 'create_quote', serviceId: LAWN, providerId, date: DATE, startTime: `${String(startHour).padStart(2, '0')}:00`, bookingInput: INPUT },
    { accessToken: client.token },
  );
  const quoteId = q.body?.quoteId;
  if (!q.ok || !quoteId) return { error: `create_quote ${q.status}${why({ ok: false, body: q.body })}` };
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}` };
  const holdWorker = sql(`select assignee_id from public.booking_schedule_holds where payment_attempt_id='${prep.body.attemptId}'`);
  if (!confirm) return { attemptId: prep.body.attemptId, holdWorker };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId,
    p_stripe_event_id: `evt_f4_${randomUUID()}`,
    p_stripe_payment_intent_id: `pi_f4_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents,
    p_currency: 'eur',
    p_gateway_payload: {},
  });
  const bookingId = conf.body?.bookingId ?? null;
  if (bookingId) createdBookings.add(bookingId);
  return { bookingId, holdWorker, attemptId: prep.body.attemptId, confirm: conf };
}

const workersOf = (bookingId) =>
  sql(`select coalesce(string_agg(distinct assignee_id::text, ','), '') from public.booking_blocks where booking_id='${bookingId}'`);
const blocksOf = (bookingId) =>
  sql(`select coalesce(string_agg(hour_block::text, ',' order by hour_block), '') from public.booking_blocks where booking_id='${bookingId}'`);
const busyOf = (userId) =>
  sql(`select coalesce(string_agg(extract(hour from start_time)::int::text, ',' order by start_time), '')
       from public.availability where gardener_id='${userId}' and date='${DATE}' and not is_available`);

async function main() {
  const adminToken = await signIn('admin.local@test.local');

  // ── Empresa desechable, por el alta real ───────────────────────────────────
  const owner = await newUser('duena', 'company');
  const draft = await rest('POST', '/rest/v1/company_applications', owner.token, {
    user_id: owner.id, commercial_name: `Jardines F4 ${RUN}`, legal_name: 'Jardines F4 S.L.', tax_id: 'B11111111',
    contact_name: 'Dueña F4', phone: '600000004', address: 'Marbella', city_zone: 'Marbella', services: ['Corte de césped'],
    owner_works: false, accept_terms: true, declaration_truth: true, answers: { team_size: '2-5', has_liability_insurance: true },
  });
  await rpc('submit_company_application', { p_application_id: draft.rows[0]?.id }, owner.token);
  const approve = await rpc('admin_review_company_application', { p_application_id: draft.rows[0]?.id, p_status: 'approved', p_comment: null }, adminToken);
  if (!approve.ok) throw new Error(`No se pudo aprobar la empresa: ${why(approve)}`);
  const COMPANY = owner.id;
  sql(`update public.gardener_profiles set operational_latitude = 36.51, operational_longitude = -4.882, max_distance = 30 where user_id = '${COMPANY}'`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
       select '${COMPANY}', service_id, unit_type, price_per_unit, currency, true, additional_config
       from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}' and service_id in ('${LAWN}', '${PHYTO}', '${HEDGE}')`);
  const ownerToken = await signIn(owner.email);

  const ana = await joinTeam(ownerToken, 'ana');
  const luis = await joinTeam(ownerToken, 'luis');
  const pepe = await joinTeam(ownerToken, 'pepe');
  sql(`insert into public.gardener_licenses (gardener_id, license_number, document_url, status, expires_at, terms_accepted)
       values ('${ana.id}', 'F4-${RUN}', '${ana.id}/carnet.pdf', 'approved', now() + interval '1 year', true)`);
  for (const [who, services] of [[ana, [LAWN, PHYTO]], [luis, [LAWN]], [pepe, [PHYTO]]]) {
    const r = await rpc('set_company_member_services', { p_member_id: who.memberId, p_service_ids: services }, ownerToken);
    if (!r.ok && who !== pepe) throw new Error(`Servicios de ${who.email}: ${why(r)}`);
  }
  setAvailability(ana.id, [9, 13, 14, 15, 18, 19]);
  setAvailability(luis.id, [10, 16, 17, 18, 19]);
  setAvailability(pepe.id, [7, 8]);
  setAvailability(COMPANY, [11, 12]);

  // ── Horas que ve el cliente ─────────────────────────────────────────────────
  {
    const { r, hours } = await validHoursOf(COMPANY);
    record('F4-01', 'La empresa ofrece las horas en que UNA persona puede hacer el trabajo entero (13, 14, 16, 17, 18)',
      r.ok && hours === '13,14,16,17,18', `HTTP ${r.status}, horas [${hours}]`);
    record('F4-02', 'No mezcla personas (9 de Ana + 10 de Luis), ni cuenta a quien no hace el servicio (Pepe) ni a la dueña que no trabaja',
      r.ok && !/\b(7|9|10|11)\b/.test(hours), `horas [${hours}]`);
    const prev = await authority({ action: 'preview_providers', serviceId: LAWN, providerIds: [COMPANY, PROVIDER_ID], selectedDate: DATE, windowDays: 1, bookingInput: INPUT });
    const earliest = prev.body?.earliestByProvider?.[COMPANY];
    record('F4-03', 'En el listado la empresa sale como elegible, junto al autónomo, con su primer hueco',
      prev.ok && (prev.body?.eligibleProviderIds || []).includes(COMPANY) && earliest?.date === DATE && earliest?.startHour === 13,
      `elegibles ${JSON.stringify(prev.body?.eligibleProviderIds)}, primer hueco ${JSON.stringify(earliest)}`);
    const dir = await rest('GET', `/rest/v1/public_gardener_directory?select=provider_kind&user_id=eq.${COMPANY}`, null);
    record('F4-04', 'El directorio público dice que es una empresa (para el distintivo)', dir.rows[0]?.provider_kind === 'company', JSON.stringify(dir.body));
  }

  // ── Vender ──────────────────────────────────────────────────────────────────
  const clients = [];
  for (let i = 0; i < 6; i += 1) clients.push(await newUser(`cliente${i}`));

  const A = await pay(COMPANY, clients[0], 13);
  {
    const booking = A.bookingId ? sql(`select gardener_id||'|'||status||'|'||assignment_pending from public.bookings where id='${A.bookingId}'`) : '';
    record('F4-05', 'Pagar a las 13: se aparta a Ana (la única que puede) y la reserva es de la empresa',
      !!A.bookingId && A.holdWorker === ana.id && workersOf(A.bookingId) === ana.id && blocksOf(A.bookingId) === '13,14' && booking === `${COMPANY}|pending|false`,
      A.error || `persona ${A.holdWorker === ana.id ? 'Ana' : A.holdWorker}, bloques [${blocksOf(A.bookingId)}], reserva ${booking}`);
    record('F4-06', 'Las horas se ocupan en la agenda de Ana, no en la de la empresa',
      busyOf(ana.id) === '13,14' && busyOf(COMPANY) === '', `Ana ocupadas [${busyOf(ana.id)}], empresa [${busyOf(COMPANY)}]`);
    const { hours } = await validHoursOf(COMPANY);
    record('F4-07', 'Después, 13 y 14 ya no se ofrecen (Ana está ocupada); los de Luis y el de Ana a las 18, sí',
      hours === '16,17,18', `horas [${hours}]`);
  }

  {
    const B = await pay(COMPANY, clients[1], 18);
    const C = await pay(COMPANY, clients[2], 18);
    const D = await pay(COMPANY, clients[3], 18);
    const bw = B.bookingId ? workersOf(B.bookingId) : '';
    const cw = C.bookingId ? workersOf(C.bookingId) : '';
    record('F4-08', 'Tres clientes a las 18: el primero se lleva a Luis (menos cargado), el segundo a Ana, el tercero no puede',
      bw === luis.id && cw === ana.id && !D.bookingId,
      `B ${bw === luis.id ? 'Luis' : bw || B.error}, C ${cw === ana.id ? 'Ana' : cw || C.error}, D ${D.bookingId ? 'VENDIDA' : D.error}`);
    const doubled = sql(`select count(*) from (select assignee_id, date, hour_block from public.booking_blocks group by 1,2,3 having count(*) > 1) d`);
    record('F4-09', 'Nadie tiene la misma hora vendida dos veces', doubled === '0', `repetidas ${doubled}`);
  }

  {
    const E = await pay(COMPANY, clients[4], 16, { confirm: false });
    const { hours } = await validHoursOf(COMPANY);
    record('F4-10', 'Mientras un cliente paga a Luis a las 16, ese hueco no se ofrece a otros',
      E.holdWorker === luis.id && hours === '', `bloqueo a ${E.holdWorker === luis.id ? 'Luis' : E.holdWorker || E.error}, horas [${hours}]`);
    sql(`update public.booking_schedule_holds set expires_at = now() - interval '1 minute' where payment_attempt_id = '${E.attemptId}'`);
    const after = await validHoursOf(COMPANY);
    record('F4-11', 'Si ese pago caduca, el hueco vuelve', after.hours === '16', `horas [${after.hours}]`);
  }

  {
    const price = Number(sql(`select total_price from public.bookings where id='${A.bookingId}'`));
    const prop = await rpc('propose_booking_price_change', {
      p_booking_id: A.bookingId, p_proposed_total_price: price + 10, p_reason: 'Prueba F4: una hora más',
      p_operation_id: randomUUID(), p_expires_in_minutes: 60, p_proposed_duration_hours: 3,
    }, ownerToken);
    const resp = prop.ok
      ? await rpc('respond_booking_price_change', { p_booking_id: A.bookingId, p_accept: true, p_operation_id: randomUUID() }, clients[0].token)
      : prop;
    record('F4-12', 'Alargar una hora: se añade en la agenda de Ana (la que va)',
      resp.ok && blocksOf(A.bookingId) === '13,14,15' && workersOf(A.bookingId) === ana.id && busyOf(ana.id).startsWith('13,14,15'),
      `HTTP ${resp.status}${why(resp)}, bloques [${blocksOf(A.bookingId)}], Ana ocupadas [${busyOf(ana.id)}]`);
    const can = await rpc('cancel_booking', { p_booking_id: A.bookingId, p_reason: 'Prueba F4' }, clients[0].token);
    const { hours } = await validHoursOf(COMPANY);
    record('F4-13', 'Cancelar libera las horas de Ana y el hueco vuelve a ofrecerse',
      can.ok && !busyOf(ana.id).includes('13') && hours.includes('13'), `HTTP ${can.status}${why(can)}, Ana ocupadas [${busyOf(ana.id)}], horas [${hours}]`);
  }

  // ── Carnet, modo de asignación, empresa no activa, permisos ────────────────
  {
    const withLicense = sql(`select coalesce(string_agg(distinct worker_id::text, ','), '') from public.provider_free_hours(array['${COMPANY}']::uuid[], '${PHYTO}', '${DATE}', '${DATE}', true)`);
    const any = sql(`select count(distinct worker_id) from public.provider_free_hours(array['${COMPANY}']::uuid[], '${PHYTO}', '${DATE}', '${DATE}', false)`);
    record('F4-14', 'Trabajo con carnet: solo cuenta quien lo tiene (Ana), aunque Pepe tenga horas',
      withLicense === ana.id, `con carnet [${withLicense === ana.id ? 'Ana' : withLicense}], personas con fitosanitarios ${any}`);
  }
  {
    const byEmployee = await rpc('set_company_assignment_mode', { p_mode: 'manual' }, ana.token);
    const byOwner = await rpc('set_company_assignment_mode', { p_mode: 'manual' }, ownerToken);
    const F = await pay(COMPANY, clients[5], 13);
    const pending = F.bookingId ? sql(`select assignment_pending from public.bookings where id='${F.bookingId}'`) : '';
    record('F4-15', 'Modo «yo elijo quién va»: solo lo cambia la dueña; la persona apartada queda como propuesta',
      !byEmployee.ok && byOwner.ok && pending === 't' && workersOf(F.bookingId) === ana.id,
      `empleada ${byEmployee.status}, dueña ${byOwner.status}, propuesta ${pending}`);
  }
  {
    sql(`update public.companies set status = 'suspended' where provider_user_id = '${COMPANY}'`);
    const { hours } = await validHoursOf(COMPANY);
    sql(`update public.companies set status = 'active' where provider_user_id = '${COMPANY}'`);
    record('F4-16', 'Una empresa no activa no tiene horas que vender', hours === '', `horas [${hours}]`);
  }
  {
    const byClient = await rpc('provider_free_hours', { p_provider_ids: [COMPANY], p_service_id: LAWN, p_start: DATE, p_end: DATE }, clients[1].token);
    const byAnon = await rest('POST', '/rest/v1/rpc/provider_free_hours', anonKey, { p_provider_ids: [COMPANY], p_service_id: LAWN, p_start: DATE, p_end: DATE });
    const pick = await rpc('pick_provider_worker', { p_provider: COMPANY, p_service: LAWN, p_date: DATE, p_start_hour: 16, p_end_hour: 18 }, clients[1].token);
    record('F4-17', 'Nadie de fuera puede consultar los horarios del equipo ni apartar a una persona',
      !byClient.ok && !byAnon.ok && !pick.ok, `cliente ${byClient.status}, anónimo ${byAnon.status}, apartar ${pick.status}`);
  }

  // ── Lo que pedía el plan de F4 (03-PRUEBAS.md) ─────────────────────────────
  {
    const price = async (providerId) => authority({ action: 'recalculate_correction', serviceId: LAWN, providerId, bookingInput: INPUT });
    const [company, solo] = await Promise.all([price(COMPANY), price(PROVIDER_ID)]);
    const same = (k) => JSON.stringify(company.body?.[k]) === JSON.stringify(solo.body?.[k]);
    record('F4-18', 'Con la misma configuración, la empresa cobra lo mismo que el autónomo, gastos de gestión incluidos',
      company.ok && solo.ok && same('totalPrice') && same('estimatedHours') && same('economics'),
      `empresa ${company.body?.totalPrice} € (gestión ${company.body?.economics?.managementFee}), autónomo ${solo.body?.totalPrice} € (gestión ${solo.body?.economics?.managementFee})`);
  }
  {
    const hedge = () => sql(`select count(*) from public.provider_free_hours(array['${COMPANY}']::uuid[], '${HEDGE}', '${DATE}', '${DATE}', false)`);
    const before = hedge();
    await rpc('set_company_member_services', { p_member_id: luis.memberId, p_service_ids: [LAWN, HEDGE] }, ownerToken);
    const after = hedge();
    record('F4-19', 'La empresa ofrece setos (precio activo) pero nadie los hace: sin horas; cuando se le asignan a Luis, las de Luis',
      before === '0' && Number(after) > 0, `antes ${before}, después ${after}`);
  }
  {
    const ownerMember = sql(`select id from public.company_members where user_id='${COMPANY}'`);
    const works = await rpc('set_company_owner_works', { p_works: true }, ownerToken);
    const svc = await rpc('set_company_member_services', { p_member_id: ownerMember, p_service_ids: [LAWN] }, ownerToken);
    const { hours } = await validHoursOf(COMPANY);
    record('F4-20', 'Si la dueña activa «Yo también trabajo» y hace césped, sus horas (11-12) se venden',
      works.ok && svc.ok && /\b11\b/.test(hours), `horas [${hours}]`);
  }
  {
    const before = sql(`select additional_config::text from public.gardener_service_prices where gardener_id='${COMPANY}' and service_id='${LAWN}'`);
    const patch = await rest('PATCH', `/rest/v1/gardener_service_prices?gardener_id=eq.${COMPANY}&service_id=eq.${LAWN}`, ana.token, { active: false, additional_config: {} });
    const after = sql(`select additional_config::text || active::text from public.gardener_service_prices where gardener_id='${COMPANY}' and service_id='${LAWN}'`);
    record('F4-21', 'Una empleada no puede cambiar los precios de su empresa', after === `${before}true`, `HTTP ${patch.status}, filas cambiadas ${patch.rows.length}`);
  }
}

function cleanup(userIds = createdUsers) {
  if (!userIds.length) return;
  const ids = userIds.map((id) => `'${id}'`).join(',');
  const companyBookings = `(select id from public.bookings where gardener_id in (${ids}) or client_id in (${ids}))`;
  sql(`select public.release_booking_schedule(id) from public.bookings where id in ${companyBookings}`);
  sql(`delete from public.bookings where id in ${companyBookings}`);
  sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where gardener_id in (${ids}) or client_id in (${ids}))`);
  sql(`delete from public.booking_schedule_holds where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.booking_payment_attempts where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.booking_quotes where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.availability where gardener_id in (${ids})`);
  sql(`delete from public.availability_blocks where gardener_id in (${ids})`);
  sql(`delete from public.gardener_licenses where gardener_id in (${ids})`);
  const companies = `(select id from public.companies where provider_user_id in (${ids}))`;
  sql(`delete from public.company_applications where user_id in (${ids})`);
  sql(`delete from public.company_member_services where member_id in (select id from public.company_members where company_id in ${companies})`);
  sql(`delete from public.company_invitations where company_id in ${companies}`);
  sql(`delete from public.company_members where company_id in ${companies} or user_id in (${ids})`);
  sql(`delete from public.companies where provider_user_id in (${ids})`);
  sql(`delete from public.gardener_service_prices where gardener_id in (${ids})`);
  sql(`delete from public.gardener_profiles where user_id in (${ids})`);
  sql(`delete from public.profiles where user_id in (${ids})`);
  sql(`delete from auth.users where id in (${ids})`);
}

// Restos de una ejecución anterior que no llegó a limpiar (solo cuentas de este script).
const stale = sql("select coalesce(string_agg(id::text, ','), '') from auth.users where email like '%@f4-verify.local'");
if (stale) cleanup(stale.split(','));

try {
  await main();
} catch (error) {
  console.error('Error ejecutando la verificación:', error.message);
  results.push({ id: 'error', ok: false });
} finally {
  try { cleanup(); } catch (error) { console.error('Error limpiando:', error.message); results.push({ id: 'cleanup', ok: false }); }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} en verde. Reservas de prueba creadas y borradas: ${createdBookings.size}. Cuentas: ${createdUsers.length}.`);
process.exit(failed ? 1 : 0);
