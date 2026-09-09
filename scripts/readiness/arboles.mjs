/**
 * Runner de preparación para producción — Poda de árboles.
 *
 * Config sembrada verificada (2026-09-04):
 *   formacion:   { small: 35,  medium: 60,  large: 110 }
 *   estructural: { small: 45,  medium: 80,  large: 150 }
 *   yield_units_per_hour.formacion:   { small: 2.5, medium: 1.5, large: 0.8 }
 *   yield_units_per_hour.estructural: { small: 2.0, medium: 1.2, large: 0.6 }
 *   difficultyIncrease: 30 %   wasteRemovalMultiplier: 15 %   minimumPrice: 60
 *
 * node scripts/readiness/arboles.mjs
 */
import { quote, expectQuote, sweep, previewProviders, validHours, report, PROVIDER_ID } from './_harness.mjs';

const SERVICE_ID = 'f1bee417-f860-4dd3-aa4e-1b3bb7c8641a';

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
  await expectQuote(
    '1. Base: 2x estructural large',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 2 })], wasteRemoval: false }),
    { totalPrice: 300, estimatedHours: 3.5 },
  );

  // 2. Mínimo: 1 árbol formación pequeño (35€ teóricos, factura el mínimo 60€).
  await expectQuote(
    '2. Mínimo: 1x formación small',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 1 })], wasteRemoval: false }),
    { totalPrice: 60, estimatedHours: 1 },
  );

  // 3. Recargo de dificultad: 1 árbol estructural mediano, dificultad alta.
  await expectQuote(
    '3. Dificultad alta: 1x estructural medium',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium', difficultyHigh: true })], wasteRemoval: false }),
    { totalPrice: 104, estimatedHours: 1.5 },
  );

  // 4. Retirada de restos: 1 árbol formación grande, con retirada.
  await expectQuote(
    '4. Retirada de restos: 1x formación large',
    await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'large' })], wasteRemoval: true }),
    { totalPrice: 127, estimatedHours: 1.5 },
  );

  // 5. over_9 (banda abierta) + dificultad + retirada combinadas.
  const r5 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'over_9', difficultyHigh: true })], wasteRemoval: true });
  expectQuote('5. over_9 + dificultad + retirada: 1x formación', r5, { totalPrice: 165, estimatedHours: 2 });
  if (r5.ok && !(r5.warnings || []).some((w) => /verificar el pago/i.test(w))) {
    console.log('  ⚠ over_9 no trae el warning de verificación de pago esperado:', JSON.stringify(r5.warnings));
  }

  // 6. Fuera de rango (banda inválida en modo manual → 422 manual_input_invalid).
  const r6 = await quote(SERVICE_ID, {
    dataInputMode: 'manual',
    treeGroups: [tree({ aiSizeBand: 'gigante' })],
    wasteRemoval: false,
  });
  if (r6.status === 422) {
    console.log('✓ PASA       6. Banda inválida en modo manual → 422', JSON.stringify(r6.body).slice(0, 200));
  } else {
    console.log('✗ FALLA      6. Banda inválida en modo manual → esperado 422, obtenido', r6.status, JSON.stringify(r6.body).slice(0, 200));
  }

  // 7. Elegibilidad: todos los árboles fallidos → invalid_tree_config (envuelto en 422 recalculation_ineligible).
  const r7 = await quote(SERVICE_ID, { treeGroups: [tree({ isFailed: true, analysisLevel: 3, aiSizeBand: undefined })], wasteRemoval: false });
  if (r7.status === 422 && r7.body?.eligibility?.reason === 'invalid_tree_config') {
    console.log('✓ PASA       7. Todos los árboles fallidos → 422 recalculation_ineligible / invalid_tree_config');
  } else {
    console.log('✗ FALLA      7. Todos los árboles fallidos → esperado 422 + eligibility.reason=invalid_tree_config, obtenido', r7.status, JSON.stringify(r7.body).slice(0, 200));
  }
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

  // Base holgado: 3 árboles estructural large, sin recargos ni retirada.
  const base = { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: false };

  await sweep(SERVICE_ID, base, [
    { key: 'formacion.small (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (35 - 150) * 3 } },
    { key: 'formacion.medium (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'medium', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (60 - 150) * 3 } },
    { key: 'formacion.large (banda)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (110 - 150) * 3 } },
    { key: 'estructural.small (banda)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (45 - 150) * 3 } },
    { key: 'estructural.medium (banda)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium', quantity: 3 })], wasteRemoval: false }, expectedDelta: { eur: (80 - 150) * 3 } },
    { key: 'estructural.large (base, delta 0)', input: base, expectedDelta: { eur: 0 } },
    { key: 'difficultyIncrease (+30%)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3, difficultyHigh: true })], wasteRemoval: false }, expectedDelta: { pct: 30 } },
    // 450 * 1.15 = 517.5 -> roundUp final a 518: el delta real incluye el redondeo al alza.
    { key: 'wasteRemovalMultiplier (+15%)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 3 })], wasteRemoval: true }, expectedDelta: { eur: 68 } },
    { key: 'quantity (lineal x1 vs x3)', input: { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'large', quantity: 1 })], wasteRemoval: false }, expectedDelta: { eur: 150 - 450 } },
    { key: 'minimumPrice (60, banda pequeña)', input: { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 1 })], wasteRemoval: false }, expectedDelta: { eur: 60 - 450 } },
  ]);

  console.log('\n  --- yields (afectan horas, no precio) ---\n');
  const y1 = await quote(SERVICE_ID, base);
  const y2 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'shaping', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false });
  const y3 = await quote(SERVICE_ID, { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'small', quantity: 3 })], wasteRemoval: false });
  console.log(`  estructural.large yield (0.6/h): base horas = ${y1.estimatedHours} (esperado 5)`);
  console.log(`  formacion.small yield (2.5/h): horas = ${y2.estimatedHours} (esperado ceil(3*0.4*2)/2 = ${Math.ceil(3 * 0.4 * 2) / 2})`);
  console.log(`  estructural.small yield (2.0/h): horas = ${y3.estimatedHours} (esperado ceil(3*0.5*2)/2 = ${Math.ceil(3 * 0.5 * 2) / 2})`);
}

async function availability() {
  console.log('\n=== 2A.4 Disponibilidad ===\n');
  const input = { treeGroups: [tree({ pruningType: 'structural', aiSizeBand: 'medium' })], wasteRemoval: false, address: 'Marbella', addressCoordinates: { lat: 36.5108, lng: -4.8850 } };

  // Domingo sin huecos (el fixture no siembra domingo).
  const sunday = await validHours(SERVICE_ID, '2026-09-06', input);
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
  }, { selectedDate: '2026-09-10' });
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
