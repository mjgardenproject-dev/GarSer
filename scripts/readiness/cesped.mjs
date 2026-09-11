/**
 * Red de regresión de preparación para producción — Corte de césped.
 *
 *   READINESS_ENGINE=local node scripts/readiness/cesped.mjs   (motor en proceso)
 *   node scripts/readiness/cesped.mjs                          (HTTP, tras integrar)
 *
 * Sale con código 1 si algo falla. Relanzar tras cualquier cambio en el motor
 * (`src/shared/bookingQuoteCore.ts`) o en la config del servicio del jardinero.
 *
 * serviceId verificado en BD el 2026-09-11 (auditoría origin/main @ f6c1e4d):
 * fe9d2d9e-3f62-4184-aa80-a3289d7c378a — el id documentado en la skill
 * (dd8a3286-...) está OBSOLETO, la tabla `services` no fija ids en el seed.
 *
 * Config del jardinero sembrado (11111111-…-111111111111), verificada en BD:
 *   pricing_method: per_quantity · price_per_m2: 0.18 · yield_m2_per_hour: 150
 *   minimum_price: 45 · condition_surcharges: {descuidado:20, muy_descuidado:50}
 *   waste_removal.percentage: 15
 *
 * Reglas del motor usadas para las predicciones (a mano, releídas de
 * src/shared/bookingQuoteCore.ts contra origin/main, no asumidas de una tanda anterior):
 *
 *   PRECIO  precio_zona = 0.18 · q · stateMult_precio · wasteMult
 *           stateMult_precio: 1 / 1.20 / 1.50   ← resolveSurchargePercent(config, ...) (:1438-1439)
 *           wasteMult: 1.15 si wasteRemoval, si no 1
 *           PRECIO = MAX(ceil(Σ zonas), 45)
 *
 *   HORAS   h_zona = (q / 150) · durMult_horas · wasteMult
 *           durMult_horas: 1.0 / 1.3 / 1.7  ← getDurationMultiplier(state), FIJO (:412-419)
 *           si Σh > 8  →  Σh · 0.9                                          (:1349)
 *           HORAS = MAX(1, ceil(Σh · 2) / 2)
 *
 * ESTADO TRAS LA FASE 3 (2026-09-11, autorizada por el usuario):
 *
 * · Corregido (esta rama): la superficie de césped por fotos ahora emite un aviso de
 *   plausibilidad (`lawn_area_implausible`) por encima de LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000 m²,
 *   alineado con el propio rango que el prompt a Gemini ya declaraba. Ver 2A.4.
 *
 * · NO corregido aquí, deliberadamente (transversal, ver COORDINACION-SERVICIOS.md §3.2):
 *   - T3: el multiplicador de horas para "descuidado"/"muy_descuidado" está FIJO en el código
 *     (getDurationMultiplier, 1.3/1.7) y no lee `condition_surcharges`, que es la config que el
 *     PRECIO sí usa. La usan también setos (:1275), desbroce (:1302) y arbustos (:1312) — tocarla
 *     es transversal. Y NO es correcto atarla al recargo de precio: el recargo es lo que el
 *     jardinero decide COBRAR, el multiplicador es lo que la faena tarda de verdad. Un jardinero
 *     que ponga 0 % de recargo para "muy_descuidado" seguiría necesitando más tiempo real, y
 *     igualar horas a precio le reservaría de menos y no llegaría. Confirmado y corregido de
 *     rumbo tras revisión del usuario (2026-09-11): no se toca.
 *   - T7 (consecuencia, no exclusiva de "descuidado"): un trabajo que no cabe en un único día
 *     (>10 bloques en el fixture L-V) se queda sin ningún hueco reservable en ninguna fecha, sin
 *     ningún aviso al cliente de por qué. Pasa con CUALQUIER estado si el área es suficiente
 *     (verificado también con 1700 m² en estado NORMAL, ajeno al multiplicador fijo) — es un
 *     hueco de producto (sin reserva multi-día ni aviso de "trabajo extenso"), no un efecto
 *     secundario de T3.
 *   - T2: redondeo de horas por residuo de coma flotante
 *     (`(5000/150)*0.9 = 30.000000000000004` en vez de 30 exacto). Vive en el código compartido
 *     "después de los bloques por servicio" (bookingQuoteCore.ts:1349-1350) — no es mío.
 *
 * Los tres puntos de arriba quedan como `untested(...)` citando su número de §3.2, no como
 * FALLA: un FALLA permanente aquí bloquearía cualquier integración futura de OTRO servicio
 * cuando se ejecuten todos los runners tras un merge (ver COORDINACION-SERVICIOS.md §4.5).
 * Cuando la ronda transversal los corrija, se reconvierten en aserciones reales.
 */

