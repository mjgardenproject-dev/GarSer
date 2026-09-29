/**
 * Respuestas de referencia de la entrada manual (ronda de rediseño UX 2026-09-29, Fase 0).
 *
 * Son las respuestas COMPLETAS que un cliente puede dar en cada formulario manual —todas las
 * ramas condicionales de cada servicio— y las configuraciones de jardinero con las que se
 * cotizan. Las usan dos comprobaciones:
 *
 *  - `manualEntryPricingParity.test.ts`: congela el `patch` del builder y el presupuesto del
 *    motor para cada respuesta. Si un cambio de presentación altera un solo céntimo o un solo
 *    campo enviado, el test falla.
 *  - El banco visual (`scripts/qa/manual-entry/`): introduce estas mismas respuestas pulsando
 *    la interfaz real y comprueba que lo que sale del asistente es lo mismo.
 *
 * «Completas» quiere decir que cada campo visible lleva su valor explícito, igual que lo dejaría
 * el asistente (que rellena los `defaultValue`), para que el recorrido por la interfaz y el
 * fixture describan exactamente el mismo formulario.
 *
 * No se importa desde la aplicación: no entra en el bundle.
 */
import {
  PALM_HEIGHT_RANGES_BY_SPECIES,
  PALM_SPECIES_OPTIONS,
  type ManualAnswers,
  type ManualServiceKey,
} from '../../shared/manualEntry/manualEntrySchema';

export interface ManualParityFixture {
  /** Identificador estable: `<servicio>/<descripción>`. Es la clave del snapshot. */
  id: string;
  serviceKey: ManualServiceKey;
  items: ManualAnswers[];
  wasteRemoval: boolean;
}

/* -------------------------------------------------------------------------- */
/* Configuraciones de jardinero de prueba                                       */
/* -------------------------------------------------------------------------- */

/**
 * Precios distintos entre sí a propósito: si una rama se confundiera con otra (un tramo, un
 * porte, un estado), el total cambiaría y el snapshot lo delataría.
 */
const PALM_HEIGHT_PRICES: Record<string, Record<string, number>> = {};
const PALM_YIELDS: Record<string, Record<string, number>> = {};
Object.entries(PALM_HEIGHT_RANGES_BY_SPECIES).forEach(([species, ranges], speciesIndex) => {
  PALM_HEIGHT_PRICES[species] = {};
  PALM_YIELDS[species] = {};
  ranges.forEach((range, rangeIndex) => {
    PALM_HEIGHT_PRICES[species][range] = 40 + speciesIndex * 7 + rangeIndex * 35;
    PALM_YIELDS[species][range] = Number((1.2 - rangeIndex * 0.25).toFixed(2));
  });
});

