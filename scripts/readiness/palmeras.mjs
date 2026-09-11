/**
 * Red de regresión — Poda de palmeras (garser-service-production-readiness).
 *
 *   READINESS_ENGINE=local node scripts/readiness/palmeras.mjs
 *
 * Habla con `booking-authority` (o con el motor en proceso, `buildAuthoritativeBookingQuote`
 * vía `bookingQuoteCore`, con READINESS_ENGINE=local). Sale con código 1 si algo falla.
 *
 * IMPORTANTE — reescrito el 2026-09-11 desde cero contra `origin/main`. La versión anterior
 * de este fichero venía de una tanda de auditorías hecha sobre una rama local que NUNCA se
 * subió a GitHub (ver docs/audit/HALLAZGOS-CONOCIDOS.md) y usaba el serviceId fantasma
 * `7f1b414c-...` (el real es `8e5a99f5-5ab5-40c7-b4f3-a9272c08f47e`).
 *
 * Fase 3 (2026-09-12) — hallazgos #1a/#1b y #2 CORREGIDOS y verificados por este mismo
 * runner (71 PASA / 0 FALLA / 0 NO PROBADO):
 *   - #1a/#1b: `calculatePalmHoursFromConfig` (`src/domain/pricingEngine.ts`) ahora
 *     multiplica por `trunkMult` cuando `hasTrunkPeeling` está activo, y suma
 *     `PALM_PHYTOSANITARY_TIME_HOURS × quantity` cuando `hasPhytosanitary` está activo —
 *     antes ninguno de los dos afectaba a las horas, solo al precio.
 *   - #2: `bookingQuoteCore.ts` emite `palm_quantity_implausible` cuando `quantity` de un
 *     grupo supera `PALM_MAX_PLAUSIBLE_QUANTITY` (20), mismo patrón que
 *     `lawn_area_implausible`/`hedge_length_implausible`. El stepper de palmeras del flujo
 *     de fotos (`DetailsPage.tsx`, `handlePalmQuantityChange`) tiene ahora el mismo tope que
 *     el flujo manual (`MANUAL_RANGES.palm.quantity.max`, 50) — no lo cubre este runner por
 *     ser un cambio de UI, ver el informe.
 *   - #3 (configurador del jardinero) y #4 (RPC `propose_booking_price_change`) también
 *     corregidos en esta Fase 3, pero no los cubre este runner: #3 es una migración de
 *     `selected_species` dentro de `PalmPricingConfigurator.tsx` (UI), y #4 es una función
 *     SQL que actúa sobre una reserva ya persistida, no sobre `recalculate_correction`. Ver
 *     el informe (`docs/audit/2026-09-11-palmeras/REPORT.md`) para su evidencia.
 * Las predicciones de abajo están recalculadas a mano contra el código y la configuración
 * REALES de `origin/main` tras los cuatro fixes.
 *
 * Config del jardinero sembrado (supabase/seed.sql, jardinero.local@test.local),
 * verificada por SQL el 2026-09-11:
 *   pricing_method: per_quantity
 *   height_prices / yield_units_per_hour: 21 combinaciones especie×banda (abajo)
 *   condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 }
 *   waste_removal.percentage: 15   phytosanitary: 18 (€ plano/ud)
 *   trunk_finish: 20 (%)   access_difficulty: 25 (%)   minimum_price: 60
 */

import {
  quote,
  authority,
  previewProviders,
  validHours,
  expectQuote,
  expectError,
  pass,
  fail,
  untested,
  report,
  PROVIDER_ID,
} from './_harness.mjs';

const SERVICE_ID = '8e5a99f5-5ab5-40c7-b4f3-a9272c08f47e'; // Poda de palmeras (verificado por SQL, no el de references/servicios.md)

