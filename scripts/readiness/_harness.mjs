/**
 * Harness de pruebas de preparación para producción — GarSer.
 *
 * Habla con `booking-authority` en el entorno local. La acción `recalculate_correction`
 * devuelve precio y horas sin sesión, sin fecha y sin hueco, así que sirve para medir el
 * motor de forma aislada y repetible: es el instrumento del barrido de variables.
 *
 * Copiar a `scripts/readiness/_harness.mjs` del repo y escribir un runner por servicio
 * que lo importe. Vive en el repo, no en la skill, para que el runner siga funcionando
 * cuando la skill no esté delante.
 *
 * Uso:
 *   import { quote, expectQuote, sweep, report } from './_harness.mjs'
 *   node scripts/readiness/cesped.mjs
 *
 * CLI de apoyo:
 *   node scripts/readiness/_harness.mjs services   → ids y config de los 7 servicios
 */

import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------

let cachedEnv = null;

/**
 * Las claves locales cambian si se recrea el proyecto, así que se leen de
 * `supabase status` en vez de estar escritas aquí: un harness con claves fijas falla con
 * un 401 desconcertante meses después.
 */
export function env() {
  if (cachedEnv) return cachedEnv;
  // `supabase status` se resuelve contra el directorio del proyecto. Al ejecutar el
  // runner desde un git worktree, el nombre del proyecto cambia y el comando falla con
  // "No such container": por eso se admite SUPABASE_PROJECT_DIR para apuntar al checkout
  // donde se levantó el stack, y variables sueltas como último recurso.
  let status;
  try {
    const raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: process.env.SUPABASE_PROJECT_DIR || process.cwd(),
    });
    status = JSON.parse(raw);
  } catch (error) {
    if (!process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        `No se pudo leer 'supabase status' (${error.message}). Ejecuta el runner desde el ` +
        'checkout donde levantaste el stack, exporta SUPABASE_PROJECT_DIR apuntando a él, ' +
        'o define SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    const apiUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
    status = {
      API_URL: apiUrl,
      FUNCTIONS_URL: `${apiUrl}/functions/v1`,
      ANON_KEY: process.env.SUPABASE_ANON_KEY,
      SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }
  cachedEnv = {
    apiUrl: status.API_URL,
    functionsUrl: status.FUNCTIONS_URL,
    storageUrl: `${status.API_URL}/storage/v1`,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  };
  return cachedEnv;
}

export const PROVIDER_ID = '11111111-aaaa-4aaa-8aaa-111111111111';
export const CLIENT_EMAIL = 'cliente.local@test.local';
export const GARDENER_EMAIL = 'jardinero.local@test.local';
export const TEST_PASSWORD = 'Test123456!';
export const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_GarSer-main_4';

// ---------------------------------------------------------------------------
// booking-authority
// ---------------------------------------------------------------------------

/**
 * Llamada cruda. Devuelve siempre `{ ok, status, body }` en vez de lanzar, porque buena
 * parte de lo que hay que verificar son los errores: el 422 de validación manual y el
 * 403 de fuera de cobertura son resultados esperados, no accidentes.
 */
export async function authority(payload, { accessToken } = {}) {
  const { functionsUrl, anonKey } = env();
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${functionsUrl}/booking-authority`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// Motor en proceso (READINESS_ENGINE=local)
// ---------------------------------------------------------------------------

/**
 * El edge runtime local monta los ficheros del checkout desde el que se levantó el stack.
 * Al trabajar en un worktree eso significa medir *otro* código: los cambios no llegan a la
 * función hasta reiniciar Supabase desde este directorio.
 *
 * Con `READINESS_ENGINE=local` el runner llama a `buildAuthoritativeBookingQuote`
 * directamente, empaquetándolo con esbuild y leyendo la configuración del jardinero de la
 * base de datos. Sirve para iterar; **no sustituye a la prueba por HTTP**, que es la que
 * demuestra que lo desplegado cobra lo que crees. El cierre siempre es HTTP.
 */
const bundleCache = new Map();

/**
 * Empaqueta un módulo TypeScript del repo y lo importa. Sirve para afirmar sobre las SSOT
 * isomorfas (esquema de encuestas, reglas de negocio) desde el runner, sin duplicar aquí
 * unas constantes que dejarían de estar sincronizadas al primer cambio.
 */
export async function bundleModule(relativePath) {
  if (bundleCache.has(relativePath)) return bundleCache.get(relativePath);
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const outfile = `${repoRoot}node_modules/.cache/readiness-${relativePath.replace(/[^a-z0-9]/gi, '-')}.mjs`;
  await build({
    entryPoints: [`${repoRoot}${relativePath}`],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  const mod = await import(`${outfile}?t=${Date.now()}`);
  bundleCache.set(relativePath, mod);
  return mod;
}

let cachedEngine = null;
let cachedProviderConfig = new Map();

async function localEngine() {
  if (cachedEngine) return cachedEngine;
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  // fileURLToPath y no `.pathname`: la ruta del repo lleva un espacio y esbuild recibiría
  // el %20 sin decodificar.
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const outfile = `${repoRoot}node_modules/.cache/readiness-engine.mjs`;
  await build({
    entryPoints: [`${repoRoot}src/shared/bookingQuoteCore.ts`],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  cachedEngine = await import(`${outfile}?t=${Date.now()}`);
  return cachedEngine;
}

function providerConfigFor(serviceId, providerId) {
  const key = `${serviceId}|${providerId}`;
  if (cachedProviderConfig.has(key)) return cachedProviderConfig.get(key);
  const raw = sql(
    `select coalesce(additional_config::text, 'null') from public.gardener_service_prices
      where service_id = '${serviceId}' and gardener_id = '${providerId}' and active;`,
  );
  const parsed = raw ? JSON.parse(raw) : null;
  cachedProviderConfig.set(key, parsed);
  return parsed;
}

/** Reinicia la caché de configuración (tras restaurar el fixture o guardar en el panel). */
export function resetProviderConfigCache() {
  cachedProviderConfig = new Map();
}

async function quoteLocal(serviceId, bookingInput, providerId) {
  const engine = await localEngine();
  const providerConfig = providerConfigFor(serviceId, providerId);
  if (!providerConfig) {
    return { ok: false, status: 409, body: { code: 'missing_provider_config' }, code: 'missing_provider_config' };
  }
  const result = engine.buildAuthoritativeBookingQuote({ bookingData: bookingInput, providerConfig });
  if (!result.eligibility?.isEligible) {
    return {
      ok: false,
      status: 422,
      body: { code: result.eligibility?.code || 'recalculation_ineligible', ...result },
      code: result.eligibility?.code || 'recalculation_ineligible',
    };
  }
  return { ok: true, status: 200, body: result, ...result, code: undefined };
}

/**
 * Precio y horas de un `bookingInput`. El caballo de batalla del runner.
 */
export async function quote(serviceId, bookingInput, { providerId = PROVIDER_ID } = {}) {
  if (process.env.READINESS_ENGINE === 'local') return quoteLocal(serviceId, bookingInput, providerId);
  const res = await authority({
    action: 'recalculate_correction',
    serviceId,
    providerId,
    bookingInput,
  });
  return {
    ...res,
    totalPrice: res.body?.totalPrice,
    estimatedHours: res.body?.estimatedHours,
    code: res.body?.code,
    economics: res.body?.economics,
    warnings: res.body?.warnings || [],
  };
}

export async function previewProviders(serviceId, bookingInput, opts = {}) {
  return authority({
    action: 'preview_providers',
    serviceId,
    providerIds: opts.providerIds || [PROVIDER_ID],
    selectedDate: opts.selectedDate,
    windowDays: opts.windowDays ?? 14,
    bookingInput,
  });
}

export async function validHours(serviceId, date, bookingInput, opts = {}) {
  return authority({
    action: 'valid_hours',
    serviceId,
    providerId: opts.providerId || PROVIDER_ID,
    date,
    bookingInput,
  });
}

export async function createQuote(serviceId, bookingInput, { date, startTime, accessToken, providerId = PROVIDER_ID }) {
  return authority(
    { action: 'create_quote', serviceId, providerId, date, startTime, bookingInput },
    { accessToken },
  );
}

/** JWT de una cuenta sembrada. Solo hace falta para `create_quote`. */
export async function signIn(email = CLIENT_EMAIL, password = TEST_PASSWORD) {
  const { apiUrl, anonKey } = env();
  const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Login fallido (${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Aserciones
// ---------------------------------------------------------------------------

const results = [];

const money = (n) => (typeof n === 'number' ? `${n.toFixed(2)} €` : String(n));
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

function record(status, label, detail) {
  results.push({ status, label, detail });
  const icon = status === 'PASA' ? '✓' : status === 'FALLA' ? '✗' : '·';
  console.log(`${icon} ${status.padEnd(10)} ${label}${detail ? `\n             ${detail}` : ''}`);
}

export function pass(label, detail) { record('PASA', label, detail); }
export function fail(label, detail) { record('FALLA', label, detail); }
export function untested(label, detail) { record('NO PROBADO', label, detail); }

/**
 * Compara un presupuesto contra la predicción de la Fase 1.
 *
 * Imprime esperado vs. obtenido en cada fallo porque un runner que solo dice "falla" te
 * obliga a reproducir la llamada a mano para saber por cuánto.
 */
export function expectQuote(label, res, { totalPrice, estimatedHours, tolEur = 0.005, tolHours = 0.005 }) {
  if (!res.ok) {
    fail(label, `respuesta ${res.status} ${res.code || ''} — ${JSON.stringify(res.body).slice(0, 300)}`);
    return false;
  }
  const okPrice = totalPrice === undefined || near(res.totalPrice, totalPrice, tolEur);
  const okHours = estimatedHours === undefined || near(res.estimatedHours, estimatedHours, tolHours);
  if (okPrice && okHours) {
    pass(label, `${money(res.totalPrice)} · ${res.estimatedHours} h`);
    return true;
  }
  const parts = [];
  if (!okPrice) parts.push(`precio esperado ${money(totalPrice)}, obtenido ${money(res.totalPrice)}`);
  if (!okHours) parts.push(`horas esperadas ${estimatedHours}, obtenidas ${res.estimatedHours}`);
  fail(label, parts.join(' · '));
  return false;
}

/** Verifica que una llamada falla con el código esperado (422 de validación, 403, …). */
export function expectError(label, res, { status, code }) {
  const okStatus = status === undefined || res.status === status;
  const okCode = code === undefined || res.code === code || res.body?.code === code;
  if (okStatus && okCode) {
    pass(label, `${res.status} ${res.body?.code || ''}`);
    return true;
  }
  fail(label, `esperado ${status || ''} ${code || ''}, obtenido ${res.status} ${res.body?.code || ''}`);
  return false;
}

/**
 * Barrido de variables: para cada variante, mide el delta contra el caso base y lo compara
 * con lo que dice la configuración del jardinero.
 *
 * Dos avisos que cuestan una tarde de depuración si se ignoran:
 *  · Omitir un flag booleano NO es ponerlo a false. Sin `wasteRemoval` el motor cobra la
 *    retirada igual que con `true`. Declara siempre el valor en base y en variante.
 *  · Si una variante deja el precio en 0, la función devuelve 422 en vez de 0. Parte de un
 *    caso base con precio holgado y lejos del mínimo, o los deltas salen aplastados.
 *
 * @param variants Array de { key, input, expectedDelta } donde `expectedDelta` es
 *                 { pct: 20 } | { eur: 18 } | { factor: 1.15 }.
 */
export async function sweep(serviceId, baseInput, variants, opts = {}) {
  const base = await quote(serviceId, baseInput, opts);
  if (!base.ok) {
    fail('barrido: caso base', `el base no cotiza (${base.status} ${base.code || ''}) — sin base no hay deltas`);
    return [];
  }
  console.log(`\n  base: ${money(base.totalPrice)} · ${base.estimatedHours} h\n`);

  const rows = [];
  for (const variant of variants) {
    const res = await quote(serviceId, variant.input, opts);
    if (!res.ok) {
      fail(`barrido ${variant.key}`, `${res.status} ${res.code || ''}`);
      rows.push({ key: variant.key, expected: variant.expectedDelta, observed: null, verdict: 'FALLA' });
      continue;
    }

    const observedEur = res.totalPrice - base.totalPrice;
    const observedPct = base.totalPrice === 0 ? null : (observedEur / base.totalPrice) * 100;
    const d = variant.expectedDelta || {};
    let expectedEur;
    if (d.eur !== undefined) expectedEur = d.eur;
    else if (d.pct !== undefined) expectedEur = base.totalPrice * (d.pct / 100);
    else if (d.factor !== undefined) expectedEur = base.totalPrice * (d.factor - 1);

    const ok = expectedEur === undefined || near(observedEur, expectedEur, 0.02);
    const label = `barrido ${variant.key}`;
    const detail = `delta esperado ${money(expectedEur)}${d.pct !== undefined ? ` (${d.pct} %)` : ''}, observado ${money(observedEur)}${observedPct !== null ? ` (${observedPct.toFixed(1)} %)` : ''}`;

    if (ok) pass(label, detail);
    else if (Math.abs(observedEur) < 0.005) fail(label, `${detail} — la clave NO mueve el precio: o no llega al motor, o el flujo nunca la produce`);
    else fail(label, detail);

    rows.push({
      key: variant.key,
      expected: expectedEur,
      observed: observedEur,
      verdict: ok ? 'PASA' : 'FALLA',
    });
  }
  return rows;
}

/**
 * Resumen final. Sale con código 1 si algo falla, para que el runner sirva de red de
 * regresión en CI o en un `npm test` y no solo como informe para leer.
 */
export function report() {
  const passed = results.filter((r) => r.status === 'PASA').length;
  const failed = results.filter((r) => r.status === 'FALLA').length;
  const skipped = results.filter((r) => r.status === 'NO PROBADO').length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${passed} PASA · ${failed} FALLA · ${skipped} NO PROBADO`);
  if (failed > 0) {
    console.log('\n  Fallos:');
    results.filter((r) => r.status === 'FALLA').forEach((r) => console.log(`    ✗ ${r.label} — ${r.detail}`));
  }
  console.log(`${'─'.repeat(70)}\n`);
  process.exitCode = failed > 0 ? 1 : 0;
  return { passed, failed, skipped, results };
}

