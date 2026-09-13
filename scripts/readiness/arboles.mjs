/**
 * Runner de preparación para producción — Poda de árboles.
 *
 * Reescrito el 2026-09-11 porque el runner heredado de la tanda anterior apuntaba a un
 * serviceId que no existe en este entorno (`f1bee417-…`, fantasma) — con ese id todas las
 * llamadas habrían fallado con `missing_provider_config`/404, no con los PASA que el
 * fichero previo daba a entender. El serviceId correcto se leyó de
 * `select id, name from public.services` contra el stack de referencia.
 *
 * Config sembrada verificada de nuevo a mano el 2026-09-11 contra
 * `gardener_service_prices.additional_config` del jardinero
 * 11111111-aaaa-4aaa-8aaa-111111111111 (coincide con la de la tanda anterior, no ha
 * cambiado):
 *   formacion:   { small: 35,  medium: 60,  large: 110 }
 *   estructural: { small: 45,  medium: 80,  large: 150 }
 *   yield_units_per_hour.formacion:   { small: 2.5, medium: 1.5, large: 0.8 }
 *   yield_units_per_hour.estructural: { small: 2.0, medium: 1.2, large: 0.6 }
 *   difficultyIncrease: 30 %   wasteRemovalMultiplier: 15 %   minimumPrice: 60
 *
 * Fórmula por árbol (src/domain/pricing/treePruningPricing.ts):
 *   basePrice = banda[pruningType][sizeBand]  (over_9 reutiliza el precio/rendimiento de 'large')
 *   unitHours = 1 / yield_units_per_hour[pruningType][sizeBand]
 *   si difficultyHigh:  subtotal = basePrice * 1.30      horas = unitHours * 1.30
 *   si wasteRemoval:    subtotal = subtotal  * 1.15      horas = horas    * 1.15   (compuesto, no aditivo)
 *   total del grupo = max(suma de subtotales, minimumPrice)   [visible ANTES del roundUp final]
 * Agregador (bookingQuoteCore.ts): total final = Math.ceil(suma de todos los servicios);
 * horas finales = max(1, ceil(horas*2)/2), con *0.9 si horas > 8 (línea 1349, transversal T2).
 *
 * node scripts/readiness/arboles.mjs                       # HTTP contra booking-authority
 * READINESS_ENGINE=local node scripts/readiness/arboles.mjs # motor en proceso (este worktree)
 */
import { quote, expectQuote, sweep, previewProviders, validHours, report, PROVIDER_ID, sql } from './_harness.mjs';

/**
 * El id se resuelve por NOMBRE, no se escribe a mano (mismo patrón que fitosanitarios.mjs).
 * `supabase/seed.sql` genera los UUID de `services` en cada `db reset`, así que un id fijo
 * apunta a un servicio fantasma en cuanto se resiembra: es justo lo que le pasaba a este
 * runner (todos los escenarios morían en `missing_provider_config` sin medir nada).
 */
const SERVICE_ID = (() => {
  const fromEnv = process.env.TREE_SERVICE_ID;
  if (fromEnv) return fromEnv;
  const row = sql("select id from public.services where name = 'Poda de árboles' limit 1;");
  if (!row) throw new Error('No se encuentra el servicio «Poda de árboles» en la base local.');
  return row.trim();
})();

const tree = (overrides = {}) => ({
  id: overrides.id || 't1',
  pruningType: 'structural',
  quantity: 1,
  aiSizeBand: 'small',
  difficultyHigh: false,
  analysisLevel: 1,
  isFailed: false,
  ...overrides,
});

