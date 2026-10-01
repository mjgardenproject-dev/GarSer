#!/usr/bin/env node
/**
 * Banco de pruebas visual de la entrada manual (ronda de rediseño UX 2026-09-29).
 *
 * Levanta la página de `main.tsx` (componentes reales dentro del marco de «Detalles») y la
 * recorre con Playwright pulsando la interfaz como un cliente:
 *
 *   1. Maquetación: cada servicio en 320, 360, 375, 414, 768 y 1280 px. Por pantalla mide
 *      desbordamiento horizontal, si el botón principal se ve sin hacer scroll, controles de
 *      menos de 44 px y errores de consola. Capturas a 375 px.
 *   2. Paridad de lo enviado: introduce cada respuesta de `manualEntryParityFixtures.ts` y
 *      comprueba que lo que sale del asistente produce el mismo `patch` que la respuesta de
 *      referencia. Además compara el payload y los eventos de telemetría con la línea base
 *      guardada en `baseline/payloads.json` (se genera con `--write-baseline`).
 *   3. Escenarios de los hallazgos: stepper de la altura del seto, elementos fantasma en
 *      servicios repetibles, coma decimal, tecla Intro y «Atrás» en la primera pantalla.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/qa/manual-entry/bench.mjs [--out DIR] [--widths 320,375] [--services lawn,hedge]
 *        [--skip-payloads] [--no-shots] [--write-baseline] [--strict] [--port 5199]
 *
 * Requiere Playwright (paquete `playwright` en el proyecto o instalado de forma global) y un
 * Chromium instalado para él. No hace llamadas de red.
 *
 * La forma de conducir cada pantalla (textos de botones, `aria-label`) depende de la interfaz:
 * cuando una fase la cambie, se actualizan las funciones `detectScreen` y `applyActions`, nunca
 * las respuestas de referencia ni la línea base.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BASELINE_FILE = path.join(HERE, 'baseline', 'payloads.json');

/* ------------------------------------------------------------------------ */
/* Argumentos                                                                 */
/* ------------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const ALL_SERVICES = ['lawn', 'hedge', 'tree', 'palm', 'shrub', 'phytosanitary', 'weeding'];
const OUT = path.resolve(option('out', '/tmp/garser-manual-entry-qa'));
const WIDTHS = option('widths', '320,360,375,414,768,1280').split(',').map(Number);
const SERVICES = option('services', ALL_SERVICES.join(',')).split(',');
const PORT = Number(option('port', '5199'));
const SHOTS = !flag('no-shots');
const STRICT = flag('strict');

/** Respuesta con la que se recorre cada servicio para medir la maquetación. */
const LAYOUT_FIXTURES = {
  lawn: 'lawn/normal-80m2',
  hedge: 'hedge/altura-2.1m-caras-2-normal',
  tree: 'tree/tres-arboles-distintos',
  palm: 'palm/dos-grupos-sin-retirada',
  shrub: 'shrub/medianas-descuidado',
  phytosanitary: 'phytosanitary/Palmeras-curative-insects',
  weeding: 'weeding/dificultad_media-con-herbicida',
};

const PRIMARY_LABELS = ['Siguiente', 'Continuar', 'Revisar mis datos', 'Confirmar y continuar', 'Recalcular precio'];
const MIN_TARGET_PX = 44;

/* ------------------------------------------------------------------------ */
/* Arranque                                                                   */
/* ------------------------------------------------------------------------ */

function loadPlaywright() {
  const attempts = [path.join(REPO, 'package.json')];
  try {
    attempts.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js'));
  } catch {
    // sin npm global: solo se intenta el del proyecto
  }
  for (const from of attempts) {
    try {
      return createRequire(from)('playwright');
    } catch {
      // siguiente
    }
  }
  throw new Error('No se encuentra Playwright. Instálalo (npm i -g playwright) y vuelve a lanzar el banco.');
}

const viewportHeight = (width) => (width <= 414 ? 667 : width <= 768 ? 1024 : 800);
const slug = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------------ */
/* Conducción de la interfaz                                                  */
/* ------------------------------------------------------------------------ */

