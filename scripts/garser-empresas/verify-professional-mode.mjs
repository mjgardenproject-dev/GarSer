#!/usr/bin/env node
// GarSer Empresas · cuenta de profesional única y dinámica (2026-11-08, docs/garser-empresas/08).
//
// Recorre contra el Supabase LOCAL, por los caminos reales (API, booking-authority, pago como el
// webhook de Stripe), la vida de UNA cuenta de profesional:
//
//   individual  →  (invita al primer compañero)  →  equipo  →  (se va el último)  →  individual  →  equipo
//
// y comprueba lo que prometen las decisiones D31–D40:
//   · nada se pierde: servicios, precios, enlace de reserva, reseñas, carnet, ficha y reservas futuras son
//     los mismos antes y después, en las dos direcciones;
//   · el motor sigue al modo: en equipo suman las horas de los compañeros; al volver, solo las del titular;
//   · los ajustes de equipo vuelven a fábrica al volver a individual y no queda nada esperando asignación;
//   · los invariantes de F2 siguen en pie (un profesional no es empleado de otro, el modo no se escribe por API).
//
// Uso:    node scripts/garser-empresas/verify-professional-mode.mjs
// Requisito: el contenedor de funciones sirve el código actual de booking-authority.
// Salida: una línea por prueba; código 1 si alguna falla. Lo borra todo al terminar.

import { execFileSync } from 'node:child_process';
import {
  accounts, makeRecorder, runVerification, rpc, rest, why, signIn, sql, authority, apiUrl, anonKey,
  LAWN, PHYTO, HEDGE, LAWN_INPUT, PROVIDER_ID, setAvailability, pay, workerOf,
} from './_company-harness.mjs';

const acc = accounts('pmode-verify.local');
const { newUser } = acc;
const { results, record } = makeRecorder();

const DATE = sql('select (current_date + 7)::text;').trim();
const OWNER_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const ANA_HOURS = [15, 16, 17, 18, 19];

const validStarts = async (providerId) => {
  const r = await authority({ action: 'valid_hours', serviceId: LAWN, providerId, date: DATE, bookingInput: LAWN_INPUT });
  return (r.body?.validHours || []).join(',');
};
const modeOf = async (token) => (await rpc('my_provider_mode', {}, token)).body;
const kindOf = (id) => sql(`select provider_kind from public.gardener_profiles where user_id='${id}'`);
const ownerServices = (memberId) =>
  sql(`select coalesce(string_agg(service_id::text, ',' order by service_id), '') from public.company_member_services where member_id='${memberId}'`);

/** Todo lo que «no se puede perder» de un profesional, como texto comparable. */
function snapshot(id, bookingIds = []) {
  return {
    // Las reservas que ya existían: mismo proveedor, mismo estado, mismo día y hora.
    bookings: bookingIds.length
      ? sql(`select coalesce(string_agg(id::text||':'||status||':'||gardener_id::text||':'||date::text||':'||start_time::text||':'||duration_hours::text, '|' order by id), '')
             from public.bookings where id in (${bookingIds.map((b) => `'${b}'`).join(',')})`)
      : '',
    prices: sql(`select coalesce(string_agg(service_id::text||':'||price_per_unit::text||':'||active::text||':'||additional_config::text, '|' order by service_id), '')
                 from public.gardener_service_prices where gardener_id='${id}'`),
    ficha: sql(`select concat_ws('|', full_name, phone, address, operational_latitude, operational_longitude, max_distance,
                 rating_average, rating_count, has_phytosanitary_license, license_verification_status, suspended_at is null)
                from public.gardener_profiles where user_id='${id}'`),
    reviews: sql(`select count(*)::text||'/'||coalesce(round(avg(rating), 2), 0)::text from public.reviews where gardener_id='${id}'`),
    licenses: sql(`select coalesce(string_agg(id::text||':'||status, '|' order by id), '') from public.gardener_licenses where gardener_id='${id}'`),
    directory: sql(`select count(*) from public.public_gardener_directory where user_id='${id}'`),
  };
}

