// Pruebas de las comisiones configurables SIN Docker: ejecuta las migraciones reales sobre PGlite
// (Postgres compilado a WebAssembly) y lanza los tests SQL del repositorio.
//
//   npm i --no-save @electric-sql/pglite --prefix /ruta/a/una/carpeta/vacia     (una sola vez)
//   PGLITE_DIR=/ruta/a/una/carpeta/vacia node scripts/commissions/pglite-sql-tests.mjs
//
// Qué hace, en orden:
//   1. Monta un esquema mínimo (scripts/commissions/pglite-bootstrap.sql).
//   2. Ejecuta TAL CUAL las dos migraciones anteriores que las nuevas modifican
//      (20260803120000 y 20261019120000), para probar los CREATE OR REPLACE contra sus
//      definiciones reales.
//   3. Inserta reservas «antiguas» y ejecuta las tres migraciones nuevas: comprueba que el relleno
//      de relaciones cliente↔profesional clasifica bien lo que ya existía.
//   4. Repite las tres migraciones (deben ser repetibles).
//   5. Lanza supabase/tests/commission_settings.test.sql y, de regresión,
//      supabase/tests/fee_waiver.test.sql.
//   6. Comprueba permisos de verdad (SET ROLE anon / authenticated / service_role).
//   7. Compara la cuenta en céntimos de la base de datos con una referencia independiente en BigInt
//      (miles de importes y porcentajes) y con el redondeo del código antiguo (12,5 %).
//   8. Ejecuta generate_maintenance_proposals() de punta a punta.
//
// Docker no hace falta, pero esto NO sustituye a la prueba en el entorno real de Supabase: es la
// misma base de datos (Postgres), no el mismo servidor.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pgliteDir = process.env.PGLITE_DIR;
if (!pgliteDir) {
  console.error('Define PGLITE_DIR con la carpeta donde instalaste @electric-sql/pglite (ver la cabecera de este archivo).');
  process.exit(2);
}
const { PGlite } = createRequire(path.join(pgliteDir, 'noop.js'))('@electric-sql/pglite');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const MIGRATIONS_BEFORE = [
  'supabase/migrations/20260803120000_booking_management_fee_ssot.sql',
  'supabase/migrations/20261019120000_own_clients_fee_waiver.sql',
];
const MIGRATIONS_NEW = [
  'supabase/migrations/20261102130000_commission_settings.sql',
  'supabase/migrations/20261102140000_commission_engine.sql',
  'supabase/migrations/20261102150000_commission_bookings_and_plans.sql',
];

let failures = 0;
const ok = (message) => console.log(`✅ ${message}`);
const fail = (message, detail) => {
  failures += 1;
  console.log(`❌ ${message}${detail ? `\n     ${String(detail).split('\n').join('\n     ')}` : ''}`);
};
const check = (condition, message, detail) => (condition ? ok(message) : fail(message, detail));

const db = new PGlite();
const run = async (label, sql) => {
  try {
    await db.exec(sql);
    ok(label);
    return true;
  } catch (error) {
    fail(label, error?.message || error);
    return false;
  }
};
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const expectError = async (label, sql, pattern) => {
  try {
    await db.exec(sql);
    fail(`${label}: debería haber fallado y no lo hizo`);
  } catch (error) {
    const message = String(error?.message || error);
    check(!pattern || pattern.test(message), `${label} (rechazado)`, message);
  }
};

// Las funciones se crean con check_function_bodies = off para no necesitar todo el esquema de producción.
await db.exec('SET check_function_bodies = off');

// ── 1-2) Esquema mínimo y migraciones anteriores ─────────────────────────────────────────
if (!(await run('esquema mínimo', read('scripts/commissions/pglite-bootstrap.sql')))) process.exit(1);
for (const migration of MIGRATIONS_BEFORE) {
  if (!(await run(`migración anterior: ${path.basename(migration)}`, read(migration)))) process.exit(1);
}

