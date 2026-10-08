#!/usr/bin/env node
/**
 * Entrada a «Detalles»: ¿se ve alguna pantalla que no sea la del servicio? (2026-10-08, H-N-24)
 *
 * Anota, desde el primer fotograma (MutationObserver instalado antes de que cargue la app), qué
 * pantallas aparecen al pasar de «Servicios» a «Detalles» y al recargar en «Detalles». La pantalla
 * genérica («Fotos de tu jardín») no debe aparecer nunca con un servicio del catálogo.
 *
 * Uso:
 *   node scripts/qa/manual-entry/details-entry.mjs http://localhost:5191 [servicio]
 *   (servicio por defecto: «Corte de césped»)
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [base = 'http://localhost:5191', service = 'Corte de césped'] = process.argv.slice(2);
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(base)) throw new Error(`Solo servidores locales: ${base}`);

const loadPlaywright = () => {
  for (const from of [path.join(REPO, 'package.json'), path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'noop.js')]) {
    try {
      return createRequire(from)('playwright');
    } catch {
      // siguiente
    }
  }
  throw new Error('No se encuentra Playwright (ver scripts/qa/manual-entry/README.md).');
};

const SCREENS = {
  generica: 'Fotos de tu jardín',
  carga: 'Cargando el servicio',
  selector: '¿Cómo calculamos tu presupuesto?',
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'es-ES' });
await context.addInitScript((screens) => {
  window.__screens = [];
  const record = () => {
    const text = document.body?.innerText || '';
    const seen = Object.entries(screens).filter(([, marker]) => text.includes(marker)).map(([key]) => key).join('+') || '(otra)';
    if (window.__screens[window.__screens.length - 1] !== seen) window.__screens.push(seen);
  };
  new MutationObserver(record).observe(document, { childList: true, subtree: true, characterData: true });
}, SCREENS);

const page = await context.newPage();
const screensSince = async (from) => (await page.evaluate(() => window.__screens)).slice(from);
const result = {};
try {
  await page.goto(`${base}/reservar`, { waitUntil: 'networkidle', timeout: 60000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByPlaceholder(/Buscar dirección/).fill('');
    await page.getByPlaceholder(/Buscar dirección/).fill('Avenida Ricardo Soriano 12, Marbella');
    try {
      await page.getByText('Marbella, España').first().click({ timeout: 20000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await page.getByRole('button', { name: 'Continuar a servicios', exact: true }).click();
  await page.getByRole('button', { name: `Seleccionar ${service}` }).click({ timeout: 15000 });
  const before = (await page.evaluate(() => window.__screens)).length;
  await page.getByRole('button', { name: 'Continuar a los detalles del servicio', exact: true }).click();
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), SCREENS.selector, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  result.servicesToDetails = await screensSince(before);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), SCREENS.selector, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  result.reloadOnDetails = await screensSince(0);
} catch (error) {
  result.error = String(error?.message || error).split('\n')[0];
}
result.genericShown = [...(result.servicesToDetails || []), ...(result.reloadOnDetails || [])].some((s) => s.includes('generica'));
console.log(JSON.stringify(result, null, 1));
await browser.close();