/** Qué pantalla del asistente está a la vista. */
async function detectScreen(page) {
  return page.evaluate((primaryLabels) => {
    const visibleButton = (label) =>
      [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === label && button.offsetParent);
    // F2: la cabecera de cada pantalla lleva `data-manual-heading` y la pantalla dice qué pasos
    // del schema enseña (`data-manual-step-ids`), que es lo que se usa para rellenarla.
    const heading = document.querySelector('[data-manual-heading]')?.textContent?.trim() || '';
    const stepIds = (document.querySelector('[data-manual-step-ids]')?.getAttribute('data-manual-step-ids') || '')
      .split(' ')
      .filter(Boolean);
    if (visibleButton('Confirmar y continuar') || visibleButton('Recalcular precio') || visibleButton('Guardando…')) {
      return { kind: 'summary', heading: 'Resumen' };
    }
    if (visibleButton('Revisar mis datos')) return { kind: 'waste', heading };
    if (heading === '¿Quieres añadir más?') return { kind: 'interstitial', heading };
    if (visibleButton('Siguiente')) return { kind: 'item', heading, stepIds };
    return { kind: 'unknown', heading, primary: primaryLabels.filter((label) => visibleButton(label)) };
  }, PRIMARY_LABELS);
}

/** Acciones para rellenar la pantalla actual con las respuestas de `item`. */
async function planItemScreen(page, screen, item) {
  return page.evaluate(
    ({ heading, stepIds, item }) => {
      const qa = window.__qa;
      const survey = qa.surveys[qa.serviceKey];
      const steps = stepIds && stepIds.length
        ? stepIds.map((id) => survey.steps.find((candidate) => candidate.id === id)).filter(Boolean)
        : survey.steps.filter((candidate) => candidate.title === heading);
      if (steps.length === 0) return { error: `Paso no reconocido: «${heading}»` };
      const step = steps[0];
      const actions = [];
      for (const field of steps.flatMap((candidate) => qa.getVisibleFields(candidate, item))) {
        const value = item[field.key];
        if (value === undefined) {
          if (field.type === 'boolean') continue;
          return { error: `La respuesta no trae ${field.key} y el paso «${heading}» lo pide` };
        }
        if (field.ui === 'toggle') {
          actions.push({ type: 'switch', label: field.label, value: value === true });
        } else if (field.ui === 'cards') {
          const options = field.type === 'boolean' ? field.options || [] : qa.getFieldOptions(field, item);
          const option = options.find((candidate) => candidate.value === String(value));
          if (!option) return { error: `Opción ${String(value)} no disponible en ${field.key}` };
          actions.push({ type: 'radio', group: field.label, label: option.label });
        } else {
          actions.push({ type: 'number', label: field.label, value });
        }
      }
      return { stepId: steps.map((candidate) => candidate.id).join('+'), actions };
    },
    { heading: screen.heading, stepIds: screen.stepIds, item },
  );
}

async function applyActions(page, actions) {
  for (const action of actions) {
    if (action.type === 'radio') {
      await page
        .getByRole('radiogroup', { name: action.group, exact: true })
        .getByRole('radio', { name: new RegExp(`^${escapeRegExp(action.label)}`) })
        .first()
        .click();
    } else if (action.type === 'switch') {
      const control = page.getByRole('switch', { name: action.label, exact: true });
      const checked = (await control.getAttribute('aria-checked')) === 'true';
      if (checked !== action.value) await control.click();
    } else if (action.type === 'number') {
      await page.locator(`input[aria-label="${action.label}"]`).fill(String(action.value));
    }
  }
  await page.waitForTimeout(60);
}

async function clickPrimary(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(90);
}

/* ------------------------------------------------------------------------ */
/* Medición                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Mide la pantalla tal como la ve el cliente al llegar a ella: desde arriba del todo. Así el
 * resultado no depende de dónde dejó el scroll el paso anterior (ni la captura de pantalla).
 */