// ── 3) Datos «antiguos», antes de las migraciones nuevas ─────────────────────────────────
const U = (n) => `00000000-0b01-4b01-8fff-${String(n).padStart(12, '0')}`;
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${U(1)}', 'old.u1@test.local'), ('${U(2)}', 'old.u2@test.local'), ('${U(3)}', 'old.u3@test.local'),
    ('${U(11)}', 'old.p1@test.local'), ('${U(12)}', 'old.p2@test.local');
  INSERT INTO public.bookings (id, client_id, gardener_id, date, start_time, status, total_price, management_fee, management_fee_source, created_at) VALUES
    -- u1 con p1: la primera fue por el enlace (exenta); la segunda ya pagó comisión → origen «enlace»
    ('${U(101)}', '${U(1)}', '${U(11)}', '2026-10-01', '09:00', 'completed', 100, 0,    'waived_provider_link', '2026-10-01 10:00+00'),
    ('${U(102)}', '${U(1)}', '${U(11)}', '2026-10-10', '09:00', 'completed', 100, 12.5, 'payment_attempt',      '2026-10-10 10:00+00'),
    -- u2 con p1: la primera pagó comisión; la segunda fue por el enlace → manda la PRIMERA: «GarSer»
    ('${U(103)}', '${U(2)}', '${U(11)}', '2026-10-02', '09:00', 'completed', 100, 12.5, 'payment_attempt',      '2026-10-02 10:00+00'),
    ('${U(104)}', '${U(2)}', '${U(11)}', '2026-10-12', '09:00', 'pending',   100, 0,    'waived_provider_link', '2026-10-12 10:00+00'),
    -- u3 con p2: sin dato fiable → «GarSer»
    ('${U(105)}', '${U(3)}', '${U(12)}', '2026-10-03', '09:00', 'cancelled', 100, 0,    'unknown',              '2026-10-03 10:00+00');
  INSERT INTO public.bookings (id, client_id, gardener_id, date, start_time, status, total_price, management_fee, management_fee_source)
  VALUES ('${U(106)}', NULL, '${U(12)}', '2026-10-04', '09:00', 'completed', 100, 12.5, 'payment_attempt');
`);
ok('reservas antiguas insertadas (5 con cliente + 1 sin cliente)');
const before = await one(`SELECT count(*)::int AS n, sum(management_fee)::numeric AS fee FROM public.bookings`);

// Las migraciones NUEVAS se ejecutan con la validación de cuerpos de función ACTIVADA (como hace
// `supabase db push`): una columna que no existe o un error de sintaxis dentro de un plpgsql falla
// ya al crear la función, no cuando alguien la llama por primera vez.
await db.exec('SET check_function_bodies = on');
for (const migration of MIGRATIONS_NEW) {
  if (!(await run(`migración nueva (con validación de cuerpos): ${path.basename(migration)}`, read(migration)))) process.exit(1);
}

const relationships = await rows(`
  SELECT client_id, provider_id, origin, first_booking_id, source FROM public.client_provider_relationships
  ORDER BY client_id, provider_id`);
check(relationships.length === 3, 'relleno: 3 relaciones (la reserva sin cliente no genera ninguna)', JSON.stringify(relationships));
const rel = (c, p) => relationships.find((r) => r.client_id === U(c) && r.provider_id === U(p));
check(rel(1, 11)?.origin === 'provider_link' && rel(1, 11)?.first_booking_id === U(101), 'relleno: u1+p1 = enlace (su primera reserva fue por el enlace)');
check(rel(2, 11)?.origin === 'garser' && rel(2, 11)?.first_booking_id === U(103), 'relleno: u2+p1 = GarSer (manda la primera reserva, no la segunda)');
check(rel(3, 12)?.origin === 'garser', 'relleno: u3+p2 = GarSer (sin dato fiable)');
check(relationships.every((r) => r.source === 'backfill'), 'relleno: todas marcadas como backfill');
const after = await one(`SELECT count(*)::int AS n, sum(management_fee)::numeric AS fee,
  count(*) FILTER (WHERE commission_rule IS NOT NULL)::int AS with_snapshot FROM public.bookings`);
check(after.n === before.n && Number(after.fee) === Number(before.fee) && after.with_snapshot === 0,
  'las reservas existentes no cambian (mismo número, mismas comisiones, sin instantánea inventada)', JSON.stringify({ before, after }));

// ── 4) Repetibles ────────────────────────────────────────────────────────────────────────
await db.exec(`UPDATE public.commission_settings SET rate_garser_first = 11 WHERE id = 1`); // un valor del admin que NO debe pisarse
const versionBefore = (await one('SELECT version FROM public.commission_settings WHERE id = 1')).version;
let repeated = true;
for (const migration of MIGRATIONS_NEW) repeated = (await run(`migración repetida: ${path.basename(migration)}`, read(migration))) && repeated;
const kept = await one('SELECT version, rate_garser_first FROM public.commission_settings WHERE id = 1');
check(repeated && Number(kept.rate_garser_first) === 11 && kept.version === versionBefore,
  'repetir las migraciones no pisa la configuración del administrador ni sube la versión', JSON.stringify(kept));
check((await one('SELECT count(*)::int AS n FROM public.client_provider_relationships')).n === 3, 'repetir las migraciones no duplica relaciones');
await db.exec(`UPDATE public.commission_settings SET rate_garser_first = 12.5 WHERE id = 1`);

// ── 5) Tests SQL del repositorio ─────────────────────────────────────────────────────────
for (const file of ['supabase/tests/commission_settings.test.sql', 'supabase/tests/fee_waiver.test.sql']) {
  const passed = await run(`test SQL ${path.basename(file)}`, read(file));
  // Un test que falla deja la transacción abierta y abortada: se limpia para que no arrastre al siguiente.
  if (!passed) await db.exec('ROLLBACK').catch(() => {});
}
// Cada test hace ROLLBACK de lo suyo: el estado vuelve a ser el de después de las migraciones.

// ── 6) Permisos de verdad (los tests SQL usan has_*_privilege; aquí se cambia de rol) ─────
const ADMIN = U(901);
const NOADMIN = U(902);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'perm.admin@test.local'), ('${NOADMIN}', 'perm.user@test.local');
  UPDATE public.profiles SET role = 'admin' WHERE user_id = '${ADMIN}';`);
