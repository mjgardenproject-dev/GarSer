#!/usr/bin/env node
/**
 * Escenarios de la app REAL en local (F4 de la ronda 2026-09-30), a 375 px:
 *
 *   1. Elemento fantasma (P-01): árbol mediano → «Añadir otro árbol» → «Atrás» → confirmar.
 *      Esperado: 1 elemento en la revisión, 1 `treeGroup` guardado y el total de un solo árbol.
 *   2. Retirada heredada (P-02 / D-02): fitosanitarios y después desbroce en la misma reserva.
 *      Esperado: la retirada del desbroce arranca en «Sí» (antes, «No» heredado).
 *
 * Uso: node scripts/qa/manual-entry/scenarios-local.mjs <url-local> <prefijo-capturas>
 * Playwright: igual que el banco (`npm_config_prefix` / `PLAYWRIGHT_BROWSERS_PATH`).
 * Contra `main` (antes de F4) los dos escenarios dan el fallo; contra la rama, lo esperado.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/noop.js');
const { chromium } = require('playwright');
const [base = 'http://localhost:5191', out = '/tmp/garser-escenarios'] = process.argv.slice(2);
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(base)) throw new Error('Solo servidores locales');
const browser = await chromium.launch();
const newPage = async () => (await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'es-ES' })).newPage();
const pick = async (page, option) => page.evaluate((o) => { const r = [...document.querySelectorAll('[role=radio]')].find((el) => el.offsetParent && (el.innerText || '').trim().startsWith(o) && !/^(Con fotos|Escribo)/.test(el.innerText)); r?.click(); return !!r; }, option);
const btn = async (page, name) => { await page.getByRole('button', { name, exact: true }).last().click(); await page.waitForTimeout(250); };
async function start(page, services) {
  await page.goto(`${base}/reservar`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder(/Buscar dirección/).fill('Avenida Ricardo Soriano 12, Marbella');
  await page.getByText('Marbella, España').first().click();
  await btn(page, 'Continuar a servicios');
  for (const s of services) await page.getByRole('button', { name: `Seleccionar ${s}` }).click();
  await page.getByRole('button', { name: services.length > 1 ? `Continuar con ${services.length} servicios` : 'Continuar a los detalles del servicio' }).click();
  await page.waitForTimeout(800);
}
const manual = async (page) => { const m = page.getByRole('radio').filter({ hasText: 'Escribo los datos' }); if (await m.count()) await m.first().click(); await page.waitForTimeout(300); };
const stored = (page, collection) => page.evaluate((c) => { const k = Object.keys(localStorage).find((x) => x.startsWith('booking_resume_v2')); const b = JSON.parse(localStorage.getItem(k)).payload.bookingData; return Object.values(b.servicesData || {}).map((s) => (s[c] || []).length).filter(Boolean); }, collection);
const result = {};

// 1) Fantasma en árboles
{
  const page = await newPage();
  await start(page, ['Poda de árboles']);
  await manual(page);
  await pick(page, 'Mediano'); await btn(page, 'Siguiente');
  await pick(page, 'Poda estructural'); await btn(page, 'Siguiente');
  await pick(page, 'Acceso normal'); await btn(page, 'Siguiente');
  await page.getByRole('button', { name: 'Añadir otro árbol', exact: true }).click(); await page.waitForTimeout(250);
  await btn(page, 'Atrás');
  // En main, «Atrás» vuelve al árbol 1: el cliente sigue con «Siguiente» hasta la lista.
  for (let i = 0; i < 6 && !(await page.getByRole('button', { name: 'Continuar', exact: true }).count()); i += 1) await btn(page, 'Siguiente');
  const inter = await page.evaluate(() => document.querySelector('[data-manual-heading]')?.parentElement?.innerText.split('\n').slice(0, 4).join(' / '));
  await btn(page, 'Continuar');
  await pick(page, 'Sí'); await btn(page, 'Revisar mis datos');
  const reviewItems = await page.evaluate(() => document.querySelectorAll('[data-manual-review-item]').length || [...document.querySelectorAll('h4')].length);
  await page.getByRole('checkbox').check();
  await btn(page, 'Confirmar y continuar');
  await page.waitForFunction(() => /Total de la reserva|No disponible/i.test(document.body.innerText), null, { timeout: 45000 });
  await page.waitForTimeout(1500);
  const total = await page.evaluate(() => (document.body.innerText.match(/Total de la reserva\s*([\d.,]+\s*€)/i) || [])[1]);
  result.fantasma = { pantallaIntermedia: inter, elementosEnRevision: reviewItems, treeGroupsGuardados: await stored(page, 'treeGroups'), total };
  await page.screenshot({ path: `${out}-fantasma-profesionales.png` });
}

// 2) D-02: fitosanitarios y después desbroce en la misma reserva
{
  const page = await newPage();
  await start(page, ['Servicios fitosanitarios', 'Desbroce de malas hierbas']);
  await manual(page);
  await pick(page, 'Césped'); await btn(page, 'Siguiente');
  // F8: el campo se llama según lo que se trata («Superficie de césped»).
  await page.getByLabel('Superficie de césped', { exact: true }).fill('50'); await btn(page, 'Siguiente');
  await pick(page, 'Preventivo'); await btn(page, 'Siguiente');
  await pick(page, 'Convencional'); await btn(page, 'Siguiente');
  await btn(page, 'Continuar');
  await page.getByRole('checkbox').check();
  await btn(page, 'Confirmar y continuar');
  await page.waitForTimeout(1500);
  await page.getByLabel('Superficie a desbrozar', { exact: true }).fill('300'); await btn(page, 'Siguiente');
  await pick(page, 'Dificultad normal'); await btn(page, 'Siguiente');
  await btn(page, 'Siguiente');
  const waste = await page.evaluate(() => {
    const sw = document.querySelector('[role=switch][aria-label="Retirada de restos"]');
    if (sw) return `interruptor: ${sw.getAttribute('aria-checked') === 'true' ? 'Sí' : 'No'}`;
    const checked = [...document.querySelectorAll('[role=radio][aria-checked=true]')].map((r) => r.innerText.split('\n')[0]).filter((t) => !/^(Con fotos|Escribo)/.test(t));
    return `opción marcada: ${checked.join(', ')}`;
  });
  result.d02_retiradaDesbroceTrasFitos = waste;
  await page.screenshot({ path: `${out}-d02-retirada.png` });
}
console.log(JSON.stringify(result, null, 1));
await browser.close();
const ok = result.fantasma.treeGroupsGuardados.join() === '1' && result.fantasma.elementosEnRevision === 1 && /Sí/.test(result.d02_retiradaDesbroceTrasFitos);
process.exit(ok ? 0 : 1);
