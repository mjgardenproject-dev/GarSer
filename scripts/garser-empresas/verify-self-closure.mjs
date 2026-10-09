#!/usr/bin/env node
// Pendientes · fase A: el propio usuario cierra su cuenta desde «Mi cuenta» (PH-01), sus ficheros
// se borran (PH-04), cada fichero de Storage lo ve solo quien debe (PH-14) y los correos de reserva
// llevan el nombre (PH-15). Contra el Supabase LOCAL con las funciones servidas.
// Uso: node scripts/garser-empresas/verify-self-closure.mjs

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { env } from '../readiness/_harness.mjs';
import {
  accounts, apiUrl, anonKey, createCompany, joinTeam, makeRecorder, pay, rpc, runVerification,
  setAvailability, signIn, sql, why, PROVIDER_ID,
} from './_company-harness.mjs';

const { serviceRoleKey } = env();
const acc = accounts('self-closure.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const D = day(58);
const D2 = day(59);
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const count = (table, where) => Number(sql(`select count(*) from ${table} where ${where}`));
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs --since 4m supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const selfClose = async (token, body) => {
  const res = await fetch(`${apiUrl}/functions/v1/account-closure`, {
    method: 'POST',
    headers: { apikey: anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const preview = async (token) => (await rpc('my_account_closure_preview', {}, token)).body || {};
const upload = (token, bucket, path) => fetch(`${apiUrl}/storage/v1/object/${bucket}/${path}`, {
  method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
  body: new Uint8Array([255, 216, 255, 217]),
}).then((r) => r.status);
const list = (token, bucket, prefix) => fetch(`${apiUrl}/storage/v1/object/list/${bucket}`, {
  method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix, limit: 100 }),
}).then(async (r) => { const b = await r.json().catch(() => null); return Array.isArray(b) ? b.length : -1; });
const download = (token, bucket, path) => fetch(`${apiUrl}/storage/v1/object/authenticated/${bucket}/${path}`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
}).then((r) => r.status);
const sign = (token, bucket, path) => fetch(`${apiUrl}/storage/v1/object/sign/${bucket}/${path}`, {
  method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }),
}).then((r) => r.status);
const publicGet = (bucket, path) => fetch(`${apiUrl}/storage/v1/object/public/${bucket}/${path}`).then((r) => r.status);
/** Sus ficheros (como `account_storage_objects`; los del chat se conservan). */
const filesOf = (id) => count('storage.objects', `(bucket_id in ('applications','private_licenses') and split_part(name,'/',1) = '${id}')
  or (bucket_id = 'booking-photos' and split_part(name,'/',1) in ('drafts','bookings') and split_part(name,'/',2) = '${id}')`);
const giveFiles = async (u) => [
  await upload(u.token, 'applications', `${u.id}/avatar/1.jpg`),
  await upload(u.token, 'applications', `${u.id}/proof/1.jpg`),
  await upload(u.token, 'booking-photos', `drafts/${u.id}/jardin.jpg`),
].join(',');
const givePush = (id) => sql(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('${id}', 'https://fcm.googleapis.com/fcm/send/${randomUUID()}', '${'B'.repeat(87)}', '${'a'.repeat(22)}')`);
const accept = (id, token) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: randomUUID() }, token);
const waitOutbox = async (type, bookingId) => {
  const st = () => sql(`select coalesce(string_agg(status, ','), '') from public.notification_outbox where type = '${type}' and booking_id = '${bookingId}'`);
  for (let i = 0; i < 30 && /pending|sending|^$/.test(st()); i++) await new Promise((r) => setTimeout(r, 700));
  return st();
};
const tick = () => fetch(`${apiUrl}/functions/v1/booking-lifecycle-tick`, {
  method: 'POST', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }, body: '{}',
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Un autónomo con la misma ficha, precios y zona que el jardinero de la semilla (Regla 2). */
async function newFreelancer(label) {
  const u = await acc.newUser(label, 'gardener');
  sql(`update public.profiles set role = 'gardener', full_name = 'Autónomo ${label}' where user_id = '${u.id}'`);
  sql(`insert into public.gardener_profiles select * from jsonb_populate_record(null::public.gardener_profiles,
        (select to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(), 'user_id', '${u.id}', 'full_name', 'Autónomo ${label}', 'phone', '600123123', 'address', 'Calle del autónomo 1')
         from public.gardener_profiles g where g.user_id = '${PROVIDER_ID}'))`);
  sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
       select '${u.id}', service_id, unit_type, price_per_unit, currency, true, additional_config from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}'`);
  return { ...u, token: await signIn(u.email) };
}

