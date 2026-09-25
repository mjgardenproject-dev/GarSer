#!/usr/bin/env node
// GarSer Empresas · F7.3 — empresa de prueba para mirar en el navegador los trabajos de equipo y de
// varios días: Rosa (dueña, no trabaja), Ana, Luis y Eva; «hasta 2 personas a la vez»; un trabajo
// de 8 h con dos personas y otro de 36 h en varios días, ya aceptados; y una clienta, Laura.
//
// Uso:  node scripts/garser-empresas/seed-f7-demo.mjs crear   → imprime los correos
//       node scripts/garser-empresas/seed-f7-demo.mjs borrar
// Solo contra el Supabase LOCAL. Contraseña de todas las cuentas: Test123456!

import { randomUUID } from 'node:crypto';
import { accounts, createCompany, joinTeam, sql, setAvailability, cleanupUsers, pay, rpc, LAWN_INPUT } from './_company-harness.mjs';

const acc = accounts('f7-demo.local');
const mode = process.argv[2];
const lawn = (m2) => ({ ...LAWN_INPUT, lawnZones: [{ quantity: m2, state: 'normal' }] });

if (mode === 'borrar') {
  cleanupUsers(acc.stale());
  console.log('Demo de F7 borrada.');
} else if (mode === 'crear') {
  cleanupUsers(acc.stale());
  const owner = await createCompany(acc.newUser, 'rosa');
  sql(`update public.profiles set full_name = 'Rosa Dueña' where user_id = '${owner.id}'`);
  sql(`update public.company_members set counts_as_labour = false where user_id = '${owner.id}'`);
  sql(`update public.companies set max_crew = 2 where provider_user_id = '${owner.id}'`);
  const people = {};
  for (const [key, name] of [['ana', 'Ana García'], ['luis', 'Luis Pérez'], ['eva', 'Eva Ruiz']]) {
    people[key] = await joinTeam(acc.newUser, owner.token, key);
    sql(`update public.profiles set full_name = '${name}' where user_id = '${people[key].id}'`);
  }
  const monday = sql("select (date_trunc('week', current_date + 7))::date::text;").trim();
  const day = (i) => sql(`select (date '${monday}' + ${i})::text;`).trim();
  for (let i = 0; i < 12; i += 1) {
    setAvailability(people.ana.id, day(i), [8, 9, 10, 11]);
    setAvailability(people.luis.id, day(i), i === 2 ? [15, 16, 17, 18] : [8, 9, 10, 11]);
    setAvailability(people.eva.id, day(i), [8, 9, 10, 11, 12, 13, 14, 15]);
  }
  const client = await acc.newUser('laura');
  sql(`update public.profiles set full_name = 'Laura Cliente' where user_id = '${client.id}'`);
  // Eva ocupada el lunes para que el trabajo de 8 h lo hagan Ana y Luis a la vez.
  sql(`update public.availability set is_available = false where gardener_id = '${people.eva.id}' and date = '${day(0)}'`);
  const crew = await pay(owner.id, client, day(0), 8, { input: lawn(1200) });
  // Eva, ocupada toda la semana siguiente, para que el grande sea de Ana y Luis en varios días.
  sql(`update public.availability set is_available = false where gardener_id = '${people.eva.id}' and date between '${day(1)}' and '${day(11)}'`);
  const multi = await pay(owner.id, client, day(1), 8, { input: lawn(6000) });
  sql(`update public.availability set is_available = true where gardener_id = '${people.eva.id}' and date between '${day(1)}' and '${day(11)}'
       and not exists (select 1 from public.booking_blocks bb where bb.assignee_id = gardener_id and bb.date = availability.date)`);
  for (const b of [crew.bookingId, multi.bookingId]) {
    if (b) await rpc('respond_booking_request', { p_booking_id: b, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  }
  console.log(`Creada. Semana del ${monday}. Contraseña: Test123456!`);
  console.log(`  Dueña:   ${owner.email}`);
  console.log(`  Ana:     ${people.ana.email}`);
  console.log(`  Luis:    ${people.luis.email}`);
  console.log(`  Clienta: ${client.email}`);
  console.log(`  Equipo:  ${crew.bookingId || crew.error}  · Varios días: ${multi.bookingId || multi.error}`);
} else {
  console.error('Uso: crear | borrar');
  process.exit(2);
}
