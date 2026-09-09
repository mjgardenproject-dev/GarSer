/**
 * Red de regresión — Servicios fitosanitarios (47a66caa-7671-45ec-b321-df6179249efd).
 *
 * Los valores esperados se derivan de la CONFIGURACIÓN del jardinero sembrado, no del
 * comportamiento actual del motor: el runner debe fallar mientras el motor no cobre lo
 * que el jardinero configuró, y pasar cuando lo haga.
 *
 *   node scripts/readiness/fitosanitarios.mjs
 *   SUPABASE_PROJECT_DIR=/ruta/al/checkout node scripts/readiness/fitosanitarios.mjs
 */

import { quote, expectQuote, expectError, validHours, previewProviders, bundleModule, pass, fail, untested, report, sql, PROVIDER_ID } from './_harness.mjs';

const SERVICE_ID = '47a66caa-7671-45ec-b321-df6179249efd';

/** El esquema de la encuesta manual es isomorfo; se empaqueta igual que el motor. */
const manualEntrySchema = () => bundleModule('src/shared/manualEntry/manualEntrySchema.ts');

/* --------------------------------------------------------------------------
 * Configuración sembrada (SSOT del test: si el seed cambia, cambia aquí).
 * -------------------------------------------------------------------------- */
const C = {
  cesped:   { minimo: 50, preventivo: 0.12, curativo: 0.20 },
  setos:    { minimo: 50, bajos_preventivo: 1.2, bajos_curativo: 1.8, altos_preventivo: 1.8, altos_curativo: 2.6 },
  arboles:  { minimo: 50, pequenos_preventivo: 15, pequenos_curativo: 25, medianos_preventivo: 25, medianos_curativo: 40, grandes_preventivo: 40, grandes_curativo: 65 },
  plantas:  { minimo: 45, pequenas_preventivo: 0.15, pequenas_curativo: 0.25, medianas_preventivo: 0.20, medianas_curativo: 0.32, grandes_preventivo: 0.28, grandes_curativo: 0.45 },
  palmeras: { minimo: 60, pequenas_preventivo: 25, pequenas_curativo: 40, pequenas_cirugia: 90, medianas_preventivo: 35, medianas_curativo: 55, medianas_cirugia: 120, altas_preventivo: 50, altas_curativo: 75, altas_cirugia: 160, endoterapia: 65 },
  eco: 10,
  yields: { cesped_m2_per_hour: 400, setos_ml_per_hour: 60, plantas_m2_per_hour: 300, arboles_units_per_hour: 5, palmeras_units_per_hour: 4, endoterapia_units_per_hour: 3 },
};

/** Redondeo de horas del motor: >8 h aplica 0,9 y se sube a media hora, mínimo 1. */
const hours = (raw) => Math.max(1, Math.ceil((raw > 8 ? raw * 0.9 : raw) * 2) / 2);
/** Redondeo de importe del motor: euro entero hacia arriba. */
const eur = (v) => Math.ceil(Math.round(v * 100) / 100);

const zone = (o) => ({ productPreference: 'chemical', ...o });
// La disponibilidad sembrada cubre 2026-08-24 → 2026-10-02, L-V 08-18 y S 09-14.
const TUESDAY_DATE = '2026-09-15';
const MARBELLA_ADDRESS = { address: 'Avenida Ricardo Soriano 20, Marbella', addressCoordinates: { lat: 36.5101, lng: -4.8825 } };
const input = (zones, extra = {}) => ({ phytosanitaryZones: zones, wasteRemoval: false, ...extra });
const q = (zones, extra) => quote(SERVICE_ID, input(zones, extra));

