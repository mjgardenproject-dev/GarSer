#!/usr/bin/env node
// QA-065 / QA-086 · paquete 1.6: la retirada de restos tiene coste y solo se cobra si el cliente la
// ha elegido. Por HTTP contra booking-authority (motor del servidor): sin respuesta = igual que «no».
//
//   supabase functions serve --env-file <env>        # otra terminal
//   node scripts/qa/verify-unchosen-extras.mjs

import { quote, sql } from '../readiness/_harness.mjs';

const id = (name) => sql(`select id from public.services where name = '${name}' limit 1;`).trim();
const cases = [
  ['Corte de césped', { lawnZones: [{ quantity: 300, state: 'normal' }] }],
  ['Desbroce de malas hierbas', { weedingZones: [{ id: 'w1', area: 300, state: 'normal', applyHerbicide: false }] }],
  ['Poda de plantas y arbustos', { shrubGroups: [{ id: 's1', area: 20, size: 'pequeñas' }] }],
  ['Poda de palmeras', { palmGroups: [{ id: 'p1', species: 'Phoenix canariensis', height: '0-4', quantity: 1, state: 'normal' }] }],
];

let ok = 0;
for (const [name, input] of cases) {
  const unchosen = await quote(id(name), input);
  const no = await quote(id(name), { ...input, wasteRemoval: false });
  const yes = await quote(id(name), { ...input, wasteRemoval: true });
  const price = (r) => Number(r?.totalPrice ?? r?.body?.totalPrice);
  const pass = price(unchosen) === price(no) && price(unchosen) > 0;
  if (pass) ok += 1;
  console.log(`${pass ? '✅' : '❌'} ${name}: sin elegir ${price(unchosen)} € · «no» ${price(no)} € · «sí» ${price(yes)} €`);
}
console.log(`\n${ok}/${cases.length} comprobaciones OK`);
process.exit(ok === cases.length ? 0 : 1);
