#!/usr/bin/env node
/**
 * Accesibilidad del asistente manual (F12, criterio 6 de PLAN-IMPLEMENTACION §11).
 *
 * Usa el mismo marco que el banco (`main.tsx` + `vite.config.mjs`), sin red. Para cada servicio
 * (y el modal del jardinero) recorre todas las pantallas y comprueba:
 *   - foco: al cambiar de pantalla, en el título (h2 con `data-manual-heading`); al fallar, en el
 *     primer campo con error;
 *   - nombres: cada `radiogroup`, `radio`, `switch`, casilla y campo de texto tiene nombre;
 *   - errores: `aria-invalid` y `aria-describedby` que apunta a un texto que existe;
 *   - contraste del texto visible ≥ 4,5:1 (≥ 3:1 en texto grande), salvo controles desactivados;
 * y hace dos recorridos completos SOLO con teclado (césped y árboles, con «Añadir otro»).
 *
 * Uso (Playwright aislado, ver README):
 *   node scripts/qa/manual-entry/a11y.mjs --out ~/Downloads/auditorias/formularios-qa/fase-12-a11y
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
const OUT = path.resolve(option('out', '/tmp/garser-manual-entry-a11y'));
const PORT = Number(option('port', '5198'));
const SERVICES = ['lawn', 'hedge', 'tree', 'palm', 'shrub', 'phytosanitary', 'weeding'];

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

/* ------------------------------------------------------------------------ */
/* Comprobaciones dentro de la página                                         */
/* ------------------------------------------------------------------------ */

/** Nombres, errores y contraste de la pantalla actual. Devuelve una lista de problemas. */
const auditScreen = () => {
  const problems = [];
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('.sr-only');
  };
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${el.id}"]`);
      if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
    return (el.textContent || '').trim();
  };
  const describe = (el) => `${el.getAttribute('role') || el.tagName.toLowerCase()} «${nameOf(el).slice(0, 40)}»`;

  // Nombres
  document.querySelectorAll('[role="radiogroup"], [role="radio"], [role="switch"], input, textarea, select, button').forEach((el) => {
    if (!visible(el)) return;
    if (!nameOf(el)) problems.push(`sin nombre: ${el.outerHTML.slice(0, 80)}`);
  });

  // Errores: aria-invalid con descripción que existe y no está vacía
  document.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    const texts = ids.map((id) => document.getElementById(id)?.textContent?.trim() || '');
    if (!texts.some(Boolean)) problems.push(`error sin texto descrito: ${describe(el)}`);
  });

  // Contraste
  const parse = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
    return { r: +r, g: +g, b: +b, a: +a };
  };
  const lum = ({ r, g, b }) => {
    const c = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const background = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!ownText || !visible(el)) return;
    if (el.closest('[disabled], [aria-disabled="true"]')) return; // controles desactivados: exentos (WCAG 1.4.3)
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) return;
    const bg = background(el);
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      const key = `${style.color}|${ownText.slice(0, 30)}`;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(`contraste ${ratio.toFixed(2)}:1 < ${min}:1 en «${ownText.slice(0, 50)}» (${style.color} sobre rgb(${bg.r}, ${bg.g}, ${bg.b}))`);
      }
    }
  });
  return problems;
};

const focusInfo = () => {
  const el = document.activeElement;
  if (!el) return { kind: 'none' };
  if (el.matches('[data-manual-heading]')) return { kind: 'heading', text: el.textContent.trim() };
  return {
    kind: el.getAttribute('role') || el.tagName.toLowerCase(),
    invalid: el.getAttribute('aria-invalid') === 'true' || !!el.closest('[aria-invalid="true"]'),
    text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50),
  };
};

/* ------------------------------------------------------------------------ */
/* Recorrido de cada servicio (ratón) con comprobaciones en cada pantalla      */
/* ------------------------------------------------------------------------ */

const PRIMARY = ['Siguiente', 'Continuar', 'Revisar mis datos'];

async function heading(page) {
  return page.evaluate(() => document.querySelector('[data-manual-heading]')?.textContent?.trim() || '');
}

async function clickPrimary(page) {
  for (const label of PRIMARY) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count()) {
      await button.last().click();
      await page.waitForTimeout(120);
      return label;
    }
  }
  return null;
}