const asRole = (role, user) => `RESET ROLE; SELECT set_config('request.jwt.claims', ${user ? `json_build_object('sub','${user}')::text` : 'NULL'}, false); SET ROLE ${role};`;
await expectError('anon no lee la configuración', `${asRole('anon')} SELECT * FROM public.commission_settings;`, /permission denied/i);
await expectError('authenticated no lee la configuración', `${asRole('authenticated', NOADMIN)} SELECT * FROM public.commission_settings;`, /permission denied/i);
await expectError('authenticated no escribe la configuración', `${asRole('authenticated', ADMIN)} UPDATE public.commission_settings SET rate_garser_first = 0;`, /permission denied/i);
await expectError('authenticated (incluso admin) no lee el historial', `${asRole('authenticated', ADMIN)} SELECT * FROM public.commission_settings_history;`, /permission denied/i);
await expectError('anon no puede llamar a la RPC de lectura', `${asRole('anon')} SELECT public.get_commission_settings();`, /permission denied/i);
await expectError('un usuario NO admin no puede leer por la RPC', `${asRole('authenticated', NOADMIN)} SELECT public.get_commission_settings();`, /Acceso denegado/);
await expectError('un usuario NO admin no puede guardar por la RPC', `${asRole('authenticated', NOADMIN)} SELECT public.save_commission_settings(1, '{"garser_first":0,"link_first":0,"garser_repeat":0,"maintenance_visit":0,"link_repeat":0}'::jsonb);`, /Acceso denegado/);
await expectError('authenticated no puede calcular comisiones (función del servidor)', `${asRole('authenticated', ADMIN)} SELECT public.resolve_booking_commission(NULL, NULL, NULL);`, /permission denied/i);
await expectError('authenticated no puede firmar economías', `${asRole('authenticated', ADMIN)} SELECT public.quote_commission_economics('{}'::jsonb, NULL, NULL, NULL);`, /permission denied/i);
await expectError('authenticated no puede usar la regla antigua', `${asRole('authenticated', ADMIN)} SELECT public.management_fee_waiver_reason(NULL, NULL, NULL);`, /permission denied/i);
try {
  await db.exec(asRole('authenticated', ADMIN));
  const got = await one('SELECT public.get_commission_settings() AS s');
  check(got.s.version >= 1 && got.s.rates.garser_first !== undefined, 'un admin real lee la configuración por la RPC (rol authenticated)');
  const saved = await one(`SELECT public.save_commission_settings(${got.s.version}, '{"garser_first":13,"link_first":0,"garser_repeat":3,"maintenance_visit":3,"link_repeat":0}'::jsonb) AS r`);
  check(saved.r.ok === true && saved.r.settings.rates.garser_first === 13, 'un admin real guarda por la RPC (rol authenticated)', JSON.stringify(saved.r));
  const audit = await one('SELECT public.list_commission_audit(3) AS a');
  check(Array.isArray(audit.a) && audit.a[0]?.outcome === 'saved' && audit.a[0]?.actorId === ADMIN, 'la auditoría registra al admin que guardó', JSON.stringify(audit.a?.[0]));
} catch (error) {
  fail('flujo de un administrador real', error?.message || error);
}
await db.exec(`RESET ROLE; UPDATE public.commission_settings SET rate_garser_first = 12.5 WHERE id = 1;`);
try {
  await db.exec(asRole('service_role'));
  const r = await one(`SELECT public.resolve_booking_commission('${U(1)}', '${U(11)}', NULL) AS r`);
  check(r.r.rule === 'garser_repeat' || r.r.rule === 'link_repeat', 'service_role puede resolver la comisión', JSON.stringify(r.r));
  const e = await one(`SELECT public.quote_commission_economics('{"serviceGrossTotal":100,"lines":[],"payableLater":100}'::jsonb, '${U(2)}', '${U(11)}', NULL) AS e`);
  check(Number(e.e.managementFee) > 0, 'service_role puede firmar una economía', JSON.stringify(e.e));
} catch (error) {
  fail('flujo de service_role', error?.message || error);
}
await db.exec('RESET ROLE');