async function measure(page, width) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(
    ({ primaryLabels, minTarget, width }) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const primary = [...document.querySelectorAll('button')].filter(
        (button) => primaryLabels.includes(button.textContent.trim()) && visible(button),
      );
      const cta = primary[primary.length - 1];
      const ctaRect = cta?.getBoundingClientRect();
      const form = document.querySelector('[data-qa-form]');
      const interactive = form
        ? [...form.querySelectorAll('button, input, select, textarea, a[href], summary, [role="radio"], [role="switch"]')]
        : [];
      const smallTargets = interactive
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const name =
            element.getAttribute('aria-label') ||
            element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ||
            element.getAttribute('type') ||
            element.tagName.toLowerCase();
          return { name, tag: element.tagName.toLowerCase(), w: Math.round(rect.width), h: Math.round(rect.height) };
        })
        .filter((target) => target.w < minTarget || target.h < minTarget);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - width),
        pageHeight: document.documentElement.scrollHeight,
        cta: cta ? cta.textContent.trim() : null,
        ctaVisible: Boolean(ctaRect && ctaRect.top >= 0 && ctaRect.bottom <= window.innerHeight),
        smallTargets,
      };
    },
    { primaryLabels: PRIMARY_LABELS, minTarget: MIN_TARGET_PX, width },
  );
}

/* ------------------------------------------------------------------------ */
/* Recorrido de una respuesta de referencia                                   */
/* ------------------------------------------------------------------------ */

