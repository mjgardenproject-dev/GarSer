/**
 * Red de regresión de preparación para producción — Poda de setos.
 *
 *   READINESS_ENGINE=local node scripts/readiness/setos.mjs
 *
 * Reescrito el 2026-09-11 (auditoría `auditoria/setos`, Fases 1-2) y actualizado el mismo día
 * tras la Fase 3 (corrección, autorizada por el usuario). El runner heredado de la tanda
 * anterior tenía el serviceId FANTASMA `3788349c-8e52-45ac-821e-9fb076d98c0f` (no existe en
 * este entorno) y daba por hechos tres "fixes" que no estaban en `origin/main` en ese momento.
 * Los tres quedaron confirmados como hallazgos reales (Fase 2) y corregidos (Fase 3):
 *
 *   #1 Horas de setos con estado media/alta usaban `getDurationMultiplier` (factor FIJO
 *      1,3/1,7) en vez del `condition_surcharges` real del jardinero — mismo patrón que
 *      césped corrigió en PR #20. Corregido: `bookingQuoteCore.ts:1296-1327`, mismo stateMult
 *      que el bloque de precio. `getDurationMultiplier` sigue viva para desbroce/arbustos —
 *      no tocada.
 *   #2 `HedgePricingConfigurator.tsx` inferÍa `specialist_enabled=false` cuando el flag no
 *      venía explícito, aunque la banda 4-6m ya estuviera tarifada — el autoguardado (1 s, sin
 *      interacción) vaciaba esa tarifa. Corregido: `HedgePricingConfigurator.tsx:127-134`,
 *      la inferencia ahora también mira `pricing_matrix['4-6m'] > 0`.
 *   #3 El motor no avisaba de longitudes de seto inverosímiles en el flujo de fotos (sin el
 *      tope duro del flujo manual). Corregido: `bookingQuoteCore.ts:1316-1324`, nuevo
 *      `pushWarning('hedge_length_implausible', …)` con el umbral de la SSOT
 *      `hedgeBusinessRules.ts` (200 ml), mismo patrón que `lawn_area_implausible`.
 *
 * Ver docs/audit/2026-09-11-setos/REPORT.md para la evidencia completa de la Fase 2 (papel vs.
 * realidad, antes del fix) y su adenda de cierre (después del fix).
 *
 * Config del jardinero sembrado (11111111-…-111111111111), verificada en BD el 2026-09-11:
 *   serviceId: 7092ee0e-1779-45cf-bc2d-5235a757c618   (el de references/servicios.md, ghost)
 *   pricing_method: per_quantity
 *   pricing_matrix:      0-2m 3.5 · 2-4m 5.5 · 4-6m 8.0   (€/ml por cara)
 *   yield_ml_per_hour:   0-2m 25  · 2-4m 15  · 4-6m 8      (ml/h por cara)
 *   minimum_price: 50 · precioPorHora: 30
 *   condition_surcharges: media 20 · alta 50
 *   waste_removal.percentage: 15
 *   (NO tiene `specialist_enabled` en additional_config — el fix #2 lo infiere del precio)
 *
 * Predicciones (ahora iguales a lo que el motor corregido devuelve — el % de
 * condition_surcharges es tiempo Y precio a la vez, ver garser-pricing-rules §10.8):
 *   precio_zona = base · length_pricing_m · faces · stateMult · wasteMult
 *     base = pricing_matrix[height] ; stateMult = 1 + condition_surcharges[media|alta]/100 ; wasteMult = 1,15 si retirada
 *   PRECIO = MAX(ceil(Σ zonas), 50)
 *   h_zona = (length_pricing_m??length · faces / yield_ml_per_hour[height]) · stateMult · wasteMult   [MISMO stateMult que el precio]
 *   si Σh > 8  →  Σh · 0,9
 *   HORAS = MAX(1, ceil(Σh · 2) / 2)
 */

