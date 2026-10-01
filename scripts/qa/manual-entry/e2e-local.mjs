#!/usr/bin/env node
/**
 * Pruebas de la app REAL en local — Nivel C de la puerta de prueba
 * (docs/audit/2026-09-30-formularios-manuales-ux/METODO-Y-PRUEBAS.md).
 *
 * Recorre con Playwright la reserva real (dirección → servicio → «Detalles» en modo manual →
 * «Profesionales») contra el Supabase local, con LAS MISMAS respuestas por servicio, en uno o
 * varios servidores de desarrollo (normalmente `main` en 5192 y la rama en 5191), y compara:
 *
 *   C1  pantallas del asistente: desbordamiento horizontal, errores de consola, respuestas
 *       HTTP ≥ 400 y una captura por pantalla;
 *   C2  el total que muestra cada profesional en «Profesionales» y una huella SHA-256 de lo que
 *       la reserva deja guardado para el servicio (`booking_resume_v2:*`, sin ids ni fechas);
 *   C3  los eventos `booking.manual_*` que llegan a `booking_funnel_events` (evento + stepId);
 *   C4  con `--login`, las `declared_variables` de `booking_manual_declarations`.
 *
 * No sale de local: las URLs deben ser localhost y la BD se lee con `docker exec`. Con
 * `--login` inicia sesión con el cliente de `supabase/seed.sql` (credenciales de prueba que se
 * leen de ese archivo en tiempo de ejecución; no se escriben aquí ni se imprimen).
 *
 * Uso:
 *   node scripts/qa/manual-entry/e2e-local.mjs --out DIR
 *        [--targets main=http://localhost:5192,rama=http://localhost:5191]
 *        [--services lawn,hedge] [--widths 375] [--login] [--no-shots]
 *        [--db-container supabase_db_GarSer-main_4]
 *
 * Playwright: igual que el banco (`npm_config_prefix` / `PLAYWRIGHT_BROWSERS_PATH`).
 *
 * Las respuestas de cada servicio están en `SPECS` y NO se cambian entre fases. Cuando una fase
 * cambie la interfaz, se adaptan los CONDUCTORES (`drive*`), nunca los datos introducidos.
 */
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const OUT = path.resolve(option('out', path.join(REPO, '.qa-e2e-local')));
const TARGETS = Object.fromEntries(
  option('targets', 'main=http://localhost:5192,rama=http://localhost:5191')
    .split(',')
    .map((pair) => pair.split('=')),
);
const WIDTHS = option('widths', '375').split(',').map(Number);
const ONLY_SERVICES = option('services', '').split(',').filter(Boolean);
const LOGIN = flag('login');
const SHOTS = !flag('no-shots');
const DB = option('db-container', 'supabase_db_GarSer-main_4');
const ADDRESS = option('address', 'Avenida Ricardo Soriano 12, Marbella');

for (const url of Object.values(TARGETS)) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
    throw new Error(`Solo se admiten servidores locales: ${url}`);
  }
}

/* ------------------------------------------------------------------------ */
/* Respuestas por servicio (idénticas en todos los servidores y en todas las fases) */
/* ------------------------------------------------------------------------ */

/**
 * Acciones:
 *   { num: [etiqueta, 'valor'] }     escribe en el campo numérico con esa etiqueta
 *   { pick: [grupo, opción] }        elige la opción (por su primera línea de texto)
 *   { toggle: [etiqueta, bool] }     deja el interruptor/elección sí-no en ese valor
 *   { plus: [etiqueta, n] }          pulsa n veces «Aumentar …» (stepper)
 *   'next' | 'add' | 'continue' | 'review' | 'submit'
 */