async function openService(browser, serviceKey, width, { gardener = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: viewportHeight(width) },
    deviceScaleFactor: 1,
    isMobile: width <= 414,
    hasTouch: width <= 414,
    locale: 'es-ES',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${PORT}/?s=${serviceKey}${gardener ? '&gardener=1' : ''}`);
  await page.waitForSelector('[data-manual-heading]');
  return { context, page, consoleErrors };
}

/**
 * Introduce la respuesta completa pulsando la interfaz y devuelve lo que emite el asistente.
 * Con `layout`, mide y captura cada pantalla (incluida la de error del primer paso).
 */
async function driveFixture(browser, fixture, { width = 375, layout = false, gardener = false } = {}) {
  const { context, page, consoleErrors } = await openService(browser, fixture.serviceKey, width, { gardener });
  const screens = [];
  let shotIndex = 0;
  const record = async (name) => {
    const metrics = await measure(page, width);
    let shot = null;
    if (layout && SHOTS && width === 375) {
      shotIndex += 1;
      const dir = path.join(OUT, 'screens', `${fixture.serviceKey}${gardener ? '-jardinero' : ''}`);
      fs.mkdirSync(dir, { recursive: true });
      shot = path.join(dir, `${String(shotIndex).padStart(2, '0')}-${slug(name)}.png`);
      await page.screenshot({ path: shot, fullPage: true });
    }
    screens.push({ name, ...metrics, shot });
  };

  let itemIndex = 0;
  let error = null;
  try {
    if (layout) {
      await record('inicio');
      await clickPrimary(page, 'Siguiente');
      await record('error-sin-rellenar');
    }
    for (let guard = 0; guard < 80; guard += 1) {
      const screen = await detectScreen(page);
      if (screen.kind === 'item') {
        const plan = await planItemScreen(page, screen, fixture.items[itemIndex]);
        if (plan.error) throw new Error(plan.error);
        await applyActions(page, plan.actions);
        if (layout) await record(`elemento-${itemIndex + 1}-${plan.stepId}`);
        await clickPrimary(page, 'Siguiente');
      } else if (screen.kind === 'interstitial') {
        if (layout) await record(`intersticial-${itemIndex + 1}`);
        if (itemIndex < fixture.items.length - 1) {
          itemIndex += 1;
          await page.getByRole('button', { name: /^Añadir/ }).click();
          await page.waitForTimeout(90);
        } else {
          await clickPrimary(page, 'Continuar');
        }
      } else if (screen.kind === 'waste') {
        // F4 (D-09): la retirada es una elección explícita de dos opciones.
        await applyActions(page, [
          { type: 'radio', group: 'Retirada de restos', label: fixture.wasteRemoval ? 'Sí, que se lleven los restos' : 'No, me encargo yo' },
        ]);
        if (layout) await record('retirada');
        await clickPrimary(page, 'Revisar mis datos');
      } else if (screen.kind === 'summary') {
        if (layout) await record('resumen');
        const consent = page.locator('input[type="checkbox"]');
        if (await consent.count()) await consent.check();
        await clickPrimary(page, gardener ? 'Recalcular precio' : 'Confirmar y continuar');
        await page.waitForFunction(() => window.__qa.submitted !== null, null, { timeout: 3000 });
        break;
      } else {
        throw new Error(`Pantalla no reconocida (${JSON.stringify(screen)})`);
      }
    }
  } catch (caught) {
    error = String(caught?.message || caught);
  }

  const result = await page.evaluate((fixture) => {
    const qa = window.__qa;
    const strip = (value) =>
      JSON.parse(JSON.stringify(value, (_k, raw) => (typeof raw === 'string' && /^manual-[a-z]+-\d+-\d+$/.test(raw) ? '<id>' : raw)));
    const payload = qa.submitted;
    let patchMatches = null;
    let patchDiff = null;
    if (payload) {
      const fromUi = strip(qa.buildManualBookingPatch({ serviceKey: fixture.serviceKey, items: payload.items, wasteRemoval: payload.wasteRemoval }).patch);
      const fromFixture = strip(qa.buildManualBookingPatch({ serviceKey: fixture.serviceKey, items: fixture.items, wasteRemoval: fixture.wasteRemoval }).patch);
      const a = JSON.stringify(fromUi);
      const b = JSON.stringify(fromFixture);
      patchMatches = a === b;
      if (!patchMatches) {
        let index = 0;
        while (index < a.length && a[index] === b[index]) index += 1;
        patchDiff = { interfaz: a.slice(Math.max(0, index - 80), index + 80), referencia: b.slice(Math.max(0, index - 80), index + 80) };
      }
    }
    return { payload, stepEvents: qa.stepEvents, consentEvents: qa.consentEvents, patchMatches, patchDiff };
  }, fixture);

  await context.close();
  return { fixtureId: fixture.id, width, screens, consoleErrors, error, ...result };
}

/* ------------------------------------------------------------------------ */
/* Escenarios de hallazgos                                                    */
/* ------------------------------------------------------------------------ */

async function scenarioHedgeStepper(browser) {
  const { context, page } = await openService(browser, 'hedge', 375);
  await page.locator('input[aria-label="Longitud del seto"]').fill('14');
  await clickPrimary(page, 'Siguiente');
  const values = [];
  for (let tap = 0; tap < 4; tap += 1) {
    await page.getByRole('button', { name: 'Aumentar altura del seto' }).click();
    values.push(await page.locator('input[aria-label="Altura del seto"]').inputValue());
  }
  await context.close();
  const numbers = values.map((value) => Number(String(value).replace(',', '.')));
  return {
    id: 'S-SET-1',
    description: 'Cuatro toques de «+» en la altura del seto, desde vacío',
    observed: values.join(' → '),
    pass: numbers.includes(2),
    expectation: 'Pasa por 2,0 m (límite del tramo de tarifa)',
  };
}

async function scenarioPhantom(browser, serviceKey, fixtureId) {
  const fixture = FIXTURES.find((candidate) => candidate.id === fixtureId);
  const { context, page } = await openService(browser, serviceKey, 375);
  let observed = '';
  let pass = false;
  try {
    // Primer elemento completo hasta el intersticial.
    for (let guard = 0; guard < 20; guard += 1) {
      const screen = await detectScreen(page);
      if (screen.kind !== 'item') break;
      const plan = await planItemScreen(page, screen, fixture.items[0]);
      if (plan.error) throw new Error(plan.error);
      await applyActions(page, plan.actions);
      await clickPrimary(page, 'Siguiente');
    }
    // «Añadir otro» y, arrepentido, «Atrás».
    await page.getByRole('button', { name: /^Añadir/ }).click();
    await page.waitForTimeout(90);
    await clickPrimary(page, 'Atrás');
    // Sigue adelante con lo que ya tenía.
    for (let guard = 0; guard < 30; guard += 1) {
      const screen = await detectScreen(page);
      if (screen.kind === 'item') await clickPrimary(page, 'Siguiente');
      else if (screen.kind === 'interstitial') await clickPrimary(page, 'Continuar');
      else if (screen.kind === 'waste') await clickPrimary(page, 'Revisar mis datos');
      else break;
    }
    const itemsInSummary = await page.locator('[data-manual-review-item]').count();
    const consent = page.locator('input[type="checkbox"]');
    if (await consent.count()) await consent.check();
    await clickPrimary(page, 'Confirmar y continuar');
    const payload = await page.evaluate(() => window.__qa.submitted);
    const sent = payload ? payload.items.length : 0;
    let priced = null;
    if (payload && sent > 1) {
      priced = await page.evaluate(
        ({ serviceKey, payload }) => {
          const { patch } = window.__qa.buildManualBookingPatch({ serviceKey, items: payload.items, wasteRemoval: payload.wasteRemoval });
          const collection = patch.treeGroups || patch.palmGroups || patch.phytosanitaryZones || [];
          return collection.length;
        },
        { serviceKey, payload },
      );
    }
    observed = `Elementos en el resumen: ${itemsInSummary} · elementos enviados: ${sent}${priced !== null ? ` · grupos construidos: ${priced}` : ''}`;
    pass = itemsInSummary === 1 && sent === 1;
  } catch (caught) {
    observed = `Error: ${caught?.message || caught}`;
  }
  await context.close();
  return {
    id: `FANTASMA-${serviceKey}`,
    description: '«Añadir otro» + «Atrás» y continuar',
    observed,
    pass,
    expectation: 'Un solo elemento en el resumen y en el envío',
  };
}

async function scenarioComma(browser) {
  const { context, page } = await openService(browser, 'hedge', 375);
  await page.locator('input[aria-label="Longitud del seto"]').fill('14');
  await clickPrimary(page, 'Siguiente');
  const input = page.locator('input[aria-label="Altura del seto"]');
  await input.click();
  await page.keyboard.type('1,5');
  const shown = await input.inputValue();
  const before = (await detectScreen(page)).heading;
  await clickPrimary(page, 'Siguiente');
  const after = (await detectScreen(page)).heading;
  await context.close();
  return {
    id: 'V2-coma',
    description: 'Escribir «1,5» con el teclado en la altura del seto',
    observed: `Campo: «${shown}» · ${before === after ? 'no avanza' : 'avanza'}`,
    pass: before !== after && /^1[.,]5$/.test(shown),
    expectation: 'Acepta 1,5 y avanza',
  };
}

async function scenarioEnter(browser) {
  const { context, page } = await openService(browser, 'lawn', 375);
  const input = page.locator('input[aria-label="Superficie de césped"]');
  await input.fill('80');
  const before = (await detectScreen(page)).heading;
  await input.press('Enter');
  await page.waitForTimeout(90);
  const after = (await detectScreen(page)).heading;
  await context.close();
  return {
    id: 'V5-intro',
    description: 'Pulsar Intro tras escribir la superficie',
    observed: before === after ? 'No avanza' : 'Avanza',
    pass: before !== after,
    expectation: 'Avanza a la siguiente pantalla',
  };
}

async function scenarioBackOnFirstScreen(browser) {
  const { context, page } = await openService(browser, 'lawn', 375);
  const back = page.getByRole('button', { name: 'Atrás', exact: true });
  const visible = (await back.count()) > 0 && (await back.first().isVisible());
  await context.close();
  return {
    id: 'V5-atras',
    description: '«Atrás» en la primera pantalla del asistente',
    observed: visible ? 'Visible (no hace nada)' : 'No se muestra',
    pass: !visible,
    expectation: 'No se muestra',
  };
}

/* ------------------------------------------------------------------------ */
/* Principal                                                                  */
/* ------------------------------------------------------------------------ */

let FIXTURES = [];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  process.chdir(REPO);
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: path.join(HERE, 'vite.config.mjs'), server: { port: PORT } });
  await server.listen();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();

  const report = {
    generatedAt: new Date().toISOString(),
    commit: (() => {
      try {
        return execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
      } catch {
        return null;
      }
    })(),
    widths: WIDTHS,
    services: SERVICES,
    layout: [],
    payloads: [],
    scenarios: [],
  };

  try {
    // Las respuestas se leen desde la propia página para usar exactamente el mismo módulo.
    {
      const { context, page } = await openService(browser, 'lawn', 375);
      FIXTURES = await page.evaluate(() => window.__qa.fixtures);
      await context.close();
    }

    // 1 · Maquetación
    for (const width of WIDTHS) {
      for (const serviceKey of SERVICES) {
        const fixture = FIXTURES.find((candidate) => candidate.id === LAYOUT_FIXTURES[serviceKey]);
        const run = await driveFixture(browser, fixture, { width, layout: true });
        report.layout.push(run);
        process.stdout.write(`maquetación ${width}px ${serviceKey}: ${run.error ? `ERROR ${run.error}` : `${run.screens.length} pantallas`}\n`);
      }
    }
    // Corrección del jardinero (mismo asistente, sin consentimiento).
    if (SERVICES.includes('lawn')) {
      const fixture = FIXTURES.find((candidate) => candidate.id === LAYOUT_FIXTURES.lawn);
      const run = await driveFixture(browser, fixture, { width: 375, layout: true, gardener: true });
      run.fixtureId = `${run.fixtureId} (jardinero)`;
      report.layout.push(run);
    }

    // 2 · Paridad de lo enviado
    if (!flag('skip-payloads')) {
      for (const fixture of FIXTURES.filter((candidate) => SERVICES.includes(candidate.serviceKey))) {
        const run = await driveFixture(browser, fixture, { width: 375 });
        report.payloads.push({
          fixtureId: fixture.id,
          error: run.error,
          patchMatches: run.patchMatches,
          patchDiff: run.patchDiff,
          payload: run.payload,
          stepEvents: run.stepEvents,
          consentEvents: run.consentEvents,
          consoleErrors: run.consoleErrors,
        });
      }
      process.stdout.write(`paridad: ${report.payloads.length} respuestas recorridas\n`);
    }

    // 3 · Escenarios
    if (SERVICES.includes('hedge')) {
      report.scenarios.push(await scenarioHedgeStepper(browser));
      report.scenarios.push(await scenarioComma(browser));
    }
    if (SERVICES.includes('tree')) report.scenarios.push(await scenarioPhantom(browser, 'tree', 'tree/medium-structural-acceso-normal'));
    if (SERVICES.includes('palm')) report.scenarios.push(await scenarioPhantom(browser, 'palm', 'palm/cantidad-maxima-50'));
    if (SERVICES.includes('phytosanitary')) report.scenarios.push(await scenarioPhantom(browser, 'phytosanitary', 'phytosanitary/Césped-preventive'));
    if (SERVICES.includes('lawn')) {
      report.scenarios.push(await scenarioEnter(browser));
      report.scenarios.push(await scenarioBackOnFirstScreen(browser));
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // Línea base de lo enviado
  const baselineRows = report.payloads
    .filter((row) => !row.error)
    .map(({ fixtureId, payload, stepEvents, consentEvents }) => ({ fixtureId, payload, stepEvents, consentEvents }));
  let baselineMismatches = null;
  if (flag('write-baseline')) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baselineRows, null, 2)}\n`);
    process.stdout.write(`línea base escrita en ${path.relative(REPO, BASELINE_FILE)}\n`);
  } else if (fs.existsSync(BASELINE_FILE) && report.payloads.length) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    const byId = new Map(baseline.map((row) => [row.fixtureId, row]));
    baselineMismatches = baselineRows
      .filter((row) => {
        const expected = byId.get(row.fixtureId);
        return !expected || JSON.stringify(expected) !== JSON.stringify(row);
      })
      .map((row) => row.fixtureId);
  }

  const summary = summarize(report, baselineMismatches);
  report.summary = summary;
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), renderMarkdown(report, summary));
  process.stdout.write(`\n${renderMarkdown(report, summary)}\nInforme: ${path.join(OUT, 'REPORT.md')}\n`);

  if (STRICT && !summary.allPass) process.exitCode = 1;
}

