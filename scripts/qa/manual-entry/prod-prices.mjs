#!/usr/bin/env node
/**
 * Precios en PRODUCCIÓN (solo lectura) para la Sección 21.2 de PRUEBAS-PRODUCCION.md.
 *
 * Recorre garser.es como cliente anónimo, con las mismas respuestas por servicio que el E2E local
 * (`e2e-local.mjs`, de donde se copian las respuestas y la conducción), hasta «Profesionales», y
 * apunta el total y las horas de cada profesional. **Nunca pasa de «Profesionales»**: no elige
 * profesional, ni fecha, ni paga, ni crea reservas. Sí deja eventos de embudo anónimos en
 * `booking_funnel_events`, como cualquier visita.
 *
 * Uso (antes y después del despliegue, y se comparan los dos `prices.json`):
 *   node scripts/qa/manual-entry/prod-prices.mjs --out <carpeta> [--services lawn,tree] [--url https://garser.es]
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const OUT = path.resolve(option('out', path.join(REPO, '.qa-prod-prices')));
const BASE = option('url', 'https://garser.es');
if (!/^https:\/\/(www\.)?garser\.es$/.test(BASE)) throw new Error(`Solo garser.es: ${BASE}`);
const ONLY_SERVICES = option('services', '').split(',').filter(Boolean);
const ADDRESS = option('address', 'Avenida Ricardo Soriano 12, Marbella');

/* Respuestas por servicio: copiadas de e2e-local.mjs (mantener iguales). */
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
      { pick: ['Especie', ['Phoenix canariensis', 'Palmera canaria']] }, 'next',
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
      { num: [['Cantidad a tratar', 'Número de árboles'], '3'] }, 'next',
      { pick: [['Tamaño dominante', 'Altura de los árboles'], 'Grandes'] }, 'next',
      { pick: [['Intención del tratamiento', 'Tipo de tratamiento'], 'Curativo'] }, 'next',
      { pick: [['Objetivo del tratamiento', 'Plaga o enfermedad a combatir'], 'Hongos / enfermedad'] }, 'next',
      { pick: ['Tipo de producto', 'Ecológico'] }, 'next',
      'add',
      { pick: ['Tipo de vegetación', 'Palmeras'] }, 'next',
      { num: [['Cantidad a tratar', 'Número de palmeras'], '2'] }, 'next',
      { pick: [['Tamaño dominante', 'Altura del tronco'], 'Medianas'] }, 'next',
      { pick: [['Intención del tratamiento', 'Tipo de tratamiento'], 'Preventivo'] }, 'next',
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
      const names = Array.isArray(option) ? option : [option];
      const matches = (el) => {
        const line = firstLine(el);
        return names.some((name) => line === name || line.startsWith(`${name} `) || line.startsWith(`${name}(`) || line.startsWith(`${name},`));
      };
      const groupNames = Array.isArray(group) ? group : [group];
      const groups = [...document.querySelectorAll('[role=radiogroup]')].filter((g) =>
        groupNames.includes(g.getAttribute('aria-label')),
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
  for (const name of Array.isArray(label) ? label : [label]) {
    const field = page.getByLabel(name, { exact: true });
    if (!(await field.count())) continue;
    await field.first().fill(value);
    await field.first().blur();
    return;
  }
  throw new Error(`No encuentro el campo «${label}»`);
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
  if (action.num) {
    for (const name of Array.isArray(action.num[0]) ? action.num[0] : [action.num[0]]) {
      if ((await page.getByLabel(name, { exact: true }).count()) > 0) return true;
    }
    return false;
  }
  if (action.plus) return (await page.getByRole('button', { name: `Aumentar ${action.plus[0].toLowerCase()}` }).count()) > 0;
  if (action.toggle) {
    if ((await page.getByRole('switch', { name: action.toggle[0], exact: true }).count()) > 0) return true;
    // F9: la retirada de desbroce se elige con dos opciones en la pantalla de opciones.
    return page.evaluate((name) => [...document.querySelectorAll('[role=radiogroup]')].some((g) => g.getAttribute('aria-label') === name), action.toggle[0]);
  }
  if (action.pick) {
    const names = Array.isArray(action.pick[0]) ? action.pick[0] : [action.pick[0]];
    return page.evaluate((names) => [...document.querySelectorAll('[role=radiogroup]')].some((g) => names.includes(g.getAttribute('aria-label'))), names);
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


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prices(browser, key) {
  const spec = SPECS[key];
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'es-ES' });
  const page = await context.newPage();
  const dir = path.join(OUT, key);
  fs.mkdirSync(dir, { recursive: true });
  let error = null;
  try {
    await page.goto(`${BASE}/reservar`, { waitUntil: 'networkidle', timeout: 60000 });
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
    await page.waitForTimeout(1200);
    const manual = page.getByRole('radio').filter({ hasText: 'Escribo los datos' });
    if (await manual.count()) await manual.first().click();
    await page.waitForTimeout(400);
    for (const [position, action] of spec.actions.entries()) {
      if (action === 'next' && (await nextAnswerOnThisScreen(page, spec.actions[position + 1]))) continue;
      if (typeof action === 'string') {
        if (action === 'submit') await driveSubmit(page);
        else await clickButton(page, ACTION_BUTTONS[action]);
      } else if (action.num) await driveNumber(page, ...action.num);
      else if (action.pick) await drivePick(page, ...action.pick);
      else if (action.toggle) await driveToggle(page, ...action.toggle);
      else if (action.plus) await drivePlus(page, ...action.plus);
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(
      () => /Total de la reserva|No disponible|No hay profesionales/i.test(document.body.innerText),
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(dir, 'profesionales.png'), fullPage: true });
  } catch (err) {
    error = String(err?.message || err).split('\n')[0];
    await page.screenshot({ path: path.join(dir, 'error.png'), fullPage: true }).catch(() => {});
  }
  const providers = await page
    .evaluate(() =>
      [...document.querySelectorAll('span.font-semibold.truncate')].map((name) => {
        const card = name.closest('button, [role=button], div.rounded-2xl, div.rounded-xl') || name.parentElement;
        const text = card?.innerText || '';
        const total = text.match(/Total de la reserva\s*([\d.,]+\s*€)/i);
        return { name: name.textContent.trim(), total: total ? total[1].replace(/\s/g, ' ') : /No disponible/i.test(text) ? 'No disponible' : '?' };
      }),
    )
    .catch(() => []);
  const hours = await page.evaluate(() => (document.body.innerText.match(/son ([\d.,]+) h de trabajo/i) || [])[1] || null).catch(() => null);
  await context.close();
  return { key, error, providers, hours };
}

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
for (const key of Object.keys(SPECS).filter((k) => !ONLY_SERVICES.length || ONLY_SERVICES.includes(k))) {
  const result = await prices(browser, key);
  results.push(result);
  process.stdout.write(`${key}: ${result.error ? `ERROR ${result.error}` : `${result.providers.map((p) => `${p.name} ${p.total}`).join(' · ')} · ${result.hours} h`}\n`);
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'prices.json'), `${JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2)}\n`);
