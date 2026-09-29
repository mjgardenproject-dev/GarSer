#!/usr/bin/env node
// Prueba real · F5: al unirse alguien al equipo se avisa al dueño y el panel dice qué le falta
// (R-04); cuando el dueño cambia el horario de un empleado, a este le llega UN correo por cada
// «Guardar» que cambie algo, y los días sueltos se guardan todo o nada (R-05). Contra el Supabase
// LOCAL con las funciones servidas y el Vault local configurado (ver verify-notification-outbox).
// Uso: node scripts/garser-empresas/verify-team-setup.mjs

import { execFileSync } from 'node:child_process';
import {
  accounts, apiUrl, anonKey, createCompany, joinTeam, makeRecorder, rpc, runVerification, sql, why, LAWN,
} from './_company-harness.mjs';

const acc = accounts('team-setup.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const edgeLog = () => execFileSync('sh', ['-c', 'docker logs --since 3m supabase_edge_runtime_GarSer-main_4 2>&1'], { encoding: 'utf8' });
const outbox = (type, memberId) => sql(`select coalesce(string_agg(status || ':' || coalesce(payload->>'kind', '-'), ',' order by created_at), '') from public.notification_outbox where type = '${type}' and payload->>'memberId' = '${memberId}'`);
const waitOutbox = async (type, memberId) => {
  for (let i = 0; i < 30 && /pending|sending/.test(outbox(type, memberId)); i++) await new Promise((r) => setTimeout(r, 700));
  return outbox(type, memberId);
};
const overviewOf = async (token, memberId) => {
  const r = await rpc('company_team_overview', {}, token);
  return (r.body?.members || []).find((m) => m.member_id === memberId) || {};
};
const rules = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '14:00' }));

async function main() {
  const owner = await createCompany(acc.newUser, 'empresa-ts');
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', []);

  // ── R-04: se une alguien ──────────────────────────────────────────────────────────────────
  const joined = await waitOutbox('company_member_joined', ana.memberId);
  const log1 = edgeLog();
  record('TS-01', 'Al aceptar la invitación, al dueño le llega 1 correo «se ha unido a tu equipo»',
    joined === 'sent:-' && log1.includes(owner.email) && /se ha unido a tu equipo/.test(log1), `cola [${joined}]`);

  const o0 = await overviewOf(owner.token, ana.memberId);
  record('TS-02', 'El panel dice que le falta todo: sin horario fijo ni servicios, no configurada',
    o0.has_recurring_schedule === false && o0.is_configured === false, JSON.stringify({ h: o0.has_recurring_schedule, c: o0.is_configured }));

  await rpc('set_company_member_services', { p_member_id: ana.memberId, p_service_ids: [LAWN] }, owner.token);
  const o1 = await overviewOf(owner.token, ana.memberId);
  const weekly = await rpc('set_member_recurring_schedule', { p_member_id: ana.memberId, p_rules: rules, p_weeks: 4 }, owner.token);
  const o2 = await overviewOf(owner.token, ana.memberId);
  record('TS-03', 'Con solo servicios sigue sin configurar; con horario fijo y servicio, configurada (el aviso se va)',
    o1.is_configured === false && weekly.ok && o2.has_recurring_schedule === true && o2.is_configured === true,
    `solo servicio ${o1.is_configured}, con horario ${o2.is_configured}${why(weekly)}`);

  // ── R-05: horario fijo ────────────────────────────────────────────────────────────────────
  const w1 = await waitOutbox('member_schedule_published', ana.memberId);
  await rpc('set_member_recurring_schedule', { p_member_id: ana.memberId, p_rules: rules, p_weeks: 4 }, owner.token);
  const w2 = await waitOutbox('member_schedule_published', ana.memberId);
  const log2 = edgeLog();
  record('TS-04', 'Publicar el horario fijo: 1 correo a Ana «Tienes un nuevo horario publicado»; guardarlo igual no manda otro',
    w1 === 'sent:weekly' && w2 === w1 && log2.includes(ana.email) && /Tienes un nuevo horario publicado/.test(log2), `cola [${w2}]`);

  // ── R-05: días sueltos, una llamada ───────────────────────────────────────────────────────
  const days = [30, 31, 32, 33, 34].map((n) => ({ date: day(n), hours: [8, 9, 10] }));
  const d1 = await rpc('set_member_days_availability', { p_member_id: ana.memberId, p_days: days }, owner.token);
  const afterDays = await waitOutbox('member_schedule_published', ana.memberId);
  const d2 = await rpc('set_member_days_availability', { p_member_id: ana.memberId, p_days: days }, owner.token);
  record('TS-05', 'Guardar 5 días sueltos: 1 solo correo más; guardar lo mismo otra vez no manda nada',
    d1.ok && d1.body?.changed === true && afterDays === 'sent:weekly,sent:days' && d2.ok && d2.body?.changed === false && outbox('member_schedule_published', ana.memberId) === afterDays,
    `cola [${outbox('member_schedule_published', ana.memberId)}]${why(d1)}`);

  const before = sql(`select string_agg(extract(hour from start_time)::int::text, ',' order by start_time) from public.availability where gardener_id = '${ana.id}' and date = '${day(30)}' and is_available`);
  const mixed = await rpc('set_member_days_availability', {
    p_member_id: ana.memberId, p_days: [{ date: day(30), hours: [15, 16] }, { date: day(-1), hours: [9] }],
  }, owner.token);
  const after = sql(`select string_agg(extract(hour from start_time)::int::text, ',' order by start_time) from public.availability where gardener_id = '${ana.id}' and date = '${day(30)}' and is_available`);
  record('TS-06', 'Todo o nada: si un día no se puede (ayer), no se guarda ninguno ni se avisa',
    !mixed.ok && before === after && outbox('member_schedule_published', ana.memberId) === afterDays, `${mixed.status}${why(mixed)} · día 30 [${before}] → [${after}]`);

  // ── Quién puede ───────────────────────────────────────────────────────────────────────────
  const other = await createCompany(acc.newUser, 'otra-ts');
  const byOther = await rpc('set_member_days_availability', { p_member_id: ana.memberId, p_days: days }, other.token);
  const byAna = await rpc('set_member_days_availability', { p_member_id: ana.memberId, p_days: days }, ana.token);
  const mail = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'member_schedule_published', memberId: ana.memberId, kind: 'weekly' }),
  }).then((r) => r.json()).catch(() => null);
  record('TS-07', 'Otra empresa y la propia empleada no pueden cambiar ese horario; y el correo no se puede pedir desde el navegador',
    !byOther.ok && !byAna.ok && mail?.skipped === 'server_managed', `otra ${byOther.status}, empleada ${byAna.status}, correo ${JSON.stringify(mail)}`);
}

await runVerification({ acc, results, main });
