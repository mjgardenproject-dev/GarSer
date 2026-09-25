#!/usr/bin/env node
// GarSer Empresas · F3.4 — verificación de los CORREOS de empresas contra el Supabase LOCAL:
// quién puede pedir cada correo, a quién llega y que no sirva para mandar correos a terceros.
//
// Llama a la edge function send-email-notification como lo haría cualquiera (anónimo, cliente,
// dueño, admin). En local no hay clave de Brevo: la función responde `mock: true` y deja el
// correo en su registro, de donde se comprueba destinatario y asunto.
//
// Requisito: el contenedor de funciones tiene que servir el código actual. Tras cambiar la
// función: `docker restart supabase_edge_runtime_GarSer-main_4`.
//
// Uso:    node scripts/garser-empresas/verify-f3-emails.mjs
// Salida: una línea por prueba; código 1 si alguna falla.
// Crea cuentas *@f3-mail.local y lo borra todo al terminar. Solo corre contra 127.0.0.1.

import { execFileSync } from 'node:child_process';

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = status.API_URL;
const ANON = status.ANON_KEY;
if (!/^http:\/\/127\.0\.0\.1:/.test(API)) {
  console.error(`Me niego a correr contra ${API}: esta verificación crea y borra cuentas.`);
  process.exit(2);
}
const DB = 'supabase_db_GarSer-main_4';
const EDGE = 'supabase_edge_runtime_GarSer-main_4';
const sql = (q) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-c', q], { encoding: 'utf8' }).trim();
// La función escribe en stderr del contenedor: se leen las dos salidas.
const edgeLog = () => execFileSync('sh', ['-c', `docker logs --since 5m ${EDGE} 2>&1`], { encoding: 'utf8' });
const RUN = Date.now();
const results = [];
const createdUsers = [];

function record(id, description, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
}

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data, rows: Array.isArray(data) ? data : [] };
}
const rpc = (fn, token, args) => call('POST', `/rest/v1/rpc/${fn}`, token, args);
const mail = (token, body) => call('POST', '/functions/v1/send-email-notification', token, body);

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return (await res.json()).access_token;
}

async function newUser(label, role = 'client') {
  const email = `${label}-${RUN}@f3-mail.local`;
  const res = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role, requested_role: role } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id) throw new Error(`No se pudo crear ${label}: ${JSON.stringify(body).slice(0, 160)}`);
  createdUsers.push(id);
  return { id, email, token: body.access_token };
}

const APPLICATION = {
  legal_name: 'Correos Prueba S.L.', tax_id: 'B87654321', contact_name: 'Rosa Dueña', phone: '600000000',
  address: 'Calle Sol 2, Marbella', city_zone: 'Marbella', services: ['Corte de césped'], owner_works: false,
  accept_terms: true, declaration_truth: true, answers: { team_size: '2-5', has_liability_insurance: true },
};

async function companyApplication(label, commercialName) {
  const owner = await newUser(label, 'company');
  const draft = await call('POST', '/rest/v1/company_applications', owner.token, { user_id: owner.id, commercial_name: commercialName, ...APPLICATION });
  const appId = draft.rows[0]?.id;
  await rpc('submit_company_application', owner.token, { p_application_id: appId });
  return { owner, appId };
}

