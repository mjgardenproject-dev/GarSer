#!/usr/bin/env node
// GarSer Empresas · F2 — verificación del modelo de proveedor y de su RLS contra el Supabase LOCAL.
//
// Monta DOS empresas desechables (A: dueño + 2 empleados; B: dueño + 1 empleado) y comprueba
// contra la API — nunca contra la interfaz — lo que dice docs/garser-empresas/03-PRUEBAS.md
// (F2-01 … F2-17): quién ve qué, quién no puede escribir nada directamente, que un empleado
// no puede ser proveedor (A-03) y el cierre de H-21 (nadie se crea una ficha de proveedor ni se
// aprueba el carnet a sí mismo).
//
// Uso:    node scripts/garser-empresas/verify-f2-db.mjs
// Salida: una línea por prueba; código 1 si alguna falla.
// Crea cuentas *@f2-verify.local y lo borra todo al terminar. Solo corre contra 127.0.0.1.

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
const sqlTry = (q) => { try { sql(q); return { ok: true }; } catch (e) { return { ok: false, error: String(e.stderr || e.message).split('\n').find((l) => l.includes('ERROR')) || '' }; } };

const GARDENER = '11111111-aaaa-4aaa-8aaa-111111111111';
const RUN = Date.now();
const results = [];
const createdUsers = [];