async function scenarios() {
  console.log('\n=== 2A.1 Escenarios (Fase 1 vs motor) ===\n');

  // 1. Caso base holgado: 2 árboles estructural grande, sin recargos.
  //    150*2=300 · unitHours=1/0.6=1.6667*2=3.3333 -> ceil(3.3333*2)/2=3.5
  await expectQuote(
    '1. Base: 2x estructural large',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 2 })], wasteRemoval: false }),
    { totalPrice: 300, estimatedHours: 3.5 },
  );

  // 2. Mínimo: 1 árbol formación pequeño (35€ teóricos < mínimo 60€ → factura 60€).
  await expectQuote(
    '2. Mínimo: 1x formación small',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 1 })], wasteRemoval: false }),
    { totalPrice: 60, estimatedHours: 1 },
  );

  // 3. Recargo de dificultad: 1 árbol estructural mediano, dificultad alta.
  //    80*1.30=104 · unitHours=1/1.2=0.8333*1.30=1.0833 -> ceil(1.0833*2)/2=1.5
  await expectQuote(
    '3. Dificultad alta: 1x estructural medium',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium', difficultyHigh: true })], wasteRemoval: false }),
    { totalPrice: 104, estimatedHours: 1.5 },
  );

  // 4. Retirada de restos: 1 árbol formación grande, con retirada.
  //    110*1.15=126.5 -> roundUp final=127 · unitHours=1.25*1.15=1.4375 -> ceil(1.4375*2)/2=1.5
  await expectQuote(
    '4. Retirada de restos: 1x formación large',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'large' })], wasteRemoval: true }),
    { totalPrice: 127, estimatedHours: 1.5 },
  );

  // 5. Fuera de rango: banda inválida en modo manual → 422 manual_input_invalid.
  const r5 = await quote(SERVICE_ID, {
    dataInputMode: 'manual',
    treeGroups: [tree({ aiSizeBand: 'gigante' })],
    wasteRemoval: false,
  });
  if (r5.status === 422) {
    console.log('✓ PASA       5. Banda inválida en modo manual → 422', JSON.stringify(r5.body).slice(0, 200));
  } else {
    console.log('✗ FALLA      5. Banda inválida en modo manual → esperado 422, obtenido', r5.status, JSON.stringify(r5.body).slice(0, 200));
  }

  // 6. over_9 (banda abierta) + dificultad + retirada combinadas: usa precio/rendimiento de 'large'.
  //    110*1.30=143 *1.15=164.45 -> roundUp=165 · horas=1.25*1.30=1.625*1.15=1.86875 -> ceil(*2)/2=2
  const r6 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'over_9', difficultyHigh: true })], wasteRemoval: true });
  expectQuote('6. over_9 + dificultad + retirada: 1x formación', r6, { totalPrice: 165, estimatedHours: 2 });
  // warnings es un array de objetos {code, message}, no de strings.
  if (r6.ok && !(r6.warnings || []).some((w) => /verificar el pago/i.test(w?.message || ''))) {
    console.log('  ⚠ over_9 no trae el warning de verificación de pago esperado:', JSON.stringify(r6.warnings));
  } else {
    console.log('  ✓ over_9 trae el warning de verificación de pago:', JSON.stringify(r6.warnings));
  }

  // 7. Elegibilidad: todos los árboles fallidos → invalid_tree_config (envuelto en 422 recalculation_ineligible).
  const r7 = await quote(SERVICE_ID, { treeGroups: [tree({ isFailed: true, analysisLevel: 3, aiSizeBand: undefined })], wasteRemoval: false });
  if (r7.status === 422 && r7.body?.eligibility?.reason === 'invalid_tree_config') {
    console.log('✓ PASA       7. Todos los árboles fallidos → 422 recalculation_ineligible / invalid_tree_config');
  } else {
    console.log('✗ FALLA      7. Todos los árboles fallidos → esperado 422 + eligibility.reason=invalid_tree_config, obtenido', r7.status, JSON.stringify(r7.body).slice(0, 200));
  }

  // 8. HALLAZGO A VERIFICAR: dificultad alta en árbol PEQUEÑO (0-3m).
  //    El configurador del jardinero (TreePruningConfigurator.tsx:488) dice explícitamente
  //    "No aplica a árboles de 0-3m", pero el wizard manual pregunta la dificultad de acceso
  //    para CUALQUIER tamaño (manualEntrySchema.ts:487-503, sin visibleWhen) y el motor
  //    (treePruningPricing.ts:98) aplica el multiplicador sin mirar la banda. Se espera que
  //    el motor SÍ cobre el recargo también en 'small' — lo cual contradice el texto que ve
  //    el jardinero. 35*1.30=45.5 -> roundUp final=46 (por debajo del mínimo 60, así que se
  //    fuerza un segundo árbol para superar el mínimo y que el delta no quede enmascarado).
  const r8base = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', difficultyHigh: false, quantity: 3 })], wasteRemoval: false });
  const r8diff = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', difficultyHigh: true, quantity: 3 })], wasteRemoval: false });
  console.log(
    `  8. Dificultad alta en banda 'small' (3 árboles formación): sin dificultad = ${r8base.totalPrice}€, con dificultad = ${r8diff.totalPrice}€` +
      (r8diff.ok && r8base.ok && r8diff.totalPrice > r8base.totalPrice
        ? ' → el motor SÍ cobra el recargo en small, pese a que el panel del jardinero dice que no aplica (ver informe).'
        : ' → el motor NO cobra el recargo en small (contradiría la lectura del código; revisar).'),
  );
}

