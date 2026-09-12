/**
 * Red de regresión — Servicios fitosanitarios (fc96088a-81f8-4efc-8908-b28a401ea556).
 *
 * Reescrito en la auditoría de 2026-09-12. Dos cambios respecto al runner heredado:
 *
 *  1. El `serviceId` anterior (`47a66caa-…`) era FANTASMA: no existe en este entorno, así
 *     que todos los escenarios morían en `missing_provider_config` y el runner nunca medía
 *     nada. Es el mismo patrón que ya encontraron césped, setos, árboles y palmeras.
 *  2. Las cifras esperadas se han recalculado a mano contra el `additional_config` que el
 *     jardinero sembrado tiene AHORA en la base de datos (leído con SQL, no de la skill).
 *
 * Criterio de las aserciones: **lo que el jardinero configuró**, no lo que el motor hace
 * hoy. Los bloques marcados `[HALLAZGO #n]` fallan a propósito mientras el motor no cobre
 * lo configurado — son la prueba ejecutable de los hallazgos del informe, no ruido.
 *
 *   READINESS_ENGINE=local node scripts/readiness/fitosanitarios.mjs
 *   SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia \
 *   SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia \
 *     READINESS_ENGINE=local node scripts/readiness/fitosanitarios.mjs
 */

import {
  quote, expectQuote, validHours, previewProviders, bundleModule,
  pass, fail, untested, report, sql,
} from './_harness.mjs';

/**
 * El id se resuelve por NOMBRE, no se escribe a mano.
 *
 * `supabase/seed.sql` genera los UUID de `services` al sembrar, así que cambian cada vez que
 * se recrea la base local. Los runners de las cinco auditorías anteriores llevaban el id
 * escrito y los cinco acabaron apuntando a un servicio fantasma: todos sus escenarios morían
 * en `missing_provider_config` sin medir nada, y en verde aparente si nadie miraba el código
 * de error. Resolverlo aquí cuesta una consulta y quita la trampa para siempre.
 */
const SERVICE_ID = (() => {
  const fromEnv = process.env.PHYTOSANITARY_SERVICE_ID;
  if (fromEnv) return fromEnv;
  const row = sql("select id from public.services where name = 'Servicios fitosanitarios' limit 1;");
  if (!row) throw new Error('No se encuentra el servicio «Servicios fitosanitarios» en la base local.');
  return row.trim();
})();

const manualEntrySchema = () => bundleModule('src/shared/manualEntry/manualEntrySchema.ts');

/* --------------------------------------------------------------------------
 * Configuración sembrada (SSOT del test). Verificada con:
 *   select jsonb_pretty(additional_config) from gardener_service_prices
 *    where service_id = 'fc96088a-…';
 * -------------------------------------------------------------------------- */
const C = {
  cesped:   { minimo: 50, preventivo: 0.12, curativo: 0.20 },
  setos:    { minimo: 50, bajos_preventivo: 1.2, bajos_curativo: 1.8, altos_preventivo: 1.8, altos_curativo: 2.6 },
  arboles:  { minimo: 50, pequenos_preventivo: 15, pequenos_curativo: 25, medianos_preventivo: 25, medianos_curativo: 40, grandes_preventivo: 40, grandes_curativo: 65 },
  plantas:  { minimo: 45, pequenas_preventivo: 0.15, pequenas_curativo: 0.25, medianas_preventivo: 0.20, medianas_curativo: 0.32, grandes_preventivo: 0.28, grandes_curativo: 0.45 },
  palmeras: { minimo: 60, pequenas_preventivo: 25, pequenas_curativo: 40, pequenas_cirugia: 90, medianas_preventivo: 35, medianas_curativo: 55, medianas_cirugia: 120, altas_preventivo: 50, altas_curativo: 75, altas_cirugia: 160, endoterapia: 65 },
  minimoGlobal: 50,
  eco: 10, comboDos: 15, comboTres: 25,
  yields: { cesped_m2_per_hour: 400, setos_ml_per_hour: 60, plantas_m2_per_hour: 300, arboles_units_per_hour: 5, palmeras_units_per_hour: 4, endoterapia_units_per_hour: 3 },
};

/** Redondeo de horas del motor: >8 h aplica 0,9; se sube a media hora; mínimo 1. */
const hours = (raw) => Math.max(1, Math.ceil((raw > 8 ? raw * 0.9 : raw) * 2) / 2);
/** Redondeo de importe del bloque fitosanitario: euro entero hacia arriba. */
const eur = (v) => Math.ceil(Math.round(v * 100) / 100);
/** Aplica el mínimo global igual que el motor. */
const withMin = (v) => (v > 0 && v < C.minimoGlobal ? C.minimoGlobal : eur(v));

