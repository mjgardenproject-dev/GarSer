#!/usr/bin/env node
// Utilidad para probar en el navegador local la cuenta de profesional dinámica (docs/garser-empresas/08):
// un profesional INDIVIDUAL ya aprobado («demo-pro-…@pmode-demo.local») con sus servicios, zona, horas libres,
// una reserva pagada y una reseña, y una cuenta de CLIENTE («demo-companero-…@pmode-demo.local») lista para
// aceptar la invitación a su equipo. Contraseña de las dos: Test123456!. Solo LOCAL.
// Con `--clean` borra lo creado antes. Uso: node scripts/garser-empresas/demo-professional-mode.mjs [--clean]
import { accounts, cleanupUsers, pay, setAvailability, signIn, sql, LAWN, HEDGE, PHYTO, PROVIDER_ID } from './_company-harness.mjs';

const acc = accounts('pmode-demo.local');
const clearReviews = (ids) => ids.length && sql(`delete from public.reviews where gardener_id in (${ids.map((id) => `'${id}'`).join(',')})`);
const stale = acc.stale();
if (stale.length) { clearReviews(stale); cleanupUsers(stale); console.log(`Borradas ${stale.length} cuentas demo anteriores.`); }
if (process.argv.includes('--clean')) process.exit(0);

const pro = await acc.newUser('demo-pro', 'gardener');
sql(`update public.profiles set full_name = 'Marta Jardinera' where user_id = '${pro.id}'`);
sql(`insert into public.gardener_profiles (user_id, full_name, phone, address, operational_latitude, operational_longitude, max_distance, description)
     values ('${pro.id}', 'Marta Jardinera', '600000010', 'Marbella', 36.51, -4.882, 30, 'Diez años cuidando jardines en la Costa del Sol.')`);
sql(`insert into public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
     select '${pro.id}', service_id, unit_type, price_per_unit, currency, true, additional_config
     from public.gardener_service_prices where gardener_id = '${PROVIDER_ID}' and service_id in ('${LAWN}','${HEDGE}','${PHYTO}')`);
const date = sql('select (current_date + 7)::text;').trim();
setAvailability(pro.id, date, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
const rules = [1, 2, 3, 4, 5].map((day) => `('${pro.id}', ${day}, '09:00', '18:00')`).join(',');
sql(`insert into public.recurring_schedules (gardener_id, day_of_week, start_time, end_time) values ${rules}`);

const client = await acc.newUser('demo-cliente');
sql(`update public.profiles set full_name = 'Clara Pérez', phone = '600999888', address = 'Calle Mayor 3' where user_id = '${client.id}'`);
const done = sql('select gen_random_uuid()').split('\n')[0].trim();
sql(`insert into public.bookings (id, client_id, gardener_id, service_id, date, start_time, duration_hours, status, total_price, client_address, management_fee, management_fee_source)
     values ('${done}', '${client.id}', '${pro.id}', '${LAWN}', current_date - 10, '09:00', 2, 'completed', 100, 'Calle Prueba 1', 12.50, 'payment_attempt')`);
sql(`insert into public.reviews (booking_id, client_id, gardener_id, rating, comment) values ('${done}', '${client.id}', '${pro.id}', 5, 'Muy puntual y el jardín quedó perfecto.')`);
const booking = await pay(pro.id, { id: client.id, token: await signIn(client.email) }, date, 9);

const companion = await acc.newUser('demo-companero');
console.log(JSON.stringify({
  profesional: pro.email, companero: companion.email, cliente: client.email, password: 'Test123456!',
  reserva: booking.bookingId, fecha: date, error: booking.error,
}));
