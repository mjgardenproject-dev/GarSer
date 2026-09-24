// GarSer Empresas — piezas comunes para las verificaciones que necesitan una empresa de prueba
// (F5 en adelante): cuentas desechables, alta real de la empresa, equipo por invitación,
// horarios, venta por los caminos reales y limpieza. Solo contra el Supabase LOCAL.

import { randomUUID } from 'node:crypto';
import { authority, sql, env, PROVIDER_ID } from '../readiness/_harness.mjs';

export { authority, sql, PROVIDER_ID };

const { apiUrl, anonKey, serviceRoleKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: estas verificaciones crean y borran cuentas y reservas.`);
  process.exit(2);
}
export { apiUrl, anonKey };

export const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
export const PHYTO = sql("select id from public.services where name = 'Servicios fitosanitarios' limit 1;").trim();
export const HEDGE = sql("select id from public.services where name = 'Poda de setos' limit 1;").trim();
/** Trabajo de césped de 2 horas con la configuración del jardinero de la semilla. */
export const LAWN_INPUT = {
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};

export function makeRecorder() {
  const results = [];
  const record = (id, description, ok, detail) => {
    results.push({ id, ok });
    console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
  };
  return { results, record };
}

export async function rest(method, path, token, body) {
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
export const rpc = (fn, args, token) => rest('POST', `/rest/v1/rpc/${fn}`, token, args);
export const why = (r) => (r.ok ? '' : ` (${r.body?.message ?? r.body?.error ?? JSON.stringify(r.body).slice(0, 140)})`);

export async function signIn(email) {
  const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return (await res.json()).access_token;
}

/** Fábrica de cuentas de un dominio de prueba; `created` guarda sus ids para limpiar. */
export function accounts(domain) {
  const run = Date.now();
  const created = [];
  const newUser = async (label, role = 'client') => {
    const email = `${label}-${run}@${domain}`;
    const res = await fetch(`${apiUrl}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test123456!', data: { role, requested_role: role } }),
    });
    const body = await res.json();
    const id = body?.user?.id ?? body?.id;
    if (!id) throw new Error(`No se pudo crear ${label}: ${JSON.stringify(body).slice(0, 160)}`);
    created.push(id);
    return { id, email, token: body.access_token };
  };
  const stale = () => {
    const ids = sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where email like '%@${domain}'`);
    return ids ? ids.split(',') : [];
  };
  return { newUser, created, stale, run };
}

/** Empresa aprobada por el alta real, con coordenadas y los precios del jardinero de la semilla. */
export async function createCompany(newUser, label, services = [LAWN, PHYTO, HEDGE]) {
  const adminToken = await signIn('admin.local@test.local');
  const owner = await newUser(label, 'company');
  const draft = await rest('POST', '/rest/v1/company_applications', owner.token, {
    user_id: owner.id, commercial_name: `${label} ${Date.now()}`, legal_name: `${label} S.L.`, tax_id: 'B11111111',
    contact_name: `Dueña ${label}`, phone: '600000005', address: 'Marbella', city_zone: 'Marbella', services: ['Corte de césped'],
    owner_works: false, accept_terms: true, declaration_truth: true, answers: { team_size: '2-5', has_liability_insurance: true },
  });
  await rpc('submit_company_application', { p_application_id: draft.rows[0]?.id }, owner.token);
  const approve = await rpc('admin_review_company_application', { p_application_id: draft.rows[0]?.id, p_status: 'approved', p_comment: null }, adminToken);
  if (!approve.ok) throw new Error(`No se pudo aprobar la empresa: ${why(approve)}`);
  sql(`update public.gardener_profiles set operational_latitude = 36.51, operational_longitude = -4.882, max_distance = 30 where user_id = '${owner.id}'`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
       select '${owner.id}', service_id, unit_type, price_per_unit, currency, true, additional_config
       from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}' and service_id in (${services.map((s) => `'${s}'`).join(',')})`);
  const token = await signIn(owner.email);
  const memberId = sql(`select id from public.company_members where user_id='${owner.id}'`);
  return { ...owner, token, memberId, adminToken };
}

export async function joinTeam(newUser, ownerToken, label, services = [LAWN]) {
  const person = await newUser(label);
  const inv = await rpc('create_company_invitation', { p_email: person.email }, ownerToken);
  const acc = await rpc('accept_company_invitation', { p_token: inv.body?.token }, person.token);
  if (!acc.ok) throw new Error(`${label} no pudo unirse: ${why(acc)}`);
  const memberId = sql(`select id from public.company_members where user_id='${person.id}'`);
  const token = await signIn(person.email);
  if (services.length) {
    const r = await rpc('set_company_member_services', { p_member_id: memberId, p_service_ids: services }, ownerToken);
    if (!r.ok) throw new Error(`Servicios de ${label}: ${why(r)}`);
  }
  return { ...person, token, memberId };
}