function summarize(report, baselineMismatches) {
  const mobile = report.layout.filter((run) => run.width <= 414);
  const screens = report.layout.flatMap((run) => run.screens.map((screen) => ({ ...screen, fixtureId: run.fixtureId, width: run.width })));
  const overflowing = screens.filter((screen) => screen.overflowPx > 0);
  const ctaHidden = mobile.flatMap((run) =>
    run.screens.filter((screen) => !screen.ctaVisible).map((screen) => ({ ...screen, fixtureId: run.fixtureId, width: run.width })),
  );
  const smallTargetNames = new Map();
  screens.forEach((screen) =>
    screen.smallTargets.forEach((target) => {
      const key = `${target.name} (${target.w}×${target.h})`;
      smallTargetNames.set(key, (smallTargetNames.get(key) || 0) + 1);
    }),
  );
  const consoleErrors = [...report.layout, ...report.payloads].flatMap((run) => run.consoleErrors || []);
  const runErrors = [...report.layout, ...report.payloads].filter((run) => run.error).map((run) => `${run.fixtureId}: ${run.error}`);
  const patchMismatches = report.payloads.filter((row) => row.patchMatches === false).map((row) => row.fixtureId);
  const scenarioFails = report.scenarios.filter((scenario) => !scenario.pass).map((scenario) => scenario.id);
  const allPass =
    overflowing.length === 0 &&
    ctaHidden.length === 0 &&
    smallTargetNames.size === 0 &&
    consoleErrors.length === 0 &&
    runErrors.length === 0 &&
    patchMismatches.length === 0 &&
    (baselineMismatches === null || baselineMismatches.length === 0) &&
    scenarioFails.length === 0;
  return {
    screensMeasured: screens.length,
    overflowing: overflowing.map((screen) => `${screen.width}px · ${screen.fixtureId} · ${screen.name} · +${screen.overflowPx}px`),
    ctaHidden: ctaHidden.map((screen) => `${screen.width}px · ${screen.fixtureId} · ${screen.name}`),
    smallTargets: [...smallTargetNames.entries()].map(([name, count]) => `${name} ×${count}`),
    consoleErrors,
    runErrors,
    payloadsDriven: report.payloads.length,
    patchMismatches,
    baselineMismatches,
    scenarioFails,
    allPass,
  };
}