async function main() {
  console.log('\n═══ Servicios fitosanitarios · red de regresión ═══\n');

  /* ---------------------------------------------------------------- 0. seed */
  const seeded = sql(`select gsp.active || '|' || coalesce(gsp.additional_config->>'version','') from public.gardener_service_prices gsp where gsp.service_id = '${SERVICE_ID}' and gsp.gardener_id = '${PROVIDER_ID}';`);
  if (/^(t|true)\|phytosanitary_v2$/.test(seeded)) pass('fixture: jardinero activo con config phytosanitary_v2', seeded);
  else fail('fixture: jardinero activo con config phytosanitary_v2', `obtenido "${seeded}"`);

  /* ------------------------------------------------- 1. escenarios (manual) */
  console.log('\n── 1. Escenarios declarados a mano (sin analysisMetrics) ──\n');

  await expectQuote('E1 césped 1000 m² preventivo convencional',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'preventive' })]),
    { totalPrice: eur(1000 * C.cesped.preventivo), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  await expectQuote('E2 césped 1000 m² curativo insectos',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects' })]),
    { totalPrice: eur(1000 * C.cesped.curativo), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  await expectQuote('E3 césped 1000 m² curativo ambos (dos productos, sin recargo)',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'both' })]),
    { totalPrice: eur(1000 * C.cesped.curativo * 2), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  await expectQuote('E4 césped 1000 m² preventivo ecológico (+10 %)',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'preventive', productPreference: 'ecological' })]),
    { totalPrice: eur(1000 * C.cesped.preventivo * (1 + C.eco / 100)), estimatedHours: hours(1000 / C.yields.cesped_m2_per_hour) });

  await expectQuote('E5 césped 100 m² preventivo → mínimo del ámbito (50 €)',
    await q([zone({ area: 100, affectedType: 'Césped', intent: 'preventive' })]),
    { totalPrice: C.cesped.minimo, estimatedHours: hours(100 / C.yields.cesped_m2_per_hour) });

  await expectQuote('E6 setos 100 ml altos curativo ambos',
    await q([zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'both', sizeBand: 'large' })]),
    { totalPrice: eur(100 * C.setos.altos_curativo * 2), estimatedHours: hours(100 / C.yields.setos_ml_per_hour) });

  await expectQuote('E7 árboles 10 ud pequeños preventivo',
    await q([zone({ area: 10, affectedType: 'Árboles', intent: 'preventive', sizeBand: 'small' })]),
    { totalPrice: eur(10 * C.arboles.pequenos_preventivo), estimatedHours: hours(10 / C.yields.arboles_units_per_hour) });

  await expectQuote('E8 palmeras 5 ud medianas preventivo',
    await q([zone({ area: 5, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'medium' })]),
    { totalPrice: eur(5 * C.palmeras.medianas_preventivo), estimatedHours: hours(5 / C.yields.palmeras_units_per_hour) });

  await expectQuote('E9 plantas bajas 200 m² medianas curativo',
    await q([zone({ area: 200, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', sizeBand: 'medium' })]),
    { totalPrice: eur(200 * C.plantas.medianas_curativo), estimatedHours: hours(200 / C.yields.plantas_m2_per_hour) });

  await expectQuote('E10 fuera de rango de horas: césped 5000 m² preventivo',
    await q([zone({ area: 5000, affectedType: 'Césped', intent: 'preventive' })]),
    { totalPrice: eur(5000 * C.cesped.preventivo), estimatedHours: hours(5000 / C.yields.cesped_m2_per_hour) });

  /* ------------------------------------------------------- 2. paridad IA↔manual */
  console.log('\n── 2. Paridad flujo de fotos ↔ flujo manual (mismo jardín físico) ──\n');

  const parity = [
    ['césped 1000 m² preventivo',
      [zone({ area: 1000, affectedType: 'Césped', intent: 'preventive' })],
      [zone({ area: 1000, affectedType: 'Césped', intent: 'preventive', analysisMetrics: { cesped_m2: 1000 } })]],
    ['césped 1000 m² curativo insectos',
      [zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects' })],
      [zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects', analysisMetrics: { cesped_m2: 1000 } })]],
    ['setos 100 ml altos curativo insectos',
      [zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' })],
      [zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'insects', analysisMetrics: { seto_alto_ml: 100 } })]],
    ['árboles 3 ud grandes curativo insectos',
      [zone({ area: 3, affectedType: 'Árboles', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' })],
      [zone({ area: 3, affectedType: 'Árboles', intent: 'curative', curativeTarget: 'insects', analysisMetrics: { arboles_gran_ud: 3 } })]],
    ['palmeras 4 ud altas preventivo',
      [zone({ area: 4, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'large' })],
      [zone({ area: 4, affectedType: 'Palmeras', intent: 'preventive', analysisMetrics: { palmeras_ducha_alta_ud: 4 } })]],
    ['plantas bajas 200 m² medianas curativo',
      [zone({ area: 200, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', sizeBand: 'medium' })],
      [zone({ area: 200, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', analysisMetrics: { plantas_superficie_calculada_m2: 200, plantas_tamano_dominante: 'medianas' } })]],
  ];

  for (const [label, manualZones, aiZones] of parity) {
    const m = await q(manualZones, { dataInputMode: 'manual' });
    const a = await q(aiZones);
    if (!m.ok || !a.ok) { fail(`paridad ${label}`, `manual ${m.status} ${m.code || ''} · IA ${a.status} ${a.code || ''}`); continue; }
    if (m.totalPrice === a.totalPrice && m.estimatedHours === a.estimatedHours) {
      pass(`paridad ${label}`, `${m.totalPrice} € · ${m.estimatedHours} h en ambos caminos`);
    } else {
      fail(`paridad ${label}`, `manual ${m.totalPrice} € / ${m.estimatedHours} h · IA ${a.totalPrice} € / ${a.estimatedHours} h`);
    }
  }

  /* -------------------------------------------- 3. barrido de detailed_pricing */
  console.log('\n── 3. Barrido: cada precio de detailed_pricing debe facturarse ──\n');

  // Cada fila: [clave, zona declarada a mano, precio unitario esperado, cantidad]
  const sweepRows = [
    ['cesped.preventivo',            zone({ area: 1000, affectedType: 'Césped', intent: 'preventive' }), C.cesped.preventivo, 1000],
    ['cesped.curativo',              zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects' }), C.cesped.curativo, 1000],
    ['setos.bajos_preventivo',       zone({ area: 100, affectedType: 'Setos', intent: 'preventive', sizeBand: 'small' }), C.setos.bajos_preventivo, 100],
    ['setos.bajos_curativo',         zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'insects', sizeBand: 'small' }), C.setos.bajos_curativo, 100],
    ['setos.altos_preventivo',       zone({ area: 100, affectedType: 'Setos', intent: 'preventive', sizeBand: 'large' }), C.setos.altos_preventivo, 100],
    ['setos.altos_curativo',         zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' }), C.setos.altos_curativo, 100],
    ['arboles.pequenos_preventivo',  zone({ area: 10, affectedType: 'Árboles', intent: 'preventive', sizeBand: 'small' }), C.arboles.pequenos_preventivo, 10],
    ['arboles.pequenos_curativo',    zone({ area: 10, affectedType: 'Árboles', intent: 'curative', curativeTarget: 'insects', sizeBand: 'small' }), C.arboles.pequenos_curativo, 10],
    ['arboles.medianos_preventivo',  zone({ area: 10, affectedType: 'Árboles', intent: 'preventive', sizeBand: 'medium' }), C.arboles.medianos_preventivo, 10],
    ['arboles.medianos_curativo',    zone({ area: 10, affectedType: 'Árboles', intent: 'curative', curativeTarget: 'insects', sizeBand: 'medium' }), C.arboles.medianos_curativo, 10],
    ['arboles.grandes_preventivo',   zone({ area: 10, affectedType: 'Árboles', intent: 'preventive', sizeBand: 'large' }), C.arboles.grandes_preventivo, 10],
    ['arboles.grandes_curativo',     zone({ area: 10, affectedType: 'Árboles', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' }), C.arboles.grandes_curativo, 10],
    ['plantas.pequenas_preventivo',  zone({ area: 500, affectedType: 'Plantas bajas', intent: 'preventive', sizeBand: 'small' }), C.plantas.pequenas_preventivo, 500],
    ['plantas.pequenas_curativo',    zone({ area: 500, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', sizeBand: 'small' }), C.plantas.pequenas_curativo, 500],
    ['plantas.medianas_preventivo',  zone({ area: 500, affectedType: 'Plantas bajas', intent: 'preventive', sizeBand: 'medium' }), C.plantas.medianas_preventivo, 500],
    ['plantas.medianas_curativo',    zone({ area: 500, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', sizeBand: 'medium' }), C.plantas.medianas_curativo, 500],
    ['plantas.grandes_preventivo',   zone({ area: 500, affectedType: 'Plantas bajas', intent: 'preventive', sizeBand: 'large' }), C.plantas.grandes_preventivo, 500],
    ['plantas.grandes_curativo',     zone({ area: 500, affectedType: 'Plantas bajas', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' }), C.plantas.grandes_curativo, 500],
    ['palmeras.pequenas_preventivo', zone({ area: 5, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'small' }), C.palmeras.pequenas_preventivo, 5],
    ['palmeras.pequenas_curativo',   zone({ area: 5, affectedType: 'Palmeras', intent: 'curative', curativeTarget: 'insects', sizeBand: 'small' }), C.palmeras.pequenas_curativo, 5],
    ['palmeras.medianas_preventivo', zone({ area: 5, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'medium' }), C.palmeras.medianas_preventivo, 5],
    ['palmeras.medianas_curativo',   zone({ area: 5, affectedType: 'Palmeras', intent: 'curative', curativeTarget: 'insects', sizeBand: 'medium' }), C.palmeras.medianas_curativo, 5],
    ['palmeras.altas_preventivo',    zone({ area: 5, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'large' }), C.palmeras.altas_preventivo, 5],
    ['palmeras.altas_curativo',      zone({ area: 5, affectedType: 'Palmeras', intent: 'curative', curativeTarget: 'insects', sizeBand: 'large' }), C.palmeras.altas_curativo, 5],
    ['palmeras.endoterapia',         zone({ area: 5, affectedType: 'Palmeras', type: 'endoterapia' }), C.palmeras.endoterapia, 5],
  ];

  for (const [key, z, unitPrice, qty] of sweepRows) {
    const res = await q([z]);
    const expected = eur(unitPrice * qty);
    await expectQuote(`barrido ${key} (${qty} × ${unitPrice} €)`, res, { totalPrice: expected });
  }

  // Cirugía: solo alcanzable por métricas; cada tamaño debe cobrar su propio precio.
  for (const [key, metricSize, unit] of [
    ['palmeras.pequenas_cirugia', 'pequenas', C.palmeras.pequenas_cirugia],
    ['palmeras.medianas_cirugia', 'medianas', C.palmeras.medianas_cirugia],
    ['palmeras.altas_cirugia', 'altas', C.palmeras.altas_cirugia],
  ]) {
    const res = await q([zone({ area: 0, affectedType: 'Palmeras', intent: 'curative', curativeTarget: 'insects', analysisMetrics: { palmeras_cirugia_ud: 2, palmeras_cirugia_tamano: metricSize } })]);
    await expectQuote(`barrido ${key} (2 × ${unit} €)`, res, { totalPrice: eur(2 * unit) });
  }

  /* ------------------------------------------------------- 4. modificadores */
  console.log('\n── 4. Modificadores eco y combo ──\n');

  const baseEur = 1000 * C.cesped.curativo;
  await expectQuote('modificador eco sobre curativo (+10 %)',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects', productPreference: 'ecological' })]),
    { totalPrice: eur(baseEur * (1 + C.eco / 100)) });

  // Combinar tratamientos cobra cada producto entero, sin recargo porcentual encima.
  await expectQuote('dos tratamientos: dos tarifas completas, sin recargo',
    await q([zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'both' })]),
    { totalPrice: eur(baseEur * 2) });

  await expectQuote('tres tratamientos: ducha × 2 + endoterapia por tronco',
    await q([zone({ area: 5, affectedType: 'Palmeras', type: 'insecticida+fungicida+endoterapia', intent: 'curative', curativeTarget: 'both', sizeBand: 'medium' })]),
    { totalPrice: eur(5 * (C.palmeras.medianas_curativo * 2 + C.palmeras.endoterapia)) });

  await expectQuote('endoterapia sola por métricas: solo el precio por tronco',
    await q([zone({ area: 0, affectedType: 'Palmeras', type: 'endoterapia', analysisMetrics: { palmeras_endoterapia_troncos_ud: 2 } })]),
    { totalPrice: eur(2 * C.palmeras.endoterapia), estimatedHours: hours(2 / C.yields.endoterapia_units_per_hour) });

  /* ------------------------------------------------------------ 5. mínimos */
  console.log('\n── 5. Mínimos por ámbito ──\n');
  for (const [label, z, minimo] of [
    ['césped 10 m²',        zone({ area: 10, affectedType: 'Césped', intent: 'preventive' }), C.cesped.minimo],
    ['setos 5 ml',          zone({ area: 5, affectedType: 'Setos', intent: 'preventive', sizeBand: 'small' }), C.setos.minimo],
    ['árboles 1 ud',        zone({ area: 1, affectedType: 'Árboles', intent: 'preventive', sizeBand: 'small' }), C.arboles.minimo],
    ['plantas bajas 20 m²', zone({ area: 20, affectedType: 'Plantas bajas', intent: 'preventive', sizeBand: 'small' }), C.plantas.minimo],
    ['palmeras 1 ud',       zone({ area: 1, affectedType: 'Palmeras', intent: 'preventive', sizeBand: 'small' }), C.palmeras.minimo],
  ]) {
    await expectQuote(`mínimo ${label} → ${minimo} €`, await q([z]), { totalPrice: minimo });
  }

  /* ------------------------------------------- 6. coherencia desglose/total */
  console.log('\n── 6. El desglose mostrado suma el importe cobrado ──\n');
  for (const [label, z] of [
    ['curativo eco (redondeo por línea)', zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'insects', productPreference: 'ecological' })],
    ['combo eco', zone({ area: 1000, affectedType: 'Césped', intent: 'curative', curativeTarget: 'both', productPreference: 'ecological' })],
  ]) {
    const res = await q([z]);
    const sum = (res.body?.breakdown || []).reduce((a, l) => a + Number(l.price || 0), 0);
    if (res.ok && sum === res.totalPrice) pass(`desglose cuadra · ${label}`, `${sum} € = ${res.totalPrice} €`);
    else fail(`desglose cuadra · ${label}`, `desglose ${sum} € ≠ total ${res.totalPrice} € — ${JSON.stringify(res.body?.breakdown)}`);
  }

  /* --------------------------------- 6bis. retirada de restos y tratamientos activos */
  console.log('\n\u2500\u2500 6bis. Retirada de restos y tratamientos desactivados \u2500\u2500\n');

  // La retirada de restos no se cobra en fitosanitarios y el jardinero no tiene d\u00f3nde
  // tarifarla, as\u00ed que el wizard no debe ofrecerla: un interruptor que el cliente activa y
  // no cambia nada es una promesa que nadie ha encargado ni cobrado. La prueba comprueba
  // las dos mitades: que el motor la ignora y que la encuesta no la ense\u00f1a.
  {
    const zonaBase = zone({ area: 1000, affectedType: 'C\u00e9sped', intent: 'curative', curativeTarget: 'insects' });
    const con = await q([zonaBase], { wasteRemoval: true });
    const sin = await q([zonaBase], { wasteRemoval: false });
    const { MANUAL_ENTRY_SURVEYS } = await manualEntrySchema();
    const ofrecida = MANUAL_ENTRY_SURVEYS.phytosanitary.offersWasteRemoval !== false;
    const neutralEnPrecio = con.ok && sin.ok && con.totalPrice === sin.totalPrice && con.estimatedHours === sin.estimatedHours;
    if (neutralEnPrecio && !ofrecida) {
      pass('retirada de restos: ni se cobra ni se ofrece', `${con.totalPrice} \u20ac / ${con.estimatedHours} h con y sin \u00b7 offersWasteRemoval=false`);
    } else if (ofrecida && neutralEnPrecio) {
      fail('retirada de restos: ni se cobra ni se ofrece', 'el wizard la ofrece pero no mueve ni precio ni horas');
    } else {
      fail('retirada de restos: ni se cobra ni se ofrece', `precio con ${con.totalPrice} \u20ac / sin ${sin.totalPrice} \u20ac \u00b7 ofrecida=${ofrecida}`);
    }
  }

  // `tratamientos_activos` decide si el jardinero puede hacer el trabajo. Debe filtrar
  // igual venga el trabajo declarado a mano o medido por la IA.
  {
    const porMetricas = await q([zone({ area: 0, affectedType: 'Setos', intent: 'curative', curativeTarget: 'fungus', analysisMetrics: { seto_alto_ml: 100 } })]);
    const aMano = await q([zone({ area: 100, affectedType: 'Setos', intent: 'curative', curativeTarget: 'fungus', sizeBand: 'large' })]);
    if (porMetricas.ok === aMano.ok) pass('tratamientos_activos filtra igual en ambos caminos', `m\u00e9tricas ${porMetricas.status} \u00b7 manual ${aMano.status}`);
    else fail('tratamientos_activos filtra igual en ambos caminos', `m\u00e9tricas ${porMetricas.status} ${porMetricas.code || ''} \u00b7 manual ${aMano.status} ${aMano.code || ''}`);
  }

  /* --------------------------------------------------------- 7. límites */
  console.log('\n── 7. Límites y validación manual ──\n');
  // La validación de rangos declarados vive en `booking-authority`, antes de despachar la
  // acción: el motor en proceso no la ve, así que estas dos solo se miden por HTTP.
  if (process.env.READINESS_ENGINE === 'local') {
    untested('límite: área fuera de rango → 422', 'la validación manual vive en booking-authority; reejecutar sin READINESS_ENGINE=local');
  } else {
    expectError('límite: área 6000 m² (máx. 5000) → 422',
      await q([zone({ area: 6000, affectedType: 'Césped', intent: 'preventive' })], { dataInputMode: 'manual' }),
      { status: 422, code: 'manual_input_invalid' });
    expectError('límite: área 0 → 422',
      await q([zone({ area: 0, affectedType: 'Césped', intent: 'preventive' })], { dataInputMode: 'manual' }),
      { status: 422, code: 'manual_input_invalid' });
  }

  const big = await q([zone({ area: 5000, affectedType: 'Césped', intent: 'preventive' })], { dataInputMode: 'manual' });
  if (big.ok && big.warnings.length > 0) pass('plausibilidad: 5000 m² emite aviso', JSON.stringify(big.warnings));
  else fail('plausibilidad: 5000 m² emite aviso', `sin warnings (${JSON.stringify(big.warnings)}) — el cliente no ve ninguna advertencia en el extremo del rango`);

  /* -------------------------------------------------- 8. disponibilidad */
  console.log('\n── 8. Disponibilidad y cobertura ──\n');
  const baseZone = [zone({ area: 1000, affectedType: 'Césped', intent: 'preventive' })];
  // La disponibilidad sembrada cubre 2026-08-24 → 2026-10-02, L-V 08-18 y S 09-14.
  const SUNDAY = '2026-09-13';
  const TUESDAY = TUESDAY_DATE;
  const MARBELLA = MARBELLA_ADDRESS;

  const sunday = await validHours(SERVICE_ID, SUNDAY, input(baseZone, MARBELLA));
  const sundayHours = sunday.body?.validHours || [];
  if (sundayHours.length === 0) pass('domingo sin huecos', `validHours=[] (${sunday.status})`);
  else fail('domingo sin huecos', `devuelve ${JSON.stringify(sundayHours)}`);

  const weekday = await validHours(SERVICE_ID, TUESDAY, input(baseZone, MARBELLA));
  const weekdayHours = weekday.body?.validHours || [];
  if (weekdayHours.length > 0) pass('martes con huecos', `validHours=${JSON.stringify(weekdayHours)}`);
  else fail('martes con huecos', `sin horas (${weekday.status}) ${JSON.stringify(weekday.body?.exclusion || {})}`);

  const inside = await previewProviders(SERVICE_ID, input(baseZone, MARBELLA), { selectedDate: TUESDAY });
  if ((inside.body?.eligibleProviderIds || []).includes(PROVIDER_ID)) pass('dentro de cobertura: el jardinero aparece', JSON.stringify(inside.body?.eligibleProviderIds));
  else fail('dentro de cobertura: el jardinero aparece', JSON.stringify(inside.body?.exclusions || inside.body));

  const outside = await previewProviders(SERVICE_ID, input(baseZone, { address: 'Barcelona', addressCoordinates: { lat: 41.3874, lng: 2.1686 } }), { selectedDate: TUESDAY });
  const exclusion = outside.body?.exclusions?.[PROVIDER_ID];
  if (!(outside.body?.eligibleProviderIds || []).includes(PROVIDER_ID) && exclusion) pass('fuera de cobertura: excluido con código', JSON.stringify(exclusion));
  else fail('fuera de cobertura: excluido con código', JSON.stringify(outside.body));

  /* ------------------------------------------------- 9. licencia fitosanitaria */
  console.log('\n\u2500\u2500 9. Licencia de productos fitosanitarios \u2500\u2500\n');

  // Aplicar producto fitosanitario de uso profesional exige carnet de manipulador
  // (RD 1311/2012), y el panel del jardinero se lo promete al cliente por escrito. La
  // prueba retira la licencia al jardinero sembrado, comprueba las dos mitades de la
  // puerta y la devuelve. Si el runner se interrumpe aquí, restaurarla con:
  //   update public.gardener_profiles set has_phytosanitary_license = true;
  // La puerta de licencia vive en `booking-authority`, no en el motor de precios: el modo
  // local no la ve. Como cualquier otra prueba que no se pueda ejecutar, se declara sin
  // disfrazarla de aprobado.
  if (process.env.READINESS_ENGINE === 'local') {
    untested('licencia fitosanitaria', 'la puerta vive en booking-authority; reejecutar sin READINESS_ENGINE=local');
    report();
    return;
  }

  const setLicense = (value) => {
    sql(`update public.gardener_profiles set has_phytosanitary_license = ${value} where user_id = '${PROVIDER_ID}';`);
  };
  const previewFor = (productPreference) =>
    previewProviders(
      SERVICE_ID,
      input([zone({ area: 1000, affectedType: 'Césped', intent: 'preventive', productPreference })], MARBELLA_ADDRESS),
      { selectedDate: TUESDAY_DATE },
    );

  try {
    setLicense(false);
    const quimico = await previewFor('chemical');
    const exclusion = quimico.body?.exclusions?.[PROVIDER_ID];
    if (!(quimico.body?.eligibleProviderIds || []).includes(PROVIDER_ID) && exclusion?.code === 'missing_phytosanitary_license') {
      pass('sin licencia: el tratamiento convencional excluye al profesional', JSON.stringify(exclusion));
    } else {
      fail('sin licencia: el tratamiento convencional excluye al profesional', JSON.stringify(quimico.body?.exclusions || quimico.body?.eligibleProviderIds));
    }

    const ecologico = await previewFor('ecological');
    if ((ecologico.body?.eligibleProviderIds || []).includes(PROVIDER_ID)) {
      pass('sin licencia: el tratamiento ecológico sigue disponible', JSON.stringify(ecologico.body?.eligibleProviderIds));
    } else {
      fail('sin licencia: el tratamiento ecológico sigue disponible', JSON.stringify(ecologico.body?.exclusions));
    }
  } finally {
    setLicense(true);
  }

  const conLicencia = await previewFor('chemical');
  if ((conLicencia.body?.eligibleProviderIds || []).includes(PROVIDER_ID)) {
    pass('con licencia: el tratamiento convencional vuelve a estar disponible', JSON.stringify(conLicencia.body?.eligibleProviderIds));
  } else {
    fail('con licencia: el tratamiento convencional vuelve a estar disponible', JSON.stringify(conLicencia.body?.exclusions));
  }

  report();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
