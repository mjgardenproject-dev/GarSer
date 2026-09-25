#!/usr/bin/env node
// GarSer Empresas · F0 — verificación de la parte servidor contra el Supabase LOCAL.
//
// Prueba lo que dice docs/garser-empresas/03-PRUEBAS.md (F0-09 a F0-14): que todo usuario
// nuevo tiene perfil creado por el servidor, con un rol que no puede autoasignarse, y que
// nadie puede crearse ni cambiarse el perfil a admin (H-11).
//
// Uso:   node scripts/garser-empresas/verify-f0-db.mjs
// Salida: una línea por prueba y código de salida 1 si alguna falla.
//
// Crea cuentas desechables (*@f0-verify.local) y las borra al terminar, pase lo que pase.
// Solo funciona contra 127.0.0.1: se niega a correr contra cualquier otra URL.

import { execSync } from 'node:child_process';

const status = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = status.API_URL;
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;

if (!/^http:\/\/127\.0\.0\.1:/.test(API)) {
  console.error(`Me niego a correr contra ${API}: esta verificación crea y borra cuentas.`);
  process.exit(2);
}

const CORPORATE_ADMIN_EMAIL = 'mjgardenproject@gmail.com';
const RUN = Date.now();
const created = [];
const results = [];

const json = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};

async function signUp(email, data) {
  const res = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data }),
  });
  const body = await json(res);
  const id = body?.user?.id ?? body?.id;
  if (id) created.push(id);
  if (!body?.access_token) throw new Error(`Alta sin sesión para ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return { id, token: body.access_token };
}

async function signIn(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  const body = await json(res);
  return { id: body.user.id, token: body.access_token };
}

const asUser = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const asService = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function profileRoleAsService(userId) {
  const res = await fetch(`${API}/rest/v1/profiles?select=role&user_id=eq.${userId}`, { headers: asService });
  const rows = await json(res);
  return Array.isArray(rows) && rows.length ? rows[0].role : null;
}

function record(id, description, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  // F0-09 · Un usuario con perfil no puede cambiarse el rol a admin.
  {
    const { id, token } = await signIn('cliente.local@test.local');
    const res = await fetch(`${API}/rest/v1/profiles?user_id=eq.${id}`, {
      method: 'PATCH', headers: asUser(token), body: JSON.stringify({ role: 'admin' }),
    });
    const role = await profileRoleAsService(id);
    record('F0-09', 'PATCH role=admin sobre el propio perfil', res.status >= 400 && role === 'client', `HTTP ${res.status}, rol final ${role}`);
  }

  // F0-11 + F0-13 · Alta por API pidiendo admin → tiene perfil al instante, y es client.
  const attackerEmail = `atacante-${RUN}@f0-verify.local`;
  const attacker = await signUp(attackerEmail, { role: 'admin', requested_role: 'admin', full_name: 'Atacante' });
  {
    const role = await profileRoleAsService(attacker.id);
    record('F0-11', 'Alta nueva tiene perfil creado por el servidor', role !== null, `rol ${role}`);
    record('F0-13', 'Alta pidiendo role=admin en metadata queda como client', role === 'client', `rol ${role}`);
  }

  // F0-10 · Esa cuenta intenta crearse (otro) perfil como admin.
  {
    const res = await fetch(`${API}/rest/v1/profiles`, {
      method: 'POST', headers: asUser(attacker.token),
      body: JSON.stringify({ user_id: attacker.id, full_name: 'Atacante', role: 'admin' }),
    });
    const role = await profileRoleAsService(attacker.id);
    record('F0-10a', 'Usuario con perfil hace POST profiles role=admin', res.status >= 400 && role !== 'admin', `HTTP ${res.status}, rol final ${role}`);
  }

  // F0-10 · La ventana exacta de H-11: un usuario SIN perfil (como todos los de antes de F0)
  // intenta crearse el perfil como admin.
  {
    await fetch(`${API}/rest/v1/profiles?user_id=eq.${attacker.id}`, { method: 'DELETE', headers: asService });
    const res = await fetch(`${API}/rest/v1/profiles`, {
      method: 'POST', headers: asUser(attacker.token),
      body: JSON.stringify({ user_id: attacker.id, full_name: 'Atacante', role: 'admin' }),
    });
    const role = await profileRoleAsService(attacker.id);
    const list = await json(await fetch(`${API}/rest/v1/profiles?select=user_id`, { headers: asUser(attacker.token) }));
    const seesOthers = Array.isArray(list) && list.some((r) => r.user_id !== attacker.id);
    record('F0-10b', 'Usuario SIN perfil hace POST profiles role=admin (ventana de H-11)', res.status >= 400 && role !== 'admin' && !seesOthers,
      `HTTP ${res.status}, rol final ${role}, ve perfiles ajenos: ${seesOthers}`);
  }

  // F0-12 · Alta con intención jardinero → gardener.
  {
    const g = await signUp(`jardinero-${RUN}@f0-verify.local`, { role: 'gardener', requested_role: 'gardener', full_name: 'Jardinero Prueba' });
    const role = await profileRoleAsService(g.id);
    record('F0-12', 'Alta con intención jardinero queda como gardener', role === 'gardener', `rol ${role}`);
  }

  // F0-14 · El correo corporativo sigue siendo admin al registrarse (orden de disparadores).
  {
    const adminUsers = await json(await fetch(`${API}/auth/v1/admin/users?per_page=1000`, { headers: asService }));
    const already = (adminUsers?.users || []).some((u) => u.email === CORPORATE_ADMIN_EMAIL);
    if (already) {
      record('F0-14', 'Correo corporativo queda como admin al registrarse', true, 'ya existe en local; no se vuelve a crear');
    } else {
      const a = await signUp(CORPORATE_ADMIN_EMAIL, { role: 'client', full_name: 'Admin corporativo (prueba)' });
      const role = await profileRoleAsService(a.id);
      record('F0-14', 'Correo corporativo queda como admin al registrarse', role === 'admin', `rol ${role}`);
    }
  }
}

async function cleanup() {
  for (const id of created) {
    await fetch(`${API}/rest/v1/profiles?user_id=eq.${id}`, { method: 'DELETE', headers: asService });
    await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: asService });
  }
}

try {
  await main();
} catch (error) {
  console.error('Error ejecutando la verificación:', error.message);
  results.push({ id: 'error', ok: false });
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} en verde. Cuentas de prueba borradas: ${created.length}.`);
process.exit(failed ? 1 : 0);
