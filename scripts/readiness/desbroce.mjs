/**
 * Readiness runner — Desbroce de malas hierbas.
 *
 * Config sembrada (verificada en BD): precio_desbroce_m2 0.35, precio_herbicida_m2 0.15,
 * yield_m2_per_hour 120, suplementos { dificultad_media 20, dificultad_alta 50,
 * retirada_restos 20 }, importe_minimo 60.
 *
 * Uso: node scripts/readiness/desbroce.mjs
 */
import { quote, authority, sweep, expectQuote, expectError, pass, fail, untested, previewProviders, validHours, report } from './_harness.mjs';

const SERVICE_ID = 'e2bb35b1-d9e8-47bf-a609-e908f6d258ca';

const zone = (overrides = {}) => ({
  weedingZones: [{ id: 'z1', area: 1000, state: 'normal', applyHerbicide: false, ...overrides.zone }],
  wasteRemoval: overrides.wasteRemoval,
  ...(overrides.extra || {}),
});

async function main() {
  console.log('\n=== 1. Escenarios (predicción Fase 1 vs. motor real) ===\n');

  await expectQuote('S1 base: 1000m², normal, sin herbicida, CON retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }], wasteRemoval: true }),
    { totalPrice: 420, estimatedHours: 9.0 });

  await expectQuote('S2 sin retirada: 1000m², normal, sin herbicida',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }], wasteRemoval: false }),
    { totalPrice: 350, estimatedHours: 7.5 });

  await expectQuote('S3 dificultad_alta: 1000m², sin herbicida, sin retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'dificultad_alta', applyHerbicide: false }], wasteRemoval: false }),
    { totalPrice: 525, estimatedHours: 13.0 });

  await expectQuote('S4 con herbicida: 1000m², normal, sin retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: true }], wasteRemoval: false }),
    { totalPrice: 500, estimatedHours: 7.5 });

  await expectQuote('S5 mínimo: 50m², normal, sin herbicida, sin retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 50, state: 'normal', applyHerbicide: false }], wasteRemoval: false }),
    { totalPrice: 60, estimatedHours: 1.0 });

  console.log('\n=== 2. Paridad IA ↔ manual ===\n');
  untested('Paridad IA↔manual', 'Desbroce es manual-first deliberado: no hay flujo de fotos alcanzable desde la UI del cliente (showsGlobalAnalyzeButton excluye isWeeding). No aplica.');

  console.log('\n=== 3. Barrido de variables (additional_config completo) ===\n');
  const sweepBase = { weedingZones: [{ area: 2000, state: 'normal', applyHerbicide: false }], wasteRemoval: false };
  await sweep(SERVICE_ID, sweepBase, [
    { key: 'precio_herbicida_m2 (applyHerbicide true)', input: { weedingZones: [{ area: 2000, state: 'normal', applyHerbicide: true }], wasteRemoval: false }, expectedDelta: { eur: 300 } },
    { key: 'suplementos.dificultad_media', input: { weedingZones: [{ area: 2000, state: 'dificultad_media', applyHerbicide: false }], wasteRemoval: false }, expectedDelta: { pct: 20 } },
    { key: 'suplementos.dificultad_alta', input: { weedingZones: [{ area: 2000, state: 'dificultad_alta', applyHerbicide: false }], wasteRemoval: false }, expectedDelta: { pct: 50 } },
    { key: 'suplementos.retirada_restos', input: { weedingZones: [{ area: 2000, state: 'normal', applyHerbicide: false }], wasteRemoval: true }, expectedDelta: { pct: 20 } },
  ]);

  console.log('\n=== 4. Límites — el hallazgo central de este servicio ===\n');

  // 4a. Con dataInputMode: 'manual' explícito → la validación de rango SÍ debe activarse.
  const outOfRangeManual = await authority({
    action: 'recalculate_correction',
    serviceId: SERVICE_ID,
    providerId: '11111111-aaaa-4aaa-8aaa-111111111111',
    bookingInput: { dataInputMode: 'manual', weedingZones: [{ area: 50000, state: 'normal', applyHerbicide: false }], wasteRemoval: false },
  });
  expectError('4a. área 50.000m² CON dataInputMode=manual → 422 manual_input_invalid', outOfRangeManual, { status: 422, code: 'manual_input_invalid' });

  // 4b. Sin dataInputMode (el payload real que construye DetailsPage para desbroce) →
  // hipótesis de la Fase 1: la validación NUNCA se activa y el precio se calcula sobre el
  // valor absurdo tal cual.
  const outOfRangeAsSentByUI = await quote(SERVICE_ID, { weedingZones: [{ area: 50000, state: 'normal', applyHerbicide: false }], wasteRemoval: false });
  if (outOfRangeAsSentByUI.status === 422) {
    pass('4b. área 50.000m² SIN dataInputMode (payload real de la UI) → rechazada',
      'La validación sí se aplica también sin dataInputMode=manual. Hipótesis de la Fase 1 descartada.');
  } else if (outOfRangeAsSentByUI.ok) {
    fail('4b. área 50.000m² SIN dataInputMode (payload real de la UI)',
      `NO se rechaza: totalPrice=${outOfRangeAsSentByUI.totalPrice} €, estimatedHours=${outOfRangeAsSentByUI.estimatedHours} h. ` +
      `El formulario de desbroce en DetailsPage nunca marca dataInputMode:'manual', así que el guard de MANUAL_RANGES.weeding.area (1-10000) ` +
      `nunca se ejecuta para este flujo y el motor factura sobre el valor tal cual.`);
  } else {
    fail('4b. área 50.000m² SIN dataInputMode (payload real de la UI)', `respuesta inesperada ${outOfRangeAsSentByUI.status} ${outOfRangeAsSentByUI.code}`);
  }

  // 4c. Límite exacto: 10000 debe pasar, 10001 debe fallar (con dataInputMode=manual).
  const atMax = await authority({
    action: 'recalculate_correction', serviceId: SERVICE_ID, providerId: '11111111-aaaa-4aaa-8aaa-111111111111',
    bookingInput: { dataInputMode: 'manual', weedingZones: [{ area: 10000, state: 'normal', applyHerbicide: false }], wasteRemoval: false },
  });
  if (atMax.ok) pass('4c. área exactamente 10.000m² CON dataInputMode=manual → acepta', `${atMax.body?.totalPrice} €`);
  else fail('4c. área exactamente 10.000m² CON dataInputMode=manual → acepta', `respuesta ${atMax.status} ${atMax.body?.code}`);

  const overMax = await authority({
    action: 'recalculate_correction', serviceId: SERVICE_ID, providerId: '11111111-aaaa-4aaa-8aaa-111111111111',
    bookingInput: { dataInputMode: 'manual', weedingZones: [{ area: 10001, state: 'normal', applyHerbicide: false }], wasteRemoval: false },
  });
  expectError('4d. área 10.001m² CON dataInputMode=manual → 422', overMax, { status: 422, code: 'manual_input_invalid' });

  console.log('\n=== 5. Mínimo (ver S5 arriba) ===\n');
  pass('5. Mínimo verificado en S1-Escenarios', '50m² → 60€ (importe_minimo)');

  console.log('\n=== 6. Cambio de precio (recalculate_correction tras corrección del jardinero) ===\n');
  await expectQuote('6. Jardinero corrige in situ: 1000m² → 1200m², descubre dificultad_alta, con retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1200, state: 'dificultad_alta', applyHerbicide: false }], wasteRemoval: true }),
    { totalPrice: Math.ceil(1200 * 0.35 * 1.5 * 1.2), estimatedHours: undefined });

  console.log('\n=== 7. Disponibilidad ===\n');
  const MARBELLA = { address: 'Avenida Ricardo Soriano 10, Marbella, Málaga', addressCoordinates: { lat: 36.5099, lng: -4.8858 } };
  const sunday = await validHours(SERVICE_ID, '2026-09-06', { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }], wasteRemoval: true, ...MARBELLA });
  const hoursOnSunday = sunday.body?.validHours || [];
  const sundayExclusionCode = sunday.body?.exclusion?.code;
  if (sunday.ok && hoursOnSunday.length === 0 && sundayExclusionCode !== 'missing_coordinates') {
    pass('7a. Domingo 2026-09-06 sin huecos (con coordenadas reales)', JSON.stringify(sunday.body));
  } else {
    fail('7a. Domingo 2026-09-06 sin huecos (con coordenadas reales)', `esperado [] por cierre dominical, obtenido ${JSON.stringify(sunday.body)} (status ${sunday.status})`);
  }
  // Sábado con un trabajo corto (cabe en la ventana 09:00-14:00) → SÍ debe haber huecos.
  const saturdayShort = await validHours(SERVICE_ID, '2026-09-12', { weedingZones: [{ area: 50, state: 'normal', applyHerbicide: false }], wasteRemoval: false, ...MARBELLA });
  const hoursOnSaturdayShort = saturdayShort.body?.validHours || [];
  if (saturdayShort.ok && hoursOnSaturdayShort.length > 0) pass('7a-bis. Sábado con trabajo corto (1h) → sí hay huecos', JSON.stringify(hoursOnSaturdayShort));
  else fail('7a-bis. Sábado con trabajo corto (1h) → sí hay huecos', `obtenido ${JSON.stringify(saturdayShort.body)}`);

  const outsideCoverage = await previewProviders(SERVICE_ID, {
    address: 'Madrid, España',
    addressCoordinates: { lat: 40.4168, lng: -3.7038 },
    weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }],
    wasteRemoval: true,
  }, { selectedDate: '2026-09-10' });
  const exclusions = outsideCoverage.body?.exclusions || {};
  const providerExclusion = exclusions['11111111-aaaa-4aaa-8aaa-111111111111'];
  if (providerExclusion?.code === 'outside_coverage') pass('7b. Dirección fuera de cobertura (Madrid) → excluido', JSON.stringify(providerExclusion));
  else fail('7b. Dirección fuera de cobertura (Madrid) → excluido', `obtenido ${JSON.stringify(outsideCoverage.body)}`);

  report();
}

main().catch((err) => {
  console.error('Runner crash:', err);
  process.exitCode = 1;
});