const SPECS = {
  lawn: {
    service: 'Corte de césped',
    actions: [
      { num: ['Superficie de césped', '80'] }, 'next',
      { pick: ['Estado del césped', 'Descuidado'] }, 'next',
      { toggle: ['Retirada de restos', true] }, 'review', 'submit',
    ],
  },
  hedge: {
    service: 'Poda de setos',
    actions: [
      { num: ['Longitud del seto', '14'] }, 'next',
      { num: ['Altura del seto', '2.1'] }, 'next',
      { pick: ['Caras a recortar', 'Las dos caras'] }, 'next',
      { pick: ['Estado del seto', 'Normal'] }, 'next',
      { toggle: ['Retirada de restos', true] }, 'review', 'submit',
    ],
  },
  tree: {
    service: 'Poda de árboles',
    actions: [
      { pick: ['Tamaño del árbol', 'Mediano'] }, 'next',
      { pick: ['Tipo de poda', 'Poda estructural'] }, 'next',
      { pick: ['Dificultad de acceso', 'Acceso normal'] }, 'next',
      'add',
      { pick: ['Tamaño del árbol', 'Grande'] }, 'next',
      { pick: ['Tipo de poda', 'Poda de formación'] }, 'next',
      { pick: ['Dificultad de acceso', 'Acceso difícil'] }, 'next',
      'continue',
      { toggle: ['Retirada de restos', true] }, 'review', 'submit',
    ],
  },
  palm: {
    service: 'Poda de palmeras',
    actions: [
      { pick: ['Especie', 'Phoenix canariensis'] }, 'next',
      { pick: ['Altura del tronco', '4-10 m'] }, 'next',
      { pick: ['Estado', 'Normal'] }, 'next',
      { plus: ['Número de palmeras', 1] }, 'next',
      'next',
      'add',
      { pick: ['Especie', 'Washingtonia'] }, 'next',
      { pick: ['Altura del tronco', '4-12 m'] }, 'next',
      { pick: ['Estado', 'Descuidada'] }, 'next',
      'next',
      { toggle: ['Acceso difícil', true] }, 'next',
      'continue',
      { toggle: ['Retirada de restos', false] }, 'review', 'submit',
    ],
  },
  shrub: {
    service: 'Poda de plantas y arbustos',
    actions: [
      { num: ['Superficie de plantas y arbustos', '30'] }, 'next',
      { pick: ['Tamaño dominante', 'Medianas'] }, 'next',
      { pick: ['Estado de las plantas', 'Descuidadas'] }, 'next',
      { toggle: ['Retirada de restos', true] }, 'review', 'submit',
    ],
  },
  phytosanitary: {
    service: 'Servicios fitosanitarios',
    actions: [
      { pick: ['Tipo de vegetación', 'Árboles'] }, 'next',
      { num: ['Cantidad a tratar', '3'] }, 'next',
      { pick: ['Tamaño dominante', 'Grandes'] }, 'next',
      { pick: ['Intención del tratamiento', 'Curativo'] }, 'next',
      { pick: ['Objetivo del tratamiento', 'Hongos / enfermedad'] }, 'next',
      { pick: ['Tipo de producto', 'Ecológico'] }, 'next',
      'add',
      { pick: ['Tipo de vegetación', 'Palmeras'] }, 'next',
      { num: ['Cantidad a tratar', '2'] }, 'next',
      { pick: ['Tamaño dominante', 'Medianas'] }, 'next',
      { pick: ['Intención del tratamiento', 'Preventivo'] }, 'next',
      { pick: ['Tipo de producto', 'Convencional'] }, 'next',
      { toggle: ['Añadir endoterapia (inyección en tronco)', true] }, 'next',
      'continue', 'submit',
    ],
  },
  weeding: {
    service: 'Desbroce de malas hierbas',
    actions: [
      { num: ['Superficie a desbrozar', '300'] }, 'next',
      { pick: ['Dificultad del desbroce', 'Dificultad media'] }, 'next',
      { toggle: ['Aplicar herbicida', true] }, 'next',
      { toggle: ['Retirada de restos', false] }, 'review', 'submit',
    ],
  },
};

const SERVICE_KEYS = Object.keys(SPECS).filter((key) => !ONLY_SERVICES.length || ONLY_SERVICES.includes(key));

/* ------------------------------------------------------------------------ */
/* Utilidades                                                                */
/* ------------------------------------------------------------------------ */

