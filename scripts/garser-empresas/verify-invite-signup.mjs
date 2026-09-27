#!/usr/bin/env node
// GarSer Empresas · D21 / H-39 — el empleado invitado crea su contraseña en la propia invitación
// (Edge Function company-invitation-signup) y queda dentro del equipo, sin correo de confirmación.
// Contra el Supabase LOCAL. Necesita el servidor de funciones con la función nueva
// (`npx supabase functions serve`, o el contenedor recreado).
// Uso: node scripts/garser-empresas/verify-invite-signup.mjs

import {
  accounts, createCompany, makeRecorder, rpc, sql, why, runVerification, apiUrl, anonKey, LAWN,
} from './_company-harness.mjs';

const acc = accounts('invite-signup.local');
const { results, record } = makeRecorder();
const PASSWORD = 'ClaveSegura123';

async function signupViaInvitation(body) {
  const res = await fetch(`${apiUrl}/functions/v1/company-invitation-signup`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function passwordLogin(email, password) {
  const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return (await res.json())?.access_token || null;
}

const usersWith = (email) => Number(sql(`select count(*) from auth.users where lower(email) = lower('${email}')`));
const track = (email) => {
  const id = sql(`select coalesce(id::text, '') from auth.users where lower(email) = lower('${email}')`);
  if (id) acc.created.push(id);
  return id;
};

async function main() {
  const company = await createCompany(acc.newUser, 'empresa', [LAWN]);
  const invite = async (email) => (await rpc('create_company_invitation', { p_email: email }, company.token)).body?.token;

  {
    const email = `ana-${acc.run}@invite-signup.local`;
    const token = await invite(email);
    // Aunque quien llama mande otro correo, la cuenta se crea con el de la invitación.
    const r = await signupViaInvitation({ token, fullName: '  Ana   Pérez ', password: PASSWORD, email: `intruso-${acc.run}@invite-signup.local` });
    const id = track(email);
    const row = id ? sql(`select (u.email_confirmed_at is not null) || '|' || p.role || '|' || p.full_name || '|' || coalesce(m.status, 'sin')
      from auth.users u join public.profiles p on p.user_id = u.id
      left join public.company_members m on m.user_id = u.id and m.company_id = '${sql(`select id from public.companies where provider_user_id='${company.id}'`)}'
      where u.id = '${id}'`) : '';
    const login = await passwordLogin(email, PASSWORD);
    const role = login ? (await rpc('current_account_role', {}, login)).body : null;
    record('IS-01', 'Cuenta nueva desde la invitación: confirmada, empleado activo del equipo, con su nombre, y entra con su contraseña',
      r.status === 200 && row === 'true|employee|Ana Pérez|active' && role === 'employee' && usersWith(`intruso-${acc.run}@invite-signup.local`) === 0,
      `${r.status} · ${row} · login ${login ? 'sí' : 'no'} · rol ${role}`);

    const again = await signupViaInvitation({ token, fullName: 'Ana', password: PASSWORD });
    record('IS-02', 'El mismo enlace no sirve dos veces', again.status === 409 && again.body?.error === 'invitation_accepted' && usersWith(email) === 1,
      `${again.status} ${again.body?.error}`);
  }
  {
    const r = await signupViaInvitation({ token: 'f'.repeat(64), fullName: 'Nadie', password: PASSWORD });
    record('IS-03', 'Un token inventado no crea nada', r.status === 409 && r.body?.error === 'invitation_invalid', `${r.status} ${r.body?.error}`);
  }
  {
    const email = `caducada-${acc.run}@invite-signup.local`;
    const token = await invite(email);
    sql(`update public.company_invitations set expires_at = now() - interval '1 minute' where email = '${email}'`);
    const r = await signupViaInvitation({ token, fullName: 'Caducada', password: PASSWORD });
    const email2 = `anulada-${acc.run}@invite-signup.local`;
    const token2 = await invite(email2);
    sql(`update public.company_invitations set revoked_at = now() where email = '${email2}'`);
    const r2 = await signupViaInvitation({ token: token2, fullName: 'Anulada', password: PASSWORD });
    record('IS-04', 'Invitación caducada o anulada: no se crea la cuenta',
      r.body?.error === 'invitation_expired' && r2.body?.error === 'invitation_revoked' && usersWith(email) === 0 && usersWith(email2) === 0,
      `${r.body?.error} · ${r2.body?.error}`);
  }
  {
    const email = `corta-${acc.run}@invite-signup.local`;
    const token = await invite(email);
    const short = await signupViaInvitation({ token, fullName: 'Corta', password: '1234567' });
    const noName = await signupViaInvitation({ token, fullName: ' ', password: PASSWORD });
    record('IS-05', 'Contraseña de menos de 8 o sin nombre: se rechaza y no se crea nada',
      short.status === 400 && short.body?.error === 'invalid_password' && noName.status === 400 && usersWith(email) === 0,
      `${short.status} ${short.body?.error} · ${noName.status} ${noName.body?.error}`);
  }
  {
    const existing = await acc.newUser('ya-cliente');
    const token = await invite(existing.email);
    const r = await signupViaInvitation({ token, fullName: 'Ya Cliente', password: PASSWORD });
    const accept = await rpc('accept_company_invitation', { p_token: token }, existing.token);
    record('IS-06', 'Si ya tiene cuenta: «account_exists», no se duplica, y al entrar la acepta como siempre',
      r.status === 409 && r.body?.error === 'account_exists' && usersWith(existing.email) === 1 && accept.ok,
      `${r.status} ${r.body?.error} · aceptar con sesión ${accept.ok ? 'sí' : `no${why(accept)}`}`);
  }
  {
    const client = await acc.newUser('curioso');
    const token = await invite(`otra-${acc.run}@invite-signup.local`);
    const asClient = await rpc('accept_company_invitation_as_service', { p_user_id: client.id, p_token: token }, client.token);
    record('IS-07', 'La aceptación «de servicio» no la puede llamar un usuario (solo la función)', !asClient.ok, `${asClient.status}`);
  }
}

await runVerification({ acc, results, main });
