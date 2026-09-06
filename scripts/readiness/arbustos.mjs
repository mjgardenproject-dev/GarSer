/**
 * Runner de preparación para producción — Poda de plantas y arbustos.
 *
 * Config sembrada del jardinero (verificada por SQL, no supuesta):
 *   prices_per_m2: { pequeñas: 4.5, medianas: 6.5, grandes: 9.0 }
 *   yield_m2_per_hour: { pequeñas: 12, medianas: 8, grandes: 5 }
 *   condition_surcharges: { media: 20, alta: 50 }
 *   waste_removal.percentage: 15
 *   minimum_price: 45
 *   pricing_method: per_quantity
 */
import { quote, expectQuote, expectError, sweep, previewProviders, validHours, report, pass, fail, PROVIDER_ID } from './_harness.mjs';

const SERVICE_ID = '40798630-0bce-4fac-9208-b75ffb59d280';

const shrubInput = (groups, wasteRemoval) => ({
  shrubGroups: groups,
  wasteRemoval,
});

async function main() {
  console.log('\n=== Poda de plantas y arbustos — 2A: contrato ejecutable ===\n');

  // --- 1. Escenarios de la tabla de predicciones ---------------------------
  console.log('--- Escenarios ---');

  // estimatedHours = max(1, ceil(totalHours_tras_descuento_eficiencia * 2) / 2), donde
  // totalHours_tras_descuento_eficiencia = totalHours_bruto * 0.9 si totalHours_bruto > 8
  // (bookingQuoteCore.ts:1372-1373). Hay que arrastrar ese descuento antes de redondear.
  await expectQuote(
    'Escenario 1: base 100 m² medianas normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'normal' }], false)),
    { totalPrice: 650, estimatedHours: 11.5 }, // bruto 12.5h > 8 → ×0.9=11.25 → ceil a 0.5 → 11.5
  );

  await expectQuote(
    'Escenario 2: mínimo — 1 m² pequeñas normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 1, size: 'pequeñas', state: 'normal' }], false)),
    { totalPrice: 45, estimatedHours: 1 }, // bruto 0.083h ≤8 → sin descuento → suelo de 1h
  );

  await expectQuote(
    'Escenario 3: recargo de estado — 100 m² medianas descuidado, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'descuidado' }], false)),
    { totalPrice: 780, estimatedHours: 15 }, // bruto 16.25h > 8 → ×0.9=14.625 → ceil a 0.5 → 15
  );

  await expectQuote(
    'Escenario 4: retirada de restos — 100 m² medianas normal, con retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'normal' }], true)),
    { totalPrice: 748, estimatedHours: 13 }, // bruto 14.375h > 8 → ×0.9=12.9375 → ceil a 0.5 → 13
  );

  // Techo alineado con el prompt de IA (>500 m² → AMBIGUOUS_SIZE, revisión obligatoria).
  // Fix aplicado en manualEntrySchema.ts:329 (antes: max 2000, asimetría con la IA).
  await expectError(
    'Escenario 5: fuera de rango manual — 501 m² (excede MANUAL_RANGES.shrub.max=500)',
    await quote(SERVICE_ID, {
      dataInputMode: 'manual',
      shrubGroups: [{ id: 'a', area: 501, size: 'grandes', state: 'normal' }],
      wasteRemoval: false,
    }),
    { status: 422, code: 'manual_input_invalid' },
  );

  await expectQuote(
    'Escenario 5b: justo en el límite — 500 m² (debe aceptarse)',
    await quote(SERVICE_ID, {
      dataInputMode: 'manual',
      shrubGroups: [{ id: 'a', area: 500, size: 'grandes', state: 'normal' }],
      wasteRemoval: false,
    }),
    { totalPrice: 4500 },
  );

  // --- 5c. Bug de precisión de coma flotante en el redondeo de horas (bookingQuoteCore.ts:1372-1373) ---
  // 200/12 = 16.6666...7 -> ×0.9 (descuento eficiencia >8h) = 15.000000000000002 en JS,
  // no 15 exacto. Math.ceil(totalHours*2)/2 empuja ese residuo al siguiente medio-hora.
  // Fix: redondear a 1e-6 antes del techo a fracción de hora.
  await expectQuote(
    'Escenario 7 (bug transversal, no solo arbustos): 200 m² pequeñas normal, sin retirada',
    await quote(SERVICE_ID, shrubInput([{ id: 'a', area: 200, size: 'pequeñas', state: 'normal' }], false)),
    { totalPrice: 900, estimatedHours: 15 },
  );

  // --- 5b. Asimetría IA↔manual: 800 m² superaba el límite de la IA (500) pero antes del
  // fix pasaba por el manual (max 2000) sin fricción. Ahora debe rechazarse igual que 501.
  await expectError(
    'Escenario 6 (hallazgo Fase 1 — asimetría de rango, ya corregida): 800 m² grandes normal',
    await quote(SERVICE_ID, {
      dataInputMode: 'manual',
      shrubGroups: [{ id: 'a', area: 800, size: 'grandes', state: 'normal' }],
      wasteRemoval: false,
    }),
    { status: 422, code: 'manual_input_invalid' },
  );

  // --- 6. Coherencia breakdown vs. total (hipótesis de Fase 1: doble redondeo) ---
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
  const breakdownLabel = 'Coherencia breakdown vs. total (2 grupos: 33m² medianas + 17m² pequeñas)';
  const breakdownDetail = `totalPrice=${multi.totalPrice}€ · suma de líneas=${breakdownSum}€ · breakdown=${JSON.stringify(multi.body?.breakdown)}`;
  if (breakdownSum !== multi.totalPrice) {
    fail(breakdownLabel, `${breakdownDetail} — el desglose mostrado al cliente NO coincide con lo cobrado`);
  } else {
    pass(breakdownLabel, breakdownDetail);
  }

  // --- 2. Paridad IA vs manual (mismo input físico, dos payloads) ----------
  console.log('--- Paridad dataInputMode ---');
  const manualPayload = shrubInput([{ id: 'a', area: 100, size: 'medianas', state: 'descuidado' }], true);
  const manualRes = await quote(SERVICE_ID, { ...manualPayload, dataInputMode: 'manual' });
  const photoRes = await quote(SERVICE_ID, { ...manualPayload, dataInputMode: 'photos' });
  if (manualRes.totalPrice === photoRes.totalPrice && manualRes.estimatedHours === photoRes.estimatedHours) {
    console.log(`  ✓ PASA  paridad manual/fotos: ${manualRes.totalPrice} € · ${manualRes.estimatedHours} h en ambos\n`);
  } else {
    console.log(`  ✗ FALLA paridad: manual=${manualRes.totalPrice}€/${manualRes.estimatedHours}h vs fotos=${photoRes.totalPrice}€/${photoRes.estimatedHours}h\n`);
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
      { key: 'yield_m2_per_hour (solo horas, no precio)', input: shrubInput([{ ...base, size: 'grandes' }], false), expectedDelta: undefined },
    ],
  );

  // --- 7. Disponibilidad -----------------------------------------------------
  console.log('--- Disponibilidad ---');
  // Trabajo pequeño (2.5h) que cabe de sobra en un solo día L-V (10h sembradas).
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
