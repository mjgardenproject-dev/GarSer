#!/usr/bin/env node
// Prueba real · F6: dar de baja o suspender cuentas sin romper nada (R-02, D23, R-09, R-12, R-13).
// Contra el Supabase LOCAL con las funciones servidas.
// Uso: node scripts/garser-empresas/verify-account-deletion.mjs

import { randomUUID } from 'node:crypto';
import {
  accounts, apiUrl, anonKey, authority, createCompany, joinTeam, makeRecorder, pay, rpc, runVerification,
  setAvailability, signIn, sql, why, LAWN, LAWN_INPUT,
} from './_company-harness.mjs';

const acc = accounts('account-closure.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const D = day(55);

const closure = async (token, body) => {
  const res = await fetch(`${apiUrl}/functions/v1/admin-account-closure`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const preview = async (adminToken, email) => (await rpc('admin_account_closure_preview', { p_email: email }, adminToken)).body || {};
const exists = (table, where) => Number(sql(`select count(*) from ${table} where ${where}`));
const tryLogin = async (email) => (await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Test123456!' }),
})).status;
const rawDelete = (id) => { try { sql(`delete from auth.users where id = '${id}'`); return 'borrado'; } catch (e) { return /violates foreign key/.test(String(e.message)) ? 'frenado' : `error ${String(e.message).slice(0, 80)}`; } };
const accept = (id, token) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: randomUUID() }, token);

