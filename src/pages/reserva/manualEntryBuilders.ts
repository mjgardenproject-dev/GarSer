/**
 * Manual Entry Builders
 * -------------------------------------------------------------
 * Convert the wizard answers into the EXACT same BookingData collection shapes
 * the AI path produces, so `buildAuthoritativeBookingQuote` (and everything
 * downstream) treats manual and AI input identically.
 *
 * Modeled 1:1 on `detailsPageDevSeeds.ts` (which already builds engine-ready
 * shapes without photos), but driven by real client answers and tagged with
 * real provenance (`inputSource: 'manual'`, provider `client-manual`).
 *
 * Lives next to `detailsPageAdapters.ts` (client-only) so it can reuse the
 * adapters; the server never needs builders — it validates the already-built
 * collections via `manualEntryValidation.ts`.
 */

import type { BookingData } from '../../contexts/BookingContext';
import { adaptLegacyAnalysisToV2 } from '../../shared/analysisV2';
import { buildAnalysisCommonFields } from '../../shared/analysisV2Details';
import {
  getHighestOpenRangeThresholdForSpecies,
  getLowestRangeThresholdForSpecies,
  isHighestOpenRangeForSpecies,
  isLowestRangeThresholdForSpecies,
  supportsPhytosanitaryForSpecies,
  supportsTrunkPeelingForSpecies,
} from '../../domain/speciesBusinessRules';
import {
  adaptLawnAnalysisResult,
  adaptShrubAnalysisResult,
  adaptTreeAnalysisResult,
} from './detailsPageAdapters';
import {
  type ManualAnswers,
  type ManualServiceKey,
} from '../../shared/manualEntry/manualEntrySchema';
import { sanitizeBoolean, sanitizeNumber, sanitizeString } from '../../shared/manualEntry/manualEntryValidation';

const MANUAL_PROVIDER = 'client-manual';
const MANUAL_MODEL = 'manual-entry';

const num = (value: unknown, fallback = 0): number => {
  const parsed = sanitizeNumber(value);
  return parsed === null ? fallback : parsed;
};

const emptyPhotoCollection = () => ({
  photoIds: [] as string[],
  photoUrls: [] as string[],
  files: [] as File[],
  selectedIndices: [] as number[],
  analyzedIndices: [] as number[],
});

const manualId = (prefix: string, index: number) => `manual-${prefix}-${index + 1}-${Date.now()}`;

/* -------------------------------------------------------------------------- */
/* Per-service builders                                                         */
/* -------------------------------------------------------------------------- */

function buildLawnZones(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const superficie = num(answers.superficie_m2);
    const estado = sanitizeString(answers.estado_jardin) || 'normal';
    const legacyTask = {
      tipo_servicio: 'Corte de césped',
      superficie_m2: superficie,
      estado_jardin: estado,
      nivel_analisis: 1,
      observaciones: [],
      indices_imagenes: [],
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Corte de césped',
      sourcePhotoCount: 0,
      legacyResponse: { tareas: [legacyTask] },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    return {
      id: manualId('lawn', index),
      wasteRemoval: true,
      imageIndices: [],
      inputSource: 'manual' as const,
      ...emptyPhotoCollection(),
      // adapter supplies species / state / quantity from the legacy task
      ...adaptLawnAnalysisResult({ analysis, legacyTask, selectedIndices: [], totalPhotoCount: 0 }),
    };
  });
}

function hedgeBandFromHeight(altura: number): '0-2m' | '2-4m' | '4-6m' {
  if (altura <= 2) return '0-2m';
  if (altura <= 4) return '2-4m';
  return '4-6m';
}

function buildHedgeZones(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const longitud = num(answers.longitud_m);
    const altura = num(answers.altura_m, 2);
    const caras = (num(answers.caras, 1) === 2 ? 2 : 1) as 1 | 2;
    const band = hedgeBandFromHeight(altura);
    const estado = sanitizeString(answers.estado_seto) || 'normal';

    const legacyTask = {
      tipo_servicio: 'Poda de setos',
      longitud_m: longitud,
      altura_m: altura,
      tipo_seto: band,
      estado_seto: estado,
      caras,
      nivel_analisis: 1,
      observaciones: [],
      indices_imagenes: [],
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de setos',
      sourcePhotoCount: 0,
      legacyResponse: { tareas: [legacyTask] },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    const common = buildAnalysisCommonFields({
      analysis,
      analysisLevel: 1,
      observations: [],
      analyzedIndices: [],
      selectedIndices: [],
      totalPhotoCount: 0,
    });

    return {
      id: manualId('hedge', index),
      category: band,
      type: band,
      height: band,
      length: longitud,
      length_pricing_m: longitud,
      height_pricing_m: altura,
      faces_to_trim: caras,
      hasBackFaceTrim: caras === 2,
      state: estado,
      access: 'normal' as const,
      wasteRemoval: true,
      inputSource: 'manual' as const,
      imageIndices: [],
      ...emptyPhotoCollection(),
      analysisV2: common.analysisV2,
      analysisLevel: common.analysisLevel,
      isFailed: common.isFailed,
      observations: common.observations,
    };
  });
}