// --- Tarifas sembradas: precio €/ud y rendimiento ud/h por especie y banda ----
const SEED = {
  'Phoenix canariensis': {
    '0-4': { price: 45, yield: 1.5 },
    '4-10': { price: 90, yield: 0.8 },
    '>10': { price: 150, yield: 0.5 },
  },
  'Phoenix dactylifera': {
    '0-5': { price: 50, yield: 1.4 },
    '5-10': { price: 95, yield: 0.8 },
    '10-15': { price: 160, yield: 0.5 },
    '>15': { price: 220, yield: 0.35 },
  },
  'Washingtonia robusta/filifera': {
    '0-4': { price: 40, yield: 1.6 },
    '4-12': { price: 85, yield: 0.9 },
    '12-20': { price: 140, yield: 0.55 },
    '>20': { price: 200, yield: 0.4 },
  },
  'Syagrus romanzoffiana': {
    '0-5': { price: 45, yield: 1.5 },
    '5-10': { price: 85, yield: 0.9 },
    '>10': { price: 140, yield: 0.6 },
  },
  'Trachycarpus fortunei': {
    '0-3': { price: 35, yield: 2.0 },
    '3-6': { price: 60, yield: 1.2 },
    '>6': { price: 95, yield: 0.8 },
  },
  'Roystonea regia': {
    '0-6': { price: 55, yield: 1.2 },
    '>6': { price: 120, yield: 0.7 },
  },
};

const MIN_PRICE = 60;
const SURCHARGE = { normal: 0, descuidado: 20, muy_descuidado: 50 };
const WASTE_PCT = 15;
const PHYTO_EUR = 18;
const TRUNK_PCT = 20;
const ACCESS_PCT = 25;

// Especies que NO admiten fitosanitario / pelado de tronco (speciesBusinessRules.ts)
const NO_PHYTO = new Set(['Syagrus romanzoffiana', 'Roystonea regia']);
const NO_TRUNK = new Set(['Syagrus romanzoffiana', 'Roystonea regia', 'Trachycarpus fortunei']);
// Banda mínima por especie (sin sufijo m): donde NO aplica access_difficulty
const LOWEST_BAND = {
  'Phoenix canariensis': '0-4',
  'Phoenix dactylifera': '0-5',
  'Washingtonia robusta/filifera': '0-4',
  'Syagrus romanzoffiana': '0-5',
  'Trachycarpus fortunei': '0-3',
  'Roystonea regia': '0-6',
};

// --- Réplica local de la aritmética del motor (para PREDECIR, no para confiar) --
const ceil = (n) => Math.ceil(n - 1e-9);
const round2 = (n) => Math.round(n * 100) / 100;

function predictPrice({ species, band, state = 'normal', qty = 1, waste = false, phyto = false, trunk = false, access = false }) {
  const basePrice = SEED[species][band].price;
  const stateMult = 1 + (SURCHARGE[state] || 0) / 100;
  const wasteMult = waste ? 1 + WASTE_PCT / 100 : 1;
  const currentValue = basePrice * stateMult * wasteMult;

  let unitExtra = 0;
  if (phyto && !NO_PHYTO.has(species)) unitExtra += PHYTO_EUR;
  if (trunk && !NO_TRUNK.has(species)) unitExtra += currentValue * (TRUNK_PCT / 100);

  const canAccess = band !== LOWEST_BAND[species];
  const accessMult = access && canAccess ? 1 + ACCESS_PCT / 100 : 1;

  const line = (currentValue + unitExtra) * accessMult * qty;
  return ceil(Math.max(line, MIN_PRICE));
}

// Horas: pricingEngine.ts `calculatePalmHoursFromConfig` (corregido 2026-09-12, hallazgo
// #1a/#1b de la auditoría de palmeras) multiplica por stateMult · wasteMult · accessMult ·
// trunkMult, y suma PALM_PHYTOSANITARY_TIME_HOURS × qty cuando hasPhytosanitary está activo
// y la especie lo admite. Antes ninguno de los dos extras movía las horas.
const PHYTO_TIME_HOURS = 0.1;