async function auditService(browser, serviceKey, { gardener = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, locale: 'es-ES' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/?s=${serviceKey}${gardener ? '&gardener=1' : ''}`);
  await page.waitForSelector('[data-manual-heading]');
  const result = { service: `${serviceKey}${gardener ? ' (jardinero)' : ''}`, screens: [], problems: [] };

  // Error en la primera pantalla: foco al primer campo con error y errores bien descritos.
  await clickPrimary(page);
  const errorFocus = await page.evaluate(focusInfo);
  if (!errorFocus.invalid) result.problems.push(`al fallar, el foco no va al campo con error (${JSON.stringify(errorFocus)})`);
  result.problems.push(...(await page.evaluate(auditScreen)).map((p) => `[error 1.ª pantalla] ${p}`));

  for (let guard = 0; guard < 25; guard += 1) {
    const title = await heading(page);
    if (/Revisa tus datos/.test(title)) {
      result.screens.push(title);
      result.problems.push(...(await page.evaluate(auditScreen)).map((p) => `[${title}] ${p}`));
      break;
    }
    // Rellenar lo que haya: números válidos y la primera opción de cada grupo sin elegir.
    for (const input of await page.locator('input[type="text"]').all()) {
      if ((await input.inputValue()) === '') await input.fill('2');
    }
    for (const group of await page.locator('[role="radiogroup"]').all()) {
      const checked = await group.locator('[role="radio"][aria-checked="true"]').count();
      if (!checked) await group.locator('[role="radio"]').first().click();
    }
    result.screens.push(title);
    result.problems.push(...(await page.evaluate(auditScreen)).map((p) => `[${title}] ${p}`));
    const before = title;
    const clicked = await clickPrimary(page);
    if (!clicked) {
      result.problems.push(`[${title}] sin botón para seguir`);
      break;
    }
    const after = await heading(page);
    if (after === before && !/añadir más/.test(before)) {
      result.problems.push(`[${title}] no avanza tras «${clicked}»`);
      break;
    }
    const focus = await page.evaluate(focusInfo);
    if (focus.kind !== 'heading') result.problems.push(`[${after}] el foco no está en el título al llegar (${JSON.stringify(focus)})`);
  }
  result.consoleErrors = consoleErrors;
  await context.close();
  return result;
}

/* ------------------------------------------------------------------------ */
/* Recorridos solo con teclado                                                */
/* ------------------------------------------------------------------------ */

/** Pulsa Tab hasta que el foco cumpla `test` (como mucho 40 veces). */
async function tabTo(page, test, description) {
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const ok = await page.evaluate(test);
    if (ok) return;
  }
  throw new Error(`Con Tab no se llega a ${description}`);
}

const isRole = (role, name) => `(() => { const el = document.activeElement; return !!el && el.getAttribute('role') === '${role}'${
  name ? ` && (el.textContent || el.getAttribute('aria-label') || '').trim().startsWith(${JSON.stringify(name)})` : ''
}; })()`;
const isButton = (name) => `(() => { const el = document.activeElement; return !!el && el.tagName === 'BUTTON' && ((el.getAttribute('aria-label') || el.textContent || '').trim().startsWith(${JSON.stringify(name)})); })()`;
const isInput = (name) => `(() => { const el = document.activeElement; return !!el && el.tagName === 'INPUT' && el.getAttribute('aria-label') === ${JSON.stringify(name)}; })()`;
const isCheckbox = `(() => { const el = document.activeElement; return !!el && el.type === 'checkbox'; })()`;

async function keyboardLawn(browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, locale: 'es-ES' });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/?s=lawn`);
  await page.waitForSelector('[data-manual-heading]');
  const steps = [];
  await tabTo(page, isInput('Superficie de césped'), 'la superficie');
  await page.keyboard.type('80');
  await page.keyboard.press('Enter');
  steps.push(await heading(page));
  await tabTo(page, isRole('radio'), 'las opciones de estado');
  await page.keyboard.press('ArrowDown'); // «Descuidado»
  await tabTo(page, isButton('Siguiente'), '«Siguiente»');
  await page.keyboard.press('Enter');
  steps.push(await heading(page));
  await tabTo(page, isRole('radio'), 'la retirada');
  await page.keyboard.press('ArrowDown'); // «No, me encargo yo»
  await tabTo(page, isButton('Revisar mis datos'), '«Revisar mis datos»');
  await page.keyboard.press('Enter');
  steps.push(await heading(page));
  await tabTo(page, isCheckbox, 'la casilla');
  await page.keyboard.press('Space');
  await tabTo(page, isButton('Confirmar y continuar'), '«Confirmar y continuar»');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__qa.submitted !== null, null, { timeout: 3000 });
  const submitted = await page.evaluate(() => window.__qa.submitted);
  await context.close();
  const ok =
    JSON.stringify(submitted) === JSON.stringify({ items: [{ superficie_m2: 80, estado_jardin: 'descuidado' }], wasteRemoval: false });
  return { name: 'Césped solo con teclado', steps, submitted, ok };
}