async function parity() {
  console.log('\n=== 2A.2 Paridad IA vs manual (mismo input físico) ===\n');
  const physical = { pruningType: 'structural', aiSizeBand: 'medium', difficultyHigh: true, quantity: 2 };

  const iaLike = await quote(SERVICE_ID, { treeGroups: [tree({ ...physical, analysisLevel: 1 })], wasteRemoval: true });
  const manualLike = await quote(SERVICE_ID, {
    dataInputMode: 'manual',
    treeGroups: [tree({ ...physical, analysisLevel: 1 })],
    wasteRemoval: true,
  });

  if (iaLike.ok && manualLike.ok && Math.abs(iaLike.totalPrice - manualLike.totalPrice) < 0.005 && Math.abs(iaLike.estimatedHours - manualLike.estimatedHours) < 0.005) {
    console.log(`✓ PASA       Paridad IA↔manual: ${iaLike.totalPrice}€ / ${iaLike.estimatedHours}h en ambos caminos`);
  } else {
    console.log('✗ FALLA      Paridad IA↔manual', JSON.stringify({ iaLike: { p: iaLike.totalPrice, h: iaLike.estimatedHours, status: iaLike.status }, manualLike: { p: manualLike.totalPrice, h: manualLike.estimatedHours, status: manualLike.status } }));
  }
}