export const MANUAL_PARITY_PROVIDER_CONFIGS: Record<ManualServiceKey, Record<string, unknown>> = {
  lawn: {
    pricing_method: 'per_quantity',
    price_per_m2: 1.3,
    yield_m2_per_hour: 150,
    condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
    waste_removal: { percentage: 10 },
    minimum_price: 35,
  },
  hedge: {
    pricing_method: 'per_quantity',
    pricing_matrix: { '0-2m': 3.1, '2-4m': 5.3, '4-6m': 8.7 },
    yield_ml_per_hour: { '0-2m': 40, '2-4m': 28, '4-6m': 17 },
    condition_surcharges: { media: 20, alta: 50 },
    waste_removal: { percentage: 12 },
    minimum_price: 40,
  },
  tree: {
    minimumPrice: 45,
    estructural: { small: 31, medium: 53, large: 97 },
    formacion: { small: 22, medium: 37, large: 64 },
    difficultyIncrease: 25,
    wasteRemovalMultiplier: 15,
    yield_units_per_hour: {
      estructural: { small: 1, medium: 0.7, large: 0.4 },
      formacion: { small: 1.2, medium: 0.9, large: 0.5 },
    },
  },
  palm: {
    pricing_method: 'per_quantity',
    height_prices: PALM_HEIGHT_PRICES,
    yield_units_per_hour: PALM_YIELDS,
    condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
    access_difficulty: 15,
    phytosanitary: 11,
    trunk_finish: 13,
    waste_removal: { option: 'extra_percentage', percentage: 10 },
    minimum_price: 50,
  },
  shrub: {
    pricing_method: 'per_quantity',
    prices_per_m2: { 'pequeñas': 4.1, 'medianas': 6.3, 'grandes': 9.7 },
    yield_m2_per_hour: { 'pequeñas': 20, 'medianas': 14, 'grandes': 9 },
    condition_surcharges: { media: 20, alta: 50 },
    waste_removal: { percentage: 10 },
    minimum_price: 30,
  },
  phytosanitary: {
    tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'],
    detailed_pricing: {
      cesped: { minimo: 0, preventivo: 0.31, curativo: 0.47 },
      setos: { minimo: 0, bajos_preventivo: 1.1, bajos_curativo: 1.7, altos_preventivo: 2.3, altos_curativo: 2.9 },
      palmeras: {
        minimo: 0,
        pequenas_preventivo: 12, pequenas_curativo: 17, pequenas_cirugia: 41,
        medianas_preventivo: 19, medianas_curativo: 26, medianas_cirugia: 43,
        altas_preventivo: 31, altas_curativo: 38, altas_cirugia: 47,
      },
      arboles: {
        minimo: 0,
        pequenos_preventivo: 9, pequenos_curativo: 13,
        medianos_preventivo: 16, medianos_curativo: 21,
        grandes_preventivo: 29, grandes_curativo: 36,
      },
      plantas: {
        minimo: 0,
        pequenas_preventivo: 0.6, pequenas_curativo: 0.9,
        medianas_preventivo: 0.8, medianas_curativo: 1.2,
        grandes_preventivo: 1.1, grandes_curativo: 1.6,
      },
    },
    palmeras: { endoterapia: { precio_unico: 45 } },
    yields: {
      cesped_m2_per_hour: 200,
      setos_ml_per_hour: 50,
      palmeras_units_per_hour: 3,
      arboles_units_per_hour: 2,
      plantas_m2_per_hour: 100,
      endoterapia_units_per_hour: 5,
    },
    pricing_modifiers: { eco: { percentage: 10 }, combo: { two_treatments_percentage: 10, three_plus_treatments_percentage: 15 } },
    minimum_fee: 25,
  },
  weeding: {
    precio_desbroce_m2: 0.45,
    precio_herbicida_m2: 0.27,
    yield_m2_per_hour: 300,
    importe_minimo: 40,
    suplementos: { dificultad_media: 20, dificultad_alta: 50, retirada_restos: 10 },
  },
};

/* -------------------------------------------------------------------------- */
/* Respuestas                                                                   */
/* -------------------------------------------------------------------------- */

const f = (
  serviceKey: ManualServiceKey,
  name: string,
  items: ManualAnswers[],
  wasteRemoval = true,
): ManualParityFixture => ({ id: `${serviceKey}/${name}`, serviceKey, items, wasteRemoval });

const LAWN: ManualParityFixture[] = [
  f('lawn', 'normal-80m2', [{ superficie_m2: 80, estado_jardin: 'normal' }]),
  f('lawn', 'descuidado-80m2', [{ superficie_m2: 80, estado_jardin: 'descuidado' }]),
  f('lawn', 'muy-descuidado-250m2', [{ superficie_m2: 250, estado_jardin: 'muy descuidado' }]),
  f('lawn', 'minimo-1m2', [{ superficie_m2: 1, estado_jardin: 'normal' }]),
  f('lawn', 'maximo-5000m2', [{ superficie_m2: 5000, estado_jardin: 'normal' }]),
  f('lawn', 'decimal-72.5m2-sin-retirada', [{ superficie_m2: 72.5, estado_jardin: 'descuidado' }], false),
];

