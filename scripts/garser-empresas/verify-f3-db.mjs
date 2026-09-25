#!/usr/bin/env node
// GarSer Empresas · F3.1 — verificación del SERVIDOR del alta de empresas y empleados, contra el
// Supabase LOCAL y siempre por la API (como lo haría un atacante), nunca por la interfaz.
//
// Recorre el ciclo entero con cuentas desechables: solicitud de empresa → revisión del admin →
// invitación → aceptación → servicios por empleado → carnet → baja. Y prueba los atajos: token
// caducado, repetido o revocado, correo equivocado, autónomo aceptando, empresa manipulada en la
// petición (F3-04, la prueba de seguridad principal de la fase), servicios no activos, carnet
// ausente o caducado…
//
// Uso:    node scripts/garser-empresas/verify-f3-db.mjs
// Salida: una línea por prueba; código 1 si alguna falla.
// Crea cuentas *@f3-verify.local y lo borra todo al terminar. Solo corre contra 127.0.0.1.

import { execFileSync } from 'node:child_process';

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = status.API_URL;
const ANON = status.ANON_KEY;
if (!/^http:\/\/127\.0\.0\.1:/.test(API)) {
  console.error(`Me niego a correr contra ${API}: esta verificación crea y borra cuentas.`);
  process.exit(2);
}

const DB = 'supabase_db_GarSer-main_4';
const sql = (q) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-c', q], { encoding: 'utf8' }).trim();
const RUN = Date.now();
const results = [];
const createdUsers = [];
const GARDENER = '11111111-aaaa-4aaa-8aaa-111111111111';
const LAWN = sql("select id from public.services where name='Corte de césped'");
const HEDGE = sql("select id from public.services where name='Poda de setos'");
const PHYTO = sql("select id from public.services where name='Servicios fitosanitarios'");

function record(id, description, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
}

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data, rows: Array.isArray(data) ? data : [] };
}
const rpc = (fn, token, args) => call('POST', `/rest/v1/rpc/${fn}`, token, args);
const msg = (r) => (r.ok ? '' : ` (${r.data?.message ?? JSON.stringify(r.data).slice(0, 120)})`);

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return (await res.json()).access_token;
}

async function newUser(label, role = 'client') {
  const email = `${label}-${RUN}@f3-verify.local`;
  const res = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { full_name: label, role, requested_role: role } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id) throw new Error(`No se pudo crear ${label}: ${JSON.stringify(body).slice(0, 160)}`);
  createdUsers.push(id);
  return { id, email, token: body.access_token };
}

const exists = (t) => sql(`select to_regclass('public.${t}') is not null`) === 't';
const fnExists = (f) => sql(`select count(*) from pg_proc where proname='${f}' and pronamespace='public'::regnamespace`) !== '0';

const FULL_APPLICATION = {
  commercial_name: 'Jardines Prueba F3', legal_name: 'Jardines Prueba F3 S.L.', tax_id: 'B12345678',
  contact_name: 'Ana Dueña', phone: '600123123', address: 'Calle Mayor 1, Marbella', city_zone: 'Marbella',
  services: ['Corte de césped', 'Poda de setos'], owner_works: false, accept_terms: true, declaration_truth: true,
  answers: { team_size: '2-5', has_liability_insurance: true },
};

