#!/usr/bin/env node
// GarSer Empresas · F8 — datos para mirar en el navegador una reserva de varios servicios:
// empresa «Jardines Rosa» (césped y setos) con Ana, que hace los dos, libre dos semanas; y una
// clienta, Laura.
//
// Uso:  node scripts/garser-empresas/seed-f8-demo.mjs crear | borrar
// Solo contra el Supabase LOCAL. Contraseña de todas las cuentas: Test123456!

import { accounts, createCompany, joinTeam, sql, setAvailability, cleanupUsers, LAWN, HEDGE } from './_company-harness.mjs';

const acc = accounts('f8-demo.local');
const mode = process.argv[2];

if (mode === 'borrar') {
  cleanupUsers(acc.stale());
  console.log('Demo de F8 borrada.');
} else if (mode === 'crear') {
  cleanupUsers(acc.stale());
  const owner = await createCompany(acc.newUser, 'rosa', [LAWN, HEDGE]);
  sql(`update public.gardener_profiles set full_name = 'Jardines Rosa' where user_id = '${owner.id}'`);
  sql(`update public.company_members set counts_as_labour = false where user_id = '${owner.id}'`);
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', [LAWN, HEDGE]);
  sql(`update public.profiles set full_name = 'Ana García' where user_id = '${ana.id}'`);
  for (let i = 1; i <= 14; i += 1) {
    setAvailability(ana.id, sql(`select (current_date + ${i})::text;`).trim(), [8, 9, 10, 11, 12, 13, 14, 15]);
  }
  const client = await acc.newUser('laura');
  sql(`update public.profiles set full_name = 'Laura Cliente' where user_id = '${client.id}'`);
  console.log('Creada. Contraseña: Test123456!');
  console.log(`  Dueña:   ${owner.email}`);
  console.log(`  Ana:     ${ana.email}`);
  console.log(`  Clienta: ${client.email}`);
} else {
  console.error('Uso: crear | borrar');
  process.exit(2);
}
