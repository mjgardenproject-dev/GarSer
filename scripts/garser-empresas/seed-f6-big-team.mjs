#!/usr/bin/env node
// GarSer Empresas · F6.2 — empresa de prueba con 20 personas para mirar el planificador en un
// móvil (prueba F6-06). Nombres largos a propósito, horarios y trabajos repartidos por la semana.
//
// Uso:  node scripts/garser-empresas/seed-f6-big-team.mjs crear   → imprime el correo de la dueña
//       node scripts/garser-empresas/seed-f6-big-team.mjs borrar
// Solo contra el Supabase LOCAL. Contraseña de todas las cuentas: Test123456!

import { accounts, createCompany, joinTeam, sql, setAvailability, cleanupUsers, pay } from './_company-harness.mjs';

const DOMAIN = 'f6-ui.local';
const acc = accounts(DOMAIN);
const mode = process.argv[2];

const NAMES = [
  'María del Carmen Fernández-Villaverde', 'José Antonio Rodríguez', 'Lucía Gómez', 'Francisco Javier Martínez de la Fuente',
  'Ana Belén Sánchez', 'Manuel López', 'Carmen Ruiz', 'David Hernández', 'Laura Jiménez', 'Pablo Moreno',
  'Isabel Álvarez', 'Sergio Romero', 'Marta Navarro', 'Alejandro Torres', 'Elena Domínguez', 'Rubén Vázquez',
  'Cristina Ramos', 'Jorge Gil', 'Patricia Serrano', 'Álvaro Blanco',
];

if (mode === 'borrar') {
  cleanupUsers(acc.stale());
  console.log('Empresa de 20 personas borrada.');
} else if (mode === 'crear') {
  cleanupUsers(acc.stale());
  const owner = await createCompany(acc.newUser, 'duena-20');
  sql(`update public.profiles set full_name = 'Rosa Dueña Grande' where user_id = '${owner.id}'`);
  const monday = sql("select (date_trunc('week', current_date + 7))::date::text;").trim();
  const days = Array.from({ length: 5 }, (_, i) => sql(`select (date '${monday}' + ${i})::text;`).trim());
  for (let i = 0; i < NAMES.length - 1; i += 1) {
    const person = await joinTeam(acc.newUser, owner.token, `p${i}`);
    sql(`update public.profiles set full_name = '${NAMES[i]}' where user_id = '${person.id}'`);
    days.forEach((d) => setAvailability(person.id, d, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]));
  }
  const client = await acc.newUser('cliente');
  for (const d of days) {
    for (const h of [8, 10, 12, 14]) await pay(owner.id, client, d, h);
  }
  console.log(`Creada. Dueña: duena-20-${acc.run}@${DOMAIN} (contraseña Test123456!). Semana del ${monday}.`);
} else {
  console.error('Uso: crear | borrar');
  process.exit(2);
}
