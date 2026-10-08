#!/usr/bin/env node
/**
 * Nivel E · Pago de prueba en LOCAL (F12, autorizado por el usuario el 2026-10-08).
 *
 * Reserva completa en la app local de la rama con el cliente de `supabase/seed.sql` (credenciales
 * de prueba leídas en tiempo de ejecución) y la tarjeta de prueba pública de Stripe en modo test.
 * Comprueba que el importe que Stripe autoriza = el total que la app enseña en «Profesionales».
 *
 * Solo contra localhost y con claves `pk_test_`/`sk_test_`: si no, se niega a ejecutarse.
 *
 * Uso:
 *   node scripts/qa/manual-entry/payment-local.mjs http://localhost:5191 <carpeta-capturas> [--explore]
 */
import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [base = 'http://localhost:5191', out = path.join(REPO, '.qa-payment-local')] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const EXPLORE = process.argv.includes('--explore');
// `--tree`: dos árboles (mediano estructural normal + grande formación difícil) en vez de césped.
const TREE = process.argv.includes('--tree');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(base)) throw new Error(`Solo servidores locales: ${base}`);
fs.mkdirSync(out, { recursive: true });

const readEnv = (file) =>
  Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
const env = readEnv(path.join(REPO, '.env.local'));
const fnEnv = readEnv(path.join(REPO, 'supabase/functions/.env'));
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.VITE_SUPABASE_URL)) throw new Error('Solo contra el Supabase local');
if (!String(env.VITE_STRIPE_PUBLISHABLE_KEY).startsWith('pk_test_')) throw new Error('La clave publicable de Stripe no es de prueba');
if (!String(fnEnv.STRIPE_SECRET_KEY).startsWith('sk_test_')) throw new Error('La clave secreta de Stripe no es de prueba');

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
const psql = (sql) =>
  execFileSync('docker', ['exec', 'supabase_db_GarSer-main_4', 'psql', '-U', 'postgres', '-tAc', sql], { encoding: 'utf8' }).trim();

