#!/usr/bin/env node
// Utilidad para probar en el navegador local: una empresa aprobada («demo-empresa@demo.local»)
// con una empleada con césped y horario («demo-ana@demo.local») y una solicitud pendiente del
// cliente de la semilla, asignada a ella. Contraseña de las dos: la de la semilla. Solo LOCAL.
// Con `--clean` borra lo creado antes. Uso: node scripts/garser-empresas/demo-company.mjs [--clean]
import { accounts, cleanupUsers, createCompany, joinTeam, pay, setAvailability, signIn, sql, rpc } from './_company-harness.mjs';

const acc = accounts('demo.local');
const stale = acc.stale();
if (stale.length) { cleanupUsers(stale); console.log(`Borradas ${stale.length} cuentas demo anteriores.`); }
if (process.argv.includes('--clean')) process.exit(0);

const company = await createCompany(acc.newUser, 'demo-empresa');
const ana = await joinTeam(acc.newUser, company.token, 'demo-ana');
const rules = [1, 2, 3, 4, 5].map((dow) => ({ day_of_week: dow, start_hour: 8, end_hour: 18 }));
await rpc('set_member_recurring_schedule', { p_member_id: ana.memberId, p_rules: rules, p_weeks: 4 }, company.token);
const date = sql('select (current_date + 21)::text;').trim();
setAvailability(ana.id, date, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
const clientId = sql("select id from auth.users where email = 'cliente.local@test.local'").trim();
const booking = await pay(company.id, { id: clientId, token: await signIn('cliente.local@test.local') }, date, 10);
console.log(JSON.stringify({ empresa: company.email, empleada: ana.email, reserva: booking.bookingId, fecha: date, error: booking.error }));