function buildTreeGroups(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const sizeBand = (sanitizeString(answers.aiSizeBand) || 'small') as 'small' | 'medium' | 'large' | 'over_9';
    const pruningType = (sanitizeString(answers.pruningType) === 'shaping' ? 'shaping' : 'structural') as
      | 'structural'
      | 'shaping';
    const difficultyHigh = sanitizeBoolean(answers.difficultyHigh);

    const legacyTree = {
      size_band: sizeBand,
      nivel_analisis: 1,
      observaciones: [],
      indice_imagen: 0,
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de árboles',
      sourcePhotoCount: 0,
      legacyResponse: { arboles: [legacyTree] },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    return {
      id: manualId('tree', index),
      pruningType,
      inputSource: 'manual' as const,
      ...emptyPhotoCollection(),
      ...adaptTreeAnalysisResult({
        analysis,
        legacyTree,
        selectedIndices: [],
        totalPhotoCount: 0,
        difficultyHigh,
      }),
      difficultyHigh,
    };
  });
}

function buildPalmGroups(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const species = sanitizeString(answers.species);
    const height = sanitizeString(answers.height);
    const state = sanitizeString(answers.state) || 'normal';
    const quantity = Math.max(1, Math.trunc(num(answers.quantity, 1)));

    const hasPhytosanitary = supportsPhytosanitaryForSpecies(species) ? sanitizeBoolean(answers.hasPhytosanitary) : false;
    const hasTrunkPeeling = supportsTrunkPeelingForSpecies(species) ? sanitizeBoolean(answers.hasTrunkPeeling) : false;
    const isLowestRange = isLowestRangeThresholdForSpecies(species, height);
    const hasAccessDifficulty = isLowestRange ? false : sanitizeBoolean(answers.hasAccessDifficulty);
    const isTerminalOpenRange = isHighestOpenRangeForSpecies(species, height);

    const legacyPalm = {
      especie: species,
      altura_m: 0,
      estado: state,
      nivel_analisis: 1,
      observaciones: [],
      indice_imagen: 0,
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de palmeras',
      sourcePhotoCount: 0,
      legacyResponse: { palmas: [legacyPalm] },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    const common = buildAnalysisCommonFields({
      analysis,
      analysisLevel: 1,
      observations: [],
      analyzedIndices: [],
      selectedIndices: [],
      totalPhotoCount: 0,
    });

    return {
      id: manualId('palm', index),
      species,
      height,
      quantity,
      state,
      wasteRemoval: true,
      hasPhytosanitary,
      hasTrunkPeeling,
      hasAccessDifficulty,
      lowestRangeThreshold: getLowestRangeThresholdForSpecies(species),
      highestOpenRangeThreshold: getHighestOpenRangeThresholdForSpecies(species) || undefined,
      isTerminalOpenRange,
      allowsPriceChange: isTerminalOpenRange,
      inputSource: 'manual' as const,
      ...emptyPhotoCollection(),
      analysisV2: common.analysisV2,
      analysisLevel: common.analysisLevel,
      observations: common.observations,
      isFailed: common.isFailed,
    };
  });
}

function buildShrubGroups(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const superficie = num(answers.superficie_m2);
    const size = (sanitizeString(answers.tamano_dominante) || 'pequeñas') as 'pequeñas' | 'medianas' | 'grandes';
    const estado = sanitizeString(answers.estado_plantas) || 'normal';
    const legacyTask = {
      tipo_servicio: 'Poda de plantas y arbustos',
      superficie_m2: superficie,
      tamano_dominante: size,
      estado_plantas: estado,
      nivel_analisis: 1,
      observaciones: [],
      indices_imagenes: [],
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Poda de plantas y arbustos',
      sourcePhotoCount: 0,
      legacyResponse: { tareas: [legacyTask] },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    return {
      id: manualId('shrub', index),
      wasteRemoval: true,
      inputSource: 'manual' as const,
      ...emptyPhotoCollection(),
      // adapter supplies area / size / state from the legacy task
      ...adaptShrubAnalysisResult({ analysis, legacyTask, selectedIndices: [], totalPhotoCount: 0 }),
      // Estado declarado por el cliente: no necesita re-confirmación.
      stateProposedByAI: false,
    };
  });
}

