import type { BookingData } from '../../contexts/BookingContext';
import { adaptLegacyAnalysisToV2 } from '../../shared/analysisV2';
import { buildAnalysisCommonFields } from '../../shared/analysisV2Details';
import {
  EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
  adaptLawnAnalysisResult,
  adaptPhytosanitaryAnalysisResult,
  adaptShrubAnalysisResult,
  adaptTreeAnalysisResult,
  sumPhytosanitaryMetrics,
} from './detailsPageAdapters';

type LawnZone = NonNullable<BookingData['lawnZones']>[number];
type HedgeZone = NonNullable<BookingData['hedgeZones']>[number];
type PalmGroup = NonNullable<BookingData['palmGroups']>[number];
type TreeGroup = NonNullable<BookingData['treeGroups']>[number];
type ShrubGroup = NonNullable<BookingData['shrubGroups']>[number];
type PhytosanitaryZone = NonNullable<BookingData['phytosanitaryZones']>[number];
type WeedingZone = NonNullable<BookingData['weedingZones']>[number];

const DEV_PROVIDER = 'development-seed';
const DEV_MODEL = 'dev-seed';

function buildSeedImageDataUrl(label: string, index: number) {
  const hue = (index * 47 + label.length * 13) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="hsl(${hue} 55% 82%)"/><rect x="80" y="80" width="1040" height="640" rx="36" fill="hsl(${(hue + 24) % 360} 45% 94%)" stroke="hsl(${hue} 35% 45%)" stroke-width="10"/><text x="80" y="180" font-size="52" font-family="Arial, sans-serif" fill="#16322f">${label}</text><text x="80" y="260" font-size="30" font-family="Arial, sans-serif" fill="#2f5f57">Imagen de prueba ${index + 1}</text><text x="80" y="330" font-size="24" font-family="Arial, sans-serif" fill="#476d67">Solo desarrollo - contrato equivalente a analisis real</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildSeedPhotoIds(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `dev-seed:${prefix}:${index}`);
}

function buildSeedPhotoBundle(prefix: string, count: number) {
  const safeCount = Math.max(1, count);
  const photoUrls = Array.from({ length: safeCount }, (_, index) => buildSeedImageDataUrl(prefix, index));
  const selectedIndices = Array.from({ length: safeCount }, (_, index) => index);
  return {
    photoUrls,
    photoIds: buildSeedPhotoIds(prefix, safeCount),
    files: [] as File[],
    selectedIndices,
    analyzedIndices: selectedIndices,
  };
}

function isLocalhostHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function isDetailsDevAnalysisEnabled() {
  const envEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_ANALYSIS_SEEDS === 'true';
  if (!envEnabled) return false;
  if (typeof window === 'undefined') return envEnabled;
  return isLocalhostHost(window.location.hostname);
}

