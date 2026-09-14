/**
 * Runner de preparación para producción — Poda de plantas y arbustos.
 *
 * Reescrito desde cero (2026-09-12): el runner heredado de la tanda anterior usaba un
 * serviceId FANTASMA (40798630-...) y varias predicciones calculadas contra una base de
 * código que nunca llegó a `origin/main` (p. ej. asumía MANUAL_RANGES.shrub.max=500,
 * cuando en `origin/main` sigue siendo 2000). serviceId real verificado por SQL:
 *
 *   select id, name from public.services where name ilike '%arbustos%';
 *   → 649bcd71-514e-4438-ad64-1136172de98a
 *
 * Config sembrada del jardinero (verificada por SQL, no supuesta):
 *   prices_per_m2: { pequeñas: 4.5, medianas: 6.5, grandes: 9.0 }
 *   yield_m2_per_hour: { pequeñas: 12, medianas: 8, grandes: 5 }
 *   condition_surcharges: { media: 20, alta: 50 }
 *   waste_removal.percentage: 15
 *   minimum_price: 45
 *   pricing_method: per_quantity
 *
 * Fase 3 (2026-09-12) — 5 hallazgos corregidos, todos contenidos en el bloque de arbustos:
 *   #1 el estado que detecta la IA por el botón global "Analizar" ya se lee y se pasa
 *      (`DetailsPage.tsx`, antes se perdía en silencio).
 *   #2 `condition_surcharges` ya es configurable desde el panel del jardinero
 *      (`ShrubPricingConfigurator.tsx` + tipo en `types/index.ts`).
 *   #3 las HORAS ya usan el mismo % de recargo real que el precio, no el multiplicador
 *      fijo `getDurationMultiplier` (bookingQuoteCore.ts, bloque de horas de arbustos).
 *   #4 nuevo aviso `shrub_area_implausible` (>500 m², alineado con el prompt de Gemini).
 *   #5 el desglose (`buildShrubBreakdown`) ya reparte el redondeo para sumar siempre lo
 *      mismo que el total cobrado.
 * Los Escenarios 3 y 4 ahora predicen (y obtienen) las HORAS correctas. Ver
 * docs/audit/2026-09-12-arbustos-NOTAS-INTERNAS.md y docs/audit/2026-09-12-arbustos/REPORT.md.
 */
import { quote, expectQuote, sweep, previewProviders, validHours, report, pass, fail, untested, PROVIDER_ID, sql } from './_harness.mjs';

/**
 * El id se resuelve por NOMBRE, no se escribe a mano (mismo patrón que fitosanitarios.mjs).
 * `supabase/seed.sql` genera los UUID de `services` en cada `db reset`, así que un id fijo
 * apunta a un servicio fantasma en cuanto se resiembra: es justo lo que le pasaba a este
 * runner (todos los escenarios morían en `missing_provider_config` sin medir nada).
 */
const SERVICE_ID = (() => {
  const fromEnv = process.env.SHRUB_SERVICE_ID;
  if (fromEnv) return fromEnv;
  const row = sql("select id from public.services where name = 'Poda de plantas y arbustos' limit 1;");
  if (!row) throw new Error('No se encuentra el servicio «Poda de plantas y arbustos» en la base local.');
  return row.trim();
})();

const shrubInput = (groups, wasteRemoval, extra = {}) => ({
  shrubGroups: groups,
  wasteRemoval,
  ...extra,
});