const hasTable = (t) => sql(`select to_regclass('public.${t}') is not null`) === 't';
const hasColumn = (t, c) => sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`) === '1';

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

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return (await res.json()).access_token;
}

async function newUser(label) {
  const email = `${label}-${RUN}@f2-verify.local`;
  const res = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { full_name: label } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id) throw new Error(`No se pudo crear ${label}: ${JSON.stringify(body).slice(0, 160)}`);
  createdUsers.push(id);
  return { id, email, token: body.access_token };
}

// Monta una empresa: cuenta del dueño = cuenta de la empresa (A-01), con su ficha de proveedor
// provider_kind='company', la fila en companies y el dueño como miembro. Se hace como postgres,
// que es como lo hará la RPC de aprobación de F3.
function seedCompany(owner, name, employees) {
  sql(`update public.profiles set role='company' where user_id='${owner.id}'`);
  sql(`insert into public.gardener_profiles (user_id, full_name, phone, address, provider_kind)
       values ('${owner.id}', '${name}', '600000000', 'Marbella', 'company')`);
  const companyId = sql(`insert into public.companies (provider_user_id, legal_name, tax_id)
       values ('${owner.id}', '${name} S.L.', 'B00000000') returning id`).split('\n')[0];
  sql(`insert into public.company_members (company_id, user_id, role, counts_as_labour)
       values ('${companyId}', '${owner.id}', 'owner', false)`);
  const lawn = sql("select id from public.services where name='Corte de césped'");
  for (const e of employees) {
    sql(`update public.profiles set role='employee' where user_id='${e.id}'`);
    const memberId = sql(`insert into public.company_members (company_id, user_id, role)
         values ('${companyId}', '${e.id}', 'employee') returning id`).split('\n')[0];
    sql(`insert into public.company_member_services (member_id, service_id) values ('${memberId}', '${lawn}')`);
    e.memberId = memberId;
  }
  sql(`insert into public.company_invitations (company_id, email, token_hash, expires_at, created_by)
       values ('${companyId}', 'invitado-${RUN}-${name.replace(/\W/g, '')}@f2-verify.local', md5(random()::text), now() + interval '7 days', '${owner.id}')`);
  return companyId;
}

async function main() {
  // ── F2-01 · lo existente queda como autónomo ───────────────────────────────
  record('F2-01', 'Todos los gardener_profiles existentes quedan con provider_kind = solo',
    hasColumn('gardener_profiles', 'provider_kind') && sql("select count(*) from public.gardener_profiles where provider_kind is distinct from 'solo'") === '0',
    hasColumn('gardener_profiles', 'provider_kind') ? `solo: ${sql("select count(*) from public.gardener_profiles where provider_kind='solo'")}` : 'no existe la columna provider_kind');

  // ── H-21 · nadie se crea una ficha de proveedor ni se aprueba el carnet ─────
  {
    const client = await newUser('cliente-h21');
    const ins = await call('POST', '/rest/v1/gardener_profiles', client.token, {
      user_id: client.id, full_name: 'Impostor', phone: '600000000', address: 'Marbella',
      has_phytosanitary_license: true, license_verification_status: 'approved', rating_average: 5, rating_count: 250,
    });
    const exists = sql(`select count(*) from public.gardener_profiles where user_id='${client.id}'`);
    record('F2-07', 'Un cliente NO puede crearse una ficha de proveedor (H-21a)', !ins.ok && exists === '0', `HTTP ${ins.status}, fichas creadas: ${exists}`);
    if (exists !== '0') sql(`delete from public.gardener_profiles where user_id='${client.id}'`);

    const gToken = await signIn('jardinero.local@test.local');
    const orig = sql(`select has_phytosanitary_license||'|'||coalesce(license_verification_status,'')||'|'||coalesce(license_expires_at::text,'')||'|'||coalesce(description,'') from public.gardener_profiles where user_id='${GARDENER}'`);
    sql(`update public.gardener_profiles set has_phytosanitary_license=false, license_verification_status='rejected' where user_id='${GARDENER}'`);
    const self = await call('PATCH', `/rest/v1/gardener_profiles?user_id=eq.${GARDENER}`, gToken,
      { has_phytosanitary_license: true, license_verification_status: 'approved', license_expires_at: '2030-01-01' });
    const after = sql(`select has_phytosanitary_license||'/'||license_verification_status from public.gardener_profiles where user_id='${GARDENER}'`);
    record('F2-08', 'Un jardinero con el carnet rechazado NO puede aprobárselo él mismo (H-21b)', !self.ok && after === 'false/rejected', `HTTP ${self.status}, queda ${after}`);

    const desc = await call('PATCH', `/rest/v1/gardener_profiles?user_id=eq.${GARDENER}`, gToken, { description: `Prueba F2 ${RUN}` });
    record('F2-09', 'El jardinero sigue pudiendo editar su ficha (descripción)', desc.ok && sql(`select description from public.gardener_profiles where user_id='${GARDENER}'`) === `Prueba F2 ${RUN}`, `HTTP ${desc.status}`);

    const kind = hasColumn('gardener_profiles', 'provider_kind')
      ? await call('PATCH', `/rest/v1/gardener_profiles?user_id=eq.${GARDENER}`, gToken, { provider_kind: 'company' })
      : { ok: true, status: '-' };
    record('F2-17', 'Un jardinero NO puede cambiarse a sí mismo a empresa (provider_kind)',
      hasColumn('gardener_profiles', 'provider_kind') && !kind.ok && sql(`select provider_kind from public.gardener_profiles where user_id='${GARDENER}'`) === 'solo',
      `HTTP ${kind.status}`);

    const [a, b, c, d] = orig.split('|');
    sql(`update public.gardener_profiles set has_phytosanitary_license=${a}, license_verification_status=nullif('${b}',''),
         license_expires_at=nullif('${c}','')::timestamptz, description=nullif('${d.replace(/'/g, "''")}','') where user_id='${GARDENER}'`);
  }

  // ── F2-18 · la aprobación de un jardinero por el admin sigue creando su ficha ──
  // Es el camino legítimo que crea fichas de proveedor; H-21 quitó ese permiso a todo el mundo
  // salvo a las funciones del servidor, así que hay que comprobar que este sigue funcionando.
  {
    const applicant = await newUser('solicitante');
    sql(`update public.profiles set role='gardener' where user_id='${applicant.id}'`);
    const appId = sql(`insert into public.gardener_applications (user_id, status, full_name, email, phone, city_zone, submitted_at)
         values ('${applicant.id}', 'submitted', 'Solicitante F2', '${applicant.email}', '600111222', 'Marbella', now()) returning id`).split('\n')[0];
    const adminTok = await signIn('admin.local@test.local');
    const res = await call('POST', '/rest/v1/rpc/admin_review_gardener_application', adminTok,
      { p_application_id: appId, p_status: 'approved', p_comment: 'Prueba F2' });
    const gp = sql(`select coalesce(max(provider_kind), 'SIN FICHA') from public.gardener_profiles where user_id='${applicant.id}'`);
    const role = sql(`select role from public.profiles where user_id='${applicant.id}'`);
    record('F2-18', 'El admin aprueba a un jardinero y se crea su ficha de proveedor (tipo solo)',
      res.ok && gp === 'solo' && role === 'gardener', `HTTP ${res.status}${res.ok ? '' : ` (${res.data?.message})`}, ficha ${gp}, rol ${role}`);
    sql(`delete from public.gardener_applications where user_id='${applicant.id}'`);
  }

  if (!['companies', 'company_members', 'company_member_services', 'company_invitations'].every(hasTable)) {
    for (const id of ['F2-02', 'F2-03', 'F2-04', 'F2-05', 'F2-06', 'F2-10', 'F2-11', 'F2-12', 'F2-13', 'F2-14', 'F2-15', 'F2-16']) {
      record(id, 'Modelo de empresas', false, 'las tablas de empresas no existen todavía');
    }
    return;
  }

  // ── Montaje: dos empresas ───────────────────────────────────────────────────
  const ownerA = await newUser('duenoA'); const empA1 = await newUser('empA1'); const empA2 = await newUser('empA2');
  const ownerB = await newUser('duenoB'); const empB1 = await newUser('empB1');
  const client = await newUser('cliente');
  const companyA = seedCompany(ownerA, 'Jardines A', [empA1, empA2]);
  const companyB = seedCompany(ownerB, 'Jardines B', [empB1]);
  const adminToken = await signIn('admin.local@test.local');

  const read = async (token, table) => call('GET', `/rest/v1/${table}?select=*`, token);
  const idsOf = (r, key) => new Set(r.rows.map((x) => x[key]));

  // ── F2-02 / F2-03 · aislamiento entre empresas ───────────────────────────────
  {
    const m = await read(empA1.token, 'company_members');
    const c = await read(empA1.token, 'companies');
    record('F2-02', 'Un empleado de A no ve miembros de B (y de A solo se ve a sí mismo)',
      m.ok && m.rows.length === 1 && m.rows[0].user_id === empA1.id, `HTTP ${m.status}, filas ${m.rows.length}`);
    record('F2-03', 'Un empleado de A ve su empresa y no la B', c.ok && c.rows.length === 1 && c.rows[0].id === companyA, `filas ${c.rows.length}`);
  }

  // ── F2-12 · el dueño ve su equipo, sus invitaciones y sus servicios; nada de B ─
  {
    const m = await read(ownerA.token, 'company_members');
    const s = await read(ownerA.token, 'company_member_services');
    const i = await read(ownerA.token, 'company_invitations');
    const c = await read(ownerA.token, 'companies');
    record('F2-12', 'El dueño de A ve su equipo (3), los servicios de sus empleados (2), sus invitaciones (1) y su empresa; nada de B',
      m.rows.length === 3 && [...idsOf(m, 'company_id')].every((x) => x === companyA) && s.rows.length === 2 && i.rows.length === 1 && i.rows[0].company_id === companyA && c.rows.length === 1,
      `miembros ${m.rows.length}, servicios ${s.rows.length}, invitaciones ${i.rows.length}, empresas ${c.rows.length}`);
  }

  // ── F2-13 · el empleado ve lo suyo y nada más ────────────────────────────────
  {
    const s = await read(empA1.token, 'company_member_services');
    const i = await read(empA1.token, 'company_invitations');
    record('F2-13', 'El empleado ve solo sus servicios y ninguna invitación',
      s.rows.length === 1 && s.rows[0].member_id === empA1.memberId && i.rows.length === 0, `servicios ${s.rows.length}, invitaciones ${i.rows.length}`);
  }

  // ── F2-04 / F2-14 · nadie escribe directamente (las escrituras llegan por RPC en F3) ─
  {
    const upd = await call('PATCH', `/rest/v1/companies?id=eq.${companyA}`, empA1.token, { legal_name: 'Hackeada' });
    const updOwner = await call('PATCH', `/rest/v1/companies?id=eq.${companyA}`, ownerA.token, { legal_name: 'Cambio directo' });
    const insMember = await call('POST', '/rest/v1/company_members', ownerA.token, { company_id: companyA, user_id: client.id, role: 'employee' });
    const selfOwner = await call('PATCH', `/rest/v1/company_members?user_id=eq.${empA1.id}`, empA1.token, { role: 'owner' });
    const insInv = await call('POST', '/rest/v1/company_invitations', ownerA.token, { company_id: companyA, email: 'x@x.x', token_hash: 'x', expires_at: '2030-01-01', created_by: ownerA.id });
    const legal = sql(`select legal_name from public.companies where id='${companyA}'`);
    const clientMember = sql(`select count(*) from public.company_members where user_id='${client.id}'`);
    const empRole = sql(`select role from public.company_members where user_id='${empA1.id}'`);
    record('F2-04', 'Un empleado NO puede escribir en su empresa', !upd.ok && legal === 'Jardines A S.L.', `HTTP ${upd.status}, razón social «${legal}»`);
    record('F2-14', 'Tampoco el dueño escribe directamente: ni empresa, ni miembros, ni invitaciones; un empleado no se hace dueño',
      !updOwner.ok && !insMember.ok && !selfOwner.ok && !insInv.ok && legal === 'Jardines A S.L.' && clientMember === '0' && empRole === 'employee',
      `empresa ${updOwner.status}, miembro ${insMember.status}, rol ${selfOwner.status}, invitación ${insInv.status}`);
  }

  // ── F2-05 / F2-15 · cliente y anónimo no ven nada ────────────────────────────
  {
    const tables = ['companies', 'company_members', 'company_member_services', 'company_invitations'];
    const clientSeen = (await Promise.all(tables.map((t) => read(client.token, t)))).map((r) => r.rows.length);
    const anonSeen = await Promise.all(tables.map((t) => read(null, t)));
    record('F2-05', 'Un cliente no ve nada de empresas', clientSeen.every((n) => n === 0), `filas por tabla: ${clientSeen.join('/')}`);
    record('F2-15', 'Un visitante sin sesión no ve nada de empresas', anonSeen.every((r) => r.rows.length === 0),
      `HTTP ${anonSeen.map((r) => r.status).join('/')}`);
  }

  // ── F2-16 · el admin lo ve todo ──────────────────────────────────────────────
  {
    const c = await read(adminToken, 'companies');
    const m = await read(adminToken, 'company_members');
    record('F2-16', 'El admin ve todas las empresas y todos los miembros',
      [companyA, companyB].every((id) => idsOf(c, 'id').has(id)) && m.rows.length >= 5, `empresas ${c.rows.length}, miembros ${m.rows.length}`);
  }

  // ── F2-06 · sin recursión de policies (responden, sin error 500/54001) ───────
  {
    const probes = await Promise.all([
      read(ownerA.token, 'company_members'), read(empA1.token, 'company_member_services'),
      read(ownerA.token, 'companies'), read(adminToken, 'company_invitations'),
      call('GET', '/rest/v1/profiles?select=user_id', ownerA.token),
    ]);
    record('F2-06', 'Las policies nuevas no provocan recursión', probes.every((r) => r.ok), `HTTP ${probes.map((r) => r.status).join('/')}`);
  }

  // ── F2-10 · un empleado no puede ser proveedor, ni un proveedor empleado (A-03) ─
  {
    const gpForEmployee = sqlTry(`insert into public.gardener_profiles (user_id, full_name, phone, address) values ('${empA2.id}', 'x', '6', 'x')`);
    const soloAsEmployee = sqlTry(`insert into public.company_members (company_id, user_id, role) values ('${companyA}', '${GARDENER}', 'employee')`);
    record('F2-10', 'Un empleado NO puede tener ficha de proveedor, y un autónomo NO puede entrar como empleado',
      !gpForEmployee.ok && !soloAsEmployee.ok, `${gpForEmployee.ok ? 'ficha CREADA' : 'ficha rechazada'} · ${soloAsEmployee.ok ? 'autónomo ACEPTADO' : 'autónomo rechazado'}`);
  }

  // ── F2-11 · una empresa activa por persona, un dueño activo por empresa ──────
  {
    const twoCompanies = sqlTry(`insert into public.company_members (company_id, user_id, role) values ('${companyB}', '${empA1.id}', 'employee')`);
    const twoOwners = sqlTry(`insert into public.company_members (company_id, user_id, role) values ('${companyA}', '${client.id}', 'owner')`);
    record('F2-11', 'Nadie está activo en dos empresas y ninguna empresa tiene dos dueños',
      !twoCompanies.ok && !twoOwners.ok, `${twoCompanies.ok ? 'doble empresa ACEPTADA' : 'doble empresa rechazada'} · ${twoOwners.ok ? 'segundo dueño ACEPTADO' : 'segundo dueño rechazado'}`);
  }
}

function cleanup() {
  if (!createdUsers.length) return;
  const ids = createdUsers.map((id) => `'${id}'`).join(',');
  if (hasTable('companies')) {
    sql(`delete from public.company_member_services where member_id in (select id from public.company_members where user_id in (${ids}) or company_id in (select id from public.companies where provider_user_id in (${ids})))`);
    sql(`delete from public.company_invitations where company_id in (select id from public.companies where provider_user_id in (${ids}))`);
    sql(`delete from public.company_members where user_id in (${ids}) or company_id in (select id from public.companies where provider_user_id in (${ids}))`);
    sql(`delete from public.companies where provider_user_id in (${ids})`);
  }
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