/** Un profesional ya aprobado: ficha, zona y los precios del jardinero de la semilla (como el alta real). */
async function createSolo(label) {
  const pro = await newUser(label, 'gardener');
  sql(`insert into public.gardener_profiles (user_id, full_name, phone, address, operational_latitude, operational_longitude, max_distance)
       values ('${pro.id}', '${label}', '600000010', 'Marbella', 36.51, -4.882, 30)`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
       select '${pro.id}', service_id, unit_type, price_per_unit, currency, true, additional_config
       from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}' and service_id in ('${LAWN}','${HEDGE}','${PHYTO}')`);
  const token = await signIn(pro.email);
  return { ...pro, token };
}

const memberOf = (userId) => sql(`select id from public.company_members where user_id='${userId}' and status='active' limit 1`);

async function scenario() {
  const adminToken = await signIn('admin.local@test.local');
  const client1 = await newUser('cliente1');
  const client2 = await newUser('cliente2');
  const client3 = await newUser('cliente3');

  // ── PM-01 · registro: un solo tipo de profesional ───────────────────────────────────────────
  {
    const viaCompany = await newUser('registro-company', 'company', { legacy: false });
    const viaGardener = await newUser('registro-gardener', 'gardener');
    const viaClient = await newUser('registro-cliente', 'client');
    const roleOf = (id) => sql(`select role from public.profiles where user_id='${id}'`);
    record('PM-01', 'Registrarse como «company» (enlace antiguo) o «gardener» da profesional (gardener); sin tipo, cliente',
      roleOf(viaCompany.id) === 'gardener' && roleOf(viaGardener.id) === 'gardener' && roleOf(viaClient.id) === 'client',
      `company→${roleOf(viaCompany.id)}, gardener→${roleOf(viaGardener.id)}, cliente→${roleOf(viaClient.id)}`);

    const declared = await newUser('declara-company');
    const first = await rpc('self_declare_signup_role', { p_role: 'company' }, declared.token);
    const again = await rpc('self_declare_signup_role', { p_role: 'gardener' }, declared.token);
    record('PM-02', 'Un cliente sin actividad que se declara «company» pasa a gardener, y repetirlo no cambia nada',
      first.ok && first.body === 'declared' && again.body === 'unchanged' && roleOf(declared.id) === 'gardener',
      `${first.body} / ${again.body} / rol ${roleOf(declared.id)}`);
  }

  // ── Un profesional con su día montado y una reserva ya pagada (modo individual) ─────────────
  const pro = await createSolo('profesional');
  setAvailability(pro.id, DATE, OWNER_HOURS);
  const link0 = (await rpc('my_booking_link', {}, pro.token)).body;
  const modeStart = await modeOf(pro.token);
  record('PM-03', 'Un profesional nuevo está en modo individual, sin empresa ni invitaciones, y sin rastro de equipo',
    modeStart?.is_professional === true && modeStart.mode === 'individual' && modeStart.has_team_structure === false
      && modeStart.active_employees === 0 && modeStart.pending_invitations === 0 && kindOf(pro.id) === 'solo'
      && sql(`select count(*) from public.companies where provider_user_id='${pro.id}'`) === '0',
    JSON.stringify(modeStart));

  // Historia previa: una reserva completada con su reseña, y una futura ya pagada.
  const doneId = sql('select gen_random_uuid()').split('\n')[0].trim();
  sql(`insert into public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status, total_price, client_address, management_fee, management_fee_source)
       values ('${doneId}', '${client1.id}', '${pro.id}', '${LAWN}', current_date - 10, '09:00', 2, 'completed', 100, 'Calle Prueba 1', 12.50, 'payment_attempt')`);
  sql(`insert into public.reviews (booking_id, client_id, gardener_id, rating, comment) values ('${doneId}', '${client1.id}', '${pro.id}', 5, 'Muy bien')`);
  const bookingA = await pay(pro.id, client1, DATE, 9);
  const individualHours0 = await validStarts(pro.id);
  record('PM-04', 'En modo individual el titular vende solo y la reserva la hace él',
    !!bookingA.bookingId && workerOf(bookingA.bookingId) === pro.id && individualHours0 === '11,12,13,14,15,16',
    `horas libres ${individualHours0 || '(ninguna)'}${bookingA.error ? ` · ${bookingA.error}` : ''}`);
  const tracked = [doneId, bookingA.bookingId];
  const before = snapshot(pro.id, tracked);

  // ── PM-05 · la primera invitación pide el seguro y no deja nada a medias ────────────────────
  const ana = await newUser('ana');
  const noDeclaration = await rpc('create_company_invitation', { p_email: ana.email }, pro.token);
  const byClient = await rpc('create_company_invitation', { p_email: ana.email, p_liability_declared: true }, client1.token);
  const badEmail = await rpc('create_company_invitation', { p_email: 'esto-no-es-un-correo', p_liability_declared: true }, pro.token);
  record('PM-05', 'Sin declarar el seguro, con un correo inválido o desde un cliente no se invita, y no queda ninguna empresa a medias',
    !noDeclaration.ok && /seguro/i.test(noDeclaration.body?.message ?? '') && !byClient.ok && !badEmail.ok
      && sql(`select count(*) from public.companies where provider_user_id='${pro.id}'`) === '0',
    `sin declarar: ${why(noDeclaration)} · cliente: ${why(byClient)}`);

  // ── PM-06 · una invitación pendiente no cambia la app ───────────────────────────────────────
  const invAna = await rpc('create_company_invitation', { p_email: ana.email, p_liability_declared: true }, pro.token);
  const modePending = await modeOf(pro.token);
  const companyId = sql(`select id from public.companies where provider_user_id='${pro.id}'`);
  const ownerMemberId = sql(`select id from public.company_members where user_id='${pro.id}' and role='owner' and status='active'`);
  const pendingSnapshot = snapshot(pro.id, tracked);
  record('PM-06', 'La primera invitación promociona la cuenta en sitio (empresa + dueño, con declaración fechada) pero el modo sigue siendo individual',
    invAna.ok && !!invAna.body?.token && !!companyId && !!ownerMemberId
      && sql(`select liability_declared_at is not null from public.companies where id='${companyId}'`) === 't'
      && kindOf(pro.id) === 'solo' && modePending.mode === 'individual' && modePending.has_team_structure === true
      && modePending.pending_invitations === 1 && modePending.liability_declared === true
      && (await validStarts(pro.id)) === individualHours0 && JSON.stringify(pendingSnapshot) === JSON.stringify(before),
    `invitación ${invAna.status}${why(invAna)} · ${JSON.stringify(modePending)}`);

  // ── PM-07 · invariantes: un profesional no es empleado de otro; el modo no se escribe por API ──
  {
    const otherPro = await createSolo('otro-profesional');
    const inv = await rpc('create_company_invitation', { p_email: otherPro.email }, pro.token);
    const accept = await rpc('accept_company_invitation', { p_token: inv.body?.token }, otherPro.token);
    record('PM-07', 'Un profesional con ficha NO puede aceptar ser empleado de otro (A-03 / D36), y el intento no cambia ningún modo',
      inv.ok && !accept.ok && /profesional/i.test(accept.body?.message ?? '') && kindOf(pro.id) === 'solo' && kindOf(otherPro.id) === 'solo',
      `aceptar: ${why(accept)}`);

    const patchOwn = await rest('PATCH', `/rest/v1/gardener_profiles?user_id=eq.${pro.id}`, pro.token, { provider_kind: 'company' });
    const patchAnon = await fetch(`${apiUrl}/rest/v1/gardener_profiles?user_id=eq.${pro.id}`, {
      method: 'PATCH', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_kind: 'company' }),
    });
    const direct = await rpc('ensure_provider_team', { p_user: pro.id, p_liability: true }, pro.token);
    record('PM-08', 'Nadie cambia provider_kind por la API (ni el propio titular) ni crea el equipo saltándose la invitación',
      !patchOwn.ok && !patchAnon.ok && kindOf(pro.id) === 'solo' && !direct.ok,
      `titular PATCH ${patchOwn.status}, anónimo PATCH ${patchAnon.status}, RPC interna ${direct.status}`);
  }

  // ── PM-09 · acepta el primer compañero: modo equipo, sin perder nada ────────────────────────
  const accAna = await rpc('accept_company_invitation', { p_token: invAna.body?.token }, ana.token);
  const anaMember = memberOf(ana.id);
  const modeTeam = await modeOf(pro.token);
  const owned = ownerServices(ownerMemberId);
  const teamNoStaff = await validStarts(pro.id);
  record('PM-09', 'Al aceptar el primer compañero la cuenta pasa a modo equipo y el titular conserva lo que vendía (mismas horas válidas que antes)',
    accAna.ok && !!anaMember && kindOf(pro.id) === 'company' && modeTeam.mode === 'team' && modeTeam.active_employees === 1
      && modeTeam.pending_invitations === 1 && modeTeam.owner_works === true
      && owned.split(',').includes(LAWN) && owned.split(',').includes(HEDGE) && !owned.split(',').includes(PHYTO)
      && teamNoStaff === individualHours0,
    `aceptar ${accAna.status}${why(accAna)} · servicios del titular ${owned.split(',').length} (sin fitosanitarios sin carnet) · horas ${teamNoStaff}`);

  // El empleado se asigna el césped y trabaja: las horas de los dos suman.
  {
    setAvailability(ana.id, DATE, ANA_HOURS);
    const assign = await rpc('set_company_member_services', { p_member_id: anaMember, p_service_ids: [LAWN] }, pro.token);
    const union = await validStarts(pro.id);
    record('PM-10', 'En modo equipo suman las horas del titular y de su compañero (11–16 y 15–18)',
      assign.ok && union === '11,12,13,14,15,16,17,18', `horas ${union}${why(assign)}`);
  }

  const afterTeam = snapshot(pro.id, tracked);
  const link1 = (await rpc('my_booking_link', {}, pro.token)).body;
  record('PM-11', 'Pasar a equipo no pierde nada: precios, ficha, reseñas, carnet, perfil público, enlace de reserva y la reserva futura son los mismos',
    JSON.stringify(afterTeam) === JSON.stringify(before) && link1?.code === link0?.code && !!link0?.code
      && workerOf(bookingA.bookingId) === pro.id,
    JSON.stringify(Object.keys(before).filter((k) => before[k] !== afterTeam[k])));

  // ── PM-12 · se vende en equipo: la hora que solo el compañero tiene es suya ─────────────────
  const bookingB = await pay(pro.id, client2, DATE, 17);
  const bookingC = await pay(pro.id, client3, DATE, 11);
  record('PM-12', 'En equipo, la reserva de las 17 la hace el compañero (el titular no llega) y la de las 11 la hace el titular',
    !!bookingB.bookingId && workerOf(bookingB.bookingId) === ana.id && !!bookingC.bookingId && workerOf(bookingC.bookingId) === pro.id,
    `B ${bookingB.error ?? (bookingB.bookingId ? `trabaja ${workerOf(bookingB.bookingId) === ana.id ? 'Ana' : 'otro'}` : '?')} · C ${bookingC.error ?? (bookingC.bookingId ? `trabaja ${workerOf(bookingC.bookingId) === pro.id ? 'el titular' : 'otro'}` : '?')}`);

  // ── PM-13 · no se vuelve a individual con trabajos del compañero por delante ────────────────
  {
    const refused = await rpc('deactivate_company_member', { p_member_id: anaMember }, pro.token);
    record('PM-13', 'No se puede dar de baja al compañero con un trabajo asignado por delante: sigue el modo equipo',
      !refused.ok && /asignados/i.test(refused.body?.message ?? '') && kindOf(pro.id) === 'company', why(refused));
    // La reserva de Ana se cancela (se libera su agenda y desaparece), como si se hubiera anulado.
    sql(`select public.release_booking_schedule('${bookingB.bookingId}')`);
    sql(`delete from public.bookings where id='${bookingB.bookingId}'`);
  }

  // ── PM-14 · ajustes de equipo, y reserva esperando asignación ───────────────────────────────
  const maxCrew = await rpc('set_company_max_crew', { p_max: 3 }, pro.token);
  const split = await rpc('set_company_allow_split_jobs', { p_allow: true }, pro.token);
  const manual = await rpc('set_company_assignment_mode', { p_mode: 'manual' }, pro.token);
  const bookingD = await pay(pro.id, client2, DATE, 13);
  record('PM-14', 'Con el reparto manual una reserva nueva queda esperando asignación (el comportamiento de un equipo)',
    maxCrew.ok && split.ok && manual.ok && !!bookingD.bookingId
      && sql(`select assignment_pending from public.bookings where id='${bookingD.bookingId}'`) === 't',
    `${bookingD.error ?? ''}${why(maxCrew)}${why(manual)}`);

  // ── PM-15 · se va el último compañero: vuelve el modo individual, sin dejar nada colgando ────
  const leave = await rpc('deactivate_company_member', { p_member_id: anaMember }, pro.token);
  const modeBack = await modeOf(pro.token);
  const backHours = await validStarts(pro.id);
  record('PM-15', 'Al irse el último compañero vuelve el modo individual (con la empresa latente) y el titular vuelve a trabajar',
    leave.ok && kindOf(pro.id) === 'solo' && modeBack.mode === 'individual' && modeBack.has_team_structure === true
      && modeBack.active_employees === 0 && modeBack.owner_works === true,
    `${why(leave)} · ${JSON.stringify(modeBack)}`);
  record('PM-16', 'Los ajustes de equipo vuelven a fábrica (capacidad 1, sin reparto, asignación automática) y ninguna reserva queda esperando asignación',
    sql(`select max_crew::text||'/'||allow_split_jobs::text||'/'||assignment_mode from public.companies where id='${companyId}'`) === '1/false/auto'
      && sql(`select count(*) from public.bookings where gardener_id='${pro.id}' and assignment_pending`) === '0'
      && sql(`select public.provider_max_crew('${pro.id}')`) === '1' && sql(`select public.provider_allows_split_jobs('${pro.id}')`) === 'f',
    sql(`select max_crew::text||'/'||allow_split_jobs::text||'/'||assignment_mode from public.companies where id='${companyId}'`));
  record('PM-17', 'De vuelta en individual solo cuentan las horas del titular (lo que le queda libre) y su compañero ya no vende',
    backHours === '15,16', `horas ${backHours || '(ninguna)'}`);

  const afterBack = snapshot(pro.id, tracked);
  const link2 = (await rpc('my_booking_link', {}, pro.token)).body;
  record('PM-18', 'Ida y vuelta sin pérdidas: precios, ficha, reseñas, carnet, perfil público y enlace iguales; las reservas de antes siguen siendo suyas',
    JSON.stringify(afterBack) === JSON.stringify(before) && link2?.code === link0.code
      && [bookingC.bookingId, bookingD.bookingId].every((id) =>
        sql(`select count(*) from public.bookings where id='${id}' and gardener_id='${pro.id}'`) === '1')
      && workerOf(bookingA.bookingId) === pro.id && workerOf(bookingD.bookingId) === pro.id,
    JSON.stringify(Object.keys(before).filter((k) => before[k] !== afterBack[k])));

  // ── PM-19 · en individual, con la empresa latente, se vende como siempre ────────────────────
  {
    const client4 = await newUser('cliente4');
    const bookingE = await pay(pro.id, client4, DATE, 15);
    record('PM-19', 'En individual, con la empresa latente, una reserva nueva se confirma sin esperar asignación y la hace el titular',
      !!bookingE.bookingId && workerOf(bookingE.bookingId) === pro.id
        && sql(`select assignment_pending from public.bookings where id='${bookingE.bookingId}'`) === 'f',
      bookingE.error ?? '');
  }

  // ── PM-20 · se vuelve a crecer: se reutiliza la empresa y el carnet del titular cuenta ──────
  {
    // La web la envía con submit_phyto_license, que exige un fichero ya subido a Storage: aquí se inserta la
    // fila con la clave de servicio y se aprueba por la RPC del admin, que es lo que decide.
    const upload = await rest('POST', '/rest/v1/gardener_licenses', null, {
      gardener_id: pro.id, license_number: `PM-${acc.run}`, document_url: `${pro.id}/carnet-${acc.run}.pdf`, status: 'pending', terms_accepted: true, submitted_by: pro.id,
    });
    const review = await rpc('review_gardener_license', { p_license_id: upload.rows[0]?.id, p_status: 'approved', p_expires_at: '2030-01-01T00:00:00Z' }, adminToken);
    const invAgain = await rpc('create_company_invitation', { p_email: ana.email }, pro.token);   // sin declarar: la empresa ya existe
    const accAgain = await rpc('accept_company_invitation', { p_token: invAgain.body?.token }, ana.token);
    const owned2 = ownerServices(ownerMemberId);
    record('PM-20', 'Volver a tener equipo reutiliza la misma empresa, no pide otra declaración y, con carnet aprobado, el titular también hace fitosanitarios',
      upload.ok && review.ok && invAgain.ok && accAgain.ok && sql(`select id from public.companies where provider_user_id='${pro.id}'`) === companyId
        && kindOf(pro.id) === 'company' && owned2.split(',').includes(PHYTO)
        && sql(`select count(*) from public.provider_workers_all('${pro.id}', array['${PHYTO}']::uuid[], true) w where w = '${pro.id}'`) === '1',
      `subir ${upload.status}${why(upload)}, revisar ${review.status}${why(review)}, invitar ${invAgain.status}${why(invAgain)}, aceptar ${accAgain.status}${why(accAgain)}`);

    // Coherencia permanente (F2-01 nueva): toda empresa con empleados activos es de equipo.
    const incoherent = sql(`select count(*) from public.gardener_profiles gp
      left join public.companies c on c.provider_user_id = gp.user_id
      where gp.user_id = '${pro.id}' and ((c.id is null and gp.provider_kind <> 'solo')
         or (c.id is not null and gp.provider_kind <> 'company' and exists (
              select 1 from public.company_members m where m.company_id = c.id and m.status = 'active' and m.role <> 'owner')))`);
    record('PM-21', 'El tipo de la ficha casa con sus empleados (la regla de F2-01)', incoherent === '0', `incoherentes ${incoherent}`);
  }

  // ── PM-22 · el correo del carnet distingue el modo por provider_kind, no por la fila de la empresa ──
  // «Titular de empresa» (enlace al panel de equipo) solo en modo equipo: una empresa LATENTE no cuenta.
  {
    const edgeLog = () => execFileSync('sh', ['-c', 'docker logs supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const licenseMails = () => edgeLog().split('MOCK EMAIL SEND').filter((c) => c.includes(pro.email) && c.includes('phyto_license_update'));
    const approveNewLicense = async (tag) => {
      const before = licenseMails().length;
      const id = sql(`insert into public.gardener_licenses (gardener_id, license_number, document_url, status, terms_accepted, submitted_by)
        values ('${pro.id}', 'PM-${tag}-${acc.run}', '${pro.id}/carnet-${tag}-${acc.run}.pdf', 'pending', true, '${pro.id}') returning id`).split('\n')[0].trim();
      const review = await rpc('review_gardener_license', { p_license_id: id, p_status: 'approved', p_expires_at: '2031-01-01T00:00:00Z' }, adminToken);
      for (let i = 0; i < 40 && licenseMails().length === before; i++) await new Promise((r) => setTimeout(r, 700));
      return { review, mail: licenseMails().pop() || '', sent: licenseMails().length > before };
    };

    const inTeam = kindOf(pro.id) === 'company';
    const teamMail = await approveNewLicense('equipo');
    const leave = await rpc('deactivate_company_member', { p_member_id: memberOf(ana.id) }, pro.token);
    const individualMail = await approveNewLicense('individual');
    record('PM-22', 'El correo del carnet lleva al panel de equipo en modo equipo y NO en individual (aunque quede una empresa latente)',
      inTeam && teamMail.review.ok && teamMail.sent && teamMail.mail.includes('/empresa?tab=company')
        && leave.ok && kindOf(pro.id) === 'solo' && individualMail.review.ok && individualMail.sent && !individualMail.mail.includes('/empresa'),
      `equipo ${teamMail.sent ? (teamMail.mail.includes('/empresa?tab=company') ? '/empresa' : 'otro enlace') : 'sin correo'} · individual ${individualMail.sent ? (individualMail.mail.includes('/empresa') ? '/empresa (mal)' : 'sin /empresa') : 'sin correo'}${why(leave)}`);
  }

}

async function main() {
  try {
    await scenario();
  } finally {
    // Las reseñas no las borra el borrado genérico de la batería.
    if (acc.created.length) sql(`delete from public.reviews where gardener_id in (${acc.created.map((id) => `'${id}'`).join(',')})`);
  }
}

await runVerification({ acc, results, main });