async function main() {
  console.log('\n=== Poda de plantas y arbustos — 2A: contrato ejecutable ===\n');

  // --- 1. Escenarios de la tabla de predicciones ---------------------------
  console.log('--- Escenarios ---');

  await expectQuote(
    'Escenario 1: base holgado — 100 m² medianas normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'normal' }], false)),
    { totalPrice: 650, estimatedHours: 11.5 }, // 100*6.5=650€ · (100/8)=12.5h>8→×0.9=11.25→ceil a 0.5→11.5h
  );

  await expectQuote(
    'Escenario 2: mínimo — 1 m² pequeñas normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 1, size: 'pequeñas', state: 'normal' }], false)),
    { totalPrice: 45, estimatedHours: 1 }, // 1*4.5=4.5€ < mínimo 45 → 45€ · (1/12)=0.083h → suelo de 1h
  );

  // Hallazgo #3: el precio usa el % REAL configurado (20 %), las horas usan un
  // multiplicador fijo (1.3 = +30 %) que no coincide. Predicción = lo que las horas
  // DEBERÍAN dar si usaran el mismo 20 % que el precio (papel correcto).
  await expectQuote(
    'Escenario 3 (hallazgo #3): recargo de estado "descuidado" — 20 m² medianas, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 20, size: 'medianas', state: 'descuidado' }], false)),
    { totalPrice: 156, estimatedHours: 3.0 }, // precio: 20*6.5*1.20=156€ (correcto) · horas correctas: (20/8)*1.20=3.0h
    // Motor actual (bug): getDurationMultiplier da 1.3 → (20/8)*1.3=3.25h → ceil a 0.5 → 3.5h.
    // Si esto FALLA solo en horas (156€ correcto, 3.5h en vez de 3.0h), es la prueba del hallazgo #3.
  );

  await expectQuote(
    'Escenario 4 (hallazgo #3): "muy descuidado" + retirada de restos — 20 m² medianas',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 20, size: 'medianas', state: 'muy_descuidado' }], true)),
    { totalPrice: 225, estimatedHours: 4.5 }, // precio: 20*6.5*1.50*1.15=224.25→ceil=225€ · horas correctas: (20/8)*1.50*1.15=4.3125→ceil a 0.5→4.5h
    // Motor actual (bug): getDurationMultiplier da 1.7 → (20/8)*1.7*1.15=4.8875h → ceil a 0.5 → 5.0h.
  );

  await expectQuote(
    'Escenario 5a: tamaño "pequeñas" aislado — 24 m² normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 24, size: 'pequeñas', state: 'normal' }], false)),
    { totalPrice: 108, estimatedHours: 2 }, // 24*4.5=108€ · 24/12=2h (yield pequeñas=12, no cruza el umbral de 8h)
  );

  await expectQuote(
    'Escenario 5b: tamaño "grandes" aislado — 24 m² normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 24, size: 'grandes', state: 'normal' }], false)),
    { totalPrice: 216, estimatedHours: 5 }, // 24*9.0=216€ · 24/5=4.8h → techo a 0.5h → 5h (yield grandes=5)
  );

  // OJO: la validación de rango manual (422 manual_input_invalid) vive en
  // supabase/functions/booking-authority/index.ts, NO en bookingQuoteCore.ts — con
  // READINESS_ENGINE=local esta llamada nunca pasa por esa capa y siempre devuelve 200.
  // Verificado aparte por HTTP contra booking-authority (2026-09-12, stack de referencia,
  // sin tocar bookingQuoteCore.ts que es lo único que iba desactualizado): PASA — 422
  // manual_input_invalid, out_of_range, "la superficie de arbustos debe estar entre 1 y
  // 2000". Se marca NO PROBADO aquí a propósito para no dar un falso FALLA en local.
  untested(
    'Escenario 6: fuera de rango manual — 2001 m² (excede MANUAL_RANGES.shrub.max=2000)',
    'requiere HTTP contra booking-authority (la validación no vive en bookingQuoteCore.ts); confirmado aparte: PASA (422 manual_input_invalid)',
  );

  await expectQuote(
    'Escenario 6b: justo en el límite manual — 2000 m² (debe aceptarse)',
    await quote(SERVICE_ID, {
      dataInputMode: 'manual',
      shrubGroups: [{ id: 'a', area: 2000, size: 'grandes', state: 'normal' }],
      wasteRemoval: false,
    }),
    { totalPrice: 18000, estimatedHours: 360 }, // 2000*9=18000€ · (2000/5)=400h>8→×0.9=360h (múltiplo exacto de 0.5)
  );

  // --- Hallazgo #4 (corregido 2026-09-12): 600 m² sigue siendo aceptado por el manual (el
  // tope de MANUAL_RANGES sigue en 2000, eso no ha cambiado), pero ahora el motor avisa con
  // shrub_area_implausible, igual que hacen lawn/hedge/palm/phytosanitary con su propio umbral.
  const asymmetryRes = await quote(SERVICE_ID, {
    dataInputMode: 'manual',
    shrubGroups: [{ id: 'a', area: 600, size: 'grandes', state: 'normal' }],
    wasteRemoval: false,
  });
  const asymmetryLabel = 'Escenario 7 (hallazgo #4, corregido): 600 m² — aceptado, con aviso shrub_area_implausible';
  const asymmetryWarnings = asymmetryRes.warnings || asymmetryRes.body?.warnings || [];
  if (asymmetryRes.ok && asymmetryRes.totalPrice === 5400 && asymmetryWarnings.some((w) => w.code === 'shrub_area_implausible')) {
    pass(asymmetryLabel, `${asymmetryRes.totalPrice}€ · ${asymmetryRes.estimatedHours}h · warnings=${JSON.stringify(asymmetryWarnings)}`);
  } else {
    fail(asymmetryLabel, `resultado inesperado: ${JSON.stringify(asymmetryRes.body || asymmetryRes)}`);
  }

  // --- Hallazgo #5: coherencia breakdown vs. total con 2+ grupos (doble redondeo) ---
  const multi = await quote(
    SERVICE_ID,
    shrubInput(
      [
        { id: 'a', area: 33, size: 'medianas', state: 'normal' },
        { id: 'b', area: 17, size: 'pequeñas', state: 'normal' },
      ],
      false,
    ),
  );
  const breakdownSum = (multi.body?.breakdown || []).reduce((s, l) => s + l.price, 0);
  const breakdownLabel = 'Escenario 8 (hallazgo #5): coherencia breakdown vs. total (33m² medianas + 17m² pequeñas)';
  const breakdownDetail = `totalPrice=${multi.totalPrice}€ · suma de líneas=${breakdownSum}€ · breakdown=${JSON.stringify(multi.body?.breakdown)}`;
  if (breakdownSum !== multi.totalPrice) {
    fail(breakdownLabel, `${breakdownDetail} — el desglose mostrado al cliente NO coincide con lo cobrado`);
  } else {
    pass(breakdownLabel, breakdownDetail);
  }

  // --- 2. Paridad dataInputMode a nivel de motor (mismo bookingInput, dos flags) --------
  // OJO: esto NO puede detectar el hallazgo #1 (el frontend nunca llega a construir un
  // bookingInput con `state` cuando el análisis pasa por el botón global "Analizar" —
  // ver notas internas). Esta prueba solo confirma que el MOTOR es indiferente a
  // `dataInputMode`, que es un requisito necesario pero no suficiente para la paridad real.
  console.log('--- Paridad dataInputMode (a nivel de motor; no cubre el hallazgo #1 del frontend) ---');
  const manualPayload = shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'descuidado' }], true);
  const manualRes = await quote(SERVICE_ID, { ...manualPayload, dataInputMode: 'manual' });
  const photoRes = await quote(SERVICE_ID, { ...manualPayload, dataInputMode: 'photos' });
  if (manualRes.totalPrice === photoRes.totalPrice && manualRes.estimatedHours === photoRes.estimatedHours) {
    pass('Paridad manual/fotos a nivel de motor', `${manualRes.totalPrice} € · ${manualRes.estimatedHours} h en ambos`);
  } else {
    fail('Paridad manual/fotos a nivel de motor', `manual=${manualRes.totalPrice}€/${manualRes.estimatedHours}h vs fotos=${photoRes.totalPrice}€/${photoRes.estimatedHours}h`);
  }

  // --- 3. Barrido de variables ----------------------------------------------
  console.log('--- Barrido de additional_config ---');
  const base = { id: 'a', area: 200, size: 'medianas', state: 'normal' };
  await sweep(
    SERVICE_ID,
    shrubInput([base], false),
    [
      { key: 'prices_per_m2.pequeñas', input: shrubInput([{ ...base, size: 'pequeñas' }], false), expectedDelta: { eur: 200 * 4.5 - 200 * 6.5 } },
      { key: 'prices_per_m2.grandes', input: shrubInput([{ ...base, size: 'grandes' }], false), expectedDelta: { eur: 200 * 9.0 - 200 * 6.5 } },
      { key: 'condition_surcharges.media (descuidado)', input: shrubInput([{ ...base, state: 'descuidado' }], false), expectedDelta: { pct: 20 } },
      { key: 'condition_surcharges.alta (muy_descuidado)', input: shrubInput([{ ...base, state: 'muy_descuidado' }], false), expectedDelta: { pct: 50 } },
      { key: 'waste_removal.percentage', input: shrubInput([base], true), expectedDelta: { pct: 15 } },
    ],
  );

  // --- 4. Disponibilidad -----------------------------------------------------
  console.log('--- Disponibilidad ---');
  const smallJob = { id: 'a', area: 20, size: 'medianas', state: 'normal' };
  const sunday = await validHours(SERVICE_ID, '2026-09-06', shrubInput([smallJob], false)); // domingo
  const sundayHours = sunday.body?.validHours || [];
  if (sundayHours.length === 0) {
    pass('Disponibilidad: domingo sin huecos');
  } else {
    fail('Disponibilidad: domingo sin huecos', `esperado [], obtenido ${JSON.stringify(sundayHours)}`);
  }

  const inside = await previewProviders(
    SERVICE_ID,
    { ...shrubInput([smallJob], false), address: 'Avenida Ricardo Soriano 12, Marbella', addressCoordinates: { lat: 36.5099, lng: -4.8858 } },
    { selectedDate: '2026-09-08' },
  );
  if (inside.body?.eligibleProviderIds?.includes(PROVIDER_ID)) {
    pass('Cobertura: Marbella (dentro del radio) incluye al jardinero', JSON.stringify(inside.body?.quotes?.[PROVIDER_ID]).slice(0, 200));
  } else {
    fail('Cobertura: Marbella (dentro del radio) incluye al jardinero', JSON.stringify(inside.body).slice(0, 300));
  }

  const outside = await previewProviders(
    SERVICE_ID,
    { ...shrubInput([smallJob], false), address: 'Gran Via 1, Madrid', addressCoordinates: { lat: 40.4168, lng: -3.7038 } },
    { selectedDate: '2026-09-08' },
  );
  const outsideCode = outside.body?.exclusions?.[PROVIDER_ID]?.code;
  if (outsideCode === 'outside_coverage') {
    pass('Cobertura: Madrid (fuera del radio) excluye al jardinero', JSON.stringify(outside.body?.exclusions));
  } else {
    fail('Cobertura: Madrid (fuera del radio) excluye al jardinero', `código obtenido: ${outsideCode} — ${JSON.stringify(outside.body?.exclusions)}`);
  }

  report();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
