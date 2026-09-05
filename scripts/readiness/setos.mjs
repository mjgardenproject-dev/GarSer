/**
 * Red de regresión de preparación para producción — Poda de setos.
 *
 *   node scripts/readiness/setos.mjs
 *
 * Sale con código 1 si algo falla. Relanzar tras cualquier cambio en el motor
 * (`src/shared/bookingQuoteCore.ts`) o en la config de setos del jardinero.
 *
 * Config del jardinero sembrado (11111111-…-111111111111), verificada en BD:
 *   pricing_method: per_quantity
 *   pricing_matrix:      0-2m 3.5 · 2-4m 5.5 · 4-6m 8.0   (€/ml por cara)
 *   yield_ml_per_hour:   0-2m 25  · 2-4m 15  · 4-6m 8      (ml/h por cara)
 *   minimum_price: 50 · precioPorHora: 30
 *   condition_surcharges: media 20 · alta 50
 *   waste_removal.percentage: 15
 *   (NO tiene `specialist_enabled` — ver bloque 2A.8)
 *
 * Reglas del motor usadas para las predicciones (a mano):
 *   precio_zona = base · length_pricing_m · faces · stateMult · wasteMult
 *     base = pricing_matrix[height] ; stateMult: 1 / 1,20 / 1,50 ; wasteMult(precio): 1,15 si retirada
 *   PRECIO = MAX(ceil(Σ zonas), 50)
 *   h_zona = (length_pricing_m??length · faces / yield_ml_per_hour[height]) · durMult · wasteMult
 *     durMult (FIX 2, getHedgeDurationMultiplier): 1 / 1+media% / 1+alta%  → 1 / 1,20 / 1,50
 *       (sin condition_surcharges configurados → factor genérico 1 / 1,3 / 1,7)
 *     wasteMult(horas): 1,15 si retirada ;  faces acotado a 1-2 (FIX 3)
 *   si Σh > 8  →  Σh · 0,9
 *   HORAS = MAX(1, ceil(Σh · 2) / 2)
 *   warnings: long_job_review si HORAS > 10 ; hedge_length_implausible si Σ ml > 200 (FIX 5)
 */

import {
  quote, expectQuote, expectError, sweep,
  previewProviders, validHours, sql,
  pass, fail, report, PROVIDER_ID,
} from './_harness.mjs';

const SETOS = '3788349c-8e52-45ac-821e-9fb076d98c0f';
const IN_COVERAGE = { lat: 36.51, lng: -4.882 };
const OUT_OF_COVERAGE = { lat: 40.4168, lng: -3.7038 };

/** Payload del flujo de fotos. El motor lee height, length_pricing_m??length, length (horas), faces_to_trim, state. */
const hedge = (length, band, faces, state, wasteRemoval) => ({
  hedgeZones: [{ type: band, height: band, length, length_pricing_m: length, faces_to_trim: faces, state }],
  wasteRemoval,
});

/** Payload del flujo manual: forma de buildHedgeZones + gate dataInputMode. */
const manualHedge = (length, band, heightM, faces, state, wasteRemoval) => ({
  dataInputMode: 'manual',
  wasteRemoval,
  hedgeZones: [{
    id: 'manual-hedge-1',
    type: band, category: band, height: band,
    length, length_pricing_m: length, height_pricing_m: heightM,
    faces_to_trim: faces, hasBackFaceTrim: faces === 2,
    state, inputSource: 'manual',
  }],
});

/* ---------------------------------------------------------------- 2A.1 Escenarios */