function loadPlaywright() {
  const attempts = [path.join(REPO, 'package.json')];
  try {
    attempts.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'));
  } catch {
    // sin npm global
  }
  for (const from of attempts) {
    try {
      return createRequire(from)('playwright');
    } catch {
      // siguiente
    }
  }
  throw new Error('No se encuentra Playwright (ver scripts/qa/manual-entry/README.md).');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function psql(sql) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();
}

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

/** Quita lo que cambia en cada ejecución (ids, fechas, marcas de tiempo) antes de la huella. */
const VOLATILE_KEY = /(^id$|Id$|_id$|^id_|At$|_at$|timestamp|Timestamp|^created|^updated|expires|legalTextHash|acceptedAt)/;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !VOLATILE_KEY.test(key))
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);

const COLLECTIONS = ['lawnZones', 'hedgeZones', 'treeGroups', 'palmGroups', 'shrubGroups', 'phytosanitaryZones', 'weedingZones'];

/* ------------------------------------------------------------------------ */
/* Conductores de la interfaz (se adaptan cuando una fase cambia la interfaz)  */
/* ------------------------------------------------------------------------ */

const MODE_CHOOSER = ['Con fotos', 'Escribo los datos'];

async function clickButton(page, names) {
  for (const name of names) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count()) {
      const target = button.last();
      if (await target.isVisible()) {
        await target.click();
        return name;
      }
    }
  }
  for (const name of names) {
    const button = page.getByRole('button').filter({ hasText: name });
    if (await button.count()) {
      await button.last().click();
      return name;
    }
  }
  throw new Error(`No encuentro el botón ${names.join(' / ')}`);
}