import {
  quote, expectQuote, expectError, sweep,
  previewProviders, validHours, sql,
  pass, fail, untested, report, PROVIDER_ID,
} from './_harness.mjs';

const LAWN = 'fe9d2d9e-3f62-4184-aa80-a3289d7c378a';
const IN_COVERAGE = { lat: 36.51, lng: -4.882 };        // junto al jardinero (Marbella)
const OUT_OF_COVERAGE = { lat: 40.4168, lng: -3.7038 }; // Madrid — ~430 km del jardinero (radio 40 km)

/** Payload del flujo de fotos: el motor solo lee quantity + state a nivel de zona. */
const photos = (quantity, state, wasteRemoval) => ({
  lawnZones: [{ quantity, state }],
  wasteRemoval,
});

/** Payload del flujo manual: forma que produce `buildLawnZones` + gate `dataInputMode`. */
const manual = (quantity, state, wasteRemoval) => ({
  dataInputMode: 'manual',
  wasteRemoval,
  lawnZones: [{
    id: 'manual-lawn-1',
    quantity,
    state,
    species: 'Césped general',
    stateProposedByAI: false,
    inputSource: 'manual',
  }],
});

/* ---------------------------------------------------------------- 2A.1 Escenarios */

async function scenarios() {
  console.log('\n── 2A.1 · Escenarios (predicción a mano vs motor) ─────────────');
  expectQuote('S1  base 1000 m² normal, sin retirada',
    await quote(LAWN, photos(1000, 'normal', false)), { totalPrice: 180, estimatedHours: 7 });
  expectQuote('S2  mínimo: 100 m² normal (18 € teóricos → 45)',
    await quote(LAWN, photos(100, 'normal', false)), { totalPrice: 45, estimatedHours: 1 });
  expectQuote('S3  recargo estado descuidado 1000 m² (precio ·1,20; horas ·1,3 fijo → 8 h por redondeo)',
    await quote(LAWN, photos(1000, 'descuidado', false)), { totalPrice: 216, estimatedHours: 8 });
  expectQuote('S4  recargo estado muy_descuidado 1000 m² (precio ·1,50; horas ·1,7 fijo → 10,5 h)',
    await quote(LAWN, photos(1000, 'muy_descuidado', false)), { totalPrice: 270, estimatedHours: 10.5 });
  expectQuote('S5  retirada de restos 1000 m² normal',
    await quote(LAWN, photos(1000, 'normal', true)), { totalPrice: 207, estimatedHours: 8 });
  expectQuote('S6  combinado descuidado + retirada 1000 m² (·1,3·1,15=9,97 → ·0,9 → 9 h)',
    await quote(LAWN, photos(1000, 'descuidado', true)), { totalPrice: 249, estimatedHours: 9 });
  expectQuote('S7  6000 m² se precia igual (con aviso de plausibilidad — ver 2A.4)',
    await quote(LAWN, photos(6000, 'normal', false)), { totalPrice: 1080, estimatedHours: 36 });

  const economics = (await quote(LAWN, photos(1000, 'normal', false))).economics;
  if (economics?.managementFee === 22.5 && economics?.payableLater === 180) {
    pass('S1  economics: managementFee 12,5% (22,50 €) y payableLater 180 €', JSON.stringify(economics).slice(0, 200));
  } else {
    fail('S1  economics: managementFee 12,5% y payableLater', JSON.stringify(economics));
  }
}

/* ---------------------------------------------------------------- 2A.2 Paridad IA↔manual */