function renderMarkdown(report, summary) {
  const lines = [];
  const status = (ok) => (ok ? '✅' : '❌');
  lines.push(`# Banco de pruebas · entrada manual`, '');
  lines.push(`Commit \`${report.commit}\` · ${report.generatedAt} · anchos ${report.widths.join(', ')} px`, '');
  lines.push('| Criterio | Resultado |', '|---|---|');
  lines.push(`| Pantallas medidas | ${summary.screensMeasured} |`);
  lines.push(`| Sin desbordamiento horizontal | ${status(summary.overflowing.length === 0)} ${summary.overflowing.length} pantallas desbordan |`);
  lines.push(`| CTA visible sin scroll desde arriba (≤ 414 px, alto 667) | ${status(summary.ctaHidden.length === 0)} ${summary.ctaHidden.length} pantallas con el CTA fuera |`);
  lines.push(`| Controles ≥ ${MIN_TARGET_PX} px | ${status(summary.smallTargets.length === 0)} ${summary.smallTargets.length} controles distintos por debajo |`);
  lines.push(`| Errores de consola | ${status(summary.consoleErrors.length === 0)} ${summary.consoleErrors.length} |`);
  lines.push(`| Recorridos sin error del banco | ${status(summary.runErrors.length === 0)} ${summary.runErrors.length} con error |`);
  lines.push(`| Lo enviado = respuesta de referencia (patch) | ${status(summary.patchMismatches.length === 0)} ${summary.payloadsDriven - summary.patchMismatches.length}/${summary.payloadsDriven} |`);
  lines.push(
    `| Lo enviado = línea base (payload y telemetría) | ${summary.baselineMismatches === null ? '— (sin comparar)' : `${status(summary.baselineMismatches.length === 0)} ${summary.baselineMismatches.length} distintos`} |`,
  );
  lines.push(`| Escenarios de hallazgos | ${status(summary.scenarioFails.length === 0)} ${report.scenarios.length - summary.scenarioFails.length}/${report.scenarios.length} |`, '');

  lines.push('## Escenarios', '', '| ID | Qué | Observado | Esperado | |', '|---|---|---|---|---|');
  report.scenarios.forEach((scenario) =>
    lines.push(`| ${scenario.id} | ${scenario.description} | ${scenario.observed} | ${scenario.expectation} | ${status(scenario.pass)} |`),
  );
  const list = (title, rows) => {
    if (!rows || rows.length === 0) return;
    lines.push('', `## ${title}`, '', ...rows.map((row) => `- ${row}`));
  };
  list('Desbordamiento horizontal', summary.overflowing);
  list('CTA fuera de la pantalla', summary.ctaHidden);
  list(`Controles por debajo de ${MIN_TARGET_PX} px`, summary.smallTargets);
  list('Errores de consola', summary.consoleErrors);
  list('Errores del banco', summary.runErrors);
  list('Lo enviado no coincide con la referencia', summary.patchMismatches);
  list('Lo enviado no coincide con la línea base', summary.baselineMismatches || []);
  lines.push('');
  return lines.join('\n');
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