export function setAvailability(userId, date, hours) {
  if (!hours.length) return;
  const values = hours.map((h) => `('${userId}', '${date}', '${String(h).padStart(2, '0')}:00', '${String(h + 1).padStart(2, '0')}:00', true)`).join(',');
  sql(`insert into public.availability (gardener_id, date, start_time, end_time, is_available) values ${values}
       on conflict (gardener_id, date, start_time) do update set is_available = true`);
}

export const freeHoursOf = (userId, date) =>
  sql(`select coalesce(string_agg(extract(hour from start_time)::int::text, ',' order by start_time), '')
       from public.availability where gardener_id='${userId}' and date='${date}' and is_available`);

export async function validHours(providerId, date, serviceId = LAWN, input = LAWN_INPUT) {
  const r = await authority({ action: 'valid_hours', serviceId, providerId, date, bookingInput: input });
  return { r, hours: (r.body?.validHours || []).join(',') };
}

/** Presupuesto → bloqueo de pago → confirmación como el webhook de Stripe. */
export async function pay(providerId, client, date, startHour, { serviceId = LAWN, input = LAWN_INPUT } = {}) {
  const q = await authority(
    { action: 'create_quote', serviceId, providerId, date, startTime: `${String(startHour).padStart(2, '0')}:00`, bookingInput: input },
    { accessToken: client.token },
  );
  const quoteId = q.body?.quoteId;
  if (!q.ok || !quoteId) return { error: `create_quote ${q.status}${why({ ok: false, body: q.body })}` };
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}` };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId,
    p_stripe_event_id: `evt_emp_${randomUUID()}`,
    p_stripe_payment_intent_id: `pi_emp_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents,
    p_currency: 'eur',
    p_gateway_payload: {},
  });
  return { bookingId: conf.body?.bookingId ?? null, confirm: conf };
}

export const workerOf = (bookingId) =>
  sql(`select coalesce(string_agg(distinct assignee_id::text, ','), '') from public.booking_blocks where booking_id='${bookingId}'`);

export function cleanupUsers(userIds) {
  if (!userIds.length) return;
  const ids = userIds.map((id) => `'${id}'`).join(',');
  const bookings = `(select id from public.bookings where gardener_id in (${ids}) or client_id in (${ids}))`;
  sql(`select public.release_booking_schedule(id) from public.bookings where id in ${bookings}`);
  sql(`delete from public.bookings where id in ${bookings}`);
  sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where gardener_id in (${ids}) or client_id in (${ids}))`);
  sql(`delete from public.booking_schedule_holds where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.booking_payment_attempts where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.booking_quotes where gardener_id in (${ids}) or client_id in (${ids})`);
  sql(`delete from public.availability where gardener_id in (${ids})`);
  sql(`delete from public.availability_blocks where gardener_id in (${ids})`);
  sql(`delete from public.recurring_schedules where gardener_id in (${ids})`);
  sql(`delete from public.recurring_availability_settings where gardener_id in (${ids})`);
  sql(`delete from public.gardener_licenses where gardener_id in (${ids})`);
  const companies = `(select id from public.companies where provider_user_id in (${ids}))`;
  sql(`delete from public.company_applications where user_id in (${ids})`);
  sql(`delete from public.company_member_services where member_id in (select id from public.company_members where company_id in ${companies} or user_id in (${ids}))`);
  sql(`delete from public.company_invitations where company_id in ${companies}`);
  sql(`delete from public.company_members where company_id in ${companies} or user_id in (${ids})`);
  sql(`delete from public.companies where provider_user_id in (${ids})`);
  sql(`delete from public.gardener_service_prices where gardener_id in (${ids})`);
  sql(`delete from public.gardener_profiles where user_id in (${ids})`);
  sql(`delete from public.profiles where user_id in (${ids})`);
  sql(`delete from auth.users where id in (${ids})`);
}

/** Ejecuta `main` limpiando restos anteriores antes y todo lo creado después. */
export async function runVerification({ acc, results, main }) {
  const stale = acc.stale();
  if (stale.length) cleanupUsers(stale);
  try {
    await main();
  } catch (error) {
    console.error('Error ejecutando la verificación:', error.message);
    results.push({ id: 'error', ok: false });
  } finally {
    try { cleanupUsers(acc.created); } catch (error) { console.error('Error limpiando:', error.message); results.push({ id: 'cleanup', ok: false }); }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} en verde. Cuentas de prueba borradas: ${acc.created.length}.`);
  process.exit(failed ? 1 : 0);
}