import {
  quote, expectQuote, expectError, sweep,
  previewProviders, validHours, sql, bundleModule,
  pass, fail, untested, report, PROVIDER_ID,
} from './_harness.mjs';

/**
 * `READINESS_ENGINE=local` llama a `buildAuthoritativeBookingQuote` directamente — la
 * validación manual (`manual_input_invalid`) NO vive ahí, vive una capa por delante, en
 * `booking-authority/index.ts:531-553`, que solo se ejecuta contra HTTP real. Para medir
 * esta capa con el motor en proceso (mismo código del worktree, sin depender del checkout
 * de referencia) se bundlea `validateManualSerializableInput` — la misma función que llama
 * booking-authority — y se invoca igual: `{ serviceName, dataInputMode: 'manual', bookingInput }`.
 */
async function manualValidation(bookingInput) {
  const mod = await bundleModule('src/shared/manualEntry/manualEntryValidation.ts');
  return mod.validateManualSerializableInput({
    serviceName: 'Poda de setos',
    dataInputMode: 'manual',
    bookingInput,
  });
}

function expectManualInvalid(label, result) {
  if (!result.ok) {
    pass(label, `422 manual_input_invalid — ${JSON.stringify(result.errors)}`);
    return true;
  }
  fail(label, `se esperaba manual_input_invalid, la validación pasó (ok=true) — el 422 real depende también de booking-authority, ver 2A HTTP`);
  return false;
}