async function scenarios() {
  console.log('\n── 2A.1 · Escenarios (predicción a mano vs motor) ─────────────');
  // NOTA: tras el FIX 2, las horas de media/alta usan el % del jardinero (1,20 / 1,50),
  // no el 1,3 / 1,7 fijo. El precio no cambia.
  expectQuote('S1  base 40 ml · 0-2m · normal · 1 cara · sin retirada',
    await quote(SETOS, hedge(40, '0-2m', 1, 'normal', false)), { totalPrice: 140, estimatedHours: 2 });
  expectQuote('S2  mínimo: 10 ml · 0-2m · normal (35 € teóricos → 50)',
    await quote(SETOS, hedge(10, '0-2m', 1, 'normal', false)), { totalPrice: 50, estimatedHours: 1 });
  expectQuote('S3  recargo estado media 40 ml · 0-2m ((40/25)·1,20 = 1,92 → 2 h)',
    await quote(SETOS, hedge(40, '0-2m', 1, 'media', false)), { totalPrice: 168, estimatedHours: 2 });
  expectQuote('S4  recargo estado alta 40 ml · 0-2m ((40/25)·1,50 = 2,4 → 2,5 h)',
    await quote(SETOS, hedge(40, '0-2m', 1, 'alta', false)), { totalPrice: 210, estimatedHours: 2.5 });
  expectQuote('S5  retirada de restos 40 ml · 0-2m · normal',
    await quote(SETOS, hedge(40, '0-2m', 1, 'normal', true)), { totalPrice: 161, estimatedHours: 2 });
  expectQuote('S6  2 caras 40 ml · 0-2m · normal (exactamente 2× S1)',
    await quote(SETOS, hedge(40, '0-2m', 2, 'normal', false)), { totalPrice: 280, estimatedHours: 3.5 });
  expectQuote('S7  banda 2-4m: 40 ml · normal · 1 cara',
    await quote(SETOS, hedge(40, '2-4m', 1, 'normal', false)), { totalPrice: 220, estimatedHours: 3 });
  expectQuote('S8  banda 4-6m: 40 ml · normal · 1 cara',
    await quote(SETOS, hedge(40, '4-6m', 1, 'normal', false)), { totalPrice: 320, estimatedHours: 5 });
  expectQuote('S9  combinado 30 ml · 2-4m · media · 2 caras · retirada',
    await quote(SETOS, hedge(30, '2-4m', 2, 'media', true)), { totalPrice: 456, estimatedHours: 6 });
  expectQuote('S11 trabajo extenso 60 ml · 2-4m · alta · 2 caras · retirada (·1,50 → 12,5 h)',
    await quote(SETOS, hedge(60, '2-4m', 2, 'alta', true)), { totalPrice: 1139, estimatedHours: 12.5 });

  const s11 = await quote(SETOS, hedge(60, '2-4m', 2, 'alta', true));
  const w = (s11.warnings || []).join(' | ');
  if (/más de una visita|no cabe|extenso|jornada/i.test(w)) {
    pass('S11 warning de trabajo extenso presente', w);
  } else {
    fail('S11 warning de trabajo extenso', `warnings = ${JSON.stringify(s11.warnings)} (¿fix de césped desplegado?)`);
  }
}

/* ---------------------------------------------------------------- 2A.2 Paridad IA↔manual */

async function parity() {
  console.log('\n── 2A.2 · Paridad flujo de fotos ↔ flujo manual ──────────────');
  const cases = [
    ['40 ml · 0-2m · normal · 1 cara',            40, '0-2m', 1.5, 1, 'normal', false],   // 140 / 2 h
    ['40 ml · 0-2m · media · 1 cara',             40, '0-2m', 1.5, 1, 'media',  false],   // 168 / 2 h
    ['30 ml · 2-4m · alta · 2 caras · retirada',  30, '2-4m', 3.0, 2, 'alta',   true],    // 570 / 7 h
    ['50 ml · 4-6m · normal · 1 cara',            50, '4-6m', 5.0, 1, 'normal', false],   // 400 / 6,5 h
  ];
  for (const [label, len, band, heightM, faces, state, waste] of cases) {
    const p = await quote(SETOS, hedge(len, band, faces, state, waste));
    const m = await quote(SETOS, manualHedge(len, band, heightM, faces, state, waste));
    if (!p.ok || !m.ok) {
      fail(`paridad · ${label}`, `fotos ${p.status} ${p.code || ''} / manual ${m.status} ${m.code || ''}`);
      continue;
    }
    if (p.totalPrice === m.totalPrice && p.estimatedHours === m.estimatedHours) {
      pass(`paridad · ${label}`, `${p.totalPrice.toFixed(2)} € · ${p.estimatedHours} h (idénticos por ambos caminos)`);
    } else {
      fail(`paridad · ${label}`, `fotos ${p.totalPrice}/${p.estimatedHours} h vs manual ${m.totalPrice}/${m.estimatedHours} h`);
    }
  }
}

/* ---------------------------------------------------------------- 2A.3 Barrido de variables */