// ── 7) La cuenta en céntimos contra una referencia independiente ─────────────────────────
// Referencia: BigInt puro. redondeo a la mitad hacia arriba = floor((2·x + d) / (2·d)).
const refFeeCents = (baseCents, bps) => {
  if (baseCents <= 0n) return 0n;
  if (bps === 0n) return 0n;
  const calc = (2n * baseCents * bps + 10000n) / 20000n;
  return calc < 50n ? 50n : calc;
};
const cases = [];
const bpsList = [0, 1, 25, 100, 150, 250, 300, 1250, 3333, 5000, 9999, 10000];
for (const bps of bpsList) for (const cents of [1, 9, 10, 49, 50, 99, 100, 999, 1000, 1500, 1666, 1667, 1668, 3333, 4100, 10004, 15800, 99999, 123456, 1000000]) cases.push({ cents, bps });
let seed = 123456789;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 6000; i += 1) cases.push({ cents: 1 + Math.floor(rnd() * 500000), bps: Math.floor(rnd() * 10001) });
const sqlResult = await rows(`
  SELECT t.cents, t.bps,
    round(((public.apply_commission_to_economics(
      jsonb_build_object('serviceGrossTotal', t.cents / 100.0, 'lines', '[]'::jsonb, 'payableLater', t.cents / 100.0),
      jsonb_build_object('rule', 'garser_first', 'rateBps', t.bps, 'configVersion', 1, 'origin', 'garser')
    ) ->> 'managementFee')::numeric) * 100)::bigint AS fee
  FROM jsonb_to_recordset($1::jsonb) AS t(cents bigint, bps int)`, [JSON.stringify(cases)]);
const bad = sqlResult.filter((row) => BigInt(row.fee) !== refFeeCents(BigInt(row.cents), BigInt(row.bps)));
check(sqlResult.length === cases.length && bad.length === 0,
  `cuenta en céntimos: ${cases.length} importes × porcentajes coinciden con la referencia independiente`,
  JSON.stringify(bad.slice(0, 5)));

// Paridad con el 12,5 % que cobraba el código antiguo (coma flotante de JS: Math.round((x + EPSILON) * 100) / 100).
// El motor de precios entrega SIEMPRE euros enteros (applyMinimumPrice → Math.ceil, y la suma de varios
// servicios es suma de enteros), así que la base de la comisión es un entero: ahí el código antiguo era
// exacto y NO debe cambiar ni un céntimo. Con importes con céntimos (que el motor no produce) el
// código antiguo arrastraba el error de la coma flotante en los empates de medio céntimo; el cálculo
// nuevo es exacto. Se mide y se informa, pero no es un fallo.
const oldRound = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const parityRows = await rows(`
  SELECT c AS cents, (public.apply_commission_to_economics(
      jsonb_build_object('serviceGrossTotal', c / 100.0, 'lines', '[]'::jsonb, 'payableLater', c / 100.0),
      jsonb_build_object('rule', 'garser_first', 'rateBps', 1250, 'configVersion', 1, 'origin', 'garser')
    ) ->> 'managementFee')::numeric AS fee
  FROM generate_series(1, 500000) AS c`);
