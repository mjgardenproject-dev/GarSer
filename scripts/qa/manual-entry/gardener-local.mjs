#!/usr/bin/env node
/**
 * Corrección del jardinero en la app REAL (Nivel D, interfaz del modal).
 *
 * Entra como el jardinero de `supabase/seed.sql` (credenciales leídas de ese archivo en tiempo
 * de ejecución), abre «Solicitudes», pulsa «Recalcular con las medidas reales del jardín» en una
 * solicitud manual de césped, rellena el asistente con 80 m², «Descuidado» y retirada, pulsa
 * «Recalcular precio» y devuelve el importe que propone (línea base: 45 €). Captura cada pantalla.
 *
 * Necesita una solicitud `pending` manual de césped para el jardinero sembrado. Si no la hay:
 *
 *   SID=$(docker exec supabase_db_GarSer-main_4 psql -U postgres -tAc "select id from services where name='Corte de césped'")
 *   docker exec supabase_db_GarSer-main_4 psql -U postgres -c "insert into bookings (client_id, gardener_id, service_id, date, start_time, duration_hours, total_price, client_address, status, data_input_mode, management_fee, management_fee_source, notes) values ('22222222-bbbb-4bbb-8bbb-222222222222','11111111-aaaa-4aaa-8aaa-111111111111','$SID', current_date + 3, '10:00', 1, 50.63, 'Avenida Ricardo Soriano 12, Marbella', 'pending', 'manual', 5.63, 'unknown', 'QA: reserva manual de prueba para el modal de corrección')"
 *
 * Uso:
 *   node scripts/qa/manual-entry/gardener-local.mjs <url-local> <carpeta-capturas>
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [base = 'http://localhost:5191', out = path.join(REPO, '.qa-gardener-local')] = process.argv.slice(2);
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(base)) throw new Error(`Solo servidores locales: ${base}`);
fs.mkdirSync(out, { recursive: true });

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

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.VITE_SUPABASE_URL)) throw new Error('Solo contra el Supabase local');
const [, email, password] = fs.readFileSync(path.join(REPO, 'supabase/seed.sql'), 'utf8').match(/Jardinero:\s+(\S+@\S+)\s+\/\s+(\S+)/);
const session = await (
  await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
).json();

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'es-ES' });
await context.addInitScript((value) => localStorage.setItem('sb-127-auth-token', value), JSON.stringify(session));
const page = await context.newPage();
const errors = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 300)));

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.getByText('Solicitudes', { exact: true }).first().click();
await page.getByRole('button', { name: 'Recalcular con las medidas reales del jardín' }).first().click({ timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, '01-modal.png') });
await page.getByLabel('Superficie de césped', { exact: true }).fill('80');
await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
await page.getByRole('radio').filter({ hasText: 'Descuidado' }).first().click();
await page.screenshot({ path: path.join(out, '02-estado.png') });
await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
await page.getByRole('button', { name: 'Revisar mis datos', exact: true }).click();
await page.screenshot({ path: path.join(out, '03-revision.png') });
const fixedFooters = await page.evaluate(() => document.querySelectorAll('[data-manual-footer]').length);
await page.getByRole('button', { name: 'Recalcular precio', exact: true }).click();
await page.waitForTimeout(3000);
const amounts = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).filter((v) => /^\d/.test(v)));
await page.screenshot({ path: path.join(out, '04-propuesta.png'), fullPage: true });
await browser.close();

const result = { amounts, fixedFootersInModal: fixedFooters, errors };
console.log(JSON.stringify(result));
process.exit(amounts.includes('45') && fixedFooters === 0 && errors.length === 0 ? 0 : 1);