// Alturas en los dos lados de cada límite de tramo (≤2 bajo, ≤4 medio, resto alto).
const HEDGE_HEIGHTS = [0.3, 1.9, 2, 2.1, 4, 4.1, 6];
const HEDGE_STATES = ['normal', 'media', 'alta'];
const HEDGE: ManualParityFixture[] = [
  ...HEDGE_HEIGHTS.map((altura, index) =>
    f('hedge', `altura-${altura}m-caras-${index % 2 ? '2' : '1'}-${HEDGE_STATES[index % 3]}`, [
      { longitud_m: 14, altura_m: altura, caras: index % 2 ? '2' : '1', estado_seto: HEDGE_STATES[index % 3] },
    ]),
  ),
  f('hedge', 'longitud-minima-1m', [{ longitud_m: 1, altura_m: 1.5, caras: '1', estado_seto: 'normal' }]),
  f('hedge', 'longitud-maxima-200m-sin-retirada', [{ longitud_m: 200, altura_m: 2.5, caras: '2', estado_seto: 'alta' }], false),
];

const TREE_SIZES = ['small', 'medium', 'large', 'over_9'];
const TREE: ManualParityFixture[] = [
  ...TREE_SIZES.flatMap((size) =>
    ['structural', 'shaping'].map((pruningType, typeIndex) =>
      f('tree', `${size}-${pruningType}-${typeIndex ? 'acceso-dificil' : 'acceso-normal'}`, [
        { aiSizeBand: size, pruningType, difficultyHigh: typeIndex === 1 },
      ]),
    ),
  ),
  f('tree', 'medium-structural-acceso-dificil-sin-retirada', [
    { aiSizeBand: 'medium', pruningType: 'structural', difficultyHigh: true },
  ], false),
  f('tree', 'tres-arboles-distintos', [
    { aiSizeBand: 'small', pruningType: 'shaping', difficultyHigh: false },
    { aiSizeBand: 'medium', pruningType: 'structural', difficultyHigh: true },
    { aiSizeBand: 'large', pruningType: 'structural', difficultyHigh: false },
  ]),
];

const PALM_STATES = ['normal', 'descuidado', 'muy descuidado'];
const PALM: ManualParityFixture[] = [
  // Cada especie en cada tramo. Los extras se alternan para que cada combinación aparezca, y
  // el acceso difícil se declara también en el tramo más bajo, donde el builder lo descarta.
  ...PALM_SPECIES_OPTIONS.flatMap((speciesOption, speciesIndex) =>
    (PALM_HEIGHT_RANGES_BY_SPECIES[speciesOption.value] || []).map((height, rangeIndex) => {
      const seed = speciesIndex + rangeIndex;
      return f('palm', `${speciesOption.value}-${height}`, [{
        species: speciesOption.value,
        height,
        state: PALM_STATES[seed % 3],
        quantity: (seed % 4) + 1,
        hasPhytosanitary: seed % 2 === 0,
        hasTrunkPeeling: seed % 3 === 1,
        hasAccessDifficulty: seed % 2 === 1 || rangeIndex === 0,
      }]);
    }),
  ),
  f('palm', 'cantidad-maxima-50', [{
    species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 50,
    hasPhytosanitary: true, hasTrunkPeeling: false, hasAccessDifficulty: false,
  }]),
  f('palm', 'dos-grupos-sin-retirada', [
    { species: 'Phoenix canariensis', height: '>10m', state: 'muy descuidado', quantity: 2, hasPhytosanitary: true, hasTrunkPeeling: true, hasAccessDifficulty: true },
    { species: 'Washingtonia robusta/filifera', height: '4-12m', state: 'normal', quantity: 5, hasPhytosanitary: false, hasTrunkPeeling: false, hasAccessDifficulty: false },
  ], false),
];

const SHRUB_SIZES = ['pequeñas', 'medianas', 'grandes'];
const SHRUB_STATES = ['normal', 'descuidado', 'muy descuidado'];
const SHRUB: ManualParityFixture[] = [
  ...SHRUB_SIZES.flatMap((size, sizeIndex) =>
    SHRUB_STATES.map((state, stateIndex) =>
      f('shrub', `${size}-${state}`, [{ superficie_m2: 6 + sizeIndex * 11 + stateIndex * 3, tamano_dominante: size, estado_plantas: state }]),
    ),
  ),
  f('shrub', 'maximo-2000m2-sin-retirada', [{ superficie_m2: 2000, tamano_dominante: 'grandes', estado_plantas: 'normal' }], false),
  f('shrub', 'minimo-1m2', [{ superficie_m2: 1, tamano_dominante: 'pequeñas', estado_plantas: 'normal' }]),
];