const differsFromOld = (row) => {
  const gross = row.cents / 100;
  const oldFee = oldRound(gross * 0.125);
  const newFee = Number(row.fee);
  // El código antiguo no tenía suelo de 0,50 €; donde el suelo aplica, la diferencia es la decisión del dueño.
  return oldFee < 0.5 ? newFee !== 0.5 : Math.abs(newFee - oldFee) > 1e-9;
};
const wholeEuros = parityRows.filter((row) => row.cents % 100 === 0);
const wholeDiffs = wholeEuros.filter(differsFromOld);
check(wholeEuros.length === 5000 && wholeDiffs.length === 0,
  `paridad con el 12,5 % antiguo: los ${wholeEuros.length} precios en euros enteros (1 € a 5.000 €) dan EXACTAMENTE el mismo importe`,
  JSON.stringify(wholeDiffs.slice(0, 5)));
const withCents = parityRows.filter((row) => row.cents % 100 !== 0);
const centsDiffs = withCents.filter(differsFromOld);
const oldUnder = centsDiffs.filter((row) => Number(row.fee) > oldRound((row.cents / 100) * 0.125)).length;
ok(`informativo: con importes con céntimos (el motor no los produce) el redondeo difiere en ${centsDiffs.length} de ${withCents.length} (${oldUnder} en las que el código antiguo cobraba 1 céntimo de menos por la coma flotante)`);

// ── 8) generate_maintenance_proposals() de punta a punta ─────────────────────────────────
try {
  const P = U(950);
  const C = U(951);
  const BOOKING = U(952);
  const QUOTE = U(953);
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${P}', 'plan.pro@test.local'), ('${C}', 'plan.cli@test.local');
    INSERT INTO public.booking_quotes (id, client_id, gardener_id, service_id, signature, pricing_version, provider_config_version,
      input_payload, pricing_snapshot, total_price, estimated_hours, status, generated_at, expires_at, selected_date, selected_start_time, economic_snapshot)
    SELECT '${QUOTE}', '${C}', '${P}', (SELECT id FROM public.services LIMIT 1), 'plan-e2e-1', 'v1', 'cfg',
      '{"x":1}'::jsonb, '{}'::jsonb, 100, 2, 'consumed', now(), now() + interval '2 hours', current_date - 3, '09:00',
      '{"serviceGrossTotal":100,"managementFee":12.5,"payableNow":12.5,"payableLater":100,"lines":[{"code":"management_fee","amount":12.5}],"stripeLineItems":[{"code":"management_fee","unitAmount":12.5,"quantity":1}]}'::jsonb;
    INSERT INTO public.bookings (id, client_id, gardener_id, service_id, date, start_time, status, total_price, pricing_context, management_fee, management_fee_source)
    SELECT '${BOOKING}', '${C}', '${P}', (SELECT id FROM public.services LIMIT 1), current_date - 3, '09:00', 'completed', 100,
      jsonb_build_object('quote_id', '${QUOTE}'), 12.5, 'payment_attempt';
    SELECT set_config('request.jwt.claims', json_build_object('sub', '${C}')::text, false);
    SELECT public.create_maintenance_plan('${BOOKING}', 'weekly');
    SELECT set_config('request.jwt.claims', NULL, false);`);
  const result = await one('SELECT public.generate_maintenance_proposals() AS r');
  check(result.r.proposed === 1, 'generate_maintenance_proposals propone la visita del plan', JSON.stringify(result.r));
  const visit = await one(`SELECT q.id, q.economic_snapshot AS e, public.maintenance_quote_is_intact(q.id) AS intact
    FROM public.booking_quotes q WHERE q.maintenance_visit_id IS NOT NULL`);
  check(visit?.e?.commission?.rule === 'maintenance_visit' && Number(visit.e.managementFee) === 3 && Number(visit.e.payableNow) === 3,
    'la visita propuesta lleva la comisión de visita de plan (3 % de 100 € = 3,00 €)', JSON.stringify(visit?.e?.commission));
  check(visit?.intact === true, 'la propuesta generada por el reloj pasa la comprobación de integridad del pago');
  const again = await one('SELECT public.generate_maintenance_proposals() AS r');
  check(again.r.proposed === 0, 'ejecutar el reloj otra vez no duplica la propuesta', JSON.stringify(again.r));
} catch (error) {
  fail('generate_maintenance_proposals de punta a punta', error?.message || error);
}

console.log(failures === 0 ? '\n✅ TODO CORRECTO' : `\n❌ ${failures} comprobación(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