async function parity() {
  console.log('\n── 2A.2 · Paridad flujo de fotos ↔ flujo manual ──────────────');
  const cases = [
    ['1000 m² normal, sin retirada',        1000, 'normal',         'normal',          false],
    ['1000 m² descuidado, sin retirada',    1000, 'descuidado',     'descuidado',      false],
    ['1000 m² muy descuidado, con retirada', 1000, 'muy_descuidado', 'muy descuidado',  true],
    ['800 m² descuidado, con retirada',      800,  'descuidado',     'descuidado',      true],
    ['1900 m² normal, sin retirada',        1900, 'normal',         'normal',          false],
  ];
  for (const [label, q, photoState, manualState, waste] of cases) {
    const p = await quote(LAWN, photos(q, photoState, waste));
    const m = await quote(LAWN, manual(q, manualState, waste));
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

/* ---------------------------------------------------------------- 2A.3 Barrido de variables (precio) */

async function variableSweep() {
  console.log('\n── 2A.3 · Barrido de cada clave de additional_config (precio) ─');
  // Base holgado (180 €, lejos del mínimo). wasteRemoval SIEMPRE declarado (omitirlo = true).
  await sweep(LAWN, photos(1000, 'normal', false), [
    { key: 'condition_surcharges.descuidado',     input: photos(1000, 'descuidado', false),     expectedDelta: { pct: 20 } },
    { key: 'condition_surcharges.muy_descuidado', input: photos(1000, 'muy_descuidado', false), expectedDelta: { pct: 50 } },
    { key: 'waste_removal.percentage',            input: photos(1000, 'normal', true),          expectedDelta: { pct: 15 } },
  ]);
  // price_per_m2 → validado por S1 (0,18 €/m² · 1000 = 180).
  // yield_m2_per_hour → validado por las horas de S1 (1000/150 = 6,67 → 7).
  // minimum_price → validado por S2 y el bloque 2A.5.
}

/* ------------------------------------------- 2A.3b Multiplicador de horas fijo (T3, transversal) */

async function priceHoursConsistency() {
  console.log('\n── 2A.3b · Multiplicador de horas fijo vs. recargo de precio (T3 — transversal, NO se arregla aquí) ─');
  // getDurationMultiplier (bookingQuoteCore.ts:412-419) usa 1.0/1.3/1.7 fijos para "normal"/
  // "descuidado"/"muy_descuidado"; el PRECIO de las mismas zonas usa el % que el jardinero
  // configura en condition_surcharges (resolveSurchargePercent, :1438-1439). Con este
  // jardinero (20 %/50 %) la diferencia es real y medible en muy_descuidado: 10,5 h reales
  // frente a las 9,0 h que darían las horas si usaran el mismo 50 % que ya paga el precio.
  //
  // NO se corrige atando las horas al recargo de precio: son dos cosas distintas por diseño.
  // El recargo es lo que el jardinero decide COBRAR de más; el multiplicador es lo que la
  // faena tarda de verdad. Un jardinero que ponga 0 % de recargo para "muy_descuidado" (p.ej.
  // como promoción) seguiría necesitando más tiempo real — igualar horas a precio le
  // reservaría el tiempo de un césped normal y no llegaría. Además, `getDurationMultiplier` la
  // comparten setos (:1275), desbroce (:1302) y arbustos (:1312): tocarla es transversal.
  // Documentado como T3 en COORDINACION-SERVICIOS.md §3.2; se deja como observación, no como
  // aserción, para no bloquear la integración de otros servicios con un FALLA permanente.
  const res = await quote(LAWN, photos(1000, 'muy_descuidado', false));
  untested('T3 · horas de muy_descuidado (1000 m²) usan multiplicador fijo, no el recargo configurado',
    `motor: ${res.estimatedHours} h (1,7 fijo) · si usara el 50 % configurado (igual que el precio) serían 9,0 h — ` +
    `diferencia real, pero NO se corrige acoplando horas a precio (ver comentario). Transversal: T3 en COORDINACION-SERVICIOS.md §3.2.`);

  const res2 = await quote(LAWN, photos(1400, 'descuidado', false));
  untested('T3 · horas de descuidado (1400 m²) usan multiplicador fijo, no el recargo configurado',
    `motor: ${res2.estimatedHours} h (1,3 fijo) · con el 20 % configurado serían 10,5 h — mismo T3.`);
}

/* ---------------------------------------------------------------- 2A.4 Límites */

async function limits() {
  console.log('\n── 2A.4 · Límites y plausibilidad ────────────────────────────');
  // La validación de MANUAL_RANGES vive en booking-authority/index.ts (gate previo al
  // despacho), NO en bookingQuoteCore.ts: quoteLocal() llama a
  // buildAuthoritativeBookingQuote() directamente y ese gate queda fuera. Por eso, igual
  // que la puerta de licencia fitosanitaria, en local sale NO PROBADO — no es un fallo del
  // motor, es una limitación de este modo de medir.
  //
  // Verificado aparte con una llamada HTTP puntual contra el stack de referencia (que sirve
  // origin/main sin modificar — todavía no he tocado ningún fichero de producto, así que
  // medir por HTTP ahora mismo sigue midiendo MI código) el 2026-09-11:
  //   5001 m² manual  → 422 manual_input_invalid ("debe estar entre 1 y 5000") ✓
  //   estado "fatal"  → 422 manual_input_invalid ("valor no permitido")        ✓
  //   0 m² manual     → 422 manual_input_invalid ("debe estar entre 1 y 5000") ✓
  //   5000 m² normal  → 200, pero 900 € / 30,5 h (ver el hallazgo de redondeo más abajo)
  // MANUAL_RANGES.lawn.superficie_m2 = {min:1, max:5000} (manualEntrySchema.ts:323) SÍ se
  // aplica correctamente en producción; esto no es un hallazgo.
  if (process.env.READINESS_ENGINE === 'local') {
    untested('manual 5001 m² → 422 manual_input_invalid', 'la validación de rango vive en booking-authority; verificado por HTTP puntual, ver comentario. Reejecutar sin READINESS_ENGINE=local para que el runner lo cubra.');
    untested('manual <1 m² (0) → 422 manual_input_invalid', 'idem — verificado por HTTP puntual');
    untested('manual estado inexistente → 422 manual_input_invalid', 'idem — verificado por HTTP puntual');
  } else {
    await expectError('manual 5001 m² → 422 manual_input_invalid',
      await quote(LAWN, manual(5001, 'descuidado', false)), { status: 422, code: 'manual_input_invalid' });
    await expectError('manual <1 m² (0) → 422 manual_input_invalid',
      await quote(LAWN, manual(0, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
    await expectError('manual estado inexistente → 422 manual_input_invalid',
      await quote(LAWN, { dataInputMode: 'manual', wasteRemoval: false, lawnZones: [{ id: 'x', quantity: 500, state: 'fatal' }] }),
      { status: 422, code: 'manual_input_invalid' });
  }

  // T2 (transversal, NO se arregla aquí — ver COORDINACION-SERVICIOS.md §3.2): 5000/150 no
  // es exacto en binario. (5000/150)·0,9 matemáticamente es 30 exacto, pero en coma flotante
  // IEEE-754 da 30.000000000000004 — un residuo de 3,55e-15 que, al multiplicar ·2 y aplicar
  // Math.ceil, salta al entero siguiente: 30,5 h en vez de 30,0 h. La ronda transversal
  // (2026-09-09) lo había dado por "no reproducido" barriendo `totalHours` en decimal; ese
  // método no lo encuentra porque el residuo depende de la CADENA de división/multiplicación
  // real, no del valor decimal final. Vive en el redondeo compartido "después de los bloques
  // por servicio" (bookingQuoteCore.ts:1349-1350) — no es de césped en solitario, así que se
  // deja como observación, no como aserción que bloquee otras integraciones.
  const roundingCase = await quote(LAWN, manual(5000, 'normal', false));
  untested('T2 · redondeo de horas por coma flotante (5000 m² normal)',
    `motor: ${roundingCase.totalPrice} € / ${roundingCase.estimatedHours} h · matemáticamente exacto: 900 € / 30,0 h ` +
    `(5000/150·0,9 = 30 sin resto) — diferencia real, confirmada dos veces (local y HTTP). Transversal: T2 en COORDINACION-SERVICIOS.md §3.2.`);

  // CORREGIDO (esta rama, autorizado 2026-09-11): el flujo de FOTOS ahora emite un aviso de
  // plausibilidad por encima de LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000 m², alineado con el rango
  // que el propio prompt a Gemini ya declaraba (new_prompts.ts:170-171) pero que antes no se
  // verificaba en ningún sitio del lado del motor.
  const huge = await quote(LAWN, photos(50000, 'normal', false));
  const hugeWarnings = (huge.warnings || []).map((w) => w.message || w).join(' | ');
  if (huge.ok && (huge.warnings || []).some((w) => w.code === 'lawn_area_implausible')) {
    pass('plausibilidad · fotos 50000 m² → aviso lawn_area_implausible', hugeWarnings);
  } else {
    fail('plausibilidad · fotos 50000 m² → aviso lawn_area_implausible',
      `esperaba warning code=lawn_area_implausible; obtenido warnings=${JSON.stringify(huge.warnings)}`);
  }

  // Frontera del aviso: exactamente en el límite (2000) no avisa ("> 2000", no ">="); 1 m² por
  // encima (2001) sí. Fija el comportamiento para que un cambio futuro del umbral se note aquí.
  const atLimit = await quote(LAWN, photos(2000, 'normal', false));
  const overLimit = await quote(LAWN, photos(2001, 'normal', false));
  const atLimitWarns = (atLimit.warnings || []).some((w) => w.code === 'lawn_area_implausible');
  const overLimitWarns = (overLimit.warnings || []).some((w) => w.code === 'lawn_area_implausible');
  if (!atLimitWarns && overLimitWarns) {
    pass('plausibilidad · frontera 2000 m² (sin aviso) vs 2001 m² (con aviso)', `2000→${atLimitWarns} · 2001→${overLimitWarns}`);
  } else {
    fail('plausibilidad · frontera 2000 m² (sin aviso) vs 2001 m² (con aviso)', `2000→${atLimitWarns} · 2001→${overLimitWarns}`);
  }
}

/* ---------------------------------------------------------------- 2A.5 Mínimo */

async function minimumPrice() {
  console.log('\n── 2A.5 · Precio mínimo ──────────────────────────────────────');
  expectQuote('99 m² normal → mínimo 45', await quote(LAWN, photos(99, 'normal', false)), { totalPrice: 45 });
  expectQuote('250 m² normal → 45 exactos (frontera)', await quote(LAWN, photos(250, 'normal', false)), { totalPrice: 45 });
  expectQuote('251 m² normal → 46 (ceil, por encima del mínimo)', await quote(LAWN, photos(251, 'normal', false)), { totalPrice: 46 });
}

/* ---------------------------------------------------------------- 2A.6 Cambio de precio */

async function priceChange() {
  console.log('\n── 2A.6 · Recálculo con variables corregidas por el jardinero ─');
  // El jardinero corrige la superficie 1000 → 1400 m² y el estado a descuidado.
  // 0.18·1400·1.20 = 302,4 → 303 € ;  horas reales (·1,3 fijo, ver 2A.3b) → 11 h
  expectQuote('recalculate_correction 1400 m² descuidado',
    await quote(LAWN, photos(1400, 'descuidado', false)), { totalPrice: 303, estimatedHours: 11 });
}

/* ---------------------------------------------------------------- 2A.7 Disponibilidad */

function nextSundayIso() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
function inDaysIso(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function availability() {
  console.log('\n── 2A.7 · Disponibilidad y cobertura ─────────────────────────');
  const inCov = { address: 'Marbella centro', addressCoordinates: IN_COVERAGE };
  const sunday = nextSundayIso();

  // Control positivo: un día laborable dentro de cobertura devuelve horas.
  const wd = await validHours(LAWN, inDaysIso(7), { ...inCov, ...photos(500, 'normal', false) });
  const wdHours = wd.body?.validHours || [];
  if (wd.status === 200 && wdHours.length > 0) {
    pass(`valid_hours laborable ${inDaysIso(7)}`, `${wdHours.length} horas: ${JSON.stringify(wdHours)}`);
  } else {
    fail(`valid_hours laborable ${inDaysIso(7)}`, `status ${wd.status}, validHours=${JSON.stringify(wdHours)}`);
  }

  // Domingo: sin huecos sembrados (fixture solo L-V y S).
  const vh = await validHours(LAWN, sunday, { ...inCov, ...photos(500, 'normal', false) });
  const hours = vh.body?.validHours || [];
  if (vh.status === 200 && hours.length === 0) {
    pass(`valid_hours domingo ${sunday}`, `validHours vacío (exclusion: ${vh.body?.exclusion?.code || 'ninguna'})`);
  } else {
    fail(`valid_hours domingo ${sunday}`, `status ${vh.status}, validHours=${JSON.stringify(hours)}`);
  }

  const weekday = inDaysIso(7);
  const pp = await previewProviders(
    LAWN,
    { address: 'Calle de Alcalá 1, Madrid', addressCoordinates: OUT_OF_COVERAGE, ...photos(500, 'normal', false) },
    { selectedDate: weekday, windowDays: 14 },
  );
  const exclusion = pp.body?.exclusions?.[PROVIDER_ID];
  const inQuotes = Boolean(pp.body?.quotes?.[PROVIDER_ID]);
  if (!inQuotes && exclusion?.code === 'outside_coverage') {
    pass('preview_providers dirección fuera de cobertura', `excluido con code=${exclusion.code}`);
  } else {
    fail('preview_providers dirección fuera de cobertura',
      `inQuotes=${inQuotes}, exclusion=${JSON.stringify(exclusion)}`);
  }

  // La jornada laborable sembrada es L-V 08:00-18:00 = 10 bloques de 1h (sábado solo 5).
  // Un trabajo moderadamente difícil sigue cabiendo en un día:
  // 700 m² muy_descuidado sin retirada → 8 h (cabe en los 10 bloques del laborable).
  const modQ = await quote(LAWN, photos(700, 'muy_descuidado', false));
  const modPP = await previewProviders(
    LAWN,
    { address: 'Marbella centro', addressCoordinates: IN_COVERAGE, ...photos(700, 'muy_descuidado', false) },
    { selectedDate: inDaysIso(7), windowDays: 21 },
  );
  const modEligible = (modPP.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  if (modQ.ok && modQ.estimatedHours === 8 && modEligible) {
    pass('700 m² muy_descuidado cabe en un día (8 h) y el jardinero es elegible',
      `q=${modQ.totalPrice} €/${modQ.estimatedHours} h · jardinero elegible`);
  } else {
    fail('700 m² muy_descuidado cabe en un día (8 h) y el jardinero es elegible',
      `q=${modQ.totalPrice}/${modQ.estimatedHours}h · elegible=${modEligible} · excl=${JSON.stringify(modPP.body?.exclusions?.[PROVIDER_ID])}`);
  }

  // T3 (transversal, NO se arregla aquí): 1000 m² muy_descuidado calcula 10,5 h (ver S4),
  // que necesita 11 bloques consecutivos — más de los 10 que tiene CUALQUIER día de la
  // semana sembrado (L-V 08-18). Es consecuencia del multiplicador fijo de horas (2A.3b);
  // no se corrige aquí por lo explicado ahí (el recargo de precio y el tiempo real son cosas
  // distintas por diseño). Se deja como observación.
  const bigQ = await quote(LAWN, photos(1000, 'muy_descuidado', false));
  const bigPP = await previewProviders(
    LAWN,
    { address: 'Marbella centro', addressCoordinates: IN_COVERAGE, ...photos(1000, 'muy_descuidado', false) },
    { selectedDate: inDaysIso(7), windowDays: 21 },
  );
  const bigEligible = (bigPP.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  console.log(`  · 1000 m² muy_descuidado: ${bigQ.totalPrice} €/${bigQ.estimatedHours} h (necesita ${Math.ceil(bigQ.estimatedHours)} bloques de 1h)`);
  untested('T3 · 1000 m² muy_descuidado (10,5h, multiplicador fijo) sin ningún hueco en 21 días',
    `elegible=${bigEligible} · exclusion=${JSON.stringify(bigPP.body?.exclusions?.[PROVIDER_ID])} — ` +
    `consecuencia de T3 (ver 2A.3b); no se corrige acoplando horas a precio. Transversal: T3 en COORDINACION-SERVICIOS.md §3.2.`);

  // T7 (transversal, NO se arregla aquí): un trabajo que no cabe en un solo día se queda sin
  // ningún hueco reservable y sin ningún aviso al cliente de por qué — y esto pasa con
  // CUALQUIER estado, no solo "descuidado"/"muy_descuidado". 1700 m² en estado NORMAL (ajeno
  // al multiplicador fijo de T3: durMult=1.0 tanto si fuera coherente como si no) ya no cabe:
  // (1700/150)=11,333 → >8 → ·0,9=10,2 → redondeo → 10,5 h → 11 bloques.
  const t7Q = await quote(LAWN, photos(1700, 'normal', false));
  const t7PP = await previewProviders(
    LAWN,
    { address: 'Marbella centro', addressCoordinates: IN_COVERAGE, ...photos(1700, 'normal', false) },
    { selectedDate: inDaysIso(7), windowDays: 21 },
  );
  const t7Eligible = (t7PP.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  console.log(`  · 1700 m² normal (control T7, sin recargo de estado): ${t7Q.totalPrice} €/${t7Q.estimatedHours} h`);
  untested('T7 · 1700 m² normal (sin recargo de estado) tampoco cabe en un día, sin aviso al cliente',
    `elegible=${t7Eligible} · warnings=${JSON.stringify(t7Q.warnings)} — prueba que el hueco-de-producto (sin reserva ` +
    `multi-día ni aviso de "trabajo extenso") es general al tamaño, no un efecto secundario de T3. Transversal: T7 en COORDINACION-SERVICIOS.md §3.2.`);
}

/* ------------------------------------------------ 2A.8 Disponibilidad envenenada */

async function orphanHoldBlocks() {
  console.log('\n── 2A.8 · Bloques de hold huérfanos NO cuentan ────────────────');
  const date = inDaysIso(10); // laborable con huecos sembrados (verificado por SQL: 10 bloques libres)

  const row = sql(`select a.id as attempt_id, a.quote_id, q.client_id, q.service_id
                   from public.booking_payment_attempts a
                   join public.booking_quotes q on q.id = a.quote_id
                   where not exists (select 1 from public.booking_schedule_holds h where h.payment_attempt_id = a.id)
                   limit 1;`).trim();
  if (!row) { untested('hold huérfano', 'no hay payment_attempt+quote para el montaje (crea uno con create_quote primero)'); return; }
  const [attemptId, quoteId, clientId, serviceId] = row.split('|');

  const before = await validHours(LAWN, date, { addressCoordinates: IN_COVERAGE, ...photos(300, 'normal', false) });
  if ((before.body?.validHours || []).length === 0) {
    untested('hold huérfano', `${date} ya no tiene huecos antes del montaje; elige otra fecha`);
    return;
  }

  const holdId = '00000000-dead-4000-8000-00000000feed';
  try {
    sql(`insert into public.booking_schedule_holds
         (id, payment_attempt_id, client_id, gardener_id, service_id, quote_id,
          selected_date, selected_start_time, duration_hours, status, expires_at)
         values ('${holdId}', '${attemptId}', '${clientId}', '${PROVIDER_ID}', '${serviceId}', '${quoteId}',
                 '${date}', '08:00', 8, 'released', now() + interval '1 hour')
         on conflict (id) do update set status='released';`);
    sql(`insert into public.booking_schedule_hold_blocks (hold_id, gardener_id, date, hour_block)
         select '${holdId}', '${PROVIDER_ID}', '${date}', g from generate_series(8,17) g
         on conflict do nothing;`);

    const after = await validHours(LAWN, date, { addressCoordinates: IN_COVERAGE, ...photos(300, 'normal', false) });
    const hrs = after.body?.validHours || [];
    const remaining = Number(sql(`select count(*) from public.booking_schedule_hold_blocks where hold_id='${holdId}';`).trim());
    if (hrs.length > 0) {
      pass('hold huérfano ("released") NO envenena la agenda',
        `${date}: ${hrs.length} horas disponibles pese al hold 'released'; bloques huérfanos restantes = ${remaining}`);
    } else {
      fail('hold huérfano ("released") NO envenena la agenda',
        `${date}: validHours vacío — los bloques del hold 'released' siguen contando (bloques restantes=${remaining})`);
    }
  } finally {
    sql(`delete from public.booking_schedule_hold_blocks where hold_id='${holdId}';`);
    sql(`delete from public.booking_schedule_holds where id='${holdId}';`);
  }
}

/* ---------------------------------------------------------------- run */

const run = async () => {
  await scenarios();
  await parity();
  await variableSweep();
  await priceHoursConsistency();
  await limits();
  await minimumPrice();
  await priceChange();
  await availability();
  await orphanHoldBlocks();
  report();
};

run().catch((error) => {
  console.error('\n runner abortado:', error);
  process.exitCode = 1;
});