export function buildLawnDevZone(existing?: Partial<LawnZone>, index = 0): LawnZone {
  const photos = buildSeedPhotoBundle(`lawn-zone-${index + 1}`, 2);
  const legacyTask = {
    tipo_servicio: 'Corte de cesped',
    superficie_m2: 85,
    estado_jardin: 'normal',
    nivel_analisis: 1,
    observaciones: ['Cesped homogeneo y listo para pricing.'],
    indices_imagenes: photos.selectedIndices,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Corte de césped',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { tareas: [legacyTask] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });

  return {
    id: existing?.id || `dev-lawn-${index + 1}`,
    species: existing?.species || '',
    state: existing?.state || 'normal',
    quantity: 0,
    wasteRemoval: existing?.wasteRemoval ?? true,
    imageIndices: existing?.imageIndices || [],
    ...photos,
    ...adaptLawnAnalysisResult({
      analysis,
      legacyTask,
      selectedIndices: photos.selectedIndices,
      totalPhotoCount: photos.photoUrls.length,
    }),
  };
}

export function buildHedgeDevZone(existing?: Partial<HedgeZone>, index = 0): HedgeZone {
  const faceA = buildSeedPhotoBundle(`hedge-zone-${index + 1}-face-a`, 1);
  const faceB = buildSeedPhotoBundle(`hedge-zone-${index + 1}-face-b`, 1);
  const allPhotoUrls = [...faceA.photoUrls, ...faceB.photoUrls];
  const selectedIndices = [0, 1];
  const legacyTask = {
    tipo_servicio: 'Poda de setos',
    longitud_m: 18,
    altura_m: 2.2,
    tipo_seto: '2-4m',
    estado_seto: 'normal',
    caras: 2,
    nivel_analisis: 1,
    observaciones: ['Seto lineal continuo con acceso normal.'],
    indices_imagenes: selectedIndices,
    detalle_caras: {
      cara_a: { longitud_m: 18, altura_m: 2.2, nivel_analisis: 1, observaciones: ['Cara A valida.'] },
      cara_b: { longitud_m: 18, altura_m: 2.2, nivel_analisis: 1, observaciones: ['Cara B valida.'] },
    },
    resumen_medicion: {
      base_longitud_m: 18,
      base_altura_m: 2.2,
      caras_recortar: 2,
      longitud_calculo_m: 18,
      altura_calculo_m: 2.2,
      metodo: 'dev_seed',
    },
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Poda de setos',
    sourcePhotoCount: allPhotoUrls.length,
    legacyResponse: { tareas: [legacyTask] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });
  const common = buildAnalysisCommonFields({
    analysis,
    analysisLevel: legacyTask.nivel_analisis,
    observations: legacyTask.observaciones,
    analyzedIndices: selectedIndices,
    selectedIndices,
    totalPhotoCount: allPhotoUrls.length,
  });

  return {
    id: existing?.id || `dev-hedge-${index + 1}`,
    // Bandas del motor ('0-2m'|'2-4m'|'4-6m') y longitud BASE (el motor multiplica por caras).
    category: '2-4m',
    type: '2-4m',
    height: '2-4m',
    length: 18,
    length_pricing_m: 18,
    height_pricing_m: 2.2,
    faces_to_trim: 2,
    hasBackFaceTrim: true,
    state: 'normal',
    access: 'normal',
    wasteRemoval: existing?.wasteRemoval ?? true,
    photoUrls: allPhotoUrls,
    photoIds: buildSeedPhotoIds(`hedge-zone-${index + 1}`, allPhotoUrls.length),
    files: [],
    imageIndices: existing?.imageIndices || [],
    selectedIndices,
    analyzedIndices: selectedIndices,
    analysisV2: common.analysisV2,
    analysisLevel: common.analysisLevel,
    isFailed: common.isFailed,
    observations: common.observations,
    faceA: {
      ...faceA,
      analysisLevel: 1,
      observations: ['Cara A lista para pricing.'],
      longitud_m: 18,
      altura_m: 2.2,
    },
    faceB: {
      ...faceB,
      analysisLevel: 1,
      observations: ['Cara B lista para pricing.'],
      longitud_m: 18,
      altura_m: 2.2,
    },
  };
}

export function buildPalmDevGroup(existing?: Partial<PalmGroup>, index = 0): PalmGroup {
  const photos = buildSeedPhotoBundle(`palm-group-${index + 1}`, 1);
  const legacyPalm = {
    especie: 'Phoenix canariensis',
    altura_m: 5,
    estado: 'normal',
    nivel_analisis: 1,
    observaciones: ['Palmera apta para poda estandar.'],
    indice_imagen: 0,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Poda de palmeras',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { palmas: [legacyPalm] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });
  const common = buildAnalysisCommonFields({
    analysis,
    analysisLevel: legacyPalm.nivel_analisis,
    observations: legacyPalm.observaciones,
    analyzedIndices: photos.selectedIndices,
    selectedIndices: photos.selectedIndices,
    totalPhotoCount: photos.photoUrls.length,
  });

  return {
    id: existing?.id || `dev-palm-${index + 1}`,
    species: 'Phoenix canariensis',
    height: '3-6m',
    quantity: Math.max(1, existing?.quantity || 2),
    state: 'normal',
    wasteRemoval: existing?.wasteRemoval ?? true,
    hasPhytosanitary: false,
    hasTrunkPeeling: false,
    ...photos,
    analysisV2: common.analysisV2,
    analysisLevel: common.analysisLevel,
    observations: common.observations,
    isFailed: common.isFailed,
  };
}

export function buildTreeDevGroup(existing?: Partial<TreeGroup>, index = 0): TreeGroup {
  const photos = buildSeedPhotoBundle(`tree-group-${index + 1}`, 1);
  const legacyTree = {
    size_band: 'medium' as const,
    altura_m: 4.5,
    tipo_arbol: 'ornamental',
    horas_estimadas: 2,
    nivel_analisis: 1,
    observaciones: ['Arbol ornamental con acceso despejado.'],
    indice_imagen: 0,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Poda de árboles',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { arboles: [legacyTree] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });

  return {
    id: existing?.id || `dev-tree-${index + 1}`,
    pruningType: existing?.pruningType || 'structural',
    ...photos,
    ...adaptTreeAnalysisResult({
      analysis,
      legacyTree,
      selectedIndices: photos.selectedIndices,
      totalPhotoCount: photos.photoUrls.length,
      difficultyHigh: existing?.difficultyHigh ?? false,
    }),
    difficultyHigh: existing?.difficultyHigh ?? false,
    estimatedHours: 2,
  };
}

export function buildShrubDevGroup(existing?: Partial<ShrubGroup>, index = 0): ShrubGroup {
  const photos = buildSeedPhotoBundle(`shrub-group-${index + 1}`, 1);
  const legacyTask = {
    tipo_servicio: 'Poda de plantas y arbustos',
    superficie_m2: 24,
    tamano_dominante: 'medianas',
    nivel_analisis: 1,
    observaciones: ['Macizo continuo con poda de mantenimiento.'],
    indices_imagenes: photos.selectedIndices,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Poda de plantas y arbustos',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { tareas: [legacyTask] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });

  return {
    id: existing?.id || `dev-shrub-${index + 1}`,
    area: 0,
    size: 'pequeñas',
    wasteRemoval: existing?.wasteRemoval ?? true,
    ...photos,
    ...adaptShrubAnalysisResult({
      analysis,
      legacyTask,
      selectedIndices: photos.selectedIndices,
      totalPhotoCount: photos.photoUrls.length,
    }),
  };
}

export function buildPhytosanitaryDevZone(existing?: Partial<PhytosanitaryZone>, index = 0): PhytosanitaryZone {
  const photos = buildSeedPhotoBundle(`phytosanitary-zone-${index + 1}`, 1);
  const legacyMetrics = {
    ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
    seto_bajo_medio_ml: 22,
    observaciones_ia: ['Tratamiento compatible con seto medio.'],
  };
  const legacyTask = {
    tipo_servicio: 'Servicios fitosanitarios',
    nivel_analisis: 1,
    observaciones: ['Danio compatible con tratamiento insecticida sobre seto.'],
    indices_imagenes: photos.selectedIndices,
    metricas_fitosanitarias: legacyMetrics,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Servicios fitosanitarios',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { tareas: [legacyTask], metricas_fitosanitarias: legacyMetrics },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });
  const patch = adaptPhytosanitaryAnalysisResult({
    analysis,
    legacyTask,
    legacyMetrics,
    selectedIndices: photos.selectedIndices,
    totalPhotoCount: photos.photoUrls.length,
  });

  return {
    id: existing?.id || `dev-phytosanitary-${index + 1}`,
    type: 'insecticida',
    scope: ['setos'],
    requestedTreatment: 'insecticida',
    wantsEco: false,
    affectedType: 'Setos',
    aboveTwoMeters: false,
    aboveThreeMeters: false,
    wasteRemoval: existing?.wasteRemoval ?? true,
    ...photos,
    ...patch,
    area: Math.max(1, sumPhytosanitaryMetrics(patch.analysisMetrics || legacyMetrics)),
  };
}

export function buildWeedingDevZone(existing?: Partial<WeedingZone>, index = 0): WeedingZone {
  const photos = buildSeedPhotoBundle(`weeding-zone-${index + 1}`, 1);
  const legacyTask = {
    tipo_servicio: 'Desbroce de malas hierbas',
    superficie_malas_hierbas_m2: 120,
    estado_malas_hierbas: 'dificultad_media' as const,
    nivel_analisis: 1,
    observaciones: ['Cobertura media de malas hierbas en parcela abierta.'],
    indices_imagenes: photos.selectedIndices,
  };
  const analysis = adaptLegacyAnalysisToV2({
    serviceName: 'Desbroce de malas hierbas',
    sourcePhotoCount: photos.photoUrls.length,
    legacyResponse: { tareas: [legacyTask] },
    provider: DEV_PROVIDER,
    model: DEV_MODEL,
  });
  const common = buildAnalysisCommonFields({
    analysis,
    analysisLevel: legacyTask.nivel_analisis,
    observations: legacyTask.observaciones,
    analyzedIndices: photos.selectedIndices,
    selectedIndices: photos.selectedIndices,
    totalPhotoCount: photos.photoUrls.length,
  });

  return {
    id: existing?.id || `dev-weeding-${index + 1}`,
    area: 120,
    state: 'dificultad_media',
    applyHerbicide: false,
    wasteRemoval: existing?.wasteRemoval ?? true,
    ...photos,
    analysisV2: common.analysisV2,
    analysisLevel: common.analysisLevel,
    observations: common.observations,
    isFailed: common.isFailed,
  };
}