async function main() {
  const adminToken = await signIn('admin.local@test.local');

  // ── Sin historial: se borra entera ─────────────────────────────────────────────────────────
  const empty = await createCompany(acc.newUser, 'vacia');
  const ana = await joinTeam(acc.newUser, empty.token, 'ana');
  const p1 = await preview(adminToken, empty.email);
  const r1 = await closure(adminToken, { userId: empty.id, expectedMode: p1.mode });
  record('AD-01', 'Empresa sin reservas: el análisis dice «borrar» y se borra entera (cuenta, empresa, miembros, solicitud); su empleada sigue existiendo, sin empresa',
    p1.mode === 'delete' && r1.status === 200 && exists('auth.users', `id='${empty.id}'`) === 0 && exists('public.companies', `provider_user_id='${empty.id}'`) === 0
      && exists('public.company_applications', `user_id='${empty.id}'`) === 0 && exists('public.company_members', `user_id='${ana.id}'`) === 0 && exists('auth.users', `id='${ana.id}'`) === 1,
    `análisis ${p1.mode}, ejecución ${r1.status} ${JSON.stringify(r1.body)}`);

  // ── Con reservas sin terminar: bloqueada ───────────────────────────────────────────────────
  const owner = await createCompany(acc.newUser, 'con-historial');
  const eva = await joinTeam(acc.newUser, owner.token, 'eva');
  setAvailability(eva.id, D, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const client = await acc.newUser('cliente');
  const b1 = (await pay(owner.id, client, D, 8)).bookingId;
  const p2 = await preview(adminToken, client.email);
  const r2 = await closure(adminToken, { userId: client.id, expectedMode: 'deactivate' });
  record('AD-02', 'Cliente con una solicitud pendiente: bloqueada, dice por qué, y ejecutarla igualmente no toca nada',
    p2.mode === 'blocked' && (p2.blockers || []).some((b) => b.code === 'open_bookings') && r2.status === 409 && exists('auth.users', `id='${client.id}'`) === 1,
    `análisis ${p2.mode} [${(p2.blockers || []).map((b) => b.code)}], ejecución ${r2.status} ${JSON.stringify(r2.body).slice(0, 120)}`);

  // ── Borrados en bruto (el panel de Supabase) ya no rompen nada ──────────────────────────────
  record('AD-03', 'En bruto: borrar a la empleada con horas apartadas o al cliente con reservas FALLA, y la reserva sigue',
    rawDelete(eva.id) === 'frenado' && rawDelete(client.id) === 'frenado' && exists('public.bookings', `id='${b1}'`) === 1,
    `reserva ${exists('public.bookings', `id='${b1}'`)}`);

  // ── Con historial: se da de baja conservando reservas e importes (D23) ──────────────────────
  await accept(b1, owner.token);
  const money = sql(`select total_price || '|' || management_fee from public.bookings where id='${b1}'`);
  sql(`update public.bookings set status = 'completed', date = current_date - 1 where id = '${b1}'`);
  const p3 = await preview(adminToken, client.email);
  const r3 = await closure(adminToken, { userId: client.id, expectedMode: p3.mode });
  const after = sql(`select coalesce(p.full_name,'') || '|' || coalesce(p.phone,'-') || '|' || u.email || '|' || (u.banned_until > now())::text from auth.users u join public.profiles p on p.user_id = u.id where u.id='${client.id}'`);
  record('AD-04', 'Cliente con reservas terminadas: se da de baja — datos fuera, correo anónimo, sin acceso — y la reserva conserva importe y comisión',
    p3.mode === 'deactivate' && r3.status === 200 && after.startsWith('Cuenta dada de baja|-|baja+') && after.endsWith('|true')
      && sql(`select total_price || '|' || management_fee from public.bookings where id='${b1}'`) === money
      && sql(`select client_address from public.bookings where id='${b1}'`) === 'Dirección eliminada'
      && (await tryLogin(client.email)) !== 200,
    `análisis ${p3.mode}, ejecución ${r3.status}, cuenta [${after}]`);

  // Empresa con historial: suspendida, equipo inactivo, fuera del catálogo.
  const p4 = await preview(adminToken, owner.email);
  const r4 = await closure(adminToken, { userId: owner.id, expectedMode: p4.mode });
  const company = sql(`select c.status || '|' || gp.full_name || '|' || (gp.suspended_at is not null)::text || '|' || (select count(*) from public.company_members m where m.company_id = c.id and m.status = 'active') from public.companies c join public.gardener_profiles gp on gp.user_id = c.provider_user_id where c.provider_user_id='${owner.id}'`);
  record('AD-05', 'Empresa con historial: se da de baja — suspendida, sin nombre, sin nadie activo — y su reserva sigue',
    p4.mode === 'deactivate' && r4.status === 200 && company === 'suspended|Empresa dada de baja|true|0' && exists('public.bookings', `id='${b1}'`) === 1,
    `análisis ${p4.mode}, ejecución ${r4.status} ${JSON.stringify(r4.body).slice(0, 200)}, empresa [${company}]`);

  // ── Solo el admin ──────────────────────────────────────────────────────────────────────────
  const intruder = await acc.newUser('intruso');
  const pv = await rpc('admin_account_closure_preview', { p_email: eva.email }, intruder.token);
  const ex = await closure(intruder.token, { userId: eva.id, expectedMode: 'deactivate' });
  const sp = await rpc('admin_set_provider_suspended', { p_user_id: eva.id, p_suspended: true }, intruder.token);
  const perf = await rpc('perform_account_closure', { p_user_id: eva.id, p_expected_mode: 'deactivate', p_admin_id: intruder.id }, intruder.token);
  record('AD-06', 'Un usuario normal no puede revisar, ejecutar, suspender ni llamar a la función interna',
    !pv.ok && ex.status === 403 && !sp.ok && !perf.ok, `revisar ${pv.status}, ejecutar ${ex.status}, suspender ${sp.status}, interna ${perf.status}`);

  // ── Suspender: sin reservas nuevas, las citadas siguen ─────────────────────────────────────
  const shop = await createCompany(acc.newUser, 'suspendible');
  const leo = await joinTeam(acc.newUser, shop.token, 'leo');
  setAvailability(leo.id, D, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const buyer = await acc.newUser('comprador');
  const pendingSale = (await pay(shop.id, buyer, D, 8)).bookingId;
  const hoursBefore = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: shop.id, date: D, bookingInput: LAWN_INPUT });
  const sus = await rpc('admin_set_provider_suspended', { p_user_id: shop.id, p_suspended: true }, adminToken);
  const hoursDuring = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: shop.id, date: D, bookingInput: LAWN_INPUT });
  const newSale = await pay(shop.id, buyer, D, 12);
  const stillAccept = await accept(pendingSale, shop.token);
  await rpc('admin_set_provider_suspended', { p_user_id: shop.id, p_suspended: false }, adminToken);
  const hoursAfter = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: shop.id, date: D, bookingInput: LAWN_INPUT });
  record('AD-07', 'Empresa suspendida: no ofrece horas ni se le puede comprar; la solicitud que ya tenía se sigue aceptando; al reactivarla vuelve',
    (hoursBefore.body?.validHours || []).length > 0 && sus.ok && (hoursDuring.body?.validHours || []).length === 0 && !newSale.bookingId
      && stillAccept.ok && sql(`select status from public.bookings where id='${pendingSale}'`) === 'confirmed' && (hoursAfter.body?.validHours || []).length > 0,
    `horas antes ${(hoursBefore.body?.validHours || []).length}, suspendida ${(hoursDuring.body?.validHours || []).length}, venta nueva ${newSale.bookingId ? 'SÍ' : 'no'}, aceptar la vieja ${stillAccept.status}, después ${(hoursAfter.body?.validHours || []).length}${why(sus)}`);

  // ── El autónomo / cliente sin historial se sigue pudiendo borrar en bruto (Regla 2) ─────────
  const fresh = await acc.newUser('sin-nada');
  record('AD-08', 'Una cuenta sin reservas se sigue pudiendo borrar desde el panel de Supabase', rawDelete(fresh.id) === 'borrado', '');

  const orphans = sql(`select (select count(*) from public.company_members m where not exists (select 1 from auth.users u where u.id=m.user_id))
    + (select count(*) from public.company_applications a where not exists (select 1 from auth.users u where u.id=a.user_id))
    + (select count(*) from public.booking_blocks b where b.assignee_id is not null and not exists (select 1 from auth.users u where u.id=b.assignee_id))`);
  record('AD-09', 'No queda ningún resto de cuentas borradas', orphans === '0', `restos ${orphans}`);
}

await runVerification({ acc, results, main });
