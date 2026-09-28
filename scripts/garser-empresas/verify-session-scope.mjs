#!/usr/bin/env node
// Prueba real · R-06 (F1): cerrar sesión en un sitio no puede echar a la misma cuenta de otro.
// Reproduce lo que pasó en producción el 2026-09-28 (la empresa cerró sesión en un sitio para
// aceptar la invitación y la otra pestaña perdió la sesión al enviar una propuesta) y comprueba
// que el cierre LOCAL, el que usa ahora la web, no lo provoca. Contra el Supabase LOCAL.
// Uso: node scripts/garser-empresas/verify-session-scope.mjs

import { accounts, apiUrl, anonKey, makeRecorder, runVerification } from './_company-harness.mjs';

const acc = accounts('session-scope.local');
const { results, record } = makeRecorder();

const login = async (email) => {
  const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!' }),
  });
  return res.json();
};
const logout = (token, scope) => fetch(`${apiUrl}/auth/v1/logout${scope ? `?scope=${scope}` : ''}`, {
  method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
});
const getUser = async (token) => (await fetch(`${apiUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })).status;
const refresh = async (refreshToken) => (await fetch(`${apiUrl}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: refreshToken }),
})).status;

async function main() {
  const user = await acc.newUser('empresa');

  // Dos sesiones de la misma cuenta: ordenador (A) y móvil (B).
  const a = await login(user.email);
  const b = await login(user.email);
  const out = await logout(b.access_token, 'local');
  record('SS-01', 'Cerrar sesión en el móvil con scope local (la web nueva) deja viva la sesión del ordenador',
    out.status === 204 && (await getUser(a.access_token)) === 200 && (await refresh(a.refresh_token)) === 200,
    `logout ${out.status}`);

  // Lo que hacía la web hasta ahora: signOut() sin opciones = global.
  const c = await login(user.email);
  const d = await login(user.email);
  const outGlobal = await logout(d.access_token);
  const cUser = await getUser(c.access_token);
  record('SS-02', 'Con el cierre global de antes, la otra sesión cae: getUser 403 (lo que vio el usuario en producción)',
    outGlobal.status === 204 && [401, 403].includes(cUser), `getUser de la otra sesión: ${cUser}`);

  // Tras cambiar la contraseña (ResetPassword) se cierran las DEMÁS sesiones y se mantiene esta.
  const e = await login(user.email);
  const f = await login(user.email);
  const outOthers = await logout(e.access_token, 'others');
  record('SS-03', 'Cambio de contraseña: scope others deja esta sesión y cierra la otra',
    outOthers.status === 204 && (await getUser(e.access_token)) === 200 && [401, 403].includes(await getUser(f.access_token)),
    `logout ${outOthers.status}`);
}

await runVerification({ acc, results, main });