const SETOS = '7092ee0e-1779-45cf-bc2d-5235a757c618';
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
  expectQuote('E1  base 40 ml · 0-2m · normal · 1 cara · sin retirada',
    await quote(SETOS, hedge(40, '0-2m', 1, 'normal', false)), { totalPrice: 140, estimatedHours: 2 });
  expectQuote('E2  mínimo: 10 ml · 0-2m · normal (35 € teóricos → 50)',
    await quote(SETOS, hedge(10, '0-2m', 1, 'normal', false)), { totalPrice: 50, estimatedHours: 1 });

  // E3/E4: el % de condition_surcharges (20/50) mueve precio Y horas por igual — corregido
  // el 2026-09-11 (hallazgo #1). Antes del fix el motor daba 2,5h/3,0h (factor fijo 1,3/1,7).
  expectQuote('E3  recargo estado media 40 ml · 0-2m (fix #1: horas con el 20 % real)',
    await quote(SETOS, hedge(40, '0-2m', 1, 'media', false)), { totalPrice: 168, estimatedHours: 2.0 });
  expectQuote('E4  recargo estado alta 40 ml · 0-2m (fix #1: horas con el 50 % real)',
    await quote(SETOS, hedge(40, '0-2m', 1, 'alta', false)), { totalPrice: 210, estimatedHours: 2.5 });

  expectQuote('E5  retirada de restos 40 ml · 0-2m · normal',
    await quote(SETOS, hedge(40, '0-2m', 1, 'normal', true)), { totalPrice: 161, estimatedHours: 2 });
  expectQuote('E6  2 caras 40 ml · 0-2m · normal (exactamente 2× E1)',
    await quote(SETOS, hedge(40, '0-2m', 2, 'normal', false)), { totalPrice: 280, estimatedHours: 3.5 });
  expectQuote('E7  banda 2-4m: 40 ml · normal · 1 cara',
    await quote(SETOS, hedge(40, '2-4m', 1, 'normal', false)), { totalPrice: 220, estimatedHours: 3 });
  expectQuote('E8  banda 4-6m: 40 ml · normal · 1 cara',
    await quote(SETOS, hedge(40, '4-6m', 1, 'normal', false)), { totalPrice: 320, estimatedHours: 5 });

  // E9: antes del fix, 5,52h "de papel" y 5,98h reales redondeaban los dos a 6,0h — el
  // redondeo enmascaraba el bug en este caso concreto (por eso E4/E10, no E9, lo delataron).
  // Tras el fix da igual: papel y motor son la misma cuenta.
  expectQuote('E9  combinado 30 ml · 2-4m · media · 2 caras · retirada',
    await quote(SETOS, hedge(30, '2-4m', 2, 'media', true)), { totalPrice: 456, estimatedHours: 6 });

  // E10: antes del fix daba 1139,00 €/14,5 h (2h de más que lo que el % de "alta" configurado
  // implicaba). Con el fix, papel = motor: 12,5 h.
  const e10 = await quote(SETOS, hedge(60, '2-4m', 2, 'alta', true));
  expectQuote('E10 trabajo extenso 60 ml · 2-4m · alta · 2 caras · retirada (fix #1)',
    e10, { totalPrice: 1139, estimatedHours: 12.5 });

  // Sigue sin existir un warning de "trabajo extenso" (>Nh) para ningún servicio — el fix #3
  // añadió solo el de longitud inverosímil (>200 ml), y 60 ml no lo cruza. No confundir los
  // dos: ver E11 más abajo para el de longitud.
  const w = (e10.warnings || []).join(' | ');
  if (w) {
    fail('E10 sin warning esperado pero el motor emitió alguno', w);
  } else {
    untested('E10 aviso de trabajo extenso', 'ningún servicio tiene aviso de "trabajo largo" en horas — hallazgo transversal T7 ya documentado, no específico de setos');
  }

  // E11: longitud inverosímil por fotos (fix #3) — antes facturaba 1650 €/18 h sin ningún
  // aviso; ahora debe traer 'hedge_length_implausible' en warnings.
  // Ojo con la forma de `warnings`: en local (buildAuthoritativeBookingQuote directo) son
  // objetos {code, message}; por HTTP, booking-authority/index.ts los aplana a solo el string
  // del mensaje (confirmado con curl directo: el texto llega, el `code` no cruza la API). Un
  // check que solo mire `.code` da un falso FALLA en modo HTTP con el aviso realmente presente.
  const e11 = await quote(SETOS, hedge(300, '2-4m', 1, 'normal', false));
  const hasHedgeLengthWarning = (list) => (list || []).some((x) =>
    (typeof x === 'object' && x?.code === 'hedge_length_implausible') ||
    (typeof x === 'string' && x.includes('supera lo habitual para un seto residencial')));
  const w11 = JSON.stringify(e11.warnings || []);
  if (e11.ok && hasHedgeLengthWarning(e11.warnings)) {
    pass('E11 longitud inverosímil 300 ml (fix #3)', `${e11.totalPrice} € · ${e11.estimatedHours} h · warnings=${w11}`);
  } else {
    fail('E11 longitud inverosímil 300 ml (fix #3)', `esperado warning 'hedge_length_implausible', obtenido warnings=${w11 || '(ninguno)'}`);
  }
}

/* ---------------------------------------------------------------- 2A.2 Paridad IA↔manual */

async function parity() {
  console.log('\n── 2A.2 · Paridad flujo de fotos ↔ flujo manual ──────────────');
  const cases = [
    ['40 ml · 0-2m · normal · 1 cara',            40, '0-2m', 1.5, 1, 'normal', false],
    ['40 ml · 0-2m · media · 1 cara',             40, '0-2m', 1.5, 1, 'media',  false],
    ['30 ml · 2-4m · alta · 2 caras · retirada',  30, '2-4m', 3.0, 2, 'alta',   true],
    ['50 ml · 4-6m · normal · 1 cara',            50, '4-6m', 5.0, 1, 'normal', false],
  ];
  for (const [label, len, band, heightM, faces, state, waste] of cases) {
    const p = await quote(SETOS, hedge(len, band, faces, state, waste));
    const m = await quote(SETOS, manualHedge(len, band, heightM, faces, state, waste));
    if (!p.ok || !m.ok) {
      fail(`paridad · ${label}`, `fotos ${p.status} ${p.code || ''} / manual ${m.status} ${m.code || ''}`);
      continue;
    }
    if (p.totalPrice === m.totalPrice && p.estimatedHours === m.estimatedHours) {
      pass(`paridad · ${label}`, `${p.totalPrice.toFixed(2)} € · ${p.estimatedHours} h (idénticos por ambos caminos — incluido el bug de horas, que afecta a los dos por igual)`);
    } else {
      fail(`paridad · ${label}`, `fotos ${p.totalPrice}/${p.estimatedHours} h vs manual ${m.totalPrice}/${m.estimatedHours} h`);
    }
  }
}