async function drivePick(page, group, option) {
  const clicked = await page.evaluate(
    ({ group, option, skip }) => {
      const firstLine = (el) => (el.innerText || el.textContent || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
      const matches = (el) => {
        const line = firstLine(el);
        return line === option || line.startsWith(`${option} `) || line.startsWith(`${option}(`) || line.startsWith(`${option},`);
      };
      const groups = [...document.querySelectorAll('[role=radiogroup]')].filter(
        (g) => g.getAttribute('aria-label') === group,
      );
      const scopes = groups.length ? groups : [document];
      for (const scope of scopes) {
        const radio = [...scope.querySelectorAll('[role=radio]')].find(
          (el) => el.offsetParent !== null && !skip.includes(firstLine(el)) && matches(el),
        );
        if (radio) {
          radio.click();
          return true;
        }
      }
      return false;
    },
    { group, option, skip: MODE_CHOOSER },
  );
  if (!clicked) throw new Error(`No encuentro la opción «${option}» de «${group}»`);
}

async function driveNumber(page, label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.first().fill(value);
  await field.first().blur();
}

async function driveToggle(page, label, wanted) {
  const toggle = page.getByRole('switch', { name: label, exact: true });
  if (await toggle.count()) {
    const checked = (await toggle.first().getAttribute('aria-checked')) === 'true';
    if (checked !== wanted) await toggle.first().click();
    return;
  }
  // Elección sí/no explícita (fases posteriores): se delega en el conductor de opciones.
  await drivePick(page, label, wanted ? 'Sí' : 'No');
}

async function drivePlus(page, label, times) {
  const button = page.getByRole('button', { name: `Aumentar ${label.toLowerCase()}` });
  for (let i = 0; i < times; i += 1) await button.first().click();
}

async function driveSubmit(page) {
  const checkbox = page.getByRole('checkbox');
  if (await checkbox.count()) {
    if (!(await checkbox.first().isChecked())) await checkbox.first().check();
  }
  await clickButton(page, ['Confirmar y continuar']);
}

const ACTION_BUTTONS = {
  next: ['Siguiente', 'Revisar mis datos'],
  add: ['Añadir otro árbol', 'Añadir palmeras de otro tipo', 'Añadir otra zona a tratar', 'Añadir otro'],
  continue: ['Continuar'],
  review: ['Revisar mis datos'],
};

/** ¿La respuesta `action` se contesta en la pantalla que hay ahora? */
async function nextAnswerOnThisScreen(page, action) {
  if (!action || typeof action === 'string') return false;
  if (action.num) return (await page.getByLabel(action.num[0], { exact: true }).count()) > 0;
  if (action.plus) return (await page.getByRole('button', { name: `Aumentar ${action.plus[0].toLowerCase()}` }).count()) > 0;
  if (action.toggle) return (await page.getByRole('switch', { name: action.toggle[0], exact: true }).count()) > 0;
  if (action.pick) {
    return page.evaluate((group) => [...document.querySelectorAll('[role=radiogroup]')].some((g) => g.getAttribute('aria-label') === group), action.pick[0]);
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Recorrido de un servicio                                                  */
/* ------------------------------------------------------------------------ */

async function wizardScreenInfo(page) {
  return page.evaluate(() => ({
    title: document.querySelector('main h3, main h2')?.textContent?.trim() || '',
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
}

async function runService({ browser, targetName, baseUrl, width, key, session }) {
  const spec = SPECS[key];
  const dir = path.join(OUT, targetName, `${key}-${width}`);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 812 : 900 }, locale: 'es-ES' });
  if (session) {
    await context.addInitScript(
      ({ storageKey, value }) => window.localStorage.setItem(storageKey, value),
      { storageKey: 'sb-127-auth-token', value: JSON.stringify(session) },
    );
  }
  const page = await context.newPage();
  const consoleErrors = [];
  const httpErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));
  page.on('response', (res) => { if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url().slice(0, 160)}`); });

  const t0 = psql('select now()');
  const screens = [];
  let error = null;
  try {
    await page.goto(`${baseUrl}/reservar`, { waitUntil: 'networkidle' });
    // El autocompletado depende de Google Maps, que a veces tarda en cargar («Cargando servicio de
    // direcciones…»): se espera más y, si no aparece la sugerencia, se vuelve a escribir.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByPlaceholder(/Buscar dirección/).fill('');
      await page.getByPlaceholder(/Buscar dirección/).fill(ADDRESS);
      try {
        await page.getByText('Marbella, España').first().click({ timeout: 20000 });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    await clickButton(page, ['Continuar a servicios']);
    await page.getByRole('button', { name: `Seleccionar ${spec.service}` }).click({ timeout: 15000 });
    await clickButton(page, ['Continuar a los detalles del servicio']);
    await page.waitForTimeout(800);
    const manual = page.getByRole('radio').filter({ hasText: 'Escribo los datos' });
    if (await manual.count()) await manual.first().click();
    await page.waitForTimeout(400);

    let index = 0;
    for (const [position, action] of spec.actions.entries()) {
      const info = await wizardScreenInfo(page);
      // Pantallas agrupadas (F5+): si la siguiente respuesta ya está en esta pantalla, el
      // «siguiente» que la separaba no existe en la interfaz nueva y se salta (los datos no cambian).
      if (action === 'next' && (await nextAnswerOnThisScreen(page, spec.actions[position + 1]))) {
        index += 1;
        continue;
      }
      if (typeof action === 'string') {
        if (SHOTS && (action === 'next' || action === 'submit' || action === 'review')) {
          const file = `${String(index).padStart(2, '0')}.png`;
          await page.screenshot({ path: path.join(dir, file), fullPage: true });
        }
        screens.push({ step: index, action, ...info });
        if (action === 'submit') await driveSubmit(page);
        else await clickButton(page, ACTION_BUTTONS[action]);
      } else if (action.num) await driveNumber(page, ...action.num);
      else if (action.pick) await drivePick(page, ...action.pick);
      else if (action.toggle) await driveToggle(page, ...action.toggle);
      else if (action.plus) await drivePlus(page, ...action.plus);
      index += 1;
      await page.waitForTimeout(250);
    }

    // «Profesionales»: espera a que las tarjetas tengan total o «No disponible».
    await page.waitForFunction(
      () => /Total de la reserva|No disponible|No hay profesionales/i.test(document.body.innerText),
      null,
      { timeout: 45000 },
    );
    await page.waitForTimeout(2000);
    if (SHOTS) await page.screenshot({ path: path.join(dir, 'profesionales.png'), fullPage: true });
  } catch (err) {
    error = String(err?.message || err).split('\n')[0];
    if (SHOTS) await page.screenshot({ path: path.join(dir, 'error.png'), fullPage: true }).catch(() => {});
  }

  const providers = await page.evaluate(() =>
    [...document.querySelectorAll('span.font-semibold.truncate')].map((name) => {
      const card = name.closest('button, [role=button], div.rounded-2xl, div.rounded-xl') || name.parentElement;
      const text = card?.innerText || '';
      const total = text.match(/Total de la reserva\s*([\d.,]+\s*€)/i);
      return { name: name.textContent.trim(), total: total ? total[1].replace(/\s/g, ' ') : (/No disponible/i.test(text) ? 'No disponible' : '?') };
    }),
  ).catch(() => []);
  const hours = await page
    .evaluate(() => (document.body.innerText.match(/son ([\d.,]+) h de trabajo/i) || [])[1] || null)
    .catch(() => null);

  const stored = await page.evaluate((collections) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('booking_resume_v2'));
    if (!key) return null;
    const data = JSON.parse(localStorage.getItem(key)).payload?.bookingData || {};
    const serviceId = (data.serviceIds || [])[0];
    const service = (data.servicesData || {})[serviceId] || {};
    const pickFrom = (source) => Object.fromEntries(
      [...collections, 'wasteRemoval', 'dataInputMode', 'manualDraft']
        .filter((k) => source[k] !== undefined && !(Array.isArray(source[k]) && source[k].length === 0))
        .map((k) => [k, source[k]]),
    );
    return { serviceId, service: pickFrom(service), declaredVariables: service.manualConsent?.declaredVariables ?? null };
  }, COLLECTIONS).catch(() => null);

  await sleep(1500); // la telemetría viaja por una Edge Function
  const telemetry = psql(
    `select coalesce(json_agg(json_build_object('e', event, 's', context->>'stepId', 'k', context->>'serviceKey', 't', (extract(epoch from created_at) * 1000)::bigint) order by created_at, id), '[]') ` +
      `from booking_funnel_events where created_at >= '${t0}' and event like 'booking.manual%'`,
  );
  let declarations = null;
  if (session) {
    declarations = psql(
      `select coalesce(json_agg(declared_variables order by created_at), '[]') from booking_manual_declarations where created_at >= '${t0}'`,
    );
  }

  await context.close();
  const correction = error ? null : await recalculateCorrection(stored).catch((err) => [{ error: String(err) }]);
  const result = {
    target: targetName,
    key,
    width,
    error,
    providers,
    hours,
    correction,
    fingerprint: stored ? fingerprint(stored.service) : null,
    declaredFingerprint: stored?.declaredVariables ? fingerprint(stored.declaredVariables) : null,
    telemetry: JSON.parse(telemetry || '[]'),
    declarationsFingerprint: declarations ? fingerprint(JSON.parse(declarations)) : null,
    maxOverflowX: Math.max(0, ...screens.map((s) => s.overflowX)),
    consoleErrors,
    httpErrors,
    screens,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...result, stored }, null, 2));
  return result;
}

/* ------------------------------------------------------------------------ */
/* Nivel D — corrección del jardinero con los mismos datos                     */
/* ------------------------------------------------------------------------ */

/**
 * Pide a `booking-authority` (`recalculate_correction`, sin sesión) el precio y las horas de lo
 * que la reserva dejó guardado, para cada profesional con tarifa del servicio. Es el mismo
 * camino que usa el jardinero al corregir en la visita (`BookingRequestsManager`), sin la
 * interfaz del modal (esa la cubre el banco con `gardener=1`).
 */
async function recalculateCorrection(stored) {
  if (!stored?.serviceId || !stored.service) return null;
  const env = readEnv(path.join(REPO, '.env.local'));
  const url = env.VITE_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) return null;
  const providers = psql(
    `select coalesce(string_agg(gardener_id::text, ','), '') from gardener_service_prices where service_id = '${stored.serviceId}' and active is not false`,
  ).split(',').filter(Boolean);
  const bookingInput = { ...stored.service, dataInputMode: 'manual' };
  delete bookingInput.manualDraft;
  const out = [];
  for (const providerId of providers) {
    const res = await fetch(`${url}/functions/v1/booking-authority`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recalculate_correction', serviceId: stored.serviceId, providerId, bookingInput }),
    });
    const body = await res.json().catch(() => ({}));
    out.push({ providerId, status: res.status, totalPrice: body.totalPrice ?? null, estimatedHours: body.estimatedHours ?? null, code: body.code ?? null });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Sesión de cliente sembrado (solo con --login)                              */
/* ------------------------------------------------------------------------ */

async function seededClientSession() {
  const env = readEnv(path.join(REPO, '.env.local'));
  const url = env.VITE_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error('--login solo contra el Supabase local');
  const seed = fs.readFileSync(path.join(REPO, 'supabase/seed.sql'), 'utf8');
  const match = seed.match(/Cliente:\s+(\S+@\S+)\s+\/\s+(\S+)/);
  if (!match) throw new Error('No encuentro el cliente sembrado en supabase/seed.sql');
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: match[1], password: match[2] }),
  });
  if (!res.ok) throw new Error(`Login del cliente sembrado: HTTP ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------------------ */
/* Informe                                                                   */
/* ------------------------------------------------------------------------ */

function report(results, outDir = OUT) {
  const names = Object.keys(TARGETS);
  const lines = [
    '# E2E local — app real (Nivel C)',
    '',
    `Fecha: ${new Date().toISOString()} · Servidores: ${names.map((n) => `${n}=${TARGETS[n]}`).join(', ')} · Anchos: ${WIDTHS.join(', ')} · Sesión: ${LOGIN ? 'cliente sembrado' : 'anónima'}`,
    '',
    '| Servicio | Ancho | ' + names.map((n) => `Total por profesional (${n})`).join(' | ') + ' | Huella | Telemetría | Declaración | Desborde | Consola/HTTP |',
    '|---|---|' + names.map(() => '---|').join('') + '---|---|---|---|---|',
  ];
  let allOk = true;
  for (const key of SERVICE_KEYS.filter((k) => results.some((r) => r.key === k))) {
    for (const width of WIDTHS) {
      const row = names.map((n) => results.find((r) => r.target === n && r.key === key && r.width === width));
      const fmt = (r) =>
        r?.error
          ? `ERROR: ${r.error}`
          : `${(r?.providers || []).map((p) => `${p.name}: ${p.total}`).join('; ') || '—'} · ${r?.hours ?? '?'} h` +
            ` · corrección ${(r?.correction || []).map((c) => `${c.totalPrice ?? c.code ?? c.status} € / ${c.estimatedHours ?? '?'} h`).join('; ') || '—'}`;
      const same = (pick) => row.every((r) => JSON.stringify(pick(r)) === JSON.stringify(pick(row[0])));
      const prices = same((r) => [r?.providers, r?.hours, r?.correction]);
      const fp = same((r) => r?.fingerprint);
      // Los pasos, en orden; el resto de eventos como conjunto (dos eventos del mismo instante
      // pueden llegar a la BD en cualquier orden, como «input_mode_changed» y «entry_started»).
      // Los pasos, en orden; los que llegan a la BD a la vez (< 100 ms: una pantalla que reúne
      // varios pasos los emite con un solo «Siguiente», y la Edge Function los inserta en cualquier
      // orden) se comparan como conjunto. El resto de eventos, como conjunto.
      const stepGroups = (telemetry) => {
        const groups = [];
        let last = null;
        for (const event of telemetry.filter((e) => e.s)) {
          if (last !== null && event.t !== undefined && event.t - last < 100) groups[groups.length - 1].push(event.s);
          else groups.push([event.s]);
          last = event.t ?? null;
        }
        return groups;
      };
      // Orden de referencia: el de la primera ejecución de la fila. Dentro de un grupo simultáneo
      // se ordena según la referencia, y la secuencia resultante tiene que ser la misma.
      const reference = (row[0]?.telemetry || []).filter((e) => e.s).map((e) => e.s);
      const rank = (step) => {
        const index = reference.indexOf(step);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      const telemetryKey = (r) => ({
        steps: stepGroups(r?.telemetry || []).flatMap((group) => [...group].sort((a, b) => rank(a) - rank(b))),
        events: (r?.telemetry || []).map((e) => `${e.e}|${e.s ?? ''}|${e.k ?? ''}`).sort(),
      });
      const tel = same(telemetryKey);
      const decl = same((r) => r?.declarationsFingerprint);
      const overflow = Math.max(...row.map((r) => r?.maxOverflowX ?? 0));
      const noise = row.map((r) => `${r?.consoleErrors.length ?? '?'}/${r?.httpErrors.length ?? '?'}`).join(' · ');
      const ok = prices && fp && tel && decl && row.every((r) => !r?.error);
      if (!ok) allOk = false;
      lines.push(
        `| ${key} | ${width} | ${row.map(fmt).join(' | ')} | ${fp ? '=' : '≠'} ${row[0]?.fingerprint ?? ''} | ${tel ? '=' : '≠'} (${row[0]?.telemetry.length ?? 0}) | ${LOGIN ? (decl ? '=' : '≠') : 'n/a'} | ${overflow}px | ${noise} |`,
      );
    }
  }
  lines.push('', allOk ? '**Resultado: todo coincide entre servidores.**' : '**Resultado: HAY DIFERENCIAS (ver filas con ≠ o ERROR).**', '');
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  return allOk;
}

/* ------------------------------------------------------------------------ */

// `--correction-from DIR`: solo recalcula el Nivel D sobre los `result.json` de una ejecución
// anterior (sin volver a recorrer la interfaz) y reescribe su informe.
const CORRECTION_FROM = option('correction-from', '');
if (CORRECTION_FROM) {
  const base = path.resolve(CORRECTION_FROM);
  const results = [];
  for (const target of fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory())) {
    for (const run of fs.readdirSync(path.join(base, target))) {
      const file = path.join(base, target, run, 'result.json');
      if (!fs.existsSync(file)) continue;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.correction = saved.error ? null : await recalculateCorrection(saved.stored);
      fs.writeFileSync(file, JSON.stringify(saved, null, 2));
      const { stored, ...result } = saved;
      results.push(result);
      console.log(`${saved.target} · ${saved.key} · ${saved.width}px · corrección ${JSON.stringify(saved.correction)}`);
    }
  }
  Object.keys(TARGETS).forEach((name) => { if (!results.some((r) => r.target === name)) delete TARGETS[name]; });
  const widths = [...new Set(results.map((r) => r.width))];
  WIDTHS.splice(0, WIDTHS.length, ...widths);
  process.exit(report(results, base) ? 0 : 1);
}

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const session = LOGIN ? await seededClientSession() : null;
const results = [];
for (const key of SERVICE_KEYS) {
  for (const width of WIDTHS) {
    for (const [targetName, baseUrl] of Object.entries(TARGETS)) {
      process.stdout.write(`${targetName} · ${key} · ${width}px … `);
      const result = await runService({ browser, targetName, baseUrl, width, key, session });
      results.push(result);
      console.log(
        result.error
          ? `ERROR ${result.error}`
          : `${result.providers.map((p) => p.total).join(', ')} · ${result.hours} h · ${result.fingerprint} · tel ${result.telemetry.length}`,
      );
    }
  }
}
await browser.close();
const ok = report(results);
console.log(`\nInforme: ${path.join(OUT, 'REPORT.md')}`);
process.exit(ok ? 0 : 1);