async function variableSweep() {
  console.log('\n── 2A.3 · Barrido de cada clave de additional_config ─────────');
  // Base holgado: 140 € (lejos del mínimo). wasteRemoval SIEMPRE declarado.
  await sweep(SETOS, hedge(40, '0-2m', 1, 'normal', false), [
    { key: 'condition_surcharges.media',   input: hedge(40, '0-2m', 1, 'media', false), expectedDelta: { pct: 20 } },
    { key: 'condition_surcharges.alta',    input: hedge(40, '0-2m', 1, 'alta', false),  expectedDelta: { pct: 50 } },
    { key: 'waste_removal.percentage',     input: hedge(40, '0-2m', 1, 'normal', true), expectedDelta: { pct: 15 } },
    { key: 'pricing_matrix.2-4m',          input: hedge(40, '2-4m', 1, 'normal', false), expectedDelta: { eur: 80 } },
    { key: 'pricing_matrix.4-6m',          input: hedge(40, '4-6m', 1, 'normal', false), expectedDelta: { eur: 180 } },
    { key: 'faces_to_trim (dato cliente)', input: hedge(40, '0-2m', 2, 'normal', false), expectedDelta: { eur: 140 } },
  ]);
  // pricing_matrix.0-2m → validado por S1 · yield_ml_per_hour.{0-2m,2-4m,4-6m} → S1/S7/S8 (horas)
  // minimum_price → S2 y bloque 2A.5
}

/* ---------------------------------------------------------------- 2A.4 Límites */

