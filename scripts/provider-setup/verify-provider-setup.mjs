#!/usr/bin/env node
// Completar la cuenta profesional (2026-10-20): verificación de punta a punta contra el entorno
// LOCAL. En cada escenario se compara lo que dice el apartado (my_provider_setup_status, «¿sale a
// los clientes en este servicio?») con lo que de verdad hace la reserva: si booking-authority
// `preview_providers` lo enseña en «Profesionales». Tienen que coincidir siempre.
//
//   supabase functions serve --workdir "$(pwd)"   # en otra terminal
//   node scripts/provider-setup/verify-provider-setup.mjs
//
// Crea sus propias cuentas (dominio provider-setup.local) y las borra al terminar.

import {
  accounts, authority, cleanupUsers, createCompany, joinTeam, makeRecorder, rpc, runVerification,
  setAvailability, signIn, sql, LAWN, LAWN_INPUT, PHYTO, HEDGE, PROVIDER_ID,
} from '../garser-empresas/_company-harness.mjs';

const acc = accounts('provider-setup.local');
const { results, record } = makeRecorder();

const today = sql("select ((now() at time zone 'Europe/Madrid')::date)::text");
const day = sql("select ((now() at time zone 'Europe/Madrid')::date + 3)::text");
const HOURS = [9, 10, 11, 12, 13];

const phytoInput = (productPreference) => ({
  dataInputMode: 'manual',
  wasteRemoval: false,
  phytosanitaryZones: [{
    id: 'manual-phytosanitary-0', affectedType: 'Césped', intent: 'preventive', productPreference,
    type: 'preventivo', aboveThreeMeters: false, aboveTwoMeters: false, inputSource: 'manual', area: 200,
  }],
  address: LAWN_INPUT.address,
  addressCoordinates: LAWN_INPUT.addressCoordinates,
});

/** Lo que dice el apartado para ese servicio (químico: `visible_chemical`). */
async function setupSays(token, serviceId, chemical = false) {
  const r = await rpc('my_provider_setup_status', {}, token);
  if (!r.ok) throw new Error(`my_provider_setup_status: ${JSON.stringify(r.body).slice(0, 160)}`);
  const svc = (r.body?.services || []).find((s) => s.id === serviceId);
  return { visible: Boolean(svc && (chemical ? svc.visible_chemical : svc.visible)), status: r.body };
}

/** Lo que de verdad enseña «Profesionales». */
async function bookingShows(providerId, serviceId, input) {
  const r = await authority({ action: 'preview_providers', serviceId, providerIds: [providerId], selectedDate: today, windowDays: 14, bookingInput: input });
  return { visible: (r.body?.eligibleProviderIds || []).includes(providerId), why: r.body?.exclusions?.[providerId]?.code };
}

async function compare(id, label, { providerId, token, serviceId, input = LAWN_INPUT, chemical = false, expected }) {
  const says = await setupSays(token, serviceId, chemical);
  const shows = await bookingShows(providerId, serviceId, input);
  record(id, `${label}: el apartado dice «${says.visible ? 'sale' : 'no sale'}» y la reserva ${shows.visible ? 'lo enseña' : `no lo enseña (${shows.why || '—'})`}`,
    says.visible === shows.visible && says.visible === expected);
  return says.status;
}

const copyPrice = (userId, serviceId) => sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
  select '${userId}', service_id, unit_type, price_per_unit, currency, true, additional_config
  from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}' and service_id = '${serviceId}'`);