/** Zona tal y como la construye `buildPhytosanitaryZones` (flujo manual). */
const manual = (o) => ({
  dataInputMode: 'manual',
  wasteRemoval: false,
  phytosanitaryZones: [{
    id: 'manual-phytosanitary-0',
    affectedType: 'Césped',
    intent: 'preventive',
    productPreference: 'chemical',
    type: 'preventivo',
    aboveThreeMeters: false,
    aboveTwoMeters: false,
    inputSource: 'manual',
    ...o,
  }],
});

/** Zona tal y como la deja `adaptPhytosanitaryAnalysisResult` (flujo de fotos). */
const photos = (o) => ({
  dataInputMode: 'ai_photos',
  wasteRemoval: false,
  phytosanitaryZones: [{
    id: 'ai-fum-1',
    affectedType: 'Césped',
    intent: 'preventive',
    productPreference: 'chemical',
    type: 'preventivo',
    aboveThreeMeters: false,
    aboveTwoMeters: false,
    ...o,
  }],
});

const TUESDAY_DATE = '2026-09-15';
const SUNDAY_DATE = '2026-09-13';

// Sin dirección, `valid_hours` y `preview_providers` responden `missing_coordinates` y no
// llegan a mirar el calendario: la prueba del domingo pasaría por la razón equivocada.
const MARBELLA = { address: 'Av. Ricardo Soriano, 20, 29601 Marbella, Málaga, España', addressCoordinates: { lat: 36.5101, lng: -4.8825 } };
const FUERA_DE_COBERTURA = { address: 'Gran Vía 1, Madrid', addressCoordinates: { lat: 40.4200, lng: -3.7050 } };
const conDireccion = (input, lugar = MARBELLA) => ({ ...input, ...lugar });