const PHYTO_TYPES = ['Césped', 'Plantas bajas', 'Setos', 'Árboles', 'Palmeras'];
const PHYTO_SIZE_BY_TYPE: Record<string, string[]> = {
  'Plantas bajas': ['pequenas', 'medianas', 'grandes'],
  'Árboles': ['pequenos', 'medianos', 'grandes'],
  'Palmeras': ['pequenas', 'medianas', 'altas'],
};
const PHYTO_INTENTS: Array<{ intent: string; curativeTarget?: string }> = [
  { intent: 'preventive' },
  { intent: 'curative', curativeTarget: 'insects' },
  { intent: 'curative', curativeTarget: 'fungus' },
  { intent: 'curative', curativeTarget: 'both' },
];
const phytoItem = (affectedType: string, variant: number): ManualAnswers => {
  const intent = PHYTO_INTENTS[variant % PHYTO_INTENTS.length];
  const sizes = PHYTO_SIZE_BY_TYPE[affectedType];
  const item: ManualAnswers = {
    affectedType,
    area: affectedType === 'Árboles' || affectedType === 'Palmeras' ? 3 + variant : 40 + variant * 15,
    intent: intent.intent,
    productPreference: variant % 2 === 0 ? 'chemical' : 'ecological',
    // Valores por defecto que el asistente deja en todas las zonas, visibles o no.
    aboveThreeMeters: affectedType === 'Setos' ? variant % 2 === 1 : false,
    wantsEndotherapy: affectedType === 'Palmeras' ? variant % 2 === 1 : false,
  };
  if (intent.curativeTarget) item.curativeTarget = intent.curativeTarget;
  if (sizes) item.sizeBand = sizes[variant % sizes.length];
  return item;
};
// Fitosanitarios no pregunta por la retirada: el asistente la deja en su valor inicial (`true`)
// y el builder la anula. Se deja igual que en la interfaz.
const PHYTO: ManualParityFixture[] = [
  ...PHYTO_TYPES.flatMap((affectedType) =>
    PHYTO_INTENTS.map((intent, variant) =>
      f('phytosanitary', `${affectedType}-${intent.intent}${intent.curativeTarget ? `-${intent.curativeTarget}` : ''}`, [phytoItem(affectedType, variant)]),
    ),
  ),
  f('phytosanitary', 'arboles-grandes-palmeras-altas-plantas-grandes', [
    { ...phytoItem('Árboles', 0), sizeBand: 'grandes' },
    { ...phytoItem('Palmeras', 0), sizeBand: 'altas' },
    { ...phytoItem('Plantas bajas', 0), sizeBand: 'grandes' },
  ]),
  f('phytosanitary', 'minimo-1-arbol', [{ ...phytoItem('Árboles', 0), area: 1 }]),
  f('phytosanitary', 'maximo-5000m2-cesped', [{ ...phytoItem('Césped', 0), area: 5000 }]),
];

const WEEDING_STATES = ['normal', 'dificultad_media', 'dificultad_alta'];
const WEEDING: ManualParityFixture[] = [
  ...WEEDING_STATES.flatMap((state, stateIndex) =>
    [false, true].map((applyHerbicide) =>
      f('weeding', `${state}-${applyHerbicide ? 'con' : 'sin'}-herbicida`, [{ area: 120 + stateIndex * 90, state, applyHerbicide }]),
    ),
  ),
  f('weeding', 'minimo-1m2', [{ area: 1, state: 'normal', applyHerbicide: false }]),
  f('weeding', 'maximo-10000m2-sin-retirada', [{ area: 10000, state: 'dificultad_alta', applyHerbicide: true }], false),
];

export const MANUAL_PARITY_FIXTURES: ManualParityFixture[] = [
  ...LAWN,
  ...HEDGE,
  ...TREE,
  ...PALM,
  ...SHRUB,
  ...PHYTO,
  ...WEEDING,
];