async function main() {
  // ── Jardinero autónomo, paso a paso ─────────────────────────────────────────────────────
  const solo = await acc.newUser('solo', 'gardener');
  sql(`update public.profiles set role = 'gardener', full_name = 'Solo Setup' where user_id = '${solo.id}'`);
  sql(`insert into public.gardener_profiles (user_id, full_name, phone, address) values ('${solo.id}', 'Solo Setup', '600000000', 'Marbella')`);
  const soloToken = await signIn(solo.email);
  const s = { providerId: solo.id, token: soloToken, serviceId: LAWN };

  const fresh = await compare('S1', 'Recién aprobado', { ...s, expected: false });
  record('S1b', 'Recién aprobado: sin servicios, sin zona y sin horario', fresh.services.length === 0 && !fresh.profile.has_coordinates && fresh.schedule.free_hours_14d === 0);

  copyPrice(solo.id, LAWN);
  await compare('S2', 'Con el servicio activo pero sin zona', { ...s, expected: false });

  sql(`update public.gardener_profiles set operational_latitude = 36.51, operational_longitude = -4.882, max_distance = 25 where user_id = '${solo.id}'`);
  await compare('S3', 'Con zona pero sin horas libres', { ...s, expected: false });

  setAvailability(solo.id, day, HOURS);
  await compare('S4', 'Con horas libres', { ...s, expected: true });

  sql(`insert into public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours) values ('${solo.id}', 4, 24 * 10)`);
  await compare('S5', 'Con 10 días de antelación mínima (las horas libres quedan antes)', { ...s, expected: false });
  sql(`update public.recurring_availability_settings set min_notice_hours = 0 where gardener_id = '${solo.id}'`);

  sql(`update public.gardener_profiles set suspended_at = now() where user_id = '${solo.id}'`);
  await compare('S6', 'Cuenta suspendida', { ...s, expected: false });
  sql(`update public.gardener_profiles set suspended_at = null where user_id = '${solo.id}'`);

  copyPrice(solo.id, PHYTO);
  const p = { ...s, serviceId: PHYTO };
  await compare('S7', 'Fitosanitarios ecológicos sin carnet', { ...p, input: phytoInput('ecological'), expected: true });
  await compare('S8', 'Fitosanitarios químicos sin carnet', { ...p, input: phytoInput('chemical'), chemical: true, expected: false });
  sql(`update public.gardener_profiles set license_verification_status = 'approved', license_expires_at = now() + interval '1 year' where user_id = '${solo.id}'`);
  await compare('S9', 'Fitosanitarios químicos con carnet vigente', { ...p, input: phytoInput('chemical'), chemical: true, expected: true });
  sql(`update public.gardener_profiles set license_expires_at = now() - interval '1 day' where user_id = '${solo.id}'`);
  await compare('S10', 'Fitosanitarios químicos con el carnet caducado', { ...p, input: phytoInput('chemical'), chemical: true, expected: false });

  // ── Empresa ─────────────────────────────────────────────────────────────────────────────
  const company = await createCompany(acc.newUser, 'empresa', [LAWN, HEDGE]);
  const c = { providerId: company.id, token: company.token, serviceId: LAWN };
  const start = await compare('E1', 'Empresa recién aprobada, el dueño no trabaja', { ...c, expected: false });
  record('E1b', 'Recién aprobada: nadie trabaja todavía', start.team?.members?.length === 0 && start.team?.owner_works === false);

  const works = await rpc('set_company_owner_works', { p_works: true }, company.token);
  const assign = await rpc('set_company_member_services', { p_member_id: company.memberId, p_service_ids: [LAWN] }, company.token);
  record('E2a', 'El dueño marca «Yo también trabajo» y se asigna césped', works.ok && assign.ok);
  await compare('E2', 'El dueño hace césped pero no tiene horario', { ...c, expected: false });

  const ana = await joinTeam(acc.newUser, company.token, 'ana', [LAWN]);
  await compare('E3', 'Ana hace césped pero aún no tiene horas', { ...c, expected: false });
  setAvailability(ana.id, day, HOURS);
  const withAna = await compare('E4', 'Ana con horas libres', { ...c, expected: true });
  const anaRow = withAna.team?.members?.find((m) => m.user_id === ana.id);
  record('E4b', 'El apartado ve a Ana con su servicio y sus horas', Boolean(anaRow) && anaRow.free_hours_14d === HOURS.length && anaRow.service_ids.includes(LAWN));

  // Un seto de 40 m (2 h): el mismo pedido que las pruebas de setos (scripts/readiness/setos.mjs).
  const hedgeInput = {
    hedgeZones: [{ type: '0-2m', height: '0-2m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }],
    wasteRemoval: false,
    address: LAWN_INPUT.address,
    addressCoordinates: LAWN_INPUT.addressCoordinates,
  };
  await compare('E5', 'Setos: lo ofrece pero nadie lo hace', { ...c, serviceId: HEDGE, input: hedgeInput, expected: false });
  const anaHedge = await rpc('set_company_member_services', { p_member_id: ana.memberId, p_service_ids: [LAWN, HEDGE] }, company.token);
  record('E5a', 'Se le asigna setos a Ana', anaHedge.ok);
  await compare('E5b', 'Setos: ahora lo hace Ana, que tiene horas', { ...c, serviceId: HEDGE, input: hedgeInput, expected: true });

  sql(`update public.companies set status = 'suspended' where provider_user_id = '${company.id}'`);
  await compare('E6', 'Empresa suspendida', { ...c, expected: false });
  sql(`update public.companies set status = 'active' where provider_user_id = '${company.id}'`);

  // ── Quién puede pedir qué ────────────────────────────────────────────────────────────────
  const asEmployee = await rpc('my_provider_setup_status', {}, ana.token);
  const client = await acc.newUser('cliente');
  const asClient = await rpc('my_provider_setup_status', {}, client.token);
  record('P1', 'Un empleado y un cliente no reciben estado', !asEmployee.ok && !asClient.ok);
  const adminOverview = await rpc('admin_provider_setup_overview', {}, company.adminToken);
  const adminRows = Array.isArray(adminOverview.body) ? adminOverview.body : [];
  record('P2', 'El admin ve a los dos con su estado',
    adminRows.some((r) => r.user_id === solo.id && r.status?.provider_id === solo.id)
      && adminRows.some((r) => r.user_id === company.id && r.provider_kind === 'company'));
  const clientOverview = await rpc('admin_provider_setup_overview', {}, client.token);
  record('P3', 'Un cliente no ve la lista del admin', !clientOverview.ok);

  // ── La foto que ven los clientes ─────────────────────────────────────────────────────────
  sql(`update public.profiles set avatar_url = 'https://ejemplo.test/solo.jpg' where user_id = '${solo.id}'`);
  const photo = sql(`select coalesce(avatar_url, '') from public.public_gardener_directory where user_id = '${solo.id}'`);
  record('F1', 'La foto de «Mi cuenta» es la que ven los clientes', photo === 'https://ejemplo.test/solo.jpg');
}

await runVerification({ acc, results, main });
void cleanupUsers;