/* ---------------------------------------------------------------- 2A.3 Barrido de variables */

async function variableSweep() {
  console.log('\n── 2A.3 · Barrido de cada clave de additional_config (precio) ─');
  // Base holgado: 140 € (lejos del mínimo). wasteRemoval SIEMPRE declarado.
  // Este barrido mide PRECIO, no horas: el fix #1 se comprueba en horas, en los
  // escenarios E3/E4/E10 de arriba.
  await sweep(SETOS, hedge(40, '0-2m', 1, 'normal', false), [
    { key: 'condition_surcharges.media',   input: hedge(40, '0-2m', 1, 'media', false), expectedDelta: { pct: 20 } },
    { key: 'condition_surcharges.alta',    input: hedge(40, '0-2m', 1, 'alta', false),  expectedDelta: { pct: 50 } },
    { key: 'waste_removal.percentage',     input: hedge(40, '0-2m', 1, 'normal', true), expectedDelta: { pct: 15 } },
    { key: 'pricing_matrix.2-4m',          input: hedge(40, '2-4m', 1, 'normal', false), expectedDelta: { eur: 80 } },
    { key: 'pricing_matrix.4-6m',          input: hedge(40, '4-6m', 1, 'normal', false), expectedDelta: { eur: 180 } },
    { key: 'faces_to_trim (dato cliente)', input: hedge(40, '0-2m', 2, 'normal', false), expectedDelta: { eur: 140 } },
  ]);
  // pricing_matrix.0-2m → validado por E1 · yield_ml_per_hour.{0-2m,2-4m,4-6m} → E1/E7/E8 (horas)
  // minimum_price → E2 y bloque 2A.5
}

/* ---------------------------------------------------------------- 2A.4 Límites */

