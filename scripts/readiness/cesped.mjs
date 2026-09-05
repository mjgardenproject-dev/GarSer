/**
 * Red de regresión de preparación para producción — Corte de césped.
 *
 *   node scripts/readiness/cesped.mjs
 *
 * Sale con código 1 si algo falla. Relanzar tras cualquier cambio en el motor
 * (`src/shared/bookingQuoteCore.ts`) o en la config del servicio del jardinero.
 *
 * Config del jardinero sembrado (11111111-…-111111111111), verificada en BD:
 *   pricing_method: per_quantity · price_per_m2: 0.18 · yield_m2_per_hour: 150
 *   minimum_price: 45 · condition_surcharges: {descuidado:20, muy_descuidado:50}
 *   waste_removal.percentage: 15
 *
 * Reglas del motor usadas para las predicciones (a mano):
 *   precio_zona = 0.18 · q · stateMult · wasteMult      stateMult: 1 / 1.20 / 1.50
 *   PRECIO      = MAX(ceil(Σ zonas), 45)                 wasteMult: 1.15 si retirada
 *   h_zona      = (q / 150) · durMult · wasteMult        durMult:  1 / 1.3 / 1.7
 *   si Σh > 8  →  Σh · 0.9                               wasteMult (horas): 1.15 si retirada
 *   HORAS       = MAX(1, ceil(Σh · 2) / 2)               (redondeo hacia arriba a 0,5 h)
 */

import {
  quote, expectQuote, expectError, sweep,
  previewProviders, validHours, sql,
  pass, fail, untested, report, PROVIDER_ID,
} from './_harness.mjs';