async function main() {
  const needed = ['company_applications'].every(exists) && ['submit_company_application', 'admin_review_company_application',
    'create_company_invitation', 'accept_company_invitation', 'set_company_member_services'].every(fnExists);
  if (!needed) {
    record('F3-00', 'Servidor de F3 desplegado (tabla de solicitudes y funciones)', false, 'todavía no existen');
    return;
  }
  const adminToken = await signIn('admin.local@test.local');

  // ── Solicitud de empresa (A-24) ─────────────────────────────────────────────
  const client = await newUser('cliente');
  {
    const r = await call('POST', '/rest/v1/company_applications', client.token, { user_id: client.id, ...FULL_APPLICATION });
    record('F3-20', 'Un cliente NO puede abrir una solicitud de empresa', !r.ok, `HTTP ${r.status}`);
  }

  const owner = await newUser('dueno', 'company');
  record('F3-21', 'Registrarse como empresa deja la cuenta con rol company (A-20)',
    sql(`select role from public.profiles where user_id='${owner.id}'`) === 'company');

  let appId;
  {
    const draft = await call('POST', '/rest/v1/company_applications', owner.token, { user_id: owner.id, commercial_name: 'A medias' });
    appId = draft.rows[0]?.id;
    const early = await rpc('submit_company_application', owner.token, { p_application_id: appId });
    const selfStatus = await call('PATCH', `/rest/v1/company_applications?id=eq.${appId}`, owner.token, { status: 'approved' });
    record('F3-22', 'La empresa crea su borrador, no puede enviarlo incompleto ni aprobarse ella misma',
      draft.ok && !early.ok && /^Falta: .*razón social.*CIF/.test(early.data?.message ?? '') && !selfStatus.ok && sql(`select status from public.company_applications where id='${appId}'`) === 'draft',
      `borrador ${draft.status}, envío incompleto ${early.status}${msg(early)}, autoaprobación ${selfStatus.status}`);

    const fill = await call('PATCH', `/rest/v1/company_applications?id=eq.${appId}`, owner.token, FULL_APPLICATION);
    const submit = await rpc('submit_company_application', owner.token, { p_application_id: appId });
    const late = await call('PATCH', `/rest/v1/company_applications?id=eq.${appId}`, owner.token, { commercial_name: 'Cambio tras enviar' });
    record('F3-23', 'La empresa completa y envía; después ya no puede cambiarla',
      fill.ok && submit.ok && sql(`select status||'|'||commercial_name from public.company_applications where id='${appId}'`) === 'submitted|Jardines Prueba F3',
      `rellenar ${fill.status}, enviar ${submit.status}${msg(submit)}, cambio posterior ${late.status}`);
  }

  record('F3-09', 'Antes de aprobar, la empresa no tiene ficha de proveedor ni sale en el directorio',
    sql(`select count(*) from public.gardener_profiles where user_id='${owner.id}'`) === '0' &&
    (await call('GET', `/rest/v1/public_gardener_directory?select=user_id&user_id=eq.${owner.id}`, null)).rows.length === 0);

  {
    const other = await call('GET', '/rest/v1/company_applications?select=id', client.token);
    const adm = await call('GET', `/rest/v1/company_applications?select=id,answers&id=eq.${appId}`, adminToken);
    record('F3-10', 'El admin ve la solicitud con sus respuestas; otro usuario no ve nada',
      other.rows.length === 0 && adm.rows.length === 1 && adm.rows[0].answers?.team_size === '2-5',
      `otro ${other.rows.length}, admin ${adm.rows.length}`);
  }

  {
    const byOwner = await rpc('admin_review_company_application', owner.token, { p_application_id: appId, p_status: 'approved', p_comment: null });
    const approve = await rpc('admin_review_company_application', adminToken, { p_application_id: appId, p_status: 'approved', p_comment: 'OK' });
    const gp = sql(`select coalesce(max(provider_kind||'|'||full_name), 'SIN FICHA') from public.gardener_profiles where user_id='${owner.id}'`);
    const company = sql(`select count(*) from public.companies where provider_user_id='${owner.id}'`);
    const ownerMember = sql(`select coalesce(max(role||'|'||status||'|'||counts_as_labour), '-') from public.company_members where user_id='${owner.id}'`);
    record('F3-24', 'Solo el admin aprueba; al aprobar se crean ficha de empresa, empresa y dueño (sin trabajar, D3)',
      !byOwner.ok && approve.ok && gp === 'company|Jardines Prueba F3' && company === '1' && ownerMember === 'owner|active|false',
      `el propio dueño ${byOwner.status}, admin ${approve.status}${msg(approve)}, ficha ${gp}, empresas ${company}, dueño ${ownerMember}`);
  }

  {
    const owner2 = await newUser('dueno-rechazado', 'company');
    const d = await call('POST', '/rest/v1/company_applications', owner2.token, { user_id: owner2.id, ...FULL_APPLICATION, commercial_name: 'Rechazable' });
    await rpc('submit_company_application', owner2.token, { p_application_id: d.rows[0]?.id });
    const rej = await rpc('admin_review_company_application', adminToken, { p_application_id: d.rows[0]?.id, p_status: 'rejected', p_comment: 'Falta el seguro' });
    record('F3-25', 'El admin rechaza: queda rechazada con motivo y no se crea nada',
      rej.ok && sql(`select status||'|'||review_comment from public.company_applications where id='${d.rows[0]?.id}'`) === 'rejected|Falta el seguro' &&
      sql(`select count(*) from public.gardener_profiles where user_id='${owner2.id}'`) === '0',
      `HTTP ${rej.status}${msg(rej)}`);
  }

  const ownerToken = await signIn(owner.email);
  const companyId = sql(`select id from public.companies where provider_user_id='${owner.id}'`);

  // ── Invitaciones (A-22) ─────────────────────────────────────────────────────
  const emp = await newUser('empleado');
  let token;
  {
    const byClient = await rpc('create_company_invitation', client.token, { p_email: emp.email });
    const inv = await rpc('create_company_invitation', ownerToken, { p_email: emp.email.toUpperCase() });
    token = inv.data?.token;
    record('F3-26', 'Solo el dueño invita; la invitación devuelve un token una vez',
      !byClient.ok && inv.ok && typeof token === 'string' && token.length >= 43, `cliente ${byClient.status}, dueño ${inv.status}${msg(inv)}`);
    const stored = sql(`select count(*) from public.company_invitations where token_hash='${token}' or email='${token}' or id::text='${token}'`);
    const hashed = sql(`select count(*) from public.company_invitations where token_hash=encode(extensions.digest('${token}','sha256'),'hex')`);
    record('F3-06', 'El token no está en claro en la base de datos: solo su huella SHA-256', stored === '0' && hashed === '1', `en claro ${stored}, huella ${hashed}`);
  }

  {
    const wrong = await newUser('otro-correo');
    const r = await rpc('accept_company_invitation', wrong.token, { p_token: token });
    record('F3-27', 'Otra persona con el token pero distinto correo NO puede aceptar', !r.ok, `HTTP ${r.status}${msg(r)}`);
  }

  {
    const otherOwner = await newUser('dueno-otra', 'company');
    sql(`insert into public.gardener_profiles (user_id, full_name, phone, address, provider_kind) values ('${otherOwner.id}', 'Otra Empresa', '6', 'x', 'company')`);
    const otherCompany = sql(`insert into public.companies (provider_user_id, legal_name) values ('${otherOwner.id}', 'Otra') returning id`).split('\n')[0];
    const forged = await rpc('accept_company_invitation', emp.token, { p_token: token, p_company_id: otherCompany });
    const inOther = sql(`select count(*) from public.company_members where user_id='${emp.id}' and company_id='${otherCompany}'`);
    record('F3-04', 'Aceptar con la empresa manipulada en la petición NO mete al empleado en otra empresa',
      inOther === '0', `HTTP ${forged.status}${msg(forged)}, filas en la otra empresa: ${inOther}`);
  }

  {
    const acc = await rpc('accept_company_invitation', emp.token, { p_token: token });
    const member = sql(`select coalesce(max(company_id||'|'||role||'|'||status), '-') from public.company_members where user_id='${emp.id}'`);
    const role = sql(`select role from public.profiles where user_id='${emp.id}'`);
    record('F3-01', 'Aceptar con token válido y el mismo correo: empleado de la empresa del token',
      acc.ok && member === `${companyId}|employee|active` && role === 'employee', `HTTP ${acc.status}${msg(acc)}, miembro ${member}, rol ${role}`);
    const again = await rpc('accept_company_invitation', emp.token, { p_token: token });
    record('F3-03', 'Aceptar dos veces el mismo token: la segunda se rechaza', !again.ok, `HTTP ${again.status}${msg(again)}`);
  }

  {
    const late = await newUser('caducado');
    const inv = await rpc('create_company_invitation', ownerToken, { p_email: late.email });
    sql(`update public.company_invitations set expires_at = now() - interval '1 minute' where company_id='${companyId}' and email='${late.email}'`);
    const r = await rpc('accept_company_invitation', late.token, { p_token: inv.data?.token });
    record('F3-02', 'Aceptar con token caducado se rechaza', !r.ok && sql(`select count(*) from public.company_members where user_id='${late.id}'`) === '0', `HTTP ${r.status}${msg(r)}`);

    const revoked = await newUser('revocado');
    const inv2 = await rpc('create_company_invitation', ownerToken, { p_email: revoked.email });
    const rev = await rpc('revoke_company_invitation', ownerToken, { p_invitation_id: inv2.data?.invitation_id });
    const r2 = await rpc('accept_company_invitation', revoked.token, { p_token: inv2.data?.token });
    record('F3-28', 'Una invitación revocada ya no se puede aceptar', rev.ok && !r2.ok, `revocar ${rev.status}, aceptar ${r2.status}${msg(r2)}`);
  }

  {
    const inv = await rpc('create_company_invitation', ownerToken, { p_email: 'jardinero.local@test.local' });
    const gToken = await signIn('jardinero.local@test.local');
    const r = await rpc('accept_company_invitation', gToken, { p_token: inv.data?.token });
    record('F3-05', 'Un autónomo activo NO puede aceptar ser empleado, con explicación',
      !r.ok && sql(`select count(*) from public.company_members where user_id='${GARDENER}'`) === '0', `HTTP ${r.status}${msg(r)}`);
  }

  // ── Empleado: ni proveedor ni visible (F3-07, F3-08) ────────────────────────
  {
    const r = await call('POST', '/rest/v1/gardener_profiles', emp.token, { user_id: emp.id, full_name: 'x', phone: '6', address: 'x' });
    const dir = await call('GET', `/rest/v1/public_gardener_directory?select=user_id&user_id=eq.${emp.id}`, null);
    record('F3-07', 'Un empleado no puede crearse una ficha de proveedor', !r.ok, `HTTP ${r.status}`);
    record('F3-08', 'Un empleado no aparece en el directorio público', dir.rows.length === 0);
  }

  // ── Servicios por empleado (D5) y carnet (D4) ───────────────────────────────
  const empMember = sql(`select id from public.company_members where user_id='${emp.id}'`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, price_per_unit, unit_type, active)
       values ('${owner.id}', '${LAWN}', 0.2, 'area', true), ('${owner.id}', '${PHYTO}', 0.2, 'area', true)`);
  {
    const notActive = await rpc('set_company_member_services', ownerToken, { p_member_id: empMember, p_service_ids: [HEDGE] });
    record('F3-11', 'Asignar a un empleado un servicio que la empresa NO tiene activo se rechaza', !notActive.ok, `HTTP ${notActive.status}${msg(notActive)}`);
    const byEmp = await rpc('set_company_member_services', emp.token, { p_member_id: empMember, p_service_ids: [LAWN] });
    record('F3-29', 'Un empleado no puede asignarse servicios a sí mismo', !byEmp.ok, `HTTP ${byEmp.status}`);
    const lawn = await rpc('set_company_member_services', ownerToken, { p_member_id: empMember, p_service_ids: [LAWN] });
    record('F3-30', 'El dueño asigna un servicio activo al empleado',
      lawn.ok && sql(`select count(*) from public.company_member_services where member_id='${empMember}'`) === '1', `HTTP ${lawn.status}${msg(lawn)}`);
    const phytoNoLicense = await rpc('set_company_member_services', ownerToken, { p_member_id: empMember, p_service_ids: [LAWN, PHYTO] });
    record('F3-12', 'Activar fitosanitarios a un empleado SIN carnet aprobado se rechaza', !phytoNoLicense.ok, `HTTP ${phytoNoLicense.status}${msg(phytoNoLicense)}`);
  }

  {
    const upload = await call('POST', '/rest/v1/gardener_licenses', emp.token, {
      gardener_id: emp.id, license_number: `F3-${RUN}`, document_url: `${emp.id}/carnet.pdf`, status: 'pending', terms_accepted: true,
    });
    const licenseId = upload.rows[0]?.id;
    const review = await rpc('review_gardener_license', adminToken, { p_license_id: licenseId, p_status: 'approved', p_expires_at: '2030-01-01T00:00:00Z' });
    const phyto = await rpc('set_company_member_services', ownerToken, { p_member_id: empMember, p_service_ids: [LAWN, PHYTO] });
    record('F3-31', 'El empleado sube su carnet, el admin lo aprueba y ya se le puede activar fitosanitarios',
      upload.ok && review.ok && phyto.ok && sql(`select count(*) from public.company_member_services where member_id='${empMember}' and service_id='${PHYTO}'`) === '1',
      `subida ${upload.status}${msg(upload)}, revisión ${review.status}${msg(review)}, asignar ${phyto.status}${msg(phyto)}`);

    const selfApproved = await call('POST', '/rest/v1/gardener_licenses', emp.token, {
      gardener_id: emp.id, license_number: `FALSA-${RUN}`, document_url: `${emp.id}/nada.pdf`, status: 'approved',
      expires_at: '2035-01-01T00:00:00Z', reviewed_at: '2026-01-01T00:00:00Z', terms_accepted: true,
    });
    record('F3-36', 'Nadie puede crear su licencia ya aprobada, sin revisión (H-22)', !selfApproved.ok &&
      sql(`select count(*) from public.gardener_licenses where license_number='FALSA-${RUN}'`) === '0', `HTTP ${selfApproved.status}`);

    const cliUpload = await call('POST', '/rest/v1/gardener_licenses', client.token, {
      gardener_id: client.id, license_number: 'x', document_url: `${client.id}/x.pdf`, status: 'pending', terms_accepted: true,
    });
    record('F3-32', 'Un cliente sin empresa ni ficha no puede subir un carnet', !cliUpload.ok, `HTTP ${cliUpload.status}`);

    sql(`update public.gardener_licenses set status='expired' where id='${licenseId}'`);
    record('F3-13', 'Si el carnet caduca, al empleado se le quita el servicio fitosanitario',
      sql(`select count(*) from public.company_member_services where member_id='${empMember}' and service_id='${PHYTO}'`) === '0' &&
      sql(`select count(*) from public.company_member_services where member_id='${empMember}' and service_id='${LAWN}'`) === '1');
  }

  // ── Resúmenes para las pantallas (F3.3) ─────────────────────────────────────
  {
    const team = await rpc('company_team_overview', ownerToken, {});
    const me = team.data?.members?.find((m) => m.user_id === emp.id);
    const byEmp = await rpc('company_team_overview', emp.token, {});
    const byClient = await rpc('company_team_overview', client.token, {});
    record('F3-37', 'El dueño ve su equipo (servicios y estado del carnet de cada uno); un empleado o un cliente no',
      team.ok && team.data?.company?.commercial_name === 'Jardines Prueba F3' && me?.services?.length === 1 && me?.has_valid_phyto_license === false &&
      team.data?.offered_services?.length === 2 && !byEmp.ok && !byClient.ok,
      `dueño ${team.status}${msg(team)} (miembros ${team.data?.members?.length}, ofrecidos ${team.data?.offered_services?.length}), empleado ${byEmp.status}, cliente ${byClient.status}`);
    const mine = await rpc('my_company_membership', emp.token, {});
    record('F3-38', 'El empleado ve a qué empresa pertenece y sus servicios',
      mine.ok && mine.data?.company_name === 'Jardines Prueba F3' && Array.isArray(mine.data?.services) && mine.data.services.includes('Corte de césped') &&
      mine.data?.company_offers_phyto === true,
      `HTTP ${mine.status}${msg(mine)}`);
    const probe = await rpc('has_valid_phyto_license', client.token, { p_user_id: emp.id });
    record('F3-39', 'Nadie puede preguntar si otra persona tiene carnet (has_valid_phyto_license no es pública)', !probe.ok, `HTTP ${probe.status}`);
  }

  {
    const guest = `f3-preview-${RUN}@test.local`;
    const inv = await rpc('create_company_invitation', ownerToken, { p_email: guest });
    const valid = await rpc('invitation_preview', null, { p_token: inv.data?.token });
    await rpc('revoke_company_invitation', ownerToken, { p_invitation_id: inv.data?.invitation_id });
    const revoked = await rpc('invitation_preview', null, { p_token: inv.data?.token });
    const used = await rpc('invitation_preview', null, { p_token: token });
    const junk = await rpc('invitation_preview', null, { p_token: 'no-es-un-token' });
    record('F3-51', 'El enlace de invitación dice, sin sesión, quién invita y si sigue valiendo (válida, anulada, usada, inventada)',
      valid.ok && valid.data?.state === 'valid' && valid.data?.company_name === 'Jardines Prueba F3' && valid.data?.email === guest &&
      revoked.data?.state === 'revoked' && used.data?.state === 'accepted' && junk.data?.state === 'invalid' && junk.data?.company_name === undefined,
      `válida ${valid.status}${msg(valid)} ${valid.data?.state}, anulada ${revoked.data?.state}, usada ${used.data?.state}, inventada ${junk.data?.state}`);
  }

  // ── «Yo también trabajo» (D3) ────────────────────────────────────────────────
  {
    const on = await rpc('set_company_owner_works', ownerToken, { p_works: true });
    const v1 = sql(`select counts_as_labour from public.company_members where user_id='${owner.id}'`);
    const off = await rpc('set_company_owner_works', ownerToken, { p_works: false });
    const v2 = sql(`select counts_as_labour from public.company_members where user_id='${owner.id}'`);
    const byEmp = await rpc('set_company_owner_works', emp.token, { p_works: true });
    record('F3-14', 'El dueño activa y desactiva «Yo también trabajo»; un empleado no puede',
      on.ok && v1 === 't' && off.ok && v2 === 'f' && !byEmp.ok, `on ${on.status}→${v1}, off ${off.status}→${v2}, empleado ${byEmp.status}`);
  }

  // ── Perfiles del equipo ──────────────────────────────────────────────────────
  {
    const seen = await call('GET', `/rest/v1/profiles?select=user_id,full_name&user_id=eq.${emp.id}`, ownerToken);
    const peer = await newUser('companero');
    const inv = await rpc('create_company_invitation', ownerToken, { p_email: peer.email });
    await rpc('accept_company_invitation', peer.token, { p_token: inv.data?.token });
    const peerSees = await call('GET', `/rest/v1/profiles?select=user_id&user_id=eq.${emp.id}`, peer.token);
    record('F3-33', 'El dueño ve los datos de su equipo; un compañero no ve los de otro empleado',
      seen.rows.length === 1 && peerSees.rows.length === 0, `dueño ${seen.rows.length}, compañero ${peerSees.rows.length}`);
  }

  // ── Baja de un empleado ──────────────────────────────────────────────────────
  {
    const bookingId = sql(`insert into public.bookings (client_id, gardener_id, service_id, date, start_time, duration_hours, total_price,
         client_address, status, management_fee, management_fee_source)
       values ('${client.id}', '${owner.id}', '${LAWN}', current_date + 7, '10:00', 1, 45, 'x', 'confirmed', 5, 'unknown') returning id`).split('\n')[0];
    sql(`insert into public.booking_blocks (booking_id, assignee_id, date, hour_block) values ('${bookingId}', '${emp.id}', current_date + 7, 10)`);
    const blocked = await rpc('deactivate_company_member', ownerToken, { p_member_id: empMember });
    record('F3-34', 'No se puede dar de baja a un empleado con trabajos futuros', !blocked.ok &&
      sql(`select status from public.company_members where id='${empMember}'`) === 'active', `HTTP ${blocked.status}${msg(blocked)}`);
    sql(`delete from public.bookings where id='${bookingId}'`);
    const byEmp = await rpc('deactivate_company_member', emp.token, { p_member_id: empMember });
    const ok = await rpc('deactivate_company_member', ownerToken, { p_member_id: empMember });
    const state = sql(`select m.status||'|'||p.role from public.company_members m join public.profiles p on p.user_id=m.user_id where m.id='${empMember}'`);
    const empSeesCompany = (await call('GET', '/rest/v1/companies?select=id', await signIn(emp.email))).rows.length;
    record('F3-35', 'Sin trabajos pendientes, el dueño da de baja al empleado: vuelve a cliente y pierde el acceso',
      !byEmp.ok && ok.ok && state === 'inactive|client' && empSeesCompany === 0, `empleado ${byEmp.status}, dueño ${ok.status}${msg(ok)}, queda ${state}, ve empresa: ${empSeesCompany}`);
  }
}

function cleanup() {
  if (!createdUsers.length) return;
  const ids = createdUsers.map((id) => `'${id}'`).join(',');
  const companies = `(select id from public.companies where provider_user_id in (${ids}))`;
  sql(`delete from public.bookings where client_id in (${ids}) or gardener_id in (${ids})`);
  sql(`delete from public.gardener_licenses where gardener_id in (${ids})`);
  if (exists('company_applications')) sql(`delete from public.company_applications where user_id in (${ids})`);
  sql(`delete from public.company_member_services where member_id in (select id from public.company_members where user_id in (${ids}) or company_id in ${companies})`);
  sql(`delete from public.company_invitations where company_id in ${companies}`);
  sql(`delete from public.company_members where user_id in (${ids}) or company_id in ${companies}`);
  sql(`delete from public.companies where provider_user_id in (${ids})`);
  sql(`delete from public.gardener_service_prices where gardener_id in (${ids})`);
  sql(`delete from public.gardener_profiles where user_id in (${ids})`);
  sql(`delete from public.profiles where user_id in (${ids})`);
  sql(`delete from auth.users where id in (${ids})`);
}

try {
  await main();
} catch (error) {
  console.error('Error ejecutando la verificación:', error.message);
  results.push({ id: 'error', ok: false });
} finally {
  try { cleanup(); } catch (error) { console.error('Error limpiando:', error.message); results.push({ id: 'cleanup', ok: false }); }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} en verde. Cuentas de prueba borradas: ${createdUsers.length}.`);
process.exit(failed ? 1 : 0);
