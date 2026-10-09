#!/usr/bin/env node
// Pendientes · fase E: el proveedor suspendido se entera (PR-02). Suspender y reactivar mandan un
// correo cada uno, solo si el estado cambia; a los empleados no se les escribe (decisión del
// usuario). Contra el Supabase LOCAL con las funciones servidas.
// Uso: node scripts/garser-empresas/verify-provider-suspension.mjs

import { execFileSync } from 'node:child_process';
import {
  accounts, apiUrl, anonKey, createCompany, joinTeam, makeRecorder, rest, rpc, runVerification, signIn, sql, why, PROVIDER_ID,
} from './_company-harness.mjs';

const acc = accounts('provider-suspension.local');
const { results, record } = makeRecorder();
const outbox = (type, id) => sql(`select coalesce(string_agg(status, ',' order by created_at), '') from public.notification_outbox where type='${type}' and payload->>'user_id'='${id}'`);
const waitOutbox = async (type, id, n) => {
  for (let i = 0; i < 30; i++) {
    const rows = outbox(type, id);
    if (rows.split(',').filter((x) => x === 'sent' || x === 'failed').length >= n) return rows;
    await new Promise((r) => setTimeout(r, 700));
  }
  return outbox(type, id);
};
// Todo el registro (sin `--since`): las cuentas son nuevas en cada pasada.
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const mailsTo = (email, subject) => edgeLog().split('MOCK EMAIL SEND').filter((c) => c.includes(email) && c.includes(subject)).length;
const SUSP = 'Tu cuenta de GarSer está suspendida';
const BACK = 'Tu cuenta de GarSer vuelve a estar activa';

async function newFreelancer(label) {
  const u = await acc.newUser(label, 'gardener');
  sql(`update public.profiles set role = 'gardener', full_name = 'Autónomo ${label}' where user_id = '${u.id}'`);
  sql(`insert into public.gardener_profiles select * from jsonb_populate_record(null::public.gardener_profiles,
        (select to_jsonb(g) || jsonb_build_object('id', gen_random_uuid(), 'user_id', '${u.id}', 'full_name', 'Autónomo ${label}', 'suspended_at', null)
         from public.gardener_profiles g where g.user_id = '${PROVIDER_ID}'))`);
  return { ...u, token: await signIn(u.email) };
}

async function main() {
  const admin = await signIn('admin.local@test.local');
  const owner = await createCompany(acc.newUser, 'empresa-ps');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana');

  const s1 = await rpc('admin_set_provider_suspended', { p_user_id: owner.id, p_suspended: true }, admin);
  const m1 = await waitOutbox('provider_suspended', owner.id, 1);
  const own = await rest('GET', `/rest/v1/gardener_profiles?user_id=eq.${owner.id}&select=suspended_at`, owner.token);
  record('PS-01', 'Suspender una empresa: 1 correo «está suspendida» al dueño, que además lee su estado (para el aviso del panel)',
    s1.ok && s1.body?.changed === true && m1 === 'sent' && mailsTo(owner.email, SUSP) === 1 && !!own.rows[0]?.suspended_at,
    `rpc ${s1.status}${why(s1)}, cola [${m1}], correos ${mailsTo(owner.email, SUSP)}`);

  const s2 = await rpc('admin_set_provider_suspended', { p_user_id: owner.id, p_suspended: true }, admin);
  await new Promise((r) => setTimeout(r, 1500));
  record('PS-02', 'Suspender otra vez lo ya suspendido no manda nada más',
    s2.ok && s2.body?.changed === false && outbox('provider_suspended', owner.id) === 'sent' && mailsTo(owner.email, SUSP) === 1, `cola [${outbox('provider_suspended', owner.id)}]`);

  const s3 = await rpc('admin_set_provider_suspended', { p_user_id: owner.id, p_suspended: false }, admin);
  const m3 = await waitOutbox('provider_reactivated', owner.id, 1);
  record('PS-03', 'Reactivar: 1 correo «vuelve a estar activa»; reactivar otra vez no manda otro',
    s3.ok && m3 === 'sent' && mailsTo(owner.email, BACK) === 1
      && (await rpc('admin_set_provider_suspended', { p_user_id: owner.id, p_suspended: false }, admin)).body?.changed === false,
    `cola [${m3}], correos ${mailsTo(owner.email, BACK)}`);

  record('PS-04', 'A la empleada no se le escribe ni al suspender ni al reactivar (decisión del usuario)',
    mailsTo(ana.email, SUSP) === 0 && mailsTo(ana.email, BACK) === 0 && outbox('provider_suspended', ana.id) === '', '');

  // ── Regla 2: un autónomo ───────────────────────────────────────────────────────────────────
  const solo = await newFreelancer('solo');
  await rpc('admin_set_provider_suspended', { p_user_id: solo.id, p_suspended: true }, admin);
  const ms = await waitOutbox('provider_suspended', solo.id, 1);
  await rpc('admin_set_provider_suspended', { p_user_id: solo.id, p_suspended: false }, admin);
  const mr = await waitOutbox('provider_reactivated', solo.id, 1);
  record('PS-05', 'Un autónomo recibe igual los dos correos', ms === 'sent' && mr === 'sent' && mailsTo(solo.email, SUSP) === 1 && mailsTo(solo.email, BACK) === 1,
    `cola [${ms}] [${mr}]`);

  // ── Quién puede ────────────────────────────────────────────────────────────────────────────
  const byOwner = await rpc('admin_set_provider_suspended', { p_user_id: solo.id, p_suspended: true }, owner.token);
  const mail = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'provider_suspended', user_id: solo.id }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  record('PS-06', 'Nadie más que el admin suspende, y el correo no se puede pedir desde el navegador',
    !byOwner.ok && sql(`select (suspended_at is null)::text from public.gardener_profiles where user_id='${solo.id}'`) === 'true'
      && (mail.body?.skipped === 'server_managed' || mail.status === 403),
    `empresa ${byOwner.status}, correo ${mail.status} ${JSON.stringify(mail.body)}`);
}

await runVerification({ acc, results, main });