function predictHours({ species, band, state = 'normal', qty = 1, waste = false, access = false, trunk = false, phyto = false }) {
  const y = SEED[species][band].yield;
  const stateMult = 1 + (SURCHARGE[state] || 0) / 100;
  const wasteMult = waste ? 1 + WASTE_PCT / 100 : 1;
  const canAccess = band !== LOWEST_BAND[species];
  const accessMult = access && canAccess ? 1 + ACCESS_PCT / 100 : 1;
  const trunkMult = trunk && !NO_TRUNK.has(species) ? 1 + TRUNK_PCT / 100 : 1;
  const phytoHours = phyto && !NO_PHYTO.has(species) ? PHYTO_TIME_HOURS * qty : 0;

  let groupHours = (qty / y) * stateMult * wasteMult * accessMult * trunkMult + phytoHours;
  let total = round2(groupHours);
  if (total > 8) total *= 0.9;
  return Math.max(1, ceil(total * 2) / 2);
}

// bookingInput con un solo grupo de palmeras. `wasteRemoval` SIEMPRE explícito:
// omitirlo equivale a true en el motor (bookingQuoteCore.ts:1044).
const palm = (o) => ({
  palmGroups: [
    {
      id: 'g1',
      species: o.species,
      height: o.band + (o.m ? 'm' : ''),
      quantity: o.qty ?? 1,
      state: o.state ?? 'normal',
      hasPhytosanitary: o.phyto ?? false,
      hasTrunkPeeling: o.trunk ?? false,
      hasAccessDifficulty: o.access ?? false,
    },
  ],
  wasteRemoval: o.waste ?? false,
});

/** Extrae los códigos de warning tanto en forma local ({code,message}) como HTTP (string). */
const warningCodes = (warnings) =>
  (warnings || []).map((w) => (typeof w === 'string' ? w : w?.code)).filter(Boolean);

const MARBELLA = { lat: 36.5094, lng: -4.8858 };
const MADRID = { lat: 40.4168, lng: -3.7038 };