async function limits() {
  console.log('\n── 2A.4 · Límites y plausibilidad ────────────────────────────');
  // Validación manual: capa de booking-authority (:531-553), no del motor — se prueba
  // bundleando validateManualSerializableInput, no con quote()/READINESS_ENGINE. Ver nota
  // junto a manualValidation() arriba: con READINESS_ENGINE=local, quote() salta esta capa
  // y devuelve 200 o un 422 distinto (recalculation_ineligible) — no es lo mismo que probar.
  expectManualInvalid('manual longitud 201 ml → 422',
    await manualValidation(manualHedge(201, '0-2m', 1.5, 1, 'media', false)));
  expectManualInvalid('manual longitud 0 ml → 422',
    await manualValidation(manualHedge(0, '0-2m', 1.5, 1, 'normal', false)));
  expectManualInvalid('manual altura 7 m → 422 (máx. 6)',
    await manualValidation(manualHedge(40, '4-6m', 7, 1, 'normal', false)));
  expectManualInvalid('manual faces_to_trim 3 → 422',
    await manualValidation(manualHedge(40, '0-2m', 1.5, 3, 'normal', false)));
  expectManualInvalid('manual banda fantasma "1-2m" → 422',
    await manualValidation(manualHedge(40, '1-2m', 1.5, 1, 'normal', false)));
  expectManualInvalid('manual estado inexistente → 422',
    await manualValidation(manualHedge(40, '0-2m', 1.5, 1, 'fatal', false)));

  // La plausibilidad del flujo de fotos (hallazgo #3, fix) se prueba en E11, dentro de
  // scenarios() — ahí ya se dispone del caso base y del propio quote(), no hace falta
  // repetirlo aquí.
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
  // El jardinero corrige a 40 ml · 2-4m · alta · 1 cara. Elegido lejos del umbral de 8h
  // (T2, ya documentado en COORDINACION-SERVICIOS.md) para no mezclar ese hallazgo con este.
  // Precio: 5,5·40·1,50 = 330. Horas (fix #1, 1,50 del jardinero): (40/15)·1,50 = 4,0h.
  // Antes del fix el motor daba 5,0h (factor fijo 1,7).
  const res = await quote(SETOS, hedge(40, '2-4m', 1, 'alta', false));
  expectQuote('recalculate_correction 40 ml · 2-4m · alta · 1 cara (fix #1)', res, { totalPrice: 330, estimatedHours: 4.0 });
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

  // El jardinero sembrado tiene 4-6m tarifado en BD (8,0 €/ml, 8 ml/h) — el motor solo mira
  // pricing_matrix[height], no specialist_enabled (ver hallazgo #2), así que debería salir
  // elegible aquí. Si este test empieza a fallar tras abrir el configurador en 2C.a, es la
  // confirmación en vivo del hallazgo #2 (el guardado borró la banda 4-6m).
  const pp46 = await previewProviders(
    SETOS,
    { ...inCov, ...hedge(30, '4-6m', 1, 'normal', false) },
    { selectedDate: inDaysIso(7), windowDays: 14 },
  );
  const elig46 = (pp46.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  (elig46 ? pass : fail)('preview_providers seto 4-6m → jardinero elegible',
    `elegible=${elig46} · excl=${pp46.body?.exclusions?.[PROVIDER_ID]?.code || 'ninguna'}`);
}

/* ------------------------------------------------ 2A.8 specialist_enabled vs. pricing_matrix 4-6m */

/**
 * Réplica en JS de la inferencia corregida en HedgePricingConfigurator.tsx:127-134 (fix #2).
 * No sustituye a la verificación en 2C.a (esto no ejecuta el componente React ni el
 * autoguardado) — es una comprobación rápida, sin navegador, de que la fórmula es correcta
 * para el estado real de la BD, para no depender solo de la memoria de lo que se vio en pantalla.
 */
function inferSpecialistEnabled({ specialist_enabled, selected_categories, pricing_matrix }) {
  if (specialist_enabled !== undefined) return specialist_enabled;
  return Boolean((selected_categories || []).includes('Setos Gran Altura (>3m)')) ||
    Number(pricing_matrix?.['4-6m'] || 0) > 0;
}

async function specialistFlag() {
  console.log('\n── 2A.8 · specialist_enabled vs. matriz 4-6m (fix #2) ─────────');
  const raw = sql(`select coalesce(additional_config::text, 'null')
    from public.gardener_service_prices gsp
    join public.services s on s.id = gsp.service_id
    where s.name ilike '%seto%' and gsp.gardener_id = '${PROVIDER_ID}';`).trim();
  const config = JSON.parse(raw);
  const priced46 = Number(config?.pricing_matrix?.['4-6m'] || 0) > 0 && Number(config?.yield_ml_per_hour?.['4-6m'] || 0) > 0;
  const inferred = inferSpecialistEnabled(config);
  if (priced46 && inferred === false) {
    fail('specialist_enabled inferido a false con 4-6m ya tarifado en BD (fix #2 no se aplica)',
      `specialist_enabled en BD=${config?.specialist_enabled ?? 'ausente'} · 4-6m tarifado · inferido=${inferred}`);
  } else {
    pass('specialist_enabled inferido coherente con la matriz 4-6m',
      `specialist_enabled en BD=${config?.specialist_enabled ?? 'ausente'} · priced46=${priced46} · inferido=${inferred} — confirmar también en vivo (2C.a): abrir el configurador sin tocar nada no debe vaciar la banda`);
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