async function limits() {
  console.log('\n── 2A.4 · Límites y plausibilidad ────────────────────────────');
  expectError('manual longitud 201 ml → 422',
    await quote(SETOS, manualHedge(201, '0-2m', 1.5, 1, 'media', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual longitud 0 ml → 422',
    await quote(SETOS, manualHedge(0, '0-2m', 1.5, 1, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual altura 7 m → 422 (máx. 6)',
    await quote(SETOS, manualHedge(40, '4-6m', 7, 1, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual faces_to_trim 3 → 422',
    await quote(SETOS, manualHedge(40, '0-2m', 1.5, 3, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual banda fantasma "1-2m" → 422',
    await quote(SETOS, manualHedge(40, '1-2m', 1.5, 1, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual estado inexistente → 422',
    await quote(SETOS, manualHedge(40, '0-2m', 1.5, 1, 'fatal', false)), { status: 422, code: 'manual_input_invalid' });

  // Flujo de fotos: sin tope duro, pero FIX 5 → warning hedge_length_implausible (> 200 ml)
  // y el warning transversal long_job_review (> 10 h).
  const big = await quote(SETOS, hedge(300, '2-4m', 2, 'alta', false));
  const bw = (big.warnings || []).join(' | ');
  if (big.ok && /supera lo habitual en un seto|200 ml/i.test(bw)) {
    pass('plausibilidad · fotos 300 ml → warning de longitud inverosímil', bw);
  } else {
    fail('plausibilidad · fotos 300 ml', `precia ${big.totalPrice} € / ${big.estimatedHours} h · warnings=${JSON.stringify(big.warnings)}`);
  }
  // Justo en el umbral (200 ml): sin warning de longitud (es "> 200", no ">=").
  const edge = await quote(SETOS, hedge(200, '0-2m', 1, 'normal', false));
  const ew = (edge.warnings || []).join(' | ');
  if (edge.ok && !/supera lo habitual en un seto/i.test(ew)) {
    pass('plausibilidad · fotos 200 ml → sin warning de longitud', ew || '(sin warnings de longitud)');
  } else {
    fail('plausibilidad · fotos 200 ml', `warnings=${JSON.stringify(edge.warnings)}`);
  }
}

/* ---------------------------------------------------------------- 2A.5 Mínimo */

async function minimumPrice() {
  console.log('\n── 2A.5 · Precio mínimo ──────────────────────────────────────');
  expectQuote('14 ml · 0-2m · normal → 50 (49 teóricos)', await quote(SETOS, hedge(14, '0-2m', 1, 'normal', false)), { totalPrice: 50 });
  expectQuote('15 ml · 0-2m · normal → 53 (52,5 → ceil, sobre el mínimo)', await quote(SETOS, hedge(15, '0-2m', 1, 'normal', false)), { totalPrice: 53 });
}

/* ---------------------------------------------------------------- 2A.6 Cambio de precio */

async function priceChange() {
  console.log('\n── 2A.6 · Recálculo con variables corregidas por el jardinero ─');
  // El jardinero corrige a 50 ml · 2-4m · media · 2 caras.
  // 5,5·50·2·1,20 = 660 ; (50·2/15)·1,20 = 8,0 h
  expectQuote('recalculate_correction 50 ml · 2-4m · media · 2 caras',
    await quote(SETOS, hedge(50, '2-4m', 2, 'media', false)), { totalPrice: 660, estimatedHours: 8 });
}

/* ---------------------------------------------------------------- 2A.7 Disponibilidad */

function nextSundayIso() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
function inDaysIso(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

async function availability() {
  console.log('\n── 2A.7 · Disponibilidad y cobertura ─────────────────────────');
  const inCov = { address: 'Marbella centro', addressCoordinates: IN_COVERAGE };

  const wd = await validHours(SETOS, inDaysIso(7), { ...inCov, ...hedge(30, '0-2m', 1, 'normal', false) });
  const wdHours = wd.body?.validHours || [];
  (wd.status === 200 && wdHours.length > 0 ? pass : fail)(
    `valid_hours laborable ${inDaysIso(7)}`, `${wdHours.length} horas: ${JSON.stringify(wdHours)}`);

  const sunday = nextSundayIso();
  const vh = await validHours(SETOS, sunday, { ...inCov, ...hedge(30, '0-2m', 1, 'normal', false) });
  const hours = vh.body?.validHours || [];
  (vh.status === 200 && hours.length === 0 ? pass : fail)(
    `valid_hours domingo ${sunday}`, `validHours=${JSON.stringify(hours)} (exclusion: ${vh.body?.exclusion?.code || 'ninguna'})`);

  const pp = await previewProviders(
    SETOS,
    { address: 'Calle de Alcalá 1, Madrid', addressCoordinates: OUT_OF_COVERAGE, ...hedge(30, '0-2m', 1, 'normal', false) },
    { selectedDate: inDaysIso(7), windowDays: 14 },
  );
  const excl = pp.body?.exclusions?.[PROVIDER_ID];
  const inQuotes = Boolean(pp.body?.quotes?.[PROVIDER_ID]);
  (!inQuotes && excl?.code === 'outside_coverage' ? pass : fail)(
    'preview_providers fuera de cobertura', `inQuotes=${inQuotes} · excl=${JSON.stringify(excl)}`);

  // El jardinero sembrado SÍ es elegible para un seto 4-6m (el motor sirve la banda
  // porque está tarifada, aunque no tenga specialist_enabled — ver 2A.8).
  const pp46 = await previewProviders(
    SETOS,
    { ...inCov, ...hedge(30, '4-6m', 1, 'normal', false) },
    { selectedDate: inDaysIso(7), windowDays: 14 },
  );
  const elig46 = (pp46.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  (elig46 ? pass : fail)('preview_providers seto 4-6m → jardinero elegible',
    `elegible=${elig46} · excl=${pp46.body?.exclusions?.[PROVIDER_ID]?.code || 'ninguna'}`);
}

/* ------------------------------------------------ 2A.8 specialist_enabled coherente (FIX 1) */

async function specialistFlag() {
  console.log('\n── 2A.8 · specialist_enabled coherente con la matriz 4-6m (FIX 1) ──');
  const row = sql(`select
      coalesce((additional_config->>'specialist_enabled'),'ausente'),
      coalesce((additional_config->'pricing_matrix'->>'4-6m'),'') ,
      coalesce((additional_config->'yield_ml_per_hour'->>'4-6m'),'')
    from public.gardener_service_prices gsp
    join public.services s on s.id = gsp.service_id
    where s.name ilike '%seto%' and gsp.gardener_id = '${PROVIDER_ID}';`).trim();
  const [flag, p46, y46] = row.split('|');
  const priced46 = Number(p46) > 0 && Number(y46) > 0;
  // Coherente si: la banda 4-6m está tarifada Y specialist_enabled NO es un 'false'
  // explícito. (El configurador ahora infiere specialist_enabled=true cuando 4-6m está
  // tarifado — FIX 1 en HedgePricingConfigurator — así que 'ausente' también es coherente.)
  if (priced46 && flag !== 'false') {
    pass('specialist_enabled coherente con la matriz 4-6m',
      `specialist_enabled=${flag} · 4-6m tarifado (${p46} €/ml, ${y46} ml/h) · el configurador mostrará la banda`);
  } else if (!priced46 && flag !== 'true') {
    pass('specialist_enabled coherente (sin 4-6m y sin flag activo)', `specialist_enabled=${flag} · priced46=${priced46}`);
  } else {
    fail('specialist_enabled coherente con la matriz 4-6m',
      `specialist_enabled=${flag} pero priced46=${priced46} → el configurador y el motor discreparían`);
  }
}

/* ---------------------------------------------------------------- run */

const run = async () => {
  await scenarios();
  await parity();
  await variableSweep();
  await limits();
  await minimumPrice();
  await priceChange();
  await availability();
  await specialistFlag();
  report();
};

run().catch((error) => { console.error('\n runner abortado:', error); process.exitCode = 1; });