async function main() {
  // ======================================================================
  // BLOQUE 1 — Escenarios de la tabla de predicciones (Fase 1)
  // ======================================================================
  console.log('\n=== 1. Escenarios ===');
  const scenarios = [
    { label: 'S1 base — PC 4-10 normal ×2, sin retirada', in: { species: 'Phoenix canariensis', band: '4-10', qty: 2 } },
    { label: 'S2 mínimo — Trachycarpus 0-3 normal ×1', in: { species: 'Trachycarpus fortunei', band: '0-3', qty: 1 } },
    { label: 'S3 estado — PC 4-10 muy_descuidado ×2', in: { species: 'Phoenix canariensis', band: '4-10', qty: 2, state: 'muy_descuidado' } },
    { label: 'S4 retirada+fito — PC 4-10 normal ×2, retirada + fitosanitario', in: { species: 'Phoenix canariensis', band: '4-10', qty: 2, waste: true, phyto: true } },
    { label: 'S5 terminal+acceso+tronco — Washingtonia >20 descuidado ×1, retirada + acceso + tronco', in: { species: 'Washingtonia robusta/filifera', band: '>20', qty: 1, state: 'descuidado', waste: true, access: true, trunk: true } },
  ];
  for (const s of scenarios) {
    const res = await quote(SERVICE_ID, palm(s.in));
    expectQuote(s.label, res, { totalPrice: predictPrice(s.in), estimatedHours: predictHours(s.in) });
  }

  // S5 debe venir marcado como banda terminal abierta (verificación final del profesional)
  {
    const res = await quote(SERVICE_ID, palm(scenarios[4].in));
    const codes = warningCodes(res.warnings);
    (res.ok && codes.includes('palm_terminal_range') ? pass : fail)(
      'S5: aviso palm_terminal_range presente (banda >20 es terminal en Washingtonia)',
      `warnings=${JSON.stringify(res.warnings)}`,
    );
  }

  // ======================================================================
  // BLOQUE 2 — Paridad manual ↔ flujo de fotos (mismo input físico)
  // ======================================================================
  console.log('\n=== 2. Paridad IA ↔ manual ===');
  {
    const physical = { species: 'Phoenix canariensis', band: '4-10', qty: 1, state: 'normal', phyto: true };
    // Flujo de fotos: banda sin sufijo (mapPalmHeightToBand → '4-10')
    const ia = await quote(SERVICE_ID, palm({ ...physical, m: false }));
    // Flujo manual: banda con sufijo 'm' (manualEntryBuilders usa getPalmHeightBandsForSpecies) + dataInputMode
    const manual = await quote(SERVICE_ID, { ...palm({ ...physical, m: true }), dataInputMode: 'manual' });
    if (!ia.ok || !manual.ok) {
      fail('paridad 4-10', `IA ${ia.status} ${ia.code || ''} · manual ${manual.status} ${manual.code || ''}`);
    } else if (ia.totalPrice === manual.totalPrice && ia.estimatedHours === manual.estimatedHours) {
      pass('paridad 4-10 (precio y horas)', `${ia.totalPrice} € · ${ia.estimatedHours} h en ambos caminos`);
    } else {
      fail('paridad 4-10', `IA ${ia.totalPrice} €/${ia.estimatedHours} h  vs  manual ${manual.totalPrice} €/${manual.estimatedHours} h`);
    }
  }
  {
    // El caso histórico: banda terminal abierta '>10' vs '>10m'
    const ia = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '>10', qty: 1, m: false }));
    const manual = await quote(SERVICE_ID, { ...palm({ species: 'Phoenix canariensis', band: '>10', qty: 1, m: true }), dataInputMode: 'manual' });
    if (ia.ok && manual.ok && ia.totalPrice === manual.totalPrice && ia.totalPrice === 150) {
      pass('paridad banda terminal >10 / >10m', `${ia.totalPrice} € en ambos`);
    } else {
      fail('paridad banda terminal >10 / >10m', `IA ${ia.status}:${ia.totalPrice}  manual ${manual.status}:${manual.totalPrice} (esperado 150 en ambos)`);
    }
  }

  // ======================================================================
  // BLOQUE 3 — Barrido de TODA clave de additional_config
  // ======================================================================
  console.log('\n=== 3. Barrido de variables ===');

  // 3a. height_prices: las 21 combinaciones especie×banda devuelven su precio exacto
  console.log('\n  -- height_prices (21 combinaciones) --');
  for (const [species, bands] of Object.entries(SEED)) {
    for (const band of Object.keys(bands)) {
      const res = await quote(SERVICE_ID, palm({ species, band, qty: 1 }));
      expectQuote(`precio ${species} ${band}`, res, { totalPrice: predictPrice({ species, band, qty: 1 }) });
    }
  }

  // 3b. yield_units_per_hour: las 21 combinaciones producen sus horas exactas
  console.log('\n  -- yield_units_per_hour (21 combinaciones) --');
  for (const [species, bands] of Object.entries(SEED)) {
    for (const band of Object.keys(bands)) {
      // ×3 para separar las horas del suelo de 1 h y ver de verdad el rendimiento
      const res = await quote(SERVICE_ID, palm({ species, band, qty: 3 }));
      expectQuote(`horas ${species} ${band} ×3`, res, { estimatedHours: predictHours({ species, band, qty: 3 }) });
    }
  }

  // 3c. recargos de estado, retirada y extras — delta contra un base holgado
  console.log('\n  -- recargos / retirada / extras (delta vs base) --');
  const base = { species: 'Phoenix canariensis', band: '4-10', qty: 2 }; // 180 €
  const baseRes = await quote(SERVICE_ID, palm(base));
  const baseP = baseRes.totalPrice;
  console.log(`  base PC 4-10 ×2 = ${baseP} €`);

  const deltaCase = async (key, mutation, expectedDelta) => {
    const res = await quote(SERVICE_ID, palm({ ...base, ...mutation }));
    if (!res.ok) return fail(`barrido ${key}`, `${res.status} ${res.code || ''}`);
    const got = res.totalPrice - baseP;
    const ok = Math.abs(got - expectedDelta) < 0.02;
    (ok ? pass : fail)(`barrido ${key}`, `delta esperado ${expectedDelta.toFixed(2)} €, observado ${got.toFixed(2)} €${!ok && Math.abs(got) < 0.005 ? ' — la clave NO mueve el precio' : ''}`);
  };

  await deltaCase('condition_surcharges.descuidado', { state: 'descuidado' }, baseP * 0.20);
  await deltaCase('condition_surcharges.muy_descuidado', { state: 'muy_descuidado' }, baseP * 0.50);
  await deltaCase('waste_removal.percentage', { waste: true }, baseP * 0.15);
  await deltaCase('phytosanitary (€ plano ×2 ud)', { phyto: true }, PHYTO_EUR * 2);
  await deltaCase('trunk_finish (20% de 90 ×2 ud)', { trunk: true }, 90 * 0.20 * 2);
  await deltaCase('access_difficulty (25% de 90 ×2 ud)', { access: true }, 90 * 0.25 * 2);

  // 3d. cero explícito: estado normal NO debe sumar nada (default no pisa al 0 sembrado)
  console.log('\n  -- cero explícito y guardas por especie/banda --');
  {
    const res = await quote(SERVICE_ID, palm({ ...base, state: 'normal' }));
    (res.ok && res.totalPrice === baseP ? pass : fail)(
      'condition_surcharges.normal = 0 explícito',
      `normal = ${res.totalPrice} € (base ${baseP} €) — debe ser idéntico, sin recargo fantasma`,
    );
  }
  // fitosanitario en especie que NO lo admite (Syagrus) → +0
  {
    const noPhyto = { species: 'Syagrus romanzoffiana', band: '5-10', qty: 2 };
    const a = await quote(SERVICE_ID, palm(noPhyto));
    const b = await quote(SERVICE_ID, palm({ ...noPhyto, phyto: true }));
    (a.ok && b.ok && a.totalPrice === b.totalPrice ? pass : fail)(
      'fitosanitario ignorado en Syagrus (no lo admite)',
      `sin ${a.totalPrice} € · con ${b.totalPrice} € (deben coincidir)`,
    );
  }
  // pelado de tronco en Trachycarpus (no lo admite) → +0
  {
    const noTrunk = { species: 'Trachycarpus fortunei', band: '3-6', qty: 2 };
    const a = await quote(SERVICE_ID, palm(noTrunk));
    const b = await quote(SERVICE_ID, palm({ ...noTrunk, trunk: true }));
    (a.ok && b.ok && a.totalPrice === b.totalPrice ? pass : fail)(
      'pelado de tronco ignorado en Trachycarpus (no lo admite)',
      `sin ${a.totalPrice} € · con ${b.totalPrice} € (deben coincidir)`,
    );
  }
  // acceso difícil en la banda MÍNIMA de la especie → +0 (guarda de pricingEngine)
  {
    const lowest = { species: 'Phoenix canariensis', band: '0-4', qty: 2 };
    const a = await quote(SERVICE_ID, palm(lowest));
    const b = await quote(SERVICE_ID, palm({ ...lowest, access: true }));
    (a.ok && b.ok && a.totalPrice === b.totalPrice ? pass : fail)(
      'access_difficulty ignorado en banda mínima 0-4',
      `sin ${a.totalPrice} € · con ${b.totalPrice} € (deben coincidir)`,
    );
  }

  // 3e. HALLAZGO #1a/#1b (CORREGIDO 2026-09-12) — trunk_finish y phytosanitary deben subir
  // el precio Y las horas. Antes del fix, el mismo grupo con y sin cada extra daba precio
  // distinto pero horas IDÉNTICAS (el motor no le dedicaba tiempo). Ahora deben moverse
  // los dos juntos.
  console.log('\n  -- HALLAZGO #1a/#1b (corregido): extras físicos que ahora sí cuentan tiempo --');
  {
    // qty=5 (no 2): con qty=2 el incremento de fitosanitario (0.1h × qty) es tan pequeño
    // que el redondeo a media hora lo absorbe sin cruzar el siguiente escalón — el fix es
    // correcto pero la prueba con qty=2 no lo distinguía de "no hace nada". Con qty=5 el
    // incremento (0,5 h) sí cruza un escalón de 0,5 h de forma determinista.
    const g = { species: 'Washingtonia robusta/filifera', band: '4-12', qty: 5 }; // admite tronco y fito
    const off = await quote(SERVICE_ID, palm(g));
    expectQuote('sin extras', off, { totalPrice: predictPrice(g), estimatedHours: predictHours(g) });

    const withTrunk = await quote(SERVICE_ID, palm({ ...g, trunk: true }));
    expectQuote(
      'trunk_finish sube el precio Y las horas (hallazgo #1a corregido)',
      withTrunk,
      { totalPrice: predictPrice({ ...g, trunk: true }), estimatedHours: predictHours({ ...g, trunk: true }) },
    );

    const withPhyto = await quote(SERVICE_ID, palm({ ...g, phyto: true }));
    expectQuote(
      'phytosanitary sube el precio Y las horas (hallazgo #1b corregido)',
      withPhyto,
      { totalPrice: predictPrice({ ...g, phyto: true }), estimatedHours: predictHours({ ...g, phyto: true }) },
    );
  }

  // ======================================================================
  // BLOQUE 4 — Límites: fuera de rango → 422, sin truncado silencioso
  // ======================================================================
  console.log('\n=== 4. Límites ===');
  const manualRecalc = (palmGroups) =>
    authority({
      action: 'recalculate_correction',
      serviceId: SERVICE_ID,
      providerId: PROVIDER_ID,
      bookingInput: { dataInputMode: 'manual', wasteRemoval: false, palmGroups },
    });
  {
    const res = await manualRecalc([{ id: 'g1', species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 51 }]);
    expectError('cantidad 51 (> máx 50 manual) → manual_input_invalid', res, { status: 422, code: 'manual_input_invalid' });
  }
  {
    const res = await manualRecalc([{ id: 'g1', species: 'Phoenix canariensis', height: '50-60m', state: 'normal', quantity: 1 }]);
    expectError('banda inexistente "50-60m" → manual_input_invalid', res, { status: 422, code: 'manual_input_invalid' });
  }
  {
    // Flujo de fotos: especie que el jardinero NO tiene configurada → cobertura parcial,
    // NO un precio inventado (buildPalmQuoteMetadata → partial_palm_coverage → 422).
    const res = await quote(SERVICE_ID, {
      palmGroups: [{ id: 'g1', species: 'Cocos nucifera', height: '4-10', quantity: 1, state: 'normal' }],
      wasteRemoval: false,
    });
    expectError('especie sin configurar en flujo fotos → recalculation_ineligible/partial_palm_coverage', res, { status: 422 });
  }
  {
    // Altura numérica "suelta" fuera de las bandas configuradas cae, POR DISEÑO, en el
    // rango abierto superior (35 m ≥ 10 → banda ">10"). No es un fallo: es la tolerancia
    // de `resolvePalmHeightKey` para alturas declaradas en metros. Se deja fijado para
    // que un cambio futuro que rompa esta regla se vea.
    const res = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '30-40', qty: 1 }));
    (res.ok && res.totalPrice === 150 ? pass : fail)(
      'altura suelta 30-40 → banda ">10" (tolerancia numérica, por diseño)',
      `${res.totalPrice} € (= precio de la banda >10)`,
    );
  }
  {
    // HALLAZGO #2 (CORREGIDO 2026-09-12) — 500 palmeras en un grupo debe disparar
    // `palm_quantity_implausible`, mismo patrón que `lawn_area_implausible`/
    // `hedge_length_implausible`. El aviso no bloquea: el precio/horas deben seguir
    // siendo el cálculo lineal normal.
    const res = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '4-10', qty: 500 }));
    const codes = warningCodes(res.warnings);
    const hasImplausibleWarning = codes.some((c) => c.includes('implausible'));
    if (res.ok && hasImplausibleWarning) {
      pass('500 palmeras dispara palm_quantity_implausible (hallazgo #2 corregido)', `warnings=${JSON.stringify(res.warnings)}`);
      expectQuote('500 palmeras: el aviso no cambia el precio/horas', res, { totalPrice: predictPrice({ species: 'Phoenix canariensis', band: '4-10', qty: 500 }), estimatedHours: predictHours({ species: 'Phoenix canariensis', band: '4-10', qty: 500 }) });
    } else if (res.ok) {
      fail(
        '500 palmeras en un grupo no dispara ningún aviso de plausibilidad',
        `${res.totalPrice} € / ${res.estimatedHours} h, warnings=${JSON.stringify(res.warnings)}`,
      );
    } else {
      fail('500 palmeras', `respuesta inesperada ${res.status} ${res.code || ''}`);
    }
  }
  {
    // El aviso NO debe dispararse por debajo del umbral (20): un encargo normal de varias
    // palmeras no debe generar ruido.
    const res = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '4-10', qty: 5 }));
    const codes = warningCodes(res.warnings);
    (res.ok && !codes.some((c) => c.includes('implausible')) ? pass : fail)(
      '5 palmeras: sin aviso de plausibilidad',
      `warnings=${JSON.stringify(res.warnings)}`,
    );
  }

  // ======================================================================
  // BLOQUE 5 — Mínimo del servicio
  // ======================================================================
  console.log('\n=== 5. Mínimo ===');
  {
    const res = await quote(SERVICE_ID, palm({ species: 'Trachycarpus fortunei', band: '0-3', qty: 1 })); // 35 € teóricos
    expectQuote('Trachycarpus 0-3 ×1 (35 € teóricos) factura el mínimo 60 €', res, { totalPrice: 60 });
  }

  // ======================================================================
  // BLOQUE 6 — Cambio de precio (recalculate_correction con variables corregidas)
  // ======================================================================
  console.log('\n=== 6. Cambio de precio ===');
  {
    const original = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '>10', qty: 1 })); // 150 €
    const corrected = await quote(SERVICE_ID, palm({ species: 'Phoenix canariensis', band: '4-10', qty: 1 })); // 90 €
    if (original.ok && corrected.ok && original.totalPrice === 150 && corrected.totalPrice === 90) {
      pass('el jardinero corrige la banda >10 → 4-10', `${original.totalPrice} € → ${corrected.totalPrice} €, recalculado por el mismo motor`);
    } else {
      fail('cambio de precio', `original ${original.status}:${original.totalPrice}  corregido ${corrected.status}:${corrected.totalPrice} (esperado 150 → 90)`);
    }
  }

  // ======================================================================
  // BLOQUE 7 — Disponibilidad y cobertura
  // ======================================================================
  console.log('\n=== 7. Disponibilidad ===');
  const availabilityInput = {
    ...palm({ species: 'Phoenix canariensis', band: '4-10', qty: 2 }),
    address: 'Marbella, Málaga',
    addressCoordinates: MARBELLA,
  };
  // previewProviders/validHours siempre hablan por HTTP con booking-authority (el harness no
  // las desvía a READINESS_ENGINE=local): la eligibilidad/disponibilidad vive en la capa de
  // la autoridad, no en el motor puro. Mientras no se toque bookingQuoteCore.ts esto mide lo
  // mismo que el motor en proceso.
  {
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
    const date = sunday.toISOString().slice(0, 10);
    const res = await validHours(SERVICE_ID, date, availabilityInput);
    const hours = res.body?.validHours;
    (Array.isArray(hours) && hours.length === 0 ? pass : fail)(
      `valid_hours domingo ${date}`,
      `validHours = ${JSON.stringify(hours)} (debe venir vacío)`,
    );
  }
  {
    const res = await previewProviders(SERVICE_ID, { ...availabilityInput, addressCoordinates: MADRID, address: 'Madrid' }, { selectedDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
    const excl = res.body?.exclusions?.[PROVIDER_ID];
    const quoted = res.body?.quotes?.[PROVIDER_ID];
    (excl && !quoted ? pass : fail)(
      'preview_providers desde Madrid excluye al jardinero de Marbella',
      excl ? `excluido: ${excl.code}` : `NO excluido (quote presente: ${!!quoted})`,
    );
  }
  {
    const res = await previewProviders(SERVICE_ID, availabilityInput, { selectedDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
    const quoted = res.body?.quotes?.[PROVIDER_ID];
    (quoted ? pass : fail)(
      'preview_providers desde Marbella incluye al jardinero',
      quoted ? `${quoted.totalPrice} € · ${quoted.estimatedHours} h` : `ausente. exclusions=${JSON.stringify(res.body?.exclusions)}`,
    );
  }

  report();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