// ---------------------------------------------------------------------------
// CLI de apoyo
// ---------------------------------------------------------------------------

export function sql(query) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-F', '|', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Fase 0 (2026-09-13): próxima fecha con jornada laborable sembrada COMPLETA para el
 * jardinero, buscada en la BD en vez de asumida con un offset fijo.
 *
 * Varios runners usaban `inDaysIso(7)`/`inDaysIso(10)` para decir "un día laborable
 * cualquiera con huecos" — pero cuál es un fijo relativo a HOY, y el fixture solo siembra
 * L-V con jornada completa (10 bloques) y sábado a medias (5): en cuanto la fecha real de
 * ejecución cambia, ese offset puede caer en fin de semana y el runner falla sin que el
 * motor tenga ninguna culpa (`valid_hours laborable`, `validHours=[]`). Aquí se pregunta a
 * la BD cuál es, en vez de suponerlo.
 */
export function nextOpenWeekdayIso(minBlocks = 10, gardenerId = PROVIDER_ID) {
  const row = sql(`
    select date::text from public.availability
    where gardener_id = '${gardenerId}'
      and date > current_date
      and date <= current_date + 30
    group by date
    having count(*) filter (where is_available) >= ${minBlocks}
    order by date asc
    limit 1;
  `);
  if (!row) {
    throw new Error(
      `No hay ningún día con ${minBlocks}+ bloques libres sembrados para ${gardenerId} en los próximos 30 días.`
    );
  }
  return row.trim();
}

if (process.argv[2] === 'services') {
  const rows = sql('select id, name from public.services order by name;');
  console.log('\nServicios:\n');
  rows.split('\n').forEach((row) => {
    const [id, name] = row.split('|');
    console.log(`  ${name.padEnd(30)} ${id}`);
  });
  console.log('\nConfiguración del jardinero sembrado:\n');
  console.log(sql(`select s.name || ' → ' || coalesce(gsp.additional_config::text, 'SIN CONFIG')
                   from public.gardener_service_prices gsp
                   join public.services s on s.id = gsp.service_id
                   where gsp.gardener_id = '${PROVIDER_ID}' order by s.name;`));
}