async function main() {
  const probe = await mail(null, { type: 'company_approved', companyApplicationId: '00000000-0000-0000-0000-000000000000' });
  if (probe.data?.error === 'unsupported_email_type') {
    record('F3E-00', 'La función de correos sirve el código de F3.4', false, `reinicia el contenedor: docker restart ${EDGE}`);
    return;
  }
  const adminToken = await signIn('admin.local@test.local');
  const client = await newUser('cliente');

  // ── Empresa aprobada / rechazada ────────────────────────────────────────────
  const approved = await companyApplication('dueno', 'Correos Prueba');
  {
    const early = await mail(adminToken, { type: 'company_approved', companyApplicationId: approved.appId });
    record('F3E-01', 'No se avisa de «aprobada» si la solicitud aún no lo está', early.status === 409, `HTTP ${early.status}`);
    await rpc('admin_review_company_application', adminToken, { p_application_id: approved.appId, p_status: 'approved', p_comment: null });
    const anon = await mail(null, { type: 'company_approved', companyApplicationId: approved.appId });
    const byClient = await mail(client.token, { type: 'company_approved', companyApplicationId: approved.appId });
    const byOwner = await mail(approved.owner.token, { type: 'company_approved', companyApplicationId: approved.appId });
    record('F3E-02', 'Solo el admin pide el correo de empresa aprobada (anónimo, cliente y la propia empresa, no)',
      anon.status === 403 && byClient.status === 403 && byOwner.status === 403, `anónimo ${anon.status}, cliente ${byClient.status}, empresa ${byOwner.status}`);
    const ok = await mail(adminToken, { type: 'company_approved', companyApplicationId: approved.appId, to: 'victima@ejemplo.com' });
    const log = edgeLog();
    record('F3E-03', 'El admin lo envía y llega al correo de la empresa, no a uno inyectado en la petición',
      ok.ok && log.includes(approved.owner.email) && /Tu empresa ya está dada de alta/.test(log) && !log.includes('victima@ejemplo.com'),
      `HTTP ${ok.status} ${JSON.stringify(ok.data)}`);
  }

  const rejected = await companyApplication('dueno-rechazado', 'Correos Rechazo');
  {
    await rpc('admin_review_company_application', adminToken, { p_application_id: rejected.appId, p_status: 'rejected', p_comment: 'Falta el seguro' });
    const wrong = await mail(adminToken, { type: 'company_approved', companyApplicationId: rejected.appId });
    const ok = await mail(adminToken, { type: 'company_rejected', companyApplicationId: rejected.appId, data: { reason: 'Texto inventado' } });
    record('F3E-04', 'Rechazada: el correo sale con el estado real (no se puede avisar de «aprobada») y al correo de la empresa',
      wrong.status === 409 && ok.ok && edgeLog().includes(rejected.owner.email), `aprobada ${wrong.status}, rechazada ${ok.status}`);
  }

  // ── Invitación ──────────────────────────────────────────────────────────────
  const ownerToken = await signIn(approved.owner.email);
  const guest = `invitada-${RUN}@f3-mail.local`;
  const inv = await rpc('create_company_invitation', ownerToken, { p_email: guest });
  const invitationId = inv.data?.invitation_id;
  const token = inv.data?.token;
  {
    const anon = await mail(null, { type: 'company_invitation', invitationId, token });
    const byClient = await mail(client.token, { type: 'company_invitation', invitationId, token });
    const badToken = await mail(ownerToken, { type: 'company_invitation', invitationId, token: `${token}x` });
    record('F3E-05', 'El correo de invitación solo lo pide su dueño con el token correcto',
      anon.status === 403 && byClient.status === 403 && badToken.status === 403, `anónimo ${anon.status}, cliente ${byClient.status}, token malo ${badToken.status}`);
    const ok = await mail(ownerToken, { type: 'company_invitation', invitationId, token, to: 'victima@ejemplo.com' });
    const log = edgeLog();
    const sent = sql(`select email_sent_at is not null from public.company_invitations where id='${invitationId}'`);
    record('F3E-06', 'El dueño lo envía: llega al correo invitado, con el nombre de la empresa, y queda marcado',
      ok.ok && log.includes(guest) && log.includes('Correos Prueba te invita a su equipo en GarSer') && sent === 't' && !log.includes('victima@ejemplo.com'),
      `HTTP ${ok.status}, marcado ${sent}`);
    const again = await mail(ownerToken, { type: 'company_invitation', invitationId, token });
    record('F3E-07', 'La misma invitación no se puede enviar dos veces (no sirve para bombardear un correo)', again.status === 403, `HTTP ${again.status}`);
  }
  {
    const inv2 = await rpc('create_company_invitation', ownerToken, { p_email: `otra-${RUN}@f3-mail.local` });
    await rpc('revoke_company_invitation', ownerToken, { p_invitation_id: inv2.data?.invitation_id });
    const r = await mail(ownerToken, { type: 'company_invitation', invitationId: inv2.data?.invitation_id, token: inv2.data?.token });
    record('F3E-08', 'Una invitación anulada no se envía', r.status === 403, `HTTP ${r.status}`);
  }
  {
    const direct = await rpc('mark_company_invitation_emailed', ownerToken, { p_invitation_id: invitationId, p_token: token, p_caller: approved.owner.id });
    record('F3E-09', 'La función que marca el envío no se puede llamar desde el navegador', !direct.ok, `HTTP ${direct.status}`);
  }
  {
    // Tope diario: ya hay 2 de hoy; se crean hasta 20 y la 21 se rechaza.
    let last;
    for (let i = 0; i < 19; i += 1) last = await rpc('create_company_invitation', ownerToken, { p_email: `tope${i}-${RUN}@f3-mail.local` });
    const count = sql(`select count(*) from public.company_invitations i join public.companies c on c.id=i.company_id where c.provider_user_id='${approved.owner.id}'`);
    record('F3E-10', 'Tope de 20 invitaciones al día por empresa, con explicación',
      count === '20' && !last.ok && /muchas invitaciones hoy/.test(last.data?.message ?? ''), `creadas ${count}, la última: ${last.status} ${last.data?.message ?? ''}`);
  }
}

function cleanup() {
  if (!createdUsers.length) return;
  const ids = createdUsers.map((id) => `'${id}'`).join(',');
  const companies = `(select id from public.companies where provider_user_id in (${ids}))`;
  sql(`delete from public.company_applications where user_id in (${ids})`);
  sql(`delete from public.company_invitations where company_id in ${companies}`);
  sql(`delete from public.company_members where user_id in (${ids}) or company_id in ${companies}`);
  sql(`delete from public.companies where provider_user_id in (${ids})`);
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