async function main() {
  console.log(`\nServicios fitosanitarios · ${SERVICE_ID}`);
  console.log(`motor: ${process.env.READINESS_ENGINE === 'local' ? 'en proceso (READINESS_ENGINE=local)' : 'HTTP booking-authority'}\n`);

  /* ======================================================================
   * 1 · ESCENARIOS — la tabla de predicciones de la Fase 1
   * ====================================================================== */
  console.log('── 1 · Escenarios ──');

  // E1 · Caso base holgado: césped 1000 m², preventivo convencional.
  // Configurado: preventivo de césped = 0,12 €/m² → 120 €.
  expectQuote('E1 césped 1000 m² preventivo convencional',
    await quote(SERVICE_ID, manual({ area: 1000 })),
    { totalPrice: eur(1000 * C.cesped.preventivo), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  // E2 · Mínimo: 200 m² preventivo = 24 € teóricos → factura el mínimo global.
  expectQuote('E2 césped 200 m² preventivo → mínimo',
    await quote(SERVICE_ID, manual({ area: 200 })),
    { totalPrice: C.minimoGlobal, estimatedHours: hours(200 / C.yields.cesped_m2_per_hour) });

  // E3 · Curativo de un solo objetivo: 1000 m² × 0,20 = 200 €, sin combo.
  expectQuote('E3 césped 1000 m² curativo insectos',
    await quote(SERVICE_ID, manual({ area: 1000, intent: 'curative', curativeTarget: 'insects', type: 'insecticida' })),
    { totalPrice: eur(1000 * C.cesped.curativo), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  // E4 · Eco: preventivo ecológico = 0,12 €/m² + 10 % = 132 €.
  expectQuote('E4 césped 1000 m² preventivo ecológico (+10 %)',
    await quote(SERVICE_ID, manual({ area: 1000, productPreference: 'ecological' })),
    { totalPrice: eur(1000 * C.cesped.preventivo * 1.1), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  // E5 · Curativo doble objetivo. Regla de negocio fijada por el usuario el 2026-09-12:
  // insecticida y fungicida son DOS tratamientos facturables independientes, se suma el
  // precio de cada uno y NO se aplica ningún porcentaje por combinarlos.
  // 1000 × 0,20 × 2 = 400 €.
  expectQuote('E5 césped 1000 m² curativo insectos+hongos (2 tratamientos sumados)',
    await quote(SERVICE_ID, manual({ area: 1000, intent: 'curative', curativeTarget: 'both', type: 'combo' })),
    { totalPrice: eur(1000 * C.cesped.curativo * 2), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  // E6 · Setos altos curativos: 200 ml × 2,60 = 520 €.
  expectQuote('E6 setos 200 ml curativo insectos >2 m',
    await quote(SERVICE_ID, manual({ area: 200, affectedType: 'Setos', intent: 'curative', curativeTarget: 'insects', type: 'insecticida', aboveThreeMeters: true, aboveTwoMeters: true })),
    { totalPrice: eur(200 * C.setos.altos_curativo), estimatedHours: hours(200 / C.yields.setos_ml_per_hour) });

  // E7 · Setos bajos preventivos: configurado 1,20 €/ml → 240 €.
  expectQuote('E7 setos 200 ml preventivo ≤2 m  [HALLAZGO #1]',
    await quote(SERVICE_ID, manual({ area: 200, affectedType: 'Setos' })),
    { totalPrice: eur(200 * C.setos.bajos_preventivo), estimatedHours: hours(200 / C.yields.setos_ml_per_hour) });

  // E8 · Árboles pequeños preventivos: configurado 15 €/ud → 75 €.
  expectQuote('E8 árboles 5 ud preventivo ≤3 m  [HALLAZGO #1]',
    await quote(SERVICE_ID, manual({ area: 5, affectedType: 'Árboles' })),
    { totalPrice: eur(5 * C.arboles.pequenos_preventivo), estimatedHours: hours(5 / C.yields.arboles_units_per_hour) });

  // E9 · Palmeras pequeñas preventivas: configurado 25 €/ud → 100 €.
  expectQuote('E9 palmeras 4 ud preventivo ≤3 m  [HALLAZGO #1]',
    await quote(SERVICE_ID, manual({ area: 4, affectedType: 'Palmeras' })),
    { totalPrice: eur(4 * C.palmeras.pequenas_preventivo), estimatedHours: hours(4 / C.yields.palmeras_units_per_hour) });

  // E10 · Plantas bajas: configurado pequeñas_preventivo 0,15 €/m² → 300 €.
  expectQuote('E10 plantas bajas 2000 m² preventivo  [HALLAZGO #4]',
    await quote(SERVICE_ID, manual({ area: 2000, affectedType: 'Plantas bajas' })),
    { totalPrice: eur(2000 * C.plantas.pequenas_preventivo), estimatedHours: hours(2000 / C.yields.plantas_m2_per_hour) });

  // E11 · Trabajo largo: 5000 m² = 12,5 h brutas → 0,9 → 11,25 → 11,5 h.
  expectQuote('E11 césped 5000 m² preventivo (>8 h)',
    await quote(SERVICE_ID, manual({ area: 5000 })),
    { totalPrice: eur(5000 * C.cesped.preventivo), estimatedHours: hours(5000 / C.yields.cesped_m2_per_hour) });

  /* ======================================================================
   * 2 · PARIDAD IA ↔ MANUAL — mismo input físico, mismo precio y horas
   * ====================================================================== */
  console.log('\n── 2 · Paridad IA ↔ manual ──');

  const parity = [
    ['césped 1000 m² preventivo',
      manual({ area: 1000 }),
      photos({ area: 1000, analysisMetrics: { cesped_m2: 1000 } })],
    ['césped 1000 m² curativo insectos+hongos',
      manual({ area: 1000, intent: 'curative', curativeTarget: 'both', type: 'combo' }),
      photos({ area: 1000, intent: 'curative', curativeTarget: 'both', type: 'combo', analysisMetrics: { cesped_m2: 1000 } })],
    ['setos 200 ml preventivo ≤2 m',
      manual({ area: 200, affectedType: 'Setos' }),
      photos({ area: 200, affectedType: 'Setos', analysisMetrics: { seto_bajo_medio_ml: 200 } })],
    ['árboles 5 ud preventivo ≤3 m',
      manual({ area: 5, affectedType: 'Árboles' }),
      photos({ area: 5, affectedType: 'Árboles', analysisMetrics: { arboles_peq_ud: 5 } })],
    ['palmeras 4 ud preventivo ≤3 m',
      manual({ area: 4, affectedType: 'Palmeras' }),
      photos({ area: 4, affectedType: 'Palmeras', analysisMetrics: { palmeras_ducha_peq_ud: 4 } })],
    ['plantas bajas 2000 m² preventivo',
      manual({ area: 2000, affectedType: 'Plantas bajas' }),
      photos({ area: 2000, affectedType: 'Plantas bajas', analysisMetrics: { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'pequenas' } })],
  ];

  for (const [label, mIn, pIn] of parity) {
    const m = await quote(SERVICE_ID, mIn);
    const p = await quote(SERVICE_ID, pIn);
    if (!m.ok || !p.ok) { fail(`paridad · ${label}`, `manual ${m.status} ${m.code || ''} · fotos ${p.status} ${p.code || ''}`); continue; }
    const samePrice = Math.abs(m.totalPrice - p.totalPrice) <= 0.005;
    const sameHours = Math.abs(m.estimatedHours - p.estimatedHours) <= 0.005;
    if (samePrice && sameHours) pass(`paridad · ${label}`, `${m.totalPrice} € · ${m.estimatedHours} h por los dos caminos`);
    else fail(`paridad · ${label}`,
      `manual ${m.totalPrice} €/${m.estimatedHours} h · fotos ${p.totalPrice} €/${p.estimatedHours} h` +
      ` — desvío ${(((m.totalPrice / p.totalPrice) - 1) * 100).toFixed(1)} % en precio`);
  }

  /* ======================================================================
   * 3 · BARRIDO DE VARIABLES — cada tarifa de `detailed_pricing` mueve el precio
   * ====================================================================== */
  console.log('\n── 3 · Barrido de tarifas (camino de fotos: usa detailed_pricing) ──');

  // Cada entrada: etiqueta, métricas, precio unitario configurado, cantidad, curativo.
  const tarifas = [
    ['cesped.preventivo',            { cesped_m2: 1000 },                 C.cesped.preventivo, 1000, false],
    ['cesped.curativo',              { cesped_m2: 1000 },                 C.cesped.curativo, 1000, true],
    ['setos.bajos_preventivo',       { seto_bajo_medio_ml: 200 },         C.setos.bajos_preventivo, 200, false],
    ['setos.bajos_curativo',         { seto_bajo_medio_ml: 200 },         C.setos.bajos_curativo, 200, true],
    ['setos.altos_preventivo',       { seto_alto_ml: 200 },               C.setos.altos_preventivo, 200, false],
    ['setos.altos_curativo',         { seto_alto_ml: 200 },               C.setos.altos_curativo, 200, true],
    ['arboles.pequenos_preventivo',  { arboles_peq_ud: 10 },              C.arboles.pequenos_preventivo, 10, false],
    ['arboles.pequenos_curativo',    { arboles_peq_ud: 10 },              C.arboles.pequenos_curativo, 10, true],
    ['arboles.medianos_preventivo',  { arboles_med_ud: 10 },              C.arboles.medianos_preventivo, 10, false],
    ['arboles.medianos_curativo',    { arboles_med_ud: 10 },              C.arboles.medianos_curativo, 10, true],
    ['arboles.grandes_preventivo',   { arboles_gran_ud: 10 },             C.arboles.grandes_preventivo, 10, false],
    ['arboles.grandes_curativo',     { arboles_gran_ud: 10 },             C.arboles.grandes_curativo, 10, true],
    ['palmeras.pequenas_preventivo', { palmeras_ducha_peq_ud: 8 },        C.palmeras.pequenas_preventivo, 8, false],
    ['palmeras.pequenas_curativo',   { palmeras_ducha_peq_ud: 8 },        C.palmeras.pequenas_curativo, 8, true],
    ['palmeras.medianas_preventivo', { palmeras_ducha_med_ud: 8 },        C.palmeras.medianas_preventivo, 8, false],
    ['palmeras.medianas_curativo',   { palmeras_ducha_med_ud: 8 },        C.palmeras.medianas_curativo, 8, true],
    ['palmeras.altas_preventivo',    { palmeras_ducha_alta_ud: 8 },       C.palmeras.altas_preventivo, 8, false],
    ['palmeras.altas_curativo',      { palmeras_ducha_alta_ud: 8 },       C.palmeras.altas_curativo, 8, true],
    ['palmeras.altas_cirugia',       { palmeras_cirugia_ud: 4 },          C.palmeras.altas_cirugia, 4, false],
    ['palmeras.endoterapia',         { palmeras_endoterapia_troncos_ud: 4 }, C.palmeras.endoterapia, 4, false],
    ['plantas.pequenas_preventivo',  { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'pequenas' }, C.plantas.pequenas_preventivo, 2000, false],
    ['plantas.pequenas_curativo',    { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'pequenas' }, C.plantas.pequenas_curativo, 2000, true],
    ['plantas.medianas_preventivo',  { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'medianas' }, C.plantas.medianas_preventivo, 2000, false],
    ['plantas.medianas_curativo',    { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'medianas' }, C.plantas.medianas_curativo, 2000, true],
    ['plantas.grandes_preventivo',   { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'grandes' }, C.plantas.grandes_preventivo, 2000, false],
    ['plantas.grandes_curativo',     { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'grandes' }, C.plantas.grandes_curativo, 2000, true],
  ];

  for (const [key, metrics, unitPrice, qty, curative] of tarifas) {
    const input = photos({
      area: qty,
      affectedType: key.startsWith('setos') ? 'Setos'
        : key.startsWith('arboles') ? 'Árboles'
          : key.startsWith('palmeras') ? 'Palmeras'
            : key.startsWith('plantas') ? 'Plantas bajas' : 'Césped',
      ...(curative ? { intent: 'curative', curativeTarget: 'insects', type: 'insecticida' } : {}),
      ...(key === 'palmeras.endoterapia' ? { type: 'endoterapia' } : {}),
      analysisMetrics: metrics,
    });
    const r = await quote(SERVICE_ID, input);
    // La cirugía de palmeras es UN concepto facturado (precio por ejemplar intervenido), así
    // que no debe arrastrar el recargo de combo por "dos tratamientos": el subtotal detallado
    // solo cobra la cirugía, sin ducha. Ver hallazgo #6.
    const etiqueta = key === 'palmeras.altas_cirugia' ? `tarifa · ${key}  [HALLAZGO #6]` : `tarifa · ${key}`;
    expectQuote(etiqueta, r, { totalPrice: withMin(qty * unitPrice) });
  }

  /* ======================================================================
   * 4 · MODIFICADORES — eco y los dos escalones de combo
   * ====================================================================== */
  console.log('\n── 4 · Modificadores ──');

  const baseEco = await quote(SERVICE_ID, photos({ area: 1000, analysisMetrics: { cesped_m2: 1000 } }));
  const conEco = await quote(SERVICE_ID, photos({ area: 1000, productPreference: 'ecological', analysisMetrics: { cesped_m2: 1000 } }));
  if (baseEco.ok && conEco.ok) {
    const factor = conEco.totalPrice / baseEco.totalPrice;
    const esperado = 1 + C.eco / 100;
    if (Math.abs(factor - esperado) <= 0.01) pass('modificador eco +10 %', `${baseEco.totalPrice} € → ${conEco.totalPrice} €`);
    else fail('modificador eco +10 %', `factor esperado ${esperado}, obtenido ${factor.toFixed(3)} (${baseEco.totalPrice} → ${conEco.totalPrice})`);
  } else fail('modificador eco +10 %', 'el base o la variante no cotizan');

  // Dos tratamientos = exactamente el doble de uno, sin recargo alguno (regla 2026-09-12).
  const unTrat = await quote(SERVICE_ID, photos({ area: 1000, intent: 'curative', curativeTarget: 'insects', type: 'insecticida', analysisMetrics: { cesped_m2: 1000 } }));
  const dosTrat = await quote(SERVICE_ID, photos({ area: 1000, intent: 'curative', curativeTarget: 'both', type: 'combo', analysisMetrics: { cesped_m2: 1000 } }));
  if (unTrat.ok && dosTrat.ok) {
    const factor = dosTrat.totalPrice / unTrat.totalPrice;
    if (Math.abs(factor - 2) <= 0.001) pass('insecticida + fungicida = suma de los dos, sin recargo', `${unTrat.totalPrice} € → ${dosTrat.totalPrice} €`);
    else fail('insecticida + fungicida = suma de los dos, sin recargo', `factor esperado 2, obtenido ${factor.toFixed(3)} (${unTrat.totalPrice} → ${dosTrat.totalPrice}) — ¿ha vuelto un porcentaje de combo?`);
  } else fail('insecticida + fungicida = suma de los dos, sin recargo', 'el base o la variante no cotizan');

  // La cirugía y la endoterapia se cobran por pieza: no se multiplican por el número de
  // tratamientos ni cuentan como uno de ellos.
  const tresConceptos = await quote(SERVICE_ID, photos({
    area: 4, affectedType: 'Palmeras', intent: 'curative', curativeTarget: 'both',
    type: 'insecticida+fungicida+endoterapia',
    analysisMetrics: { palmeras_ducha_peq_ud: 4, palmeras_endoterapia_troncos_ud: 4 },
  }));
  expectQuote('palmeras: 2 duchas curativas + endoterapia por tronco',
    tresConceptos, { totalPrice: eur(4 * C.palmeras.pequenas_curativo * 2 + 4 * C.palmeras.endoterapia) });

  // Ninguna clave de combo debe quedar viva en el motor.
  const sinCombo = await quote(SERVICE_ID, photos({ area: 1000, intent: 'curative', curativeTarget: 'both', type: 'combo', analysisMetrics: { cesped_m2: 1000 } }));
  if (sinCombo.ok && sinCombo.totalPrice === eur(1000 * C.cesped.curativo * 2)) {
    pass('pricing_modifiers.combo ya no altera el precio', `${sinCombo.totalPrice} € = 2 × ${eur(1000 * C.cesped.curativo)} €`);
  } else fail('pricing_modifiers.combo ya no altera el precio', `obtenido ${sinCombo.totalPrice} €, esperado ${eur(1000 * C.cesped.curativo * 2)} €`);

  /* ======================================================================
   * 5 · MÍNIMOS — global y por ámbito
   * ====================================================================== */
  console.log('\n── 5 · Mínimos ──');

  expectQuote('mínimo global: césped 10 m² preventivo',
    await quote(SERVICE_ID, manual({ area: 10 })), { totalPrice: C.minimoGlobal });

  expectQuote('mínimo por ámbito: palmeras 1 ud (palmeras.minimo = 60)  [HALLAZGO #9]',
    await quote(SERVICE_ID, photos({ area: 1, affectedType: 'Palmeras', analysisMetrics: { palmeras_ducha_peq_ud: 1 } })),
    { totalPrice: C.palmeras.minimo });

  // El mínimo por ámbito de plantas (45) es MENOR que el global del servicio (50), así que el
  // global manda: 45 € nunca es facturable. Lo que se comprueba es justo eso, que el suelo
  // efectivo sea el mayor de los dos y no que el de ámbito pise al global hacia abajo.
  expectQuote('mínimo: plantas 100 m² respeta el suelo global (50 > plantas.minimo 45)',
    await quote(SERVICE_ID, photos({ area: 100, affectedType: 'Plantas bajas', analysisMetrics: { plantas_superficie_calculada_m2: 100, plantas_tamano_dominante: 'pequenas' } })),
    { totalPrice: Math.max(C.minimoGlobal, C.plantas.minimo) });

  /* ======================================================================
   * 6 · LÍMITES Y PLAUSIBILIDAD
   * ====================================================================== */
  console.log('\n── 6 · Límites ──');

  const schema = await manualEntrySchema();
  const max = schema.MANUAL_RANGES.phytosanitary.area.max;
  const fuera = await quote(SERVICE_ID, manual({ area: max + 1000 }));
  if (!fuera.ok) pass(`área ${max + 1000} > máximo ${max} rechazada`, `${fuera.status} ${fuera.code}`);
  else if ((fuera.warnings || []).some((w) => String(w.code || w).includes('implausible'))) {
    pass(`área ${max + 1000} avisa de plausibilidad`, JSON.stringify(fuera.warnings));
  } else {
    fail(`área ${max + 1000} > máximo declarado ${max}  [HALLAZGO #13]`,
      `aceptada en silencio: ${fuera.totalPrice} € / ${fuera.estimatedHours} h, warnings ${JSON.stringify(fuera.warnings || [])}`);
  }

  const yieldKo = await quote(SERVICE_ID, manual({ area: 0 }));
  if (!yieldKo.ok) pass('área 0 no cotiza', `${yieldKo.status} ${yieldKo.code}`);
  else fail('área 0 no cotiza', `cotizó ${yieldKo.totalPrice} €`);

  /* ======================================================================
   * 7 · RETIRADA DE RESTOS — el wizard la pregunta; ¿mueve el precio?
   * ====================================================================== */
  console.log('\n── 7 · Retirada de restos ──');
  // Este servicio no genera restos que se facturen aparte: su `additional_config` no tiene
  // `waste_removal`, así que el motor no debe cobrar nada por ella. Lo que era el hallazgo
  // #10 no es que el motor la ignore, sino que el wizard la PREGUNTABA igualmente: se
  // comprueba abajo, contra el esquema de la encuesta.
  const sinW = await quote(SERVICE_ID, { ...manual({ area: 1000 }), wasteRemoval: false });
  const conW = await quote(SERVICE_ID, { ...manual({ area: 1000 }), wasteRemoval: true });
  if (sinW.ok && conW.ok && sinW.totalPrice === conW.totalPrice && sinW.estimatedHours === conW.estimatedHours) {
    pass('la retirada de restos no altera el precio (no está configurada)', `${conW.totalPrice} € / ${conW.estimatedHours} h con y sin`);
  } else fail('la retirada de restos no altera el precio', `con ${conW.totalPrice} €, sin ${sinW.totalPrice} € — este servicio no configura waste_removal`);

  const schemaWaste = await manualEntrySchema();
  if (schemaWaste.serviceAsksForWasteRemoval && schemaWaste.serviceAsksForWasteRemoval('phytosanitary') === false) {
    pass('el wizard manual ya no pregunta por la retirada en fitosanitarios');
  } else if (schemaWaste.SERVICES_WITHOUT_WASTE_REMOVAL?.includes?.('phytosanitary')) {
    pass('el wizard manual ya no pregunta por la retirada en fitosanitarios', 'phytosanitary está en SERVICES_WITHOUT_WASTE_REMOVAL');
  } else {
    fail('el wizard manual ya no pregunta por la retirada en fitosanitarios  [HALLAZGO #10]',
      'sigue mostrando el campo global de retirada, y su respuesta no cambia nada del presupuesto');
  }

  /* ======================================================================
   * 7b · PORTE Y ENDOTERAPIA DESDE EL FORMULARIO MANUAL
   * Antes de 2026-09-12 el manual no preguntaba el tamaño ni ofrecía endoterapia, así que
   * 12 tarifas configuradas no se podían facturar por ese camino. Se comprueba que ahora
   * cada porte llega a SU tarifa y que coincide con el flujo de fotos equivalente.
   * ====================================================================== */
  console.log('\n── 7b · Porte declarado a mano y endoterapia ──');

  const portes = [
    ['árboles pequeños', { affectedType: 'Árboles', area: 10, sizeBand: 'pequenos' }, { arboles_peq_ud: 10 }, 10 * C.arboles.pequenos_preventivo],
    ['árboles medianos', { affectedType: 'Árboles', area: 10, sizeBand: 'medianos' }, { arboles_med_ud: 10 }, 10 * C.arboles.medianos_preventivo],
    ['árboles grandes', { affectedType: 'Árboles', area: 10, sizeBand: 'grandes' }, { arboles_gran_ud: 10 }, 10 * C.arboles.grandes_preventivo],
    ['palmeras pequeñas', { affectedType: 'Palmeras', area: 8, sizeBand: 'pequenas' }, { palmeras_ducha_peq_ud: 8 }, 8 * C.palmeras.pequenas_preventivo],
    ['palmeras medianas', { affectedType: 'Palmeras', area: 8, sizeBand: 'medianas' }, { palmeras_ducha_med_ud: 8 }, 8 * C.palmeras.medianas_preventivo],
    ['palmeras altas', { affectedType: 'Palmeras', area: 8, sizeBand: 'altas' }, { palmeras_ducha_alta_ud: 8 }, 8 * C.palmeras.altas_preventivo],
    ['plantas pequeñas', { affectedType: 'Plantas bajas', area: 2000, sizeBand: 'pequenas' }, { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'pequenas' }, 2000 * C.plantas.pequenas_preventivo],
    ['plantas medianas', { affectedType: 'Plantas bajas', area: 2000, sizeBand: 'medianas' }, { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'medianas' }, 2000 * C.plantas.medianas_preventivo],
    ['plantas grandes', { affectedType: 'Plantas bajas', area: 2000, sizeBand: 'grandes' }, { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'grandes' }, 2000 * C.plantas.grandes_preventivo],
  ];

  for (const [label, zona, metrics, esperado] of portes) {
    const m = await quote(SERVICE_ID, manual(zona));
    expectQuote(`porte manual · ${label}`, m, { totalPrice: withMin(esperado) });
    const f = await quote(SERVICE_ID, photos({ ...zona, analysisMetrics: metrics }));
    if (m.ok && f.ok && Math.abs(m.totalPrice - f.totalPrice) <= 0.005 && Math.abs(m.estimatedHours - f.estimatedHours) <= 0.005) {
      pass(`paridad porte · ${label}`, `${m.totalPrice} € · ${m.estimatedHours} h por los dos caminos`);
    } else {
      fail(`paridad porte · ${label}`, `manual ${m.totalPrice} €/${m.estimatedHours} h · fotos ${f.totalPrice} €/${f.estimatedHours} h`);
    }
  }

  // Endoterapia pedida desde el formulario: se suma al tratamiento por pulverización.
  expectQuote('manual · palmeras medianas preventivo + endoterapia',
    await quote(SERVICE_ID, manual({ affectedType: 'Palmeras', area: 6, sizeBand: 'medianas', wantsEndotherapy: true, type: 'preventivo+endoterapia' })),
    {
      totalPrice: withMin(6 * C.palmeras.medianas_preventivo + 6 * C.palmeras.endoterapia),
      estimatedHours: hours(6 / C.yields.palmeras_units_per_hour + 6 / C.yields.endoterapia_units_per_hour),
    });

  // Las horas de plantas dejaron de valer 0 en el flujo de fotos (hallazgo #3).
  expectQuote('horas de plantas por fotos (2000 m² ÷ 300 m²/h)',
    await quote(SERVICE_ID, photos({ area: 2000, affectedType: 'Plantas bajas', analysisMetrics: { plantas_superficie_calculada_m2: 2000, plantas_tamano_dominante: 'pequenas' } })),
    { estimatedHours: hours(2000 / C.yields.plantas_m2_per_hour) });

  /* ======================================================================
   * 8 · DISPONIBILIDAD
   * ====================================================================== */
  console.log('\n── 8 · Disponibilidad ──');
  if (process.env.READINESS_ENGINE === 'local') {
    untested('domingo sin horas · dirección fuera de cobertura',
      '`valid_hours` y `preview_providers` solo existen en booking-authority; con el motor en proceso no son alcanzables. Se cierran ejecutando el runner por HTTP.');
  } else {
    const base = conDireccion(manual({ area: 1000 }));

    // Un martes laborable SÍ debe ofrecer horas: si no, el resto del bloque no demuestra nada.
    const laborable = await validHours(SERVICE_ID, TUESDAY_DATE, base);
    const horasLaborable = laborable.body?.validHours || [];
    if (horasLaborable.length > 0) pass('martes laborable ofrece horas', `${horasLaborable.length} horas: ${horasLaborable.slice(0, 4).join(', ')}…`);
    else fail('martes laborable ofrece horas', `ninguna — ${JSON.stringify(laborable.body).slice(0, 220)}`);

    const dom = await validHours(SERVICE_ID, SUNDAY_DATE, base);
    const horasDomingo = dom.body?.validHours || [];
    const exclusionDomingo = dom.body?.exclusion?.code;
    if (horasDomingo.length === 0 && exclusionDomingo !== 'missing_coordinates') {
      pass('domingo sin horas reservables', `exclusión: ${exclusionDomingo || 'sin horas'}`);
    } else if (exclusionDomingo === 'missing_coordinates') {
      fail('domingo sin horas reservables', 'respondió `missing_coordinates`: la llamada no llevaba dirección, así que no llegó a mirar el calendario');
    } else {
      fail('domingo sin horas reservables', `devolvió ${JSON.stringify(horasDomingo)}`);
    }

    const cerca = await previewProviders(SERVICE_ID, base, { selectedDate: TUESDAY_DATE });
    if ((cerca.body?.eligibleProviderIds || []).length > 0) pass('el profesional aparece desde una dirección cubierta', JSON.stringify(cerca.body.eligibleProviderIds));
    else fail('el profesional aparece desde una dirección cubierta', `excluido: ${JSON.stringify(cerca.body?.exclusions).slice(0, 260)}`);

    const lejos = await previewProviders(SERVICE_ID, conDireccion(manual({ area: 1000 }), FUERA_DE_COBERTURA), { selectedDate: TUESDAY_DATE });
    const excl = lejos.body?.exclusions?.[Object.keys(lejos.body?.exclusions || {})[0]]?.code;
    if ((lejos.body?.eligibleProviderIds || []).length === 0) pass('una dirección fuera de cobertura lo excluye', `código: ${excl || 'sin elegibles'}`);
    else fail('una dirección fuera de cobertura lo excluye', `siguió elegible: ${JSON.stringify(lejos.body.eligibleProviderIds)}`);
  }

  untested('puerta de licencia fitosanitaria (has_phytosanitary_license)',
    'Ninguna capa la comprueba — T1 en COORDINACION-SERVICIOS.md §3.2. No es del motor: se cierra en la ronda transversal.');

  report();
}

main().catch((error) => { console.error(error); process.exit(1); });