async function seededClientSession() {
  const seed = fs.readFileSync(path.join(REPO, 'supabase/seed.sql'), 'utf8');
  const match = seed.match(/Cliente:\s+(\S+@\S+)\s+\/\s+(\S+)/);
  if (!match) throw new Error('No encuentro el cliente sembrado en supabase/seed.sql');
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: match[1], password: match[2] }),
  });
  if (!res.ok) throw new Error(`Login del cliente sembrado: HTTP ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shot = 0;
const snap = async (page, name) => {
  shot += 1;
  await page.screenshot({ path: path.join(out, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
const dumpButtons = async (page) =>
  page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((b) => b.offsetParent).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean));

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const session = await seededClientSession();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'es-ES' });
await context.addInitScript(({ value }) => window.localStorage.setItem('sb-127-auth-token', value), { value: JSON.stringify(session) });
const page = await context.newPage();
const result = { steps: [] };
const t0 = psql('select now()');
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
  await button(page, 'Continuar a servicios').click();
  await page.getByRole('button', { name: TREE ? 'Seleccionar Poda de árboles' : 'Seleccionar Corte de césped' }).click({ timeout: 15000 });
  await button(page, 'Continuar a los detalles del servicio').click();
  await sleep(1000);
  const manual = page.getByRole('radio').filter({ hasText: 'Escribo los datos' });
  if (await manual.count()) await manual.first().click();
  const pick = (text) => page.getByRole('radio').filter({ hasText: text }).first().click();
  if (TREE) {
    for (const [size, pruning, access] of [['Mediano', 'Poda estructural', 'Acceso normal'], ['Grande', 'Poda de formación', 'Acceso difícil']]) {
      if (size === 'Grande') await button(page, 'Añadir otro árbol').click();
      await pick(size);
      await button(page, 'Siguiente').click();
      await pick(pruning);
      await button(page, 'Siguiente').click();
      await pick(access);
      await button(page, 'Siguiente').click();
    }
    await button(page, 'Continuar').click();
  } else {
    await page.getByLabel('Superficie de césped', { exact: true }).fill('80');
    await button(page, 'Siguiente').click();
    await pick('Descuidado');
    await button(page, 'Siguiente').click();
  }
  await page.getByRole('radio').filter({ hasText: 'Sí, que se lleven' }).first().click();
  await button(page, 'Revisar mis datos').click();
  await page.getByRole('checkbox').check();
  await button(page, 'Confirmar y continuar').click();
  await page.waitForFunction(() => /Total de la reserva/i.test(document.body.innerText), null, { timeout: 60000 });
  await sleep(1500);
  const shownTotal = (await page.evaluate(() => document.body.innerText.match(/Total de la reserva\s*([\d.,]+\s*€)/i)?.[1] || null));
  result.shownTotal = shownTotal;
  await snap(page, 'profesionales');
  result.steps.push({ at: 'profesionales', buttons: await dumpButtons(page) });
  result.shownPayableNow = await page.evaluate(() => document.body.innerText.match(/Pagas hoy\s*([\d.,]+\s*€)/i)?.[1] || null);
  // Un día lejano con hora libre, para no chocar con reservas de otras pruebas.
  // Árboles en otro día: el de césped ya tiene a ese jardinero ocupado.
  const day = await page.getByRole('button', { name: TREE ? /^Seleccionar 2026-10-2[6-9]$/ : /^Seleccionar 2026-10-2\d$/ }).first();
  await day.click();
  await sleep(1500);
  await page.getByRole('button', { name: /^\d{2}:00$/ }).and(page.locator(':not([disabled])')).first().click();
  await button(page, 'Confirmar jardinero').click();
  await sleep(4000);
  await snap(page, 'confirmacion');
  result.steps.push({ at: 'confirmacion', url: page.url(), buttons: await dumpButtons(page), frames: page.frames().map((f) => f.url().slice(0, 80)) });
  if (EXPLORE) throw new Error('EXPLORE: parada en la confirmación');
  await button(page, 'Continuar al pago').click();
  // Formulario de Stripe (Payment Element, modo test): tarjeta pública de prueba de Stripe.
  const stripeFrame = page.frameLocator('iframe[title*="Secure payment input"], iframe[name^="__privateStripeFrame"]').first();
  await stripeFrame.locator('[name="number"]').waitFor({ timeout: 60000 });
  await snap(page, 'pago-formulario');
  await stripeFrame.locator('[name="number"]').fill('4242 4242 4242 4242');
  await stripeFrame.locator('[name="expiry"]').fill('12 / 30');
  await stripeFrame.locator('[name="cvc"]').fill('123');
  const postal = stripeFrame.locator('[name="postalCode"]');
  if (await postal.count()) await postal.fill('29600');
  result.payButton = (await dumpButtons(page)).filter((b) => /Pagar|Confirmar/i.test(b));
  await page.getByRole('button', { name: /^Pagar/ }).first().click();
  await page.waitForFunction(() => /reserva (está )?(confirmada|solicitada|enviada)|pago (recibido|autorizado)|solicitud enviada/i.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
  await sleep(4000);
  await snap(page, 'tras-pagar');
  result.afterPayText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
} catch (error) {
  result.error = String(error?.message || error).split('\n')[0];
  await snap(page, 'parada').catch(() => {});
  result.steps.push({ at: 'parada', url: page.url(), buttons: await dumpButtons(page).catch(() => []) });
}
result.paymentAttempts = psql(
  `select coalesce(json_agg(json_build_object('status', status, 'total_cents', service_total_amount_cents, 'payable_cents', payable_now_amount_cents, 'pi', stripe_payment_intent_id, 'booking', booking_id)), '[]') from booking_payment_attempts where created_at >= '${t0}'`,
);
result.bookings = psql(
  `select coalesce(json_agg(json_build_object('id', id, 'status', status, 'total_price', total_price, 'management_fee', management_fee, 'mode', data_input_mode, 'date', date)), '[]') from bookings where created_at >= '${t0}'`,
);
fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 1));
await browser.close();
