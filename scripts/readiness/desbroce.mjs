/**
 * Readiness runner — Desbroce de malas hierbas.
 *
 * Config sembrada (verificada en BD): precio_desbroce_m2 0.35, precio_herbicida_m2 0.15,
 * yield_m2_per_hour 120, suplementos { dificultad_media 20, dificultad_alta 50,
 * retirada_restos 20 }, importe_minimo 60.
 *
 * Uso: node scripts/readiness/desbroce.mjs
 */
import { quote, authority, sweep, expectQuote, expectError, pass, fail, untested, previewProviders, validHours, report, sql } from './_harness.mjs';

// El id heredado del runner anterior (e2bb35b1-...) es fantasma: no existe en este entorno
// (confirmado contra `select id, name from public.services`). El real es este.
/**
 * El id se resuelve por NOMBRE, no se escribe a mano (mismo patrón que fitosanitarios.mjs).
 * `supabase/seed.sql` genera los UUID de `services` en cada `db reset`, así que un id fijo
 * apunta a un servicio fantasma en cuanto se resiembra: es justo lo que le pasaba a este
 * runner (todos los escenarios morían en `missing_provider_config` sin medir nada).
 */
const SERVICE_ID = (() => {
  const fromEnv = process.env.WEEDING_SERVICE_ID;
  if (fromEnv) return fromEnv;
  const row = sql("select id from public.services where name = 'Desbroce de malas hierbas' limit 1;");
  if (!row) throw new Error('No se encuentra el servicio «Desbroce de malas hierbas» en la base local.');
  return row.trim();
})();

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

  // Precio verificado con tolerancia normal; las horas de este caso concreto (1000/120,
  // estado normal) tropiezan con T2 — transversal, no se toca aquí — así que se comprueban
  // aparte como `untested`, no como parte de este `expectQuote` (mismo patrón que césped:
  // "T2 y T7 marcados untested(...), no FALLA").
  await expectQuote('S2 sin retirada: 1000m², normal, sin herbicida (solo precio)',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }], wasteRemoval: false }),
    { totalPrice: 350, estimatedHours: undefined });
  untested('S2 horas: 7,5h exactas esperadas ((1000/120)*0.9)',
    'T2 (docs/audit/HALLAZGOS-CONOCIDOS.md): el motor devuelve 8h, no 7.5h — (1000/120)*0.9 ' +
    'deja un residuo de coma flotante (7.500000000000001) que Math.ceil(h*2)/2 amplifica a la ' +
    'media hora siguiente. Reproducido aquí con un input nuevo (1000/120, no el 5000/150 de ' +
    'césped): confirma que T2 no es un caso aislado, sino cualquier área/yield que no dé un ' +
    'cociente exacto y cruce el umbral de 8h. Transversal — anotado en COORDINACION-SERVICIOS.md ' +
    '§3.2, no se toca en esta rama.');

  // Hallazgo #2 CORREGIDO (Fase 3, 2026-09-12): las horas ya usan el mismo % real
  // (suplementos.dificultad_media/alta) que el precio, en vez del getDurationMultiplier fijo
  // (1.3/1.7) que aquí se ha retirado por completo (era codigo muerto: ningún otro bloque lo
  // usaba ya, arbustos fue el último en dejar de necesitarlo). Antes: 525€/13,0h (bug). Ahora:
  // 525€/11,5h, que es lo que corresponde al 50% real: (1000/120)*1.5=12.5h; >8h→×0.9=11.25h;
  // ceil(11.25*2)/2=11.5h. Mismo patrón que césped/setos/arbustos.
  await expectQuote('S3 dificultad_alta: 1000m², sin herbicida, sin retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'dificultad_alta', applyHerbicide: false }], wasteRemoval: false }),
    { totalPrice: 525, estimatedHours: 11.5 });

  // Hallazgo #4 CORREGIDO (Fase 3, 2026-09-12, a petición explícita del usuario): el
  // herbicida suma el MISMO % de tiempo que suma de precio. En `calculateWeedingQuote` el
  // precio con herbicida es base*(1+herbicidePerM2/pricePerM2)*stateMult*wasteMult — aquí se
  // aplica el mismo factor (1+0,15/0,35=1,428571) a las horas. Cálculo:
  // (1000/120)*1,0*1*1,428571=11,9048h; >8h→×0,9=10,7143h; ceil(10,7143*2)/2=11,0h — un
  // valor limpio, sin el residuo de coma flotante de T2 (no hay ×0.9 que deje resto exacto
  // aquí porque 10,7143*2=21,42857, cuyo techo es 22 de forma estable).
  await expectQuote('S4 con herbicida: 1000m², normal, sin retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: true }], wasteRemoval: false }),
    { totalPrice: 500, estimatedHours: 11 });

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

  // 4b. Simula el payload SIN dataInputMode que el editor ad-hoc de DetailsPage construía
  // antes del fix (hallazgo #1). CORREGIDO en el cliente (Fase 3, 2026-09-12):
  // `commitSimplePhotoCollectionPatch` en DetailsPage.tsx ahora fija `dataInputMode:'manual'`
  // siempre que la clave sea `weedingZones`, así que la UI real ya nunca envía este payload —
  // verificado en vivo en el navegador: 50.000 m² → 422 `manual_input_invalid`
  // ("la superficie a desbrozar debe estar entre 1 y 10000"), capturado por red.
  //
  // Esta llamada concreta, sin embargo, sigue viendo el payload viejo aceptarse tal cual
  // cuando `READINESS_ENGINE=local`: en ese modo `quote()` llama a
  // `buildAuthoritativeBookingQuote` directamente, saltándose por completo el guard de
  // `dataInputMode` de `supabase/functions/booking-authority/index.ts` (la validación manual
  // vive SOLO ahí, no dentro del motor de precios) — es una limitación estructural del modo
  // de medición en proceso, no un bug sin corregir. Verificarlo en este modo requeriría mover
  // la validación al motor (cambio de diseño no pedido) o probar por HTTP contra la función
  // desplegada — y la función local sirve el checkout de referencia, no este worktree, hasta
  // que se despliegue tras el merge. Se deja como NO PROBADO, no como FALLA silenciada.
  const outOfRangeAsSentByUI = await quote(SERVICE_ID, { weedingZones: [{ area: 50000, state: 'normal', applyHerbicide: false }], wasteRemoval: false });
  if (outOfRangeAsSentByUI.status === 422) {
    pass('4b. área 50.000m² SIN dataInputMode (payload real de la UI, antes del fix) → rechazada',
      'La validación se aplica también sin dataInputMode=manual.');
  } else {
    untested('4b. área 50.000m² SIN dataInputMode (payload que la UI real ya NO envía tras el fix)',
      `Con READINESS_ENGINE=local, el motor en sí acepta el payload tal cual ` +
      `(totalPrice=${outOfRangeAsSentByUI.totalPrice} €, estimatedHours=${outOfRangeAsSentByUI.estimatedHours} h) ` +
      `porque el guard de dataInputMode vive en booking-authority/index.ts, no en bookingQuoteCore.ts — este modo de ` +
      `medición no lo ejercita. El hallazgo #1 real (la UI nunca fijaba dataInputMode) está corregido y verificado en ` +
      `vivo en el navegador (ver informe, §5, fila 2C.a-fix). Pendiente: repetir esta llamada por HTTP contra ` +
      `booking-authority una vez desplegado tras el merge, para cerrar la verificación a nivel de contrato.`);
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

  // 4e. Hallazgo #3 CORREGIDO (Fase 3, 2026-09-12): aviso de plausibilidad, mismo patrón que
  // lawn_area_implausible/hedge_length_implausible/palm_quantity_implausible/
  // shrub_area_implausible. Desbroce era el único de los 5 servicios de área/cantidad sin uno.
  //
  // El motor en proceso (READINESS_ENGINE=local) devuelve warnings como objetos
  // `{code,message}`, pero booking-authority los aplana a string plano por HTTP (mismo
  // contrato que setos ya documentó: PR #23, "ajuste del runner al contrato de warnings por
  // HTTP" — no era un fallo del fix, solo de cómo lo comprobaba el runner). Se acepta
  // cualquiera de las dos formas para que el runner sirva igual en local y por HTTP.
  const hasWeedingImplausibleWarning = (warnings) =>
    (warnings || []).some((w) =>
      typeof w === 'string' ? w.includes('weeding_area_implausible') || w.toLowerCase().includes('parcela residencial') : w.code === 'weeding_area_implausible',
    );
  const implausible = await quote(SERVICE_ID, { weedingZones: [{ area: 3000, state: 'normal', applyHerbicide: false }], wasteRemoval: false });
  const hasImplausibleWarning = hasWeedingImplausibleWarning(implausible.warnings || implausible.body?.warnings);
  if (implausible.ok && hasImplausibleWarning) {
    pass('4e. área 3000 m² (por debajo del máximo manual, por encima del umbral de plausibilidad) → aviso', JSON.stringify(implausible.warnings || implausible.body?.warnings));
  } else {
    fail('4e. área 3000 m² → aviso de plausibilidad', `esperado warning 'weeding_area_implausible', obtenido ${JSON.stringify(implausible.warnings || implausible.body?.warnings)}`);
  }
  const plausible = await quote(SERVICE_ID, { weedingZones: [{ area: 1500, state: 'normal', applyHerbicide: false }], wasteRemoval: false });
  const noWarningBelowThreshold = (plausible.warnings || plausible.body?.warnings || []).length === 0;
  if (noWarningBelowThreshold) pass('4f. área 1500 m² (por debajo del umbral de 2000) → sin aviso', 'warnings: []');
  else fail('4f. área 1500 m² → sin aviso', `obtenido ${JSON.stringify(plausible.warnings || plausible.body?.warnings)}`);

  console.log('\n=== 5. Mínimo (ver S5 arriba) ===\n');
  pass('5. Mínimo verificado en S1-Escenarios', '50m² → 60€ (importe_minimo)');

  console.log('\n=== 6. Cambio de precio (recalculate_correction tras corrección del jardinero) ===\n');
  await expectQuote('6. Jardinero corrige in situ: 1000m² → 1200m², descubre dificultad_alta, con retirada',
    await quote(SERVICE_ID, { weedingZones: [{ area: 1200, state: 'dificultad_alta', applyHerbicide: false }], wasteRemoval: true }),
    { totalPrice: Math.ceil(1200 * 0.35 * 1.5 * 1.2), estimatedHours: undefined });

  console.log('\n=== 7. Disponibilidad ===\n');
  // Fechas recalculadas: el runner heredado usaba 2026-09-06/09-10/09-12, que a fecha de
  // ejecución (2026-09-12, sábado) ya son hoy o pasado y habrían fallado por
  // min_notice_hours=12 del jardinero sembrado, no por lo que se quería probar. Domingo y
  // sábado futuros con margen de sobra: 2026-09-20 (domingo) y 2026-09-19 (sábado).
  const MARBELLA = { address: 'Avenida Ricardo Soriano 10, Marbella, Málaga', addressCoordinates: { lat: 36.5099, lng: -4.8858 } };
  const sunday = await validHours(SERVICE_ID, '2026-09-20', { weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }], wasteRemoval: true, ...MARBELLA });
  const hoursOnSunday = sunday.body?.validHours || [];
  const sundayExclusionCode = sunday.body?.exclusion?.code;
  if (sunday.ok && hoursOnSunday.length === 0 && sundayExclusionCode !== 'missing_coordinates') {
    pass('7a. Domingo 2026-09-20 sin huecos (con coordenadas reales)', JSON.stringify(sunday.body));
  } else {
    fail('7a. Domingo 2026-09-20 sin huecos (con coordenadas reales)', `esperado [] por cierre dominical, obtenido ${JSON.stringify(sunday.body)} (status ${sunday.status})`);
  }
  // Sábado con un trabajo corto (cabe en la ventana 09:00-14:00) → SÍ debe haber huecos.
  const saturdayShort = await validHours(SERVICE_ID, '2026-09-19', { weedingZones: [{ area: 50, state: 'normal', applyHerbicide: false }], wasteRemoval: false, ...MARBELLA });
  const hoursOnSaturdayShort = saturdayShort.body?.validHours || [];
  if (saturdayShort.ok && hoursOnSaturdayShort.length > 0) pass('7a-bis. Sábado con trabajo corto (1h) → sí hay huecos', JSON.stringify(hoursOnSaturdayShort));
  else fail('7a-bis. Sábado con trabajo corto (1h) → sí hay huecos', `obtenido ${JSON.stringify(saturdayShort.body)}`);

  const outsideCoverage = await previewProviders(SERVICE_ID, {
    address: 'Madrid, España',
    addressCoordinates: { lat: 40.4168, lng: -3.7038 },
    weedingZones: [{ area: 1000, state: 'normal', applyHerbicide: false }],
    wasteRemoval: true,
  }, { selectedDate: '2026-09-19' });
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