const LAWN = 'dd8a3286-0eb3-4175-b440-47ea83ee964e';
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
  // NOTA: tras el fix 5, las horas de "descuidado" / "muy descuidado" usan el % del
  // jardinero (condition_surcharges → 1,20 / 1,50), no el 1,3 / 1,7 fijo.
  expectQuote('S1  base 1000 m² normal, sin retirada',
    await quote(LAWN, photos(1000, 'normal', false)), { totalPrice: 180, estimatedHours: 7 });
  expectQuote('S2  mínimo: 100 m² normal (18 € teóricos → 45)',
    await quote(LAWN, photos(100, 'normal', false)), { totalPrice: 45, estimatedHours: 1 });
  expectQuote('S3  recargo estado descuidado 1000 m² (1000/150·1,20 = 8,0 h)',
    await quote(LAWN, photos(1000, 'descuidado', false)), { totalPrice: 216, estimatedHours: 8 });
  expectQuote('S4  recargo estado muy_descuidado 1000 m² (·1,50 = 10 h → ·0,9 = 9 h)',
    await quote(LAWN, photos(1000, 'muy_descuidado', false)), { totalPrice: 270, estimatedHours: 9 });
  expectQuote('S5  retirada de restos 1000 m² normal',
    await quote(LAWN, photos(1000, 'normal', true)), { totalPrice: 207, estimatedHours: 8 });
  expectQuote('S6  combinado descuidado + retirada 1000 m² (·1,20·1,15 = 9,2 → ·0,9 → 8,5 h)',
    await quote(LAWN, photos(1000, 'descuidado', true)), { totalPrice: 249, estimatedHours: 8.5 });
  expectQuote('S7  6000 m² se precia igual, pero ahora con warning',
    await quote(LAWN, photos(6000, 'normal', false)), { totalPrice: 1080, estimatedHours: 36 });

  const s7 = await quote(LAWN, photos(6000, 'normal', false));
  const s7warn = (s7.warnings || []).join(' | ');
  if (/supera lo habitual|plausib/i.test(s7warn)) {
    pass('S7  warning de plausibilidad presente', s7warn);
  } else {
    fail('S7  warning de plausibilidad presente', `warnings = ${JSON.stringify(s7.warnings)}`);
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

/* ---------------------------------------------------------------- 2A.3 Barrido de variables */

async function variableSweep() {
  console.log('\n── 2A.3 · Barrido de cada clave de additional_config ─────────');
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

/* ---------------------------------------------------------------- 2A.4 Límites */

async function limits() {
  console.log('\n── 2A.4 · Límites y plausibilidad ────────────────────────────');
  // Fix 3: el máximo manual bajó de 5000 a 2000 m², alineado con LAWN_MAX_PLAUSIBLE_AREA_M2.
  expectError('manual 2001 m² → 422 manual_input_invalid (nuevo tope)',
    await quote(LAWN, manual(2001, 'descuidado', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual 6000 m² → 422 manual_input_invalid',
    await quote(LAWN, manual(6000, 'descuidado', false)), { status: 422, code: 'manual_input_invalid' });
  expectQuote('manual 2000 m² normal → cotiza (frontera, 0,18·2000 = 360 €)',
    await quote(LAWN, manual(2000, 'normal', false)), { totalPrice: 360 });
  expectError('manual <1 m² → 422 manual_input_invalid',
    await quote(LAWN, manual(0, 'normal', false)), { status: 422, code: 'manual_input_invalid' });
  expectError('manual estado inexistente → 422 manual_input_invalid',
    await quote(LAWN, { dataInputMode: 'manual', wasteRemoval: false, lawnZones: [{ id: 'x', quantity: 500, state: 'fatal' }] }),
    { status: 422, code: 'manual_input_invalid' });

  // Fix 2: el flujo de fotos ya NO tiene tope, pero el motor emite un warning de
  // plausibilidad por encima de LAWN_MAX_PLAUSIBLE_AREA_M2 (2000 m²).
  const big = await quote(LAWN, photos(6000, 'normal', false));
  const bigWarn = (big.warnings || []).join(' | ');
  if (big.ok && /supera lo habitual|plausib/i.test(bigWarn)) {
    pass('plausibilidad · fotos 6000 m² → warning', bigWarn);
  } else {
    fail('plausibilidad · fotos 6000 m²',
      `precia ${big.totalPrice} € / ${big.estimatedHours} h · warnings = ${JSON.stringify(big.warnings)}`);
  }
  // Justo en el umbral (2000 m²): sin warning de plausibilidad (es "> 2000", no ">=").
  const edge = await quote(LAWN, photos(2000, 'normal', false));
  const edgeWarn = (edge.warnings || []).join(' | ');
  if (edge.ok && !/supera lo habitual/i.test(edgeWarn)) {
    pass('plausibilidad · fotos 2000 m² → sin warning de área', edgeWarn || '(sin warnings de área)');
  } else {
    fail('plausibilidad · fotos 2000 m²', `warnings = ${JSON.stringify(edge.warnings)}`);
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
  // 0.18·1400·1.20 = 302,4 → 303 ;  (1400/150)·1.20 = 11,2 → ·0.9 = 10,08 → 10,5 h
  expectQuote('recalculate_correction 1400 m² descuidado',
    await quote(LAWN, photos(1400, 'descuidado', false)), { totalPrice: 303, estimatedHours: 10.5 });
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

  // Fix 5: un césped 1000 m² muy descuidado ahora estima 9 h (·1,50, no ·1,70),
  // cabe en una jornada laborable (≤ 10 bloques) → el jardinero SÍ aparece.
  const midQ = await quote(LAWN, photos(1000, 'muy_descuidado', false));
  const midPP = await previewProviders(
    LAWN,
    { address: 'Marbella centro', addressCoordinates: IN_COVERAGE, ...photos(1000, 'muy_descuidado', false) },
    { selectedDate: inDaysIso(7), windowDays: 21 },
  );
  const midEligible = (midPP.body?.eligibleProviderIds || []).includes(PROVIDER_ID);
  if (midQ.ok && midQ.estimatedHours === 9 && midEligible) {
    pass('1000 m² muy descuidado ahora es reservable (9 h)',
      `q=${midQ.totalPrice} €/${midQ.estimatedHours} h · jardinero elegible`);
  } else {
    fail('1000 m² muy descuidado ahora es reservable (9 h)',
      `q=${midQ.totalPrice}/${midQ.estimatedHours}h · elegible=${midEligible} · excl=${midPP.body?.exclusions?.[PROVIDER_ID]?.code || 'ninguna'}`);
  }

  // Fix 1: un trabajo que de verdad no cabe en un día (1800 m² descuidado ≈ 13 h)
  // sigue sin poder reservarse, PERO ahora el motor emite un warning de "trabajo
  // extenso" antes, para que el funnel avise en vez de mandar al cliente a un paso
  // de selección vacío con un mensaje que culpa a la agenda. (Hallazgo #1.)
  const bigQ = await quote(LAWN, photos(1800, 'descuidado', false));
  const bigWarn = (bigQ.warnings || []).join(' | ');
  if (bigQ.ok && bigQ.estimatedHours > 10 && /más de una visita|no cabe|extenso|jornada/i.test(bigWarn)) {
    pass('1800 m² descuidado → warning de trabajo extenso antes del paso de selección',
      `${bigQ.estimatedHours} h · ${bigWarn}`);
  } else {
    fail('1800 m² descuidado → warning de trabajo extenso',
      `q=${bigQ.totalPrice}/${bigQ.estimatedHours}h · warnings=${JSON.stringify(bigQ.warnings)}`);
  }
}

/* ------------------------------------------------ 2A.8 Disponibilidad envenenada */

async function orphanHoldBlocks() {
  console.log('\n── 2A.8 · Bloques de hold huérfanos NO cuentan (fix 4) ───────');
  const date = inDaysIso(9); // laborable con huecos sembrados

  // Necesita un payment_attempt + quote reales a los que colgar el hold sintético.
  const row = sql(`select a.id as attempt_id, a.quote_id, q.client_id, q.service_id
                   from public.booking_payment_attempts a
                   join public.booking_quotes q on q.id = a.quote_id
                   limit 1;`).trim();
  if (!row) { untested('fix 4 · hold huérfano', 'no hay payment_attempt+quote para el montaje'); return; }
  const [attemptId, quoteId, clientId, serviceId] = row.split('|');

  const before = await validHours(LAWN, date, { addressCoordinates: IN_COVERAGE, ...photos(300, 'normal', false) });
  if ((before.body?.validHours || []).length === 0) {
    untested('fix 4 · hold huérfano', `${date} ya no tiene huecos antes del montaje; elige otra fecha`);
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
    // Tras el fix, los bloques de un hold 'released' se ignoran (y la limpieza
    // oportunista los borra). Antes del fix: validHours = [].
    const remaining = Number(sql(`select count(*) from public.booking_schedule_hold_blocks where hold_id='${holdId}';`).trim());
    if (hrs.length > 0) {
      pass('fix 4 · hold huérfano NO envenena la agenda',
        `${date}: ${hrs.length} horas disponibles pese al hold 'released'; bloques huérfanos restantes tras la limpieza = ${remaining}`);
    } else {
      fail('fix 4 · hold huérfano NO envenena la agenda',
        `${date}: validHours vacío — los bloques del hold 'released' siguen contando`);
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
