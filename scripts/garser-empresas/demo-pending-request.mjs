#!/usr/bin/env node
// Utilidad para probar en el navegador local: crea una solicitud PENDIENTE del cliente de la
// semilla al jardinero de la semilla (césped) para dentro de N días. Solo contra el LOCAL.
// Uso: node scripts/garser-empresas/demo-pending-request.mjs [días=20] [hora=10]
import { sql, signIn, setAvailability, pay, PROVIDER_ID } from './_company-harness.mjs';

const days = Number(process.argv[2] || 20);
const hour = Number(process.argv[3] || 10);
const date = sql(`select (current_date + ${days})::text;`).trim();
const clientId = sql("select id from auth.users where email = 'cliente.local@test.local'").trim();
const token = await signIn('cliente.local@test.local');
setAvailability(PROVIDER_ID, date, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
const r = await pay(PROVIDER_ID, { id: clientId, token }, date, hour);
console.log(JSON.stringify({ date, hour, ...r }, null, 0).slice(0, 400));