async function main() {
  const adminToken = await signIn('admin.local@test.local');

  // ── Sin reservas: se borra entera, con sus ficheros ────────────────────────────────────────
  const fresh = await acc.newUser('sin-nada');
  const up1 = await giveFiles(fresh);
  givePush(fresh.id);
  const p1 = await preview(fresh.token);
  const r1 = await selfClose(fresh.token, { expectedMode: p1.mode });
  record('SC-01', 'Cliente sin reservas: el análisis dice «borrar» (sin devolver su correo) y se borra entera con sus ficheros y avisos al móvil',
    up1 === '200,200,200' && p1.mode === 'delete' && !('email' in p1) && r1.status === 200 && count('auth.users', `id='${fresh.id}'`) === 0
      && filesOf(fresh.id) === 0 && count('public.push_subscriptions', `user_id='${fresh.id}'`) === 0
      && count('public.account_storage_cleanup', `user_id='${fresh.id}' and completed_at is not null and deleted_count = 3`) === 1,
    `subidas ${up1}, análisis ${p1.mode}, cierre ${r1.status} ${JSON.stringify(r1.body)}, ficheros ${filesOf(fresh.id)}`);

  // ── Con una reserva sin terminar: bloqueada, con la fecha ──────────────────────────────────
  const owner = await createCompany(acc.newUser, 'empresa-sc');
  const commercial = sql(`select full_name from public.gardener_profiles where user_id='${owner.id}'`);
  const eva = await joinTeam(acc.newUser, owner.token, 'eva');
  setAvailability(eva.id, D, HOURS);
  const client = await acc.newUser('cliente');
  sql(`update public.profiles set full_name = 'Clara Pérez & Hijos', phone = '600999888', address = 'Calle Mayor 3' where user_id = '${client.id}'`);
  const b1 = (await pay(owner.id, client, D, 8)).bookingId;
  const p2 = await preview(client.token);
  const r2 = await selfClose(client.token, { expectedMode: 'deactivate' });
  const ob = (p2.openBookings || [])[0] || {};
  record('SC-02', 'Cliente con una solicitud pendiente: bloqueada, con la fecha, el estado y el servicio; cerrar igualmente no toca nada',
    !!b1 && p2.mode === 'blocked' && ob.date === D && ob.status === 'pending' && ob.service === 'Corte de césped' && ob.asClient === true
      && r2.status === 409 && sql(`select full_name from public.profiles where user_id='${client.id}'`) === 'Clara Pérez & Hijos',
    `análisis ${p2.mode} ${JSON.stringify(p2.openBookings)}, cierre ${r2.status} ${JSON.stringify(r2.body).slice(0, 140)}`);

  const pe = await preview(eva.token);
  record('SC-03', 'Empleada con un trabajo asignado: bloqueada, con la fecha, hasta que la empresa lo reasigne',
    pe.mode === 'blocked' && (pe.assignedJobs || []).some((j) => j.date === D), `análisis ${pe.mode} ${JSON.stringify(pe.assignedJobs)}`);

  // ── PH-15: el correo de «aceptada» lleva los nombres ───────────────────────────────────────
  await accept(b1, owner.token);
  const accepted = await waitOutbox('booking_accepted', b1);
  const log = edgeLog();
  const line = log.split('MOCK EMAIL SEND').find((chunk) => chunk.includes(client.email) && chunk.includes('booking_accepted')) || '';
  record('SC-04', 'El correo «aceptada» saluda al cliente por su nombre (sin escaparlo dos veces) y nombra a la empresa por su nombre comercial',
    accepted === 'sent' && line.includes('Buenas noticias, Clara Pérez & Hijos') && line.includes(`${commercial} ha aceptado tu reserva`) && !line.includes('&amp;'),
    `cola [${accepted}] ${line.replace(/\s+/g, ' ').slice(0, 260)}`);

  // ── PH-14: quién ve las fotos de la reserva ────────────────────────────────────────────────
  // La ruta definitiva de una foto de reserva (la sube el servidor; booking_media no admite borradores).
  const photo = `bookings/${client.id}/${b1}/reserva.jpg`;
  await upload(serviceRoleKey, 'booking-photos', photo);
  await upload(client.token, 'booking-photos', `drafts/${client.id}/borrador.jpg`);
  sql(`insert into public.booking_media (booking_id, uploader_id, storage_bucket, storage_path, media_type) values ('${b1}', '${client.id}', 'booking-photos', '${photo}', 'image')`);
  const stranger = await acc.newUser('extrano');
  const s = {
    strangerList: await list(stranger.token, 'booking-photos', `drafts/${client.id}`),
    strangerAll: await list(stranger.token, 'booking-photos', 'drafts'),
    strangerGet: await download(stranger.token, 'booking-photos', photo),
    strangerDraft: await download(stranger.token, 'booking-photos', `drafts/${client.id}/borrador.jpg`),
    ownerSign: await sign(owner.token, 'booking-photos', photo),
    clientGet: await download(client.token, 'booking-photos', photo),
    adminGet: await download(adminToken, 'booking-photos', photo),
  };
  record('SC-05', 'Fotos de reserva: un extraño no las lista ni las descarga; el cliente, la empresa de la reserva y el admin sí',
    s.strangerList === 0 && s.strangerAll === 0 && s.strangerGet !== 200 && s.strangerDraft !== 200 && s.ownerSign === 200 && s.clientGet === 200 && s.adminGet === 200,
    JSON.stringify(s));

  await upload(client.token, 'applications', `${client.id}/avatar/cara.jpg`);
  const a = {
    anonList: await list(null, 'applications', client.id),
    strangerList: await list(stranger.token, 'applications', `${client.id}/avatar`),
    ownList: await list(client.token, 'applications', `${client.id}/avatar`),
    adminList: await list(adminToken, 'applications', `${client.id}/avatar`),
    publicLink: await publicGet('applications', `${client.id}/avatar/cara.jpg`),
  };
  record('SC-06', 'Solicitudes y fotos de perfil: nadie lista las de otro (ni sin sesión); su dueño y el admin sí; el enlace público sigue abriendo',
    a.anonList === 0 && a.strangerList === 0 && a.ownList === 1 && a.adminList === 1 && a.publicLink === 200, JSON.stringify(a));

  // ── Con historial: baja conservando reservas e importes, sin ningún dato suyo ──────────────
  await rpc('create_company_invitation', { p_email: client.email }, owner.token);
  sql(`update public.bookings set status = 'completed', date = current_date - 1, client_latitude = 36.5, client_longitude = -4.88 where id = '${b1}'`);
  sql(`delete from public.booking_media where booking_id = '${b1}'`);
  const money = sql(`select total_price || '|' || management_fee from public.bookings where id='${b1}'`);
  givePush(client.id);
  await giveFiles(client);
  const p3 = await preview(client.token);
  const r3 = await selfClose(client.token, { expectedMode: p3.mode });
  const account = sql(`select coalesce(p.full_name,'') || '|' || coalesce(p.phone,'-') || '|' || split_part(u.email,'@',2) || '|' || (u.banned_until > now())::text
    from auth.users u join public.profiles p on p.user_id = u.id where u.id='${client.id}'`);
  const booking = sql(`select total_price || '|' || management_fee || '|' || client_address || '|' || coalesce(client_latitude::text,'-') from public.bookings where id='${b1}'`);
  const login = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: client.email, password: 'Test123456!' }),
  }).then((r) => r.status);
  record('SC-07', 'Cliente con historial: se da de baja — datos, punto en el mapa, invitación, avisos y ficheros fuera; sin sesiones ni acceso — y la reserva conserva importes',
    p3.mode === 'deactivate' && r3.status === 200 && account === 'Cuenta dada de baja|-|garser.invalid|true'
      && booking === `${money}|Dirección eliminada|-` && count('public.booking_quotes', `client_id='${client.id}' and client_latitude is not null`) === 0
      && count('public.company_invitations', `lower(email) = lower('${client.email}')`) === 0
      && count('public.push_subscriptions', `user_id='${client.id}'`) === 0 && filesOf(client.id) === 0
      && count('auth.sessions', `user_id='${client.id}'`) === 0 && login !== 200,
    `análisis ${p3.mode}, cierre ${r3.status} ${JSON.stringify(r3.body)}, cuenta [${account}], reserva [${booking}], ficheros ${filesOf(client.id)}, login ${login}`);

  // ── Regla 2: un autónomo con historial ─────────────────────────────────────────────────────
  const solo = await newFreelancer('autonomo');
  setAvailability(solo.id, D2, HOURS);
  const buyer = await acc.newUser('comprador');
  const b2 = (await pay(solo.id, buyer, D2, 8)).bookingId;
  const acc2 = await accept(b2, solo.token);
  sql(`update public.bookings set status = 'completed', date = current_date - 2 where id = '${b2}'`);
  await upload(solo.token, 'private_licenses', `${solo.id}/carnet.jpg`);
  sql(`insert into public.gardener_licenses (gardener_id, license_number, document_url, status) values ('${solo.id}', 'CARNET-123', '${solo.id}/carnet.jpg', 'approved')`);
  const p4 = await preview(solo.token);
  const r4 = await selfClose(solo.token, { expectedMode: p4.mode });
  const card = sql(`select gp.full_name || '|' || gp.phone || '|' || (gp.suspended_at is not null)::text || '|' || (select count(*) from public.gardener_service_prices s where s.gardener_id = gp.user_id and s.active)
    || '|' || (select coalesce(string_agg(coalesce(license_number,'-') || '/' || document_url, ','), '') from public.gardener_licenses l where l.gardener_id = gp.user_id) from public.gardener_profiles gp where gp.user_id='${solo.id}'`);
  record('SC-08', 'Autónomo con historial: se da de baja — suspendido, sin nombre, sin precios activos, sin número ni fichero del carnet — y su reserva sigue',
    !!b2 && acc2.ok && p4.mode === 'deactivate' && r4.status === 200 && card === 'Profesional dado de baja||true|0|-/' && filesOf(solo.id) === 0
      && sql(`select status from public.bookings where id='${b2}'`) === 'completed',
    `reserva ${b2 ? 'sí' : 'no'}${why(acc2)}, análisis ${p4.mode}, cierre ${r4.status}, ficha [${card}]`);

  // ── Nadie cierra la cuenta de otro ─────────────────────────────────────────────────────────
  const victim = await acc.newUser('victima');
  const intruder = await acc.newUser('intruso');
  const anon = await selfClose(null, { expectedMode: 'delete' });
  const direct = await rpc('perform_self_account_closure', { p_user_id: victim.id, p_expected_mode: 'delete' }, intruder.token);
  const anonPreview = await rpc('my_account_closure_preview', {}, undefined).catch(() => ({ ok: false }));
  const tricked = await selfClose(intruder.token, { userId: victim.id, expectedMode: 'delete' });
  record('SC-09', 'Sin sesión no se puede; la función interna no se puede llamar; y pasar el id de otro no sirve: solo se cierra la propia cuenta',
    anon.status === 403 && !direct.ok && tricked.status === 200 && count('auth.users', `id='${victim.id}'`) === 1 && count('auth.users', `id='${intruder.id}'`) === 0,
    `anónimo ${anon.status}, interna ${direct.status}, con id ajeno ${tricked.status} (víctima ${count('auth.users', `id='${victim.id}'`)}, intruso ${count('auth.users', `id='${intruder.id}'`)}), análisis con clave de servicio ${anonPreview.status}`);

  // ── El admin no se cierra desde «Mi cuenta» ────────────────────────────────────────────────
  const pa = await preview(adminToken);
  const ra = await selfClose(adminToken, { expectedMode: 'delete' });
  record('SC-10', 'El admin: el análisis lo bloquea y cerrarla igualmente no hace nada',
    pa.mode === 'blocked' && (pa.blockers || []).some((b) => b.code === 'admin') && ra.status === 409 && count('auth.users', `email='admin.local@test.local'`) === 1,
    `análisis ${pa.mode}, cierre ${ra.status} ${JSON.stringify(ra.body).slice(0, 120)}`);

  // ── Si borrar los ficheros falla, el reloj lo reintenta ────────────────────────────────────
  const ghost = await acc.newUser('fantasma');
  await giveFiles(ghost);
  sql(`insert into public.account_storage_cleanup (user_id, attempts, last_error) values ('${ghost.id}', 1, 'simulado')`);
  const t = await tick();
  record('SC-11', 'Una limpieza de ficheros que falló queda apuntada y el reloj la termina',
    t.status === 200 && filesOf(ghost.id) === 0 && count('public.account_storage_cleanup', `user_id='${ghost.id}' and completed_at is not null and last_error is null`) === 1,
    `reloj ${t.status} ${JSON.stringify(t.body?.accountStorageCleanup)}, ficheros ${filesOf(ghost.id)}`);

  // ── La baja del admin también borra los ficheros (PH-04) ───────────────────────────────────
  const byAdmin = await acc.newUser('por-admin');
  await giveFiles(byAdmin);
  const ad = await fetch(`${apiUrl}/functions/v1/admin-account-closure`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: byAdmin.id, expectedMode: 'delete' }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  record('SC-12', 'La baja que hace el admin también borra los ficheros de la cuenta',
    ad.status === 200 && count('auth.users', `id='${byAdmin.id}'`) === 0 && filesOf(byAdmin.id) === 0, `${ad.status} ${JSON.stringify(ad.body)}`);
}

await runVerification({ acc, results, main });