function buildPhytosanitaryZones(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const area = num(answers.area);
    const affectedType = (sanitizeString(answers.affectedType) || 'Césped') as
      | 'Césped'
      | 'Árboles'
      | 'Setos'
      | 'Plantas bajas'
      | 'Palmeras';
    const intent = (sanitizeString(answers.intent) || 'preventive') as 'preventive' | 'curative';
    const curativeTarget = sanitizeString(answers.curativeTarget) as 'insects' | 'fungus' | 'both' | '';
    const productPreference = (sanitizeString(answers.productPreference) || 'chemical') as 'chemical' | 'ecological';
    const aboveThreeMeters = sanitizeBoolean(answers.aboveThreeMeters);

    let requestedTreatment: 'insecticida' | 'fungicida' | 'combo' | undefined;
    if (intent === 'curative') {
      if (curativeTarget === 'both') requestedTreatment = 'combo';
      else if (curativeTarget === 'fungus') requestedTreatment = 'fungicida';
      else requestedTreatment = 'insecticida';
    }

    return {
      id: manualId('phytosanitary', index),
      type: requestedTreatment || 'preventivo',
      area,
      affectedType,
      intent,
      curativeTarget: intent === 'curative' && curativeTarget ? curativeTarget : undefined,
      productPreference,
      aboveThreeMeters,
      aboveTwoMeters: aboveThreeMeters,
      requestedTreatment,
      wantsEco: productPreference === 'ecological',
      scope: [],
      wasteRemoval: true,
      inputSource: 'manual' as const,
      analysisLevel: 1,
      isFailed: false,
      observations: [] as string[],
      ...emptyPhotoCollection(),
    };
  });
}

function buildWeedingZones(items: ManualAnswers[]) {
  return items.map((answers, index) => {
    const area = num(answers.area);
    const state = sanitizeString(answers.state) || 'normal';
    const applyHerbicide = sanitizeBoolean(answers.applyHerbicide);
    const legacyTask: Record<string, unknown> = {
      tipo_servicio: 'Desbroce de malas hierbas',
      superficie_malas_hierbas_m2: area,
      estado_malas_hierbas: state,
      nivel_analisis: 1,
      observaciones: [],
      indices_imagenes: [],
    };
    const analysis = adaptLegacyAnalysisToV2({
      serviceName: 'Desbroce de malas hierbas',
      sourcePhotoCount: 0,
      legacyResponse: { tareas: [legacyTask] as any },
      provider: MANUAL_PROVIDER,
      model: MANUAL_MODEL,
    });
    const common = buildAnalysisCommonFields({
      analysis,
      analysisLevel: 1,
      observations: [],
      analyzedIndices: [],
      selectedIndices: [],
      totalPhotoCount: 0,
    });
    return {
      id: manualId('weeding', index),
      area,
      state,
      applyHerbicide,
      wasteRemoval: true,
      inputSource: 'manual' as const,
      ...emptyPhotoCollection(),
      analysisV2: common.analysisV2,
      analysisLevel: common.analysisLevel,
      observations: common.observations,
      isFailed: common.isFailed,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface ManualBuildResult {
  patch: Partial<BookingData>;
  /** Compact snapshot of declared variables for the audit record. */
  declaredVariables: Record<string, unknown>;
}

/**
 * Build the BookingData patch for a manual submission. The patch contains only
 * the relevant collection for the service plus the global `wasteRemoval` and
 * `dataInputMode` flags, leaving the rest of the booking untouched.
 */
export function buildManualBookingPatch(params: {
  serviceKey: ManualServiceKey;
  items: ManualAnswers[];
  wasteRemoval: boolean;
}): ManualBuildResult {
  const { serviceKey, items, wasteRemoval } = params;
  const base: Partial<BookingData> = {
    dataInputMode: 'manual',
    wasteRemoval,
  };

  const withWaste = <T extends { wasteRemoval?: boolean }>(rows: T[]): T[] =>
    rows.map((row) => ({ ...row, wasteRemoval }));

  let patch: Partial<BookingData> = base;

  switch (serviceKey) {
    case 'lawn':
      patch = { ...base, lawnZones: withWaste(buildLawnZones(items)) as BookingData['lawnZones'] };
      break;
    case 'hedge':
      patch = { ...base, hedgeZones: withWaste(buildHedgeZones(items)) as BookingData['hedgeZones'] };
      break;
    case 'tree':
      patch = { ...base, treeGroups: buildTreeGroups(items) as BookingData['treeGroups'] };
      break;
    case 'palm':
      patch = { ...base, palmGroups: withWaste(buildPalmGroups(items)) as BookingData['palmGroups'] };
      break;
    case 'shrub':
      patch = { ...base, shrubGroups: withWaste(buildShrubGroups(items)) as BookingData['shrubGroups'] };
      break;
    case 'phytosanitary':
      patch = { ...base, phytosanitaryZones: withWaste(buildPhytosanitaryZones(items)) as BookingData['phytosanitaryZones'] };
      break;
    case 'weeding':
      patch = { ...base, weedingZones: withWaste(buildWeedingZones(items)) as BookingData['weedingZones'] };
      break;
    default:
      patch = base;
  }

  return {
    patch,
    declaredVariables: {
      serviceKey,
      wasteRemoval,
      items: items.map((item) => ({ ...item })),
    },
  };
}
