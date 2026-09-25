#!/usr/bin/env node
// GarSer Empresas · F9 — datos para mirar en el navegador los planes de mantenimiento: «Jardines
// Rosa» con Ana (césped), la clienta Laura con dos reservas confirmadas; de una sale un plan
// quincenal con su próxima visita ya propuesta (el reloj simulado).
//
// Uso:  node scripts/garser-empresas/seed-f9-demo.mjs crear | borrar
// Solo contra el Supabase LOCAL. Contraseña de todas las cuentas: Test123456!

import { randomUUID } from 'node:crypto';
import { accounts, createCompany, joinTeam, sql, setAvailability, cleanupUsers, pay, rpc, LAWN } from './_company-harness.mjs';

const acc = accounts('f9-demo.local');
const mode = process.argv[2];
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();

if (mode === 'borrar') {
  cleanupUsers(acc.stale());
  console.log('Demo de F9 borrada.');
} else if (mode === 'crear') {
  cleanupUsers(acc.stale());
  const owner = await createCompany(acc.newUser, 'rosa', [LAWN]);
  sql(`update public.gardener_profiles set full_name = 'Jardines Rosa' where user_id = '${owner.id}'`);
  sql(`update public.company_members set counts_as_labour = false where user_id = '${owner.id}'`);
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', [LAWN]);
  sql(`update public.profiles set full_name = 'Ana García' where user_id = '${ana.id}'`);
  for (let i = 2; i <= 20; i += 1) setAvailability(ana.id, day(i), [9, 10, 11, 12, 13]);
  const client = await acc.newUser('laura');
  sql(`update public.profiles set full_name = 'Laura Cliente' where user_id = '${client.id}'`);
  const accept = (id) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  const a = await pay(owner.id, client, day(2), 9);
  const b = await pay(owner.id, client, day(3), 11);
  await accept(a.bookingId);
  await accept(b.bookingId);
  const plan = await rpc('create_maintenance_plan', { p_booking_id: a.bookingId, p_frequency: 'biweekly' }, client.token);
  sql(`update public.maintenance_plans set next_visit_date = '${day(6)}' where id = '${plan.body?.planId}'`);
  sql('select public.generate_maintenance_proposals()');
  console.log('Creada. Contraseña: Test123456!');
  console.log(`  Dueña:   ${owner.email}`);
  console.log(`  Clienta: ${client.email}`);
  console.log(`  Plan: ${plan.body?.planId || JSON.stringify(plan.body)}`);
} else {
  console.error('Uso: crear | borrar');
  process.exit(2);
}