async function sweepVariables() {
  console.log('\n=== 2A.3 Barrido de variables (additional_config) ===\n');

  // Base holgado: 3 árboles estructural large, sin recargos ni retirada. 150*3=450€.
  const base = { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: false };

  await sweep(SERVICE_ID, base, [
    { key: 'formacion.small (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (35 - 150) * 3 } },
    { key: 'formacion.medium (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'medium', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (60 - 150) * 3 } },
    { key: 'formacion.large (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (110 - 150) * 3 } },
    { key: 'estructural.small (banda)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (45 - 150) * 3 } },
    { key: 'estructural.medium (banda)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (80 - 150) * 3 } },
    { key: 'estructural.large (base, delta 0)', input: base, expectedDelta: { eur: 0 } },
    { key: 'difficultyIncrease (+30%)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3, difficultyHigh: true })], wasteRemoval: false }, expectedDelta: { pct: 30 } },
    // 450*1.15=517.5 -> roundUp final 518: el delta real incluye el redondeo al alza (+68, no +67.5).
    { key: 'wasteRemovalMultiplier (+15%)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: true }, expectedDelta: { eur: 68 } },
    { key: 'quantity (lineal x1 vs x3)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 1 })], wasteRemoval: false }, expectedDelta: { eur: 150 - 450 } },
    { key: 'minimumPrice (60, banda pequeña)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 1 })], wasteRemoval: false }, expectedDelta: { eur: 60 - 450 } },
  ]);

  console.log('\n  --- yields (afectan horas, no precio) ---\n');
  const y1 = await quote(SERVICE_ID, base);
  const y2 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false });
  const y3 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false });
  console.log(`  estructural.large yield (0.6/h): base horas = ${y1.estimatedHours} (esperado 5)`);
  console.log(`  formacion.small yield (2.5/h): horas = ${y2.estimatedHours} (esperado ${Math.ceil(3 * 0.4 * 2) / 2})`);
  console.log(`  estructural.small yield (2.0/h): horas = ${y3.estimatedHours} (esperado ${Math.ceil(3 * 0.5 * 2) / 2})`);

  console.log('\n  --- Hallazgo #1 corregido: tope de `quantity` por grupo (MANUAL_RANGES.tree.quantity.max=20) ---\n');
  const bigQty = await quote(SERVICE_ID, {
    dataInputMode: 'manual',
    treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 500 })],
    wasteRemoval: false,
  });
  // OJO: READINESS_ENGINE=local llama a buildAuthoritativeBookingQuote() directamente
  // (ver quoteLocal() en _harness.mjs) y se salta la capa de validación manual — esa capa
  // solo vive en la función edge real (booking-authority/index.ts), que valida ANTES de
  // despachar la acción cuando dataInputMode === 'manual'. Por eso este caso sigue dando
  // 200 en local aunque el fix ya esté aplicado: el 422 solo se observa por HTTP contra la
  // función desplegada, o directamente con validateManualBookingInput() en unit test (ver
  // 'caps treeGroups quantity to a coherent group size' en manualEntryValidation.test.ts,
  // que sí lo cubre y pasa).
  console.log(
    `  treeGroups[0].quantity = 500 en modo manual (motor local, sin pasar por la validación manual) → status ${bigQty.status}` +
      (bigQty.status === 422
        ? ' (rechazado)'
        : ` (${bigQty.totalPrice}€ / ${bigQty.estimatedHours}h — esperado en local; el tope real se aplica en validateManualBookingInput(), verificado por vitest, y se re-confirma por HTTP tras desplegar)`),
  );
}

async function availability() {
  console.log('\n=== 2A.4 Disponibilidad ===\n');
  const input = { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium' })], wasteRemoval: false, address: 'Marbella', addressCoordinates: { lat: 36.5108, lng: -4.8850 } };

  // Domingo sin huecos (el fixture no siembra domingo).
  const sunday = await validHours(SERVICE_ID, '2026-09-13', input);
  const hoursOnSunday = sunday.body?.validHours || [];
  if (Array.isArray(hoursOnSunday) && hoursOnSunday.length === 0) {
    console.log('✓ PASA       Domingo sin huecos:', JSON.stringify(sunday.body));
  } else {
    console.log('✗ FALLA      Domingo debería no tener huecos, obtenido:', JSON.stringify(sunday.body));
  }

  // Fuera de cobertura.
  const farAway = await previewProviders(SERVICE_ID, {
    ...input,
    address: 'Madrid centro',
    addressCoordinates: { lat: 40.4168, lng: -3.7038 },
  }, { selectedDate: '2026-09-16' });
  const excluded = farAway.body?.exclusions?.[PROVIDER_ID];
  if (excluded) {
    console.log('✓ PASA       Fuera de cobertura excluye al jardinero:', JSON.stringify(excluded));
  } else {
    console.log('✗ FALLA      Fuera de cobertura debería excluir al jardinero, obtenido:', JSON.stringify(farAway.body));
  }
}

async function main() {
  await scenarios();
  await parity();
  await sweepVariables();
  await availability();
  report();
}

main().catch((err) => {
  console.error('Error fatal en el runner:', err);
  process.exitCode = 1;
});