async function keyboardTree(browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, locale: 'es-ES' });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/?s=tree`);
  await page.waitForSelector('[data-manual-heading]');
  const answerTree = async (sizeDown, pruningDown, accessRight) => {
    await tabTo(page, isRole('radio'), 'el tamaño');
    for (let i = 0; i < sizeDown; i += 1) await page.keyboard.press('ArrowDown');
    if (sizeDown === 0) await page.keyboard.press('Space');
    await tabTo(page, isButton('Siguiente'), '«Siguiente»');
    await page.keyboard.press('Enter');
    await tabTo(page, isRole('radio'), 'el tipo de poda');
    for (let i = 0; i < pruningDown; i += 1) await page.keyboard.press('ArrowDown');
    if (pruningDown === 0) await page.keyboard.press('Space');
    await tabTo(page, isButton('Siguiente'), '«Siguiente»');
    await page.keyboard.press('Enter');
    // Segmentado del acceso: botones con rol radio; Tab hasta la opción y Espacio.
    await tabTo(page, isRole('radio', accessRight ? 'Acceso difícil' : 'Acceso normal'), 'el acceso');
    await page.keyboard.press('Space');
    await tabTo(page, isButton('Siguiente'), '«Siguiente»');
    await page.keyboard.press('Enter');
  };
  await answerTree(1, 0, false); // mediano, estructural, normal
  await tabTo(page, isButton('Añadir otro árbol'), '«Añadir otro árbol»');
  await page.keyboard.press('Enter');
  await answerTree(2, 1, true); // grande, formación, difícil
  await tabTo(page, isButton('Continuar'), '«Continuar»');
  await page.keyboard.press('Enter');
  await tabTo(page, isButton('Revisar mis datos'), '«Revisar mis datos»');
  await page.keyboard.press('Enter');
  await tabTo(page, isCheckbox, 'la casilla');
  await page.keyboard.press('Space');
  await tabTo(page, isButton('Confirmar y continuar'), '«Confirmar y continuar»');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__qa.submitted !== null, null, { timeout: 3000 });
  const submitted = await page.evaluate(() => window.__qa.submitted);
  await context.close();
  const expected = {
    items: [
      { aiSizeBand: 'medium', pruningType: 'structural', difficultyHigh: false },
      { aiSizeBand: 'large', pruningType: 'shaping', difficultyHigh: true },
    ],
    wasteRemoval: true,
  };
  return { name: 'Árboles (dos, con «Añadir otro») solo con teclado', submitted, ok: JSON.stringify(submitted) === JSON.stringify(expected) };
}

/* ------------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  process.chdir(REPO);
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: path.join(HERE, 'vite.config.mjs'), server: { port: PORT } });
  await server.listen();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const report = { services: [], keyboard: [], selfTest: null };
  try {
    // Autocomprobación: el auditor tiene que ver un texto gris claro y un botón sin nombre.
    {
      const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/?s=lawn`);
      await page.waitForSelector('[data-manual-heading]');
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.innerHTML = '<p style="color:#d1d5db;background:#fff">texto de prueba</p><button style="width:50px;height:50px"></button>';
        document.body.prepend(probe);
      });
      const found = await page.evaluate(auditScreen);
      report.selfTest = {
        contrast: found.some((p) => p.includes('texto de prueba')),
        unnamed: found.some((p) => p.startsWith('sin nombre')),
      };
      await context.close();
      if (!report.selfTest.contrast || !report.selfTest.unnamed) throw new Error(`El auditor no detecta lo que debe: ${JSON.stringify(report.selfTest)}`);
    }
    for (const key of SERVICES) report.services.push(await auditService(browser, key));
    report.services.push(await auditService(browser, 'lawn', { gardener: true }));
    for (const run of [keyboardLawn, keyboardTree]) {
      try {
        report.keyboard.push(await run(browser));
      } catch (error) {
        report.keyboard.push({ name: run.name, ok: false, error: String(error?.message || error) });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const lines = ['# Accesibilidad del asistente manual', '', `Autocomprobación del auditor (detecta bajo contraste y botón sin nombre): ${report.selfTest?.contrast && report.selfTest?.unnamed ? '✅' : '❌'}`, ''];
  for (const s of report.services) {
    lines.push(`## ${s.service} — ${s.problems.length ? `❌ ${s.problems.length}` : '✅ 0'} problemas · ${s.screens.length} pantallas`);
    s.problems.forEach((p) => lines.push(`- ${p}`));
    if (s.consoleErrors.length) lines.push(`- consola: ${s.consoleErrors.join(' | ')}`);
    lines.push('');
  }
  lines.push('## Recorridos solo con teclado', '');
  report.keyboard.forEach((k) => lines.push(`- ${k.ok ? '✅' : '❌'} ${k.name}${k.error ? ` — ${k.error}` : ''}`));
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), `${lines.join('\n')}\n`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
