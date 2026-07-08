// Supabase Edge Function: análisis visual de jardines con Gemini para estimación de presupuesto.
// Requiere configurar el secreto GOOGLE_API_KEY (opcional: GEMINI_MODEL).
declare const Deno: any;
import {
  adaptLegacyAnalysisToV2,
  validateAnalysisV2,
  type LegacyAnalysisResponse,
} from '../../../src/shared/analysisV2.ts';
import {
  buildAnalysisPromptAssembly,
  DETERMINISTIC_PROMPT_SETTINGS,
} from './new_prompts.ts';
import {
  PALM_SPECIES_HEIGHT_BANDS,
  getMaxPlausiblePalmHeightM,
} from '../../../src/domain/speciesBusinessRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  description: string;
  service_ids?: string[];
  photo_urls?: string[];
  hedge_faces?: {
    face_a_urls: string[];
    face_b_urls?: string[];
  };
  photo_count?: number;
  service_name?: string; // Nombre del servicio (opcional, para lógica específica)
  mode?: 'calculate_palm_pricing' | 'weeding_prompt_quality_check';
  model?: 'gemini-2.0-flash' | 'gemini-2.5-flash';
  palms?: any[]; // Array for palm pricing calculation
  phytosanitary_scopes?: string[]; // Array of selected scopes for Fitosanitarios
  qa_runs?: number;
}

type PhytosanitaryTreatment = 'insecticida' | 'fungicida' | 'herbicida' | 'ecologico_preventivo' | 'endoterapia' | 'inconclusive';

const PHYTOSANITARY_TREATMENTS: PhytosanitaryTreatment[] = [
  'insecticida',
  'fungicida',
  'herbicida',
  'ecologico_preventivo',
  'endoterapia',
  'inconclusive',
];

const PHYTOSANITARY_SERVICE_KEYS = ['fitosanit', 'fitosanit'];
const DEFAULT_GEMINI_MODEL = (Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash').trim();

function isPhytosanitaryService(serviceName?: string) {
  const lower = String(serviceName || '').toLowerCase();
  if (!lower) return false;
  return PHYTOSANITARY_SERVICE_KEYS.some((k) => lower.includes(k));
}

function getPhytosanitaryScope(payload: Payload): string[] {
  if (payload.phytosanitary_scopes && payload.phytosanitary_scopes.length > 0) {
    return payload.phytosanitary_scopes;
  }
  
  // Fallback for older clients parsing description
  const text = String(payload.description || '').toLowerCase();
  const scopes: string[] = [];
  if (text.includes('solo_palmeras') || text.includes('palmeras')) scopes.push('palmeras');
  if (text.includes('solo_arboles') || text.includes('solo_árboles') || text.includes('arboles') || text.includes('árboles')) scopes.push('arboles');
  if (text.includes('solo_setos') || text.includes('setos')) scopes.push('setos');
  if (text.includes('solo_cesped') || text.includes('solo_césped') || text.includes('cesped') || text.includes('césped')) scopes.push('cesped');
  if (text.includes('solo_malas_hierbas') || text.includes('malas hierbas')) scopes.push('quitar malas hierbas');
  if (text.includes('plantas')) scopes.push('plantas');
  
  if (scopes.length === 0 || text.includes('todo el jardin') || text.includes('todo_jardin')) {
    return ['todo el jardin'];
  }
  return scopes;
}

function getSelectedGeminiModel(requestedModel?: string | null) {
  if (requestedModel && requestedModel.startsWith('gemini-')) {
    return requestedModel;
  }

  return DEFAULT_GEMINI_MODEL;
}

function filterPhytosanitaryMetricsByScope(metrics: any, scopes: string[]) {
  if (!metrics) return metrics;
  
  const isTodoJardin = scopes.includes('todo el jardin') || scopes.includes('todo_jardin');
  if (isTodoJardin) return metrics; 
  
  const filtered = { ...metrics };
  
  const hasCesped = scopes.some(s => s.includes('cesped') || s.includes('césped'));
  const hasSetos = scopes.some(s => s.includes('setos'));
  const hasArboles = scopes.some(s => s.includes('arboles') || s.includes('árboles'));
  const hasPalmeras = scopes.some(s => s.includes('palmeras'));
  const hasPlantas = scopes.some(s => s.includes('plantas'));
  
  if (!hasCesped) filtered.cesped_m2 = 0;
  if (!hasPlantas) {
    filtered.plantas_superficie_calculada_m2 = 0;
    filtered.plantas_tamano_dominante = null;
  }
  if (!hasSetos) {
    filtered.seto_bajo_medio_ml = 0;
    filtered.seto_alto_ml = 0;
  }
  if (!hasArboles) {
    filtered.arboles_peq_ud = 0;
    filtered.arboles_med_ud = 0;
    filtered.arboles_gran_ud = 0;
  }
  if (!hasPalmeras) {
    filtered.palmeras_ducha_peq_ud = 0;
    filtered.palmeras_ducha_med_ud = 0;
    filtered.palmeras_ducha_alta_ud = 0;
    filtered.palmeras_cirugia_ud = 0;
    filtered.palmeras_endoterapia_troncos_ud = 0;
  }
  
  return filtered;
}

// --- PALM PRICING LOGIC ---
// SSOT de bandas de altura por especie: src/domain/speciesBusinessRules.ts
const SPECIES_RANGES: Record<string, readonly string[]> = PALM_SPECIES_HEIGHT_BANDS;

const PALM_CONSTANTS = {
  PRICING: {
    // Old fallback buckets
    "0-5": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
    "5-12": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    "12-20": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
    "20+": { normal: 2.5, descuidado: 3.5, "muy descuidado": 5.0 },

    // New SPECIES_RANGES buckets
    "0-3": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
    "0-4": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
    "0-6": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
    
    "3-6": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    "4-10": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    "4-12": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    "5-10": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    
    ">6": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
    ">10": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
    "10-15": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
    
    ">15": { normal: 2.5, descuidado: 3.5, "muy descuidado": 5.0 },
    ">20": { normal: 2.5, descuidado: 3.5, "muy descuidado": 5.0 }
  }
};

function normalizeStr(s: string) {
  return (s || '').toLowerCase().trim();
}

function normalizePalmState(s: string): "normal" | "descuidado" | "muy descuidado" {
  const normalized = (s || '').toLowerCase().trim();
  if (normalized.includes('muy descuidado') || normalized.includes('muy_descuidado')) return 'muy descuidado';
  if (normalized.includes('descuidado')) return 'descuidado';
  return 'normal'; // strict fallback
}

function clampConfidence(value: any): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

// Altura total plausible de un árbol objetivo residencial (post-validación anti-alucinación).
const TREE_MAX_PLAUSIBLE_HEIGHT_M = 40;

function sanitizeTreeResult(tree: any) {
  const sanitized = { ...tree };

  // Regla de negocio: la dificultad la decide SIEMPRE el cliente, nunca la IA.
  sanitized.dificultad_alta = false;

  sanitized.altura_confidence = clampConfidence(sanitized.altura_confidence);
  sanitized.size_band_confidence = clampConfidence(sanitized.size_band_confidence);

  const heightNum = Number(sanitized.altura_m);
  if (Number.isFinite(heightNum) && heightNum > TREE_MAX_PLAUSIBLE_HEIGHT_M) {
    sanitized.nivel_analisis = Math.max(Number(sanitized.nivel_analisis) || 1, 2);
    const observaciones = Array.isArray(sanitized.observaciones) ? sanitized.observaciones : [];
    if (!observaciones.includes('AMBIGUOUS_SIZE')) observaciones.push('AMBIGUOUS_SIZE');
    sanitized.observaciones = observaciones;
  }

  return sanitized;
}

function calculatePalmEstimation(palms: any[]) {
  let tiempoPodaBruto = 0;
  
  // Setup Time Logic
  let maxSetupTier = 0; 

  palms.forEach(p => {
      // Skip failed or undetected palms
      if (p.nivel_analisis === 3 || p.especie === 'No detectada') return;

      // Handle " o similar" suffix
      let species = p.especie || '';
      if (species.toLowerCase().endsWith(' o similar')) {
        species = species.slice(0, -' o similar'.length).trim();
        p.especie = species; // Strip it from the output
      }

      const heightNum = Number(p.altura_m) || 0;

      // Find matching species key in SPECIES_RANGES
      let speciesKey = species;
      let found = false;
      const speciesLower = species.toLowerCase();
      for (const key of Object.keys(SPECIES_RANGES)) {
        if (key.toLowerCase().includes(speciesLower) || speciesLower.includes(key.toLowerCase())) {
          speciesKey = key;
          found = true;
          break;
        }
      }

      let bestBucket = '0-5'; // default fallback
      if (found) {
        const ranges = SPECIES_RANGES[speciesKey];
        for (const range of ranges) {
          if (range.includes('+') || range.includes('>')) {
            const min = parseFloat(range.replace('+', '').replace('>', ''));
            if (heightNum >= min) bestBucket = range;
          } else if (range.includes('-')) {
            const [min, max] = range.split('-').map(Number);
            if (heightNum >= min && heightNum < max) {
              bestBucket = range;
              break;
            }
          }
        }
      } else {
        if (heightNum >= 20) bestBucket = '20+';
        else if (heightNum >= 12) bestBucket = '12-20';
        else if (heightNum >= 5) bestBucket = '5-12';
        else bestBucket = '0-5';
      }

      // Map exact height to the correct bucket based on species
      p.altura = bestBucket;

      // Post-validación anti-alucinación: confidences saneadas a [0,1] y
      // altura plausible por especie (fuera de rango → needs review, no rechazo).
      p.especie_confidence = clampConfidence(p.especie_confidence);
      p.altura_confidence = clampConfidence(p.altura_confidence);
      p.estado_confidence = clampConfidence(p.estado_confidence);

      const maxPlausible = getMaxPlausiblePalmHeightM(species);
      if (maxPlausible !== null && heightNum > maxPlausible) {
        p.nivel_analisis = Math.max(Number(p.nivel_analisis) || 1, 2);
        const observaciones = Array.isArray(p.observaciones) ? p.observaciones : [];
        if (!observaciones.includes('AMBIGUOUS_SIZE')) observaciones.push('AMBIGUOUS_SIZE');
        p.observaciones = observaciones;
      }

      const state = normalizePalmState(p.estado);
      p.estado = state; // enforce strict valid state in output
      
      // Calculate Hours
      let hours = 0;
      const prices = PALM_CONSTANTS.PRICING as any;
      
      // Fallback/Safety
      if (prices[bestBucket]) {
          if (prices[bestBucket][state] !== undefined) {
              hours = prices[bestBucket][state];
          } else {
              hours = prices[bestBucket]['normal'] || 0;
          }
      } else {
           // Default fallback: 5-12, normal
           hours = PALM_CONSTANTS.PRICING['5-12'].normal; 
      }
      
      tiempoPodaBruto += hours;
      
      // Determine Setup Tier
      let tier = 1;
      if (heightNum >= 12) tier = 3;
      else if (heightNum >= 5) tier = 2;
      else tier = 1;
      
      if (tier > maxSetupTier) maxSetupTier = tier;
  });
  
  // Calculate Final Setup Time
  let tiempoPreparacion = 0;
  // Count valid palms (not failed, not undetected)
  const validPalmsCount = palms.filter(p => p.nivel_analisis !== 3 && p.especie !== 'No detectada').length;
  
  if (validPalmsCount > 0) {
      tiempoPreparacion = 0.5;
  }
  
  // Efficiency Factor
  const count = palms.length;
  let factorEficiencia = 1.0;
  if (count >= 6) factorEficiencia = 0.8;
  else if (count >= 3) factorEficiencia = 0.9;
  
  const tiempoTotalEstimado = tiempoPreparacion + (tiempoPodaBruto * factorEficiencia);
  
  return {
      tiempoPreparacion,
      tiempoPodaBruto,
      factorEficiencia,
      tiempoTotalEstimado: Math.round(tiempoTotalEstimado * 100) / 100
  };
}

const WEEDING_SERVICE_NAME = 'Desbroce de malas hierbas';
const STANDARD_TECHNICAL_REASONS = {
  providerAuthMissing: 'PROVIDER_AUTH_MISSING',
  providerRateLimit: 'PROVIDER_RATE_LIMIT',
  providerRequestFailed: 'PROVIDER_REQUEST_FAILED',
  modelOutputInvalid: 'MODEL_OUTPUT_INVALID',
  analysisValidationFailed: 'ANALYSIS_VALIDATION_FAILED',
  internalError: 'INTERNAL_ERROR',
  edgeInvocationFailed: 'EDGE_FUNCTION_INVOCATION_FAILED',
} as const;

const TECHNICAL_REASON_SET = new Set<string>(Object.values(STANDARD_TECHNICAL_REASONS));

// Distingue un fallo técnico real (proveedor caído, JSON ilegible, rate limit…)
// de una respuesta válida del modelo que simplemente no detectó el elemento.
function hasTechnicalFailure(ai: any): boolean {
  const reasons = Array.isArray(ai?.reasons) ? ai.reasons : [];
  return reasons.some((reason: unknown) => TECHNICAL_REASON_SET.has(String(reason)));
}

type WeedingState = 'normal' | 'dificultad_media' | 'dificultad_alta';

interface WeedingNormalizedTask {
  tipo_servicio: typeof WEEDING_SERVICE_NAME;
  estado_malas_hierbas: WeedingState | null;
  superficie_malas_hierbas_m2: number;
  nivel_analisis: 1 | 2 | 3;
  observaciones: string[] | null;
}

function isWeedingServiceName(serviceName?: string) {
  const lower = String(serviceName || '').toLowerCase();
  return lower.includes('desbroce') || lower.includes('malas hierbas');
}

function clampWeedingRuns(value: unknown) {
  const parsed = Number(value || 5);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(10, Math.max(3, Math.round(parsed)));
}

function normalizeWeedingState(value: unknown): WeedingState | null {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('alta')) return 'dificultad_alta';
  if (normalized.includes('media')) return 'dificultad_media';
  if (normalized.includes('normal')) return 'normal';
  return null;
}

function normalizeWeedingTask(task: any): WeedingNormalizedTask | null {
  if (!task || typeof task !== 'object') return null;
  const level = Number(task.nivel_analisis);
  if (![1, 2, 3].includes(level)) return null;
  const nivel_analisis = level as 1 | 2 | 3;
  const estado = normalizeWeedingState(task.estado_malas_hierbas);
  const areaRaw = Number(task.superficie_malas_hierbas_m2 || 0);
  const superficie = Number.isFinite(areaRaw) ? Math.max(0, Math.round(areaRaw)) : 0;
  const observaciones = Array.isArray(task.observaciones)
    ? task.observaciones.filter((item: unknown) => typeof item === 'string')
    : null;

  if (nivel_analisis === 3) {
    return {
      tipo_servicio: WEEDING_SERVICE_NAME,
      estado_malas_hierbas: null,
      superficie_malas_hierbas_m2: 0,
      nivel_analisis,
      observaciones: observaciones && observaciones.length > 0 ? observaciones : ['malas hierbas no detectables']
    };
  }

  if (!estado) return null;
  return {
    tipo_servicio: WEEDING_SERVICE_NAME,
    estado_malas_hierbas: estado,
    superficie_malas_hierbas_m2: superficie,
    nivel_analisis,
    observaciones: observaciones && observaciones.length > 0 ? observaciones : null
  };
}

function parseWeedingResult(ai: any): WeedingNormalizedTask | null {
  const tasks = Array.isArray(ai?.tareas) ? ai.tareas : [];
  if (tasks.length === 0) return null;

  // Filter tasks that match weeding service
  const weedingTasks = tasks.filter((item: any) =>
    String(item?.tipo_servicio || '').toLowerCase().includes('desbroce') ||
    String(item?.tipo_servicio || '').toLowerCase().includes('malas hierbas')
  );

  if (weedingTasks.length === 0) return null;

  // If multiple tasks, consolidate them deterministically
  if (weedingTasks.length > 1) {
    // Normalize all tasks first
    const normalizedTasks = weedingTasks.map(normalizeWeedingTask).filter(Boolean) as WeedingNormalizedTask[];

    if (normalizedTasks.length === 0) return null;

    // Consolidation policy:
    // - Area: conservative, take the maximum (avoid double-counting)
    // - State: take the most severe (worst condition)
    // - Level: take the worst (highest number)
    // - Observations: merge unique observations

    const severityOrder = { 'normal': 1, 'dificultad_media': 2, 'dificultad_alta': 3 };
    const maxArea = Math.max(...normalizedTasks.map(t => t.superficie_malas_hierbas_m2));
    const worstState = normalizedTasks
      .filter(t => t.estado_malas_hierbas)
      .sort((a, b) => (severityOrder[b.estado_malas_hierbas!] || 0) - (severityOrder[a.estado_malas_hierbas!] || 0))[0]?.estado_malas_hierbas || null;
    const worstLevel = Math.max(...normalizedTasks.map(t => t.nivel_analisis)) as 1 | 2 | 3;
    const allObservations = normalizedTasks.flatMap(t => t.observaciones || []).filter(Boolean);
    const uniqueObservations = [...new Set(allObservations)];

    const consolidated: WeedingNormalizedTask = {
      tipo_servicio: WEEDING_SERVICE_NAME,
      estado_malas_hierbas: worstLevel === 3 ? null : worstState,
      superficie_malas_hierbas_m2: worstLevel === 3 ? 0 : maxArea,
      nivel_analisis: worstLevel,
      observaciones: uniqueObservations.length > 0 ? uniqueObservations : null
    };

    return consolidated;
  }

  // Single task case
  const candidate = weedingTasks[0];
  return normalizeWeedingTask(candidate);
}

type ShrubSize = 'pequeñas' | 'medianas' | 'grandes';

function normalizeShrubSize(value: unknown): ShrubSize | null {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('grande')) return 'grandes';
  if (normalized.includes('mediana')) return 'medianas';
  if (normalized.includes('peque')) return 'pequeñas';
  return null;
}

// Superficie plausible máxima de macizos residenciales (post-validación anti-alucinación).
const SHRUB_MAX_PLAUSIBLE_AREA_M2 = 500;

// Rangos plausibles de setos residenciales (post-validación anti-alucinación).
const HEDGE_MAX_PLAUSIBLE_HEIGHT_M = 8;
const HEDGE_MAX_PLAUSIBLE_LENGTH_M = 200;

// Superficie plausible máxima de un césped doméstico (post-validación anti-alucinación).
const LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000;

type LawnState = 'normal' | 'descuidado' | 'muy descuidado';

// El motor cobra condition_surcharges.descuidado/muy_descuidado según este estado.
function normalizeLawnState(value: unknown): LawnState | null {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return null;
  if (normalized.includes('muy')) return 'muy descuidado';
  if (normalized.includes('descuidad')) return 'descuidado';
  if (normalized.includes('normal')) return 'normal';
  return null;
}

type HedgeState = 'normal' | 'media' | 'alta';

// El motor cobra condition_surcharges.media/alta según este estado.
function normalizeHedgeState(value: unknown): HedgeState | null {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return null;
  if (normalized.includes('alta') || normalized.includes('muy')) return 'alta';
  if (normalized.includes('media') || normalized.includes('descuidad')) return 'media';
  if (normalized.includes('normal')) return 'normal';
  return null;
}

type ShrubState = 'normal' | 'descuidado' | 'muy descuidado';

function normalizeShrubState(value: unknown): ShrubState | null {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return null;
  if (normalized.includes('muy')) return 'muy descuidado';
  if (normalized.includes('descuidad')) return 'descuidado';
  if (normalized.includes('normal')) return 'normal';
  return null;
}

// Al fusionar tareas del mismo tamaño, conservar el estado más severo (manda el peor).
function worstShrubState(a: ShrubState | null, b: ShrubState | null): ShrubState | null {
  const severity = (state: ShrubState | null) =>
    state === 'muy descuidado' ? 2 : state === 'descuidado' ? 1 : state === 'normal' ? 0 : -1;
  return severity(a) >= severity(b) ? a : b;
}

function getShrubAreaFromTask(task: any): number {
  const directArea = Number(task?.superficie_m2);
  if (Number.isFinite(directArea)) return Math.max(0, Math.round(directArea));

  // Legacy compatibility fallback (temporary): derive area if old payload still arrives.
  const totalM2 = Number(task?.tamano_total_jardin_m2);
  const percentage = Number(task?.porcentaje_superficie_plantas);
  if (Number.isFinite(totalM2) && Number.isFinite(percentage)) {
    return Math.max(0, Math.round(totalM2 * (percentage / 100)));
  }
  return 0;
}

function areaBand(value: number) {
  return Math.round(Math.max(0, value) / 5) * 5;
}

function computeRepeatabilityMetrics(results: WeedingNormalizedTask[]) {
  const total = results.length;
  if (total === 0) {
    return {
      sample_size: 0,
      state_match_ratio: 0,
      level_match_ratio: 0,
      area_band_match_ratio: 0,
      area_cv: 0
    };
  }

  const modeRatio = (arr: string[]) => {
    const counts = new Map<string, number>();
    arr.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
    let max = 0;
    counts.forEach((count) => { if (count > max) max = count; });
    return max / total;
  };

  const states = results.map((r) => String(r.estado_malas_hierbas ?? 'null'));
  const levels = results.map((r) => String(r.nivel_analisis));
  const bands = results.map((r) => String(areaBand(r.superficie_malas_hierbas_m2)));
  const areas = results.map((r) => r.superficie_malas_hierbas_m2);

  const meanArea = areas.reduce((acc, value) => acc + value, 0) / total;
  const variance = areas.reduce((acc, value) => acc + Math.pow(value - meanArea, 2), 0) / total;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const cv = meanArea > 0 ? stdDev / meanArea : 0;

  return {
    sample_size: total,
    state_match_ratio: modeRatio(states),
    level_match_ratio: modeRatio(levels),
    area_band_match_ratio: modeRatio(bands),
    area_cv: Number(cv.toFixed(4))
  };
}

function buildMessages(payload: Payload) {
  return buildAnalysisPromptAssembly(payload).messages;
}

function heuristicTasks(payload: Payload) {
  // Cuando falla la IA, no devolvemos datos inventados.
  // Devolvemos una señal clara de error para que el frontend pida reintentar.
  return { 
      tareas: [], 
      reasons: [STANDARD_TECHNICAL_REASONS.modelOutputInvalid] 
  };
}

function normalizePhytosanitaryTreatment(value: unknown): PhytosanitaryTreatment {
  const lower = String(value || '').toLowerCase();
  if (PHYTOSANITARY_TREATMENTS.includes(lower as PhytosanitaryTreatment)) return lower as PhytosanitaryTreatment;
  if (lower.includes('endo')) return 'endoterapia';
  if (lower.includes('ecol') || lower.includes('prevent')) return 'ecologico_preventivo';
  if (lower.includes('herb')) return 'herbicida';
  if (lower.includes('fung')) return 'fungicida';
  if (lower.includes('insect') || lower.includes('curativ') || lower.includes('plaga')) return 'insecticida';
  return 'inconclusive';
}

function normalizePhytosanitaryAffectedType(value: unknown): 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras' {
  const lower = String(value || '').toLowerCase();
  if (lower.includes('palm')) return 'Palmeras';
  if (lower.includes('árbol') || lower.includes('arbol') || lower.includes('tree')) return 'Árboles';
  if (lower.includes('seto') || lower.includes('hedge')) return 'Setos';
  if (lower.includes('césped') || lower.includes('cesped') || lower.includes('lawn')) return 'Césped';
  return 'Plantas bajas';
}

function normalizePhytosanitaryHeightBand(value: unknown): 'hasta_2m' | 'mas_de_2m' | 'hasta_3m' | 'mas_de_3m' | null {
  const lower = String(value || '').toLowerCase();
  if (!lower || lower === 'null' || lower === 'none') return null;
  if (lower.includes('mas_de_2m') || lower.includes('>2')) return 'mas_de_2m';
  if (lower.includes('hasta_2m') || lower.includes('2m')) return 'hasta_2m';
  if (lower.includes('mas_de_3m') || lower.includes('>3')) return 'mas_de_3m';
  if (lower.includes('hasta_3m') || lower.includes('3m')) return 'hasta_3m';
  return null;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.max(0, num);
}

function toBoundedConfidence(value: unknown, fallback = 0.5): number {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function toUniqueStrings(values: unknown[]): string[] {
  const normalized = values
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function mapSeverityToArea(severity: string): number {
  const lower = String(severity || '').toLowerCase();
  if (lower === 'high') return 120;
  if (lower === 'medium') return 60;
  if (lower === 'low') return 25;
  return 40;
}

function inferPhytosanitaryAnalysisLevel(confidence: number, visibilityLimitations: string[], riskFlags: string[]): 1 | 2 | 3 {
  const text = `${visibilityLimitations.join(' ')} ${riskFlags.join(' ')}`.toLowerCase();
  if (confidence < 0.35 || text.includes('dark') || text.includes('blurry') || text.includes('not visible')) return 3;
  if (confidence < 0.7 || visibilityLimitations.length > 0 || riskFlags.length > 0) return 2;
  return 1;
}

function dedupePhytosanitaryTasks(tasks: any[]): any[] {
  const map = new Map<string, any>();
  tasks.forEach((task) => {
    // If it has an ai_ref_id, it is unique and should not be grouped with others
    const refId = task.ai_ref_id || 'no_ref';
    const key = [
      String(task.tipo_servicio || ''),
      String(task.tipo_afectado || ''),
      String(task.unidad || ''),
      String(task.altura_tramo || ''),
      refId,
    ].join('|');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...task });
      return;
    }
    existing.cantidad_o_superficie = Math.round((toNonNegativeNumber(existing.cantidad_o_superficie) + toNonNegativeNumber(task.cantidad_o_superficie)) * 100) / 100;
    existing.confidence = Math.max(toBoundedConfidence(existing.confidence, 0), toBoundedConfidence(task.confidence, 0));
    existing.nivel_analisis = Math.max(Number(existing.nivel_analisis || 1), Number(task.nivel_analisis || 1));
    existing.observaciones = toUniqueStrings([existing.observaciones || [], task.observaciones || []]);
  });
  return Array.from(map.values()).filter((task) => toNonNegativeNumber(task.cantidad_o_superficie) > 0);
}

function buildPhytosanitaryTasksFromDetectedElements(ai: any, payload: Payload): any[] {
  const detected = ai?.detected_elements || {};
  
  // Extract standardized observations
  let rawObs = [];
  if (Array.isArray(ai?.standardized_observations)) {
    rawObs = ai.standardized_observations;
  } else if (ai?.standardized_observations) {
    rawObs = [ai.standardized_observations];
  }
  
  const baseObservaciones = toUniqueStrings(
    rawObs.filter((o: any) => typeof o === 'string' && o.toLowerCase() !== 'none')
  );

  const riskFlags = toUniqueStrings([
    Array.isArray(ai?.risk_flags) ? ai.risk_flags : [],
    Array.isArray(ai?.phytosanitary_context?.spraying_risks) ? ai.phytosanitary_context.spraying_risks : [],
  ]);
  const visibilityLimitations = Array.isArray(ai?.notes_for_calculation?.visibility_limitations) ? ai.notes_for_calculation.visibility_limitations : [];
  const confidence = toBoundedConfidence(ai?.confidence ?? ai?.confidence_score, 0.5);
  const nivelAnalisis = inferPhytosanitaryAnalysisLevel(confidence, visibilityLimitations, riskFlags);
  const tasks: any[] = [];

  const pushTask = (task: any) => {
    if (toNonNegativeNumber(task.cantidad_o_superficie) <= 0) return;
    tasks.push({
      tipo_servicio: 'Servicios fitosanitarios',
      confidence,
      nivel_analisis: nivelAnalisis,
      observaciones: baseObservaciones,
      ...task,
    });
  };

  // Surfaces / Lawns
  const surfacesArr = Array.isArray(detected?.surfaces_plants) ? detected.surfaces_plants : (detected?.surfaces_plants ? [detected.surfaces_plants] : []);
  surfacesArr.forEach((surface: any, surfaceIndex: number) => {
    const area = Number.isFinite(Number(surface?.estimated_area_m2))
      ? Math.max(0, Number(surface.estimated_area_m2))
      : mapSeverityToArea(String(surface?.estimated_severity || 'unknown'));
    if (area > 0) {
      pushTask({
        ai_ref_id: surface.ai_ref_id || `surface_${surfaceIndex}`,
        tipo_afectado: 'Plantas bajas',
        cantidad_o_superficie: area,
        unidad: 'm2',
        altura_tramo: null,
        supera_2m: false,
        supera_3m: false,
      });
    }
  });

  // Hedges
  const hedgesArr = Array.isArray(detected?.hedges) ? detected.hedges : [];
  hedgesArr.forEach((hedge: any, hedgeIndex: number) => {
    const ml = Math.round(toNonNegativeNumber(hedge.ml));
    const band = String(hedge.size_band || 'bajos_medios').toLowerCase();
    if (ml > 0) {
      pushTask({
        ai_ref_id: hedge.ai_ref_id || `hedge_${hedgeIndex}`,
        tipo_afectado: 'Setos',
        cantidad_o_superficie: ml,
        unidad: 'ml',
        altura_tramo: band === 'altos' ? 'altos' : 'bajos_medios',
        supera_2m: band === 'altos',
        supera_3m: false,
      });
    }
  });

  // Trees
  const treesArr = Array.isArray(detected?.trees) ? detected.trees : [];
  treesArr.forEach((tree: any, treeIndex: number) => {
    const band = String(tree.size_band || 'pequenos').toLowerCase();
    pushTask({
      ai_ref_id: tree.ai_ref_id || `tree_${treeIndex}`,
      tipo_afectado: 'Árboles',
      cantidad_o_superficie: 1,
      unidad: 'unidades',
      altura_tramo: ['pequenos', 'medianos', 'grandes'].includes(band) ? band : 'pequenos',
      supera_2m: false,
      supera_3m: band === 'medianos' || band === 'grandes',
    });
  });

  // Palms
  const palmsArr = Array.isArray(detected?.palms) ? detected.palms : [];
  palmsArr.forEach((palm: any, palmIndex: number) => {
    const band = String(palm.size_band || 'pequenas').toLowerCase();
    const palmSurgery = Boolean(palm.surgery_recommended);
    pushTask({
      ai_ref_id: palm.ai_ref_id || `palm_${palmIndex}`,
      tipo_afectado: 'Palmeras',
      cantidad_o_superficie: 1,
      unidad: 'unidades',
      altura_tramo: ['pequenas', 'medianas', 'altas'].includes(band) ? band : 'pequenas',
      supera_2m: false,
      supera_3m: band === 'medianas' || band === 'altas',
      palmeras_cirugia: palmSurgery,
    });
  });

  if (tasks.length === 0) {
    const fallbackLevel = confidence < 0.4 ? 3 : 2;
    tasks.push({
      ai_ref_id: 'fallback_1',
      tipo_servicio: 'Servicios fitosanitarios',
      tipo_afectado: 'Plantas bajas',
      cantidad_o_superficie: Math.max(1, Math.round(Number(payload.photo_count || 1))),
      unidad: 'unidades',
      altura_tramo: null,
      supera_2m: false,
      supera_3m: false,
      confidence,
      nivel_analisis: fallbackLevel,
      observaciones: baseObservaciones.length > 0 ? baseObservaciones : ['insufficient_visual_evidence'],
    });
  }

  return dedupePhytosanitaryTasks(tasks);
}

function normalizePhytosanitaryTask(task: any, ai: any): any {
  // Extract standardized observations
  let rawObs = [];
  if (Array.isArray(ai?.standardized_observations)) {
    rawObs = ai.standardized_observations;
  } else if (ai?.standardized_observations) {
    rawObs = [ai.standardized_observations];
  }
  
  const baseObservaciones = toUniqueStrings(
    rawObs.filter((o: any) => typeof o === 'string' && o.toLowerCase() !== 'none')
  );

  const riskFlags = toUniqueStrings([
    Array.isArray(ai?.risk_flags) ? ai.risk_flags : [],
    Array.isArray(ai?.phytosanitary_context?.spraying_risks) ? ai.phytosanitary_context.spraying_risks : [],
  ]);
  const visibilityLimitations = Array.isArray(ai?.notes_for_calculation?.visibility_limitations) ? ai.notes_for_calculation.visibility_limitations : [];
  const topConfidence = toBoundedConfidence(ai?.confidence ?? ai?.confidence_score, 0.5);
  const taskConfidence = toBoundedConfidence(task?.confidence ?? task?.confidence_score, topConfidence);
  const tipoAfectado = normalizePhytosanitaryAffectedType(task?.tipo_afectado);
  const alturaRaw = String(task?.altura_tramo || '').toLowerCase();
  let altura: any = null;
  if (tipoAfectado === 'Setos' && (alturaRaw === 'bajos_medios' || alturaRaw === 'altos')) {
    altura = alturaRaw;
  } else if (tipoAfectado === 'Árboles' && (alturaRaw === 'pequenos' || alturaRaw === 'medianos' || alturaRaw === 'grandes')) {
    altura = alturaRaw;
  } else if (tipoAfectado === 'Palmeras' && (alturaRaw === 'pequenas' || alturaRaw === 'medianas' || alturaRaw === 'altas')) {
    altura = alturaRaw;
  } else {
    altura = normalizePhytosanitaryHeightBand(task?.altura_tramo);
  }
  const cantidad = toNonNegativeNumber(task?.cantidad_o_superficie);
  const unidad = String(task?.unidad || '').toLowerCase() === 'm2' ? 'm2' : (String(task?.unidad || '').toLowerCase() === 'ml' ? 'ml' : 'unidades');
  const observaciones = toUniqueStrings([
    task?.observaciones || [],
    baseObservaciones,
  ]);
  const nivel = Number(task?.nivel_analisis || inferPhytosanitaryAnalysisLevel(taskConfidence, visibilityLimitations, riskFlags));
  const palmSurgery = Boolean(task?.palmeras_cirugia) || (Array.isArray(ai?.detected_elements?.palms) && ai.detected_elements.palms.some((p: any) => p.surgery_recommended));
  return {
    ai_ref_id: task?.ai_ref_id || undefined,
    tipo_servicio: 'Servicios fitosanitarios',
    tipo_afectado: tipoAfectado,
    cantidad_o_superficie: cantidad,
    unidad,
    altura_tramo: altura,
    supera_2m: altura === 'mas_de_2m',
    supera_3m: altura === 'mas_de_3m',
    palmeras_cirugia: tipoAfectado === 'Palmeras' ? palmSurgery : undefined,
    confidence: taskConfidence,
    nivel_analisis: Math.min(3, Math.max(1, Number.isFinite(nivel) ? Math.round(nivel) : 2)),
    observaciones,
    elementos_detectados: ai?.detected_elements || undefined,
  };
}

function normalizePhytosanitaryTasks(ai: any, payload: Payload): any[] {
  const aiTasks = Array.isArray(ai?.tareas) ? ai.tareas : [];
  const normalized = aiTasks
    .map((task: any) => normalizePhytosanitaryTask(task, ai))
    .filter((task: any) => toNonNegativeNumber(task?.cantidad_o_superficie) > 0);
  if (normalized.length > 0) {
    return dedupePhytosanitaryTasks(normalized);
  }
  return buildPhytosanitaryTasksFromDetectedElements(ai, payload);
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    // Use standard Buffer approach or chunked processing for large files to avoid stack overflow
    // In Deno/Edge, btoa on very large strings can cause stack overflow if spread operator is used on massive arrays
    // Better approach:
    const bytes = new Uint8Array(buf);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64;
  } catch (e) {
    console.warn('Error fetching image for Gemini:', e);
    return null;
  }
}

async function callGemini(messages: any[], requestedModel?: string | null) {
  const apiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!apiKey) {
    return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.providerAuthMissing] };
  }

  // Extract system prompt
  const systemMsg = messages.find(m => m.role === 'system');
  const systemPrompt = systemMsg ? systemMsg.content : '';

  // Build contents
  const contents: any[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    
    if (msg.role === 'user') {
       const parts: any[] = [];
       if (Array.isArray(msg.content)) {
         for (const part of msg.content) {
           if (part.type === 'text') {
             parts.push({ text: part.text });
           } else if (part.type === 'image_url') {
             const url = part.image_url?.url;
             if (url) {
               try {
                 const base64 = await fetchImageAsBase64(url);
                 if (base64) {
                   parts.push({
                     inline_data: {
                       mime_type: 'image/jpeg',
                       data: base64
                     }
                   });
                 } else {
                   console.warn(`[Gemini] Failed to convert image to base64: ${url}`);
                 }
               } catch (e) {
                 console.error(`[Gemini] Error fetching image ${url}:`, e);
               }
             }
           }
         }
       } else {
         parts.push({ text: msg.content });
       }
       if (parts.length > 0) {
         contents.push({ role: 'user', parts });
       }
    }
  }

  const generationConfig: any = {
    response_mime_type: 'application/json',
    temperature: DETERMINISTIC_PROMPT_SETTINGS.temperature,
    topP: DETERMINISTIC_PROMPT_SETTINGS.topP,
    topK: DETERMINISTIC_PROMPT_SETTINGS.topK,
  };

  const body = {
    contents,
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig
  };

  const modelName = getSelectedGeminiModel(requestedModel);
  console.log(`Calling Gemini Model: ${modelName}`);

  // Implement exponential backoff retry logic for 429
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (resp.ok) {
          const data = await resp.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          try {
              return JSON.parse(text);
          } catch {
              console.error(`[Gemini] JSON Parse Error. Raw text:`, text);
              return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.modelOutputInvalid] };
          }
      }

      if (resp.status === 429) {
          const txt = await resp.text();
          console.warn(`Gemini 429 Rate Limit (Attempt ${attempts}/${maxAttempts}):`, txt);
          if (attempts < maxAttempts) {
              // Exponential backoff: 2s, 4s, 8s...
              const delay = 2000 * Math.pow(2, attempts - 1);
              console.log(`Waiting ${delay}ms before retry...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
          }
          return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.providerRateLimit] };
      }

      const txt = await resp.text();
      console.error(`Gemini API Error (${resp.status} - ${modelName}):`, txt);
      
      return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.providerRequestFailed] };
    } catch (networkError) {
      console.error(`[Gemini] Network/Fetch Error:`, networkError);
      if (attempts < maxAttempts) {
         const delay = 1000 * attempts;
         await new Promise(r => setTimeout(r, delay));
         continue;
      }
      return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.providerRequestFailed] };
    }
  }
  return { tareas: [], reasons: [STANDARD_TECHNICAL_REASONS.providerRequestFailed] };
}

function getAnalysisModelParams() {
  return {
    temperature: DETERMINISTIC_PROMPT_SETTINGS.temperature,
    top_p: DETERMINISTIC_PROMPT_SETTINGS.topP,
    top_k: DETERMINISTIC_PROMPT_SETTINGS.topK,
    frequency_penalty: DETERMINISTIC_PROMPT_SETTINGS.frequencyPenalty,
    presence_penalty: DETERMINISTIC_PROMPT_SETTINGS.presencePenalty,
    response_mime_type: 'application/json',
  };
}

function buildResponseWithAnalysisV2(
  payload: Payload,
  legacyResponse: LegacyAnalysisResponse,
  provider = 'google',
) {
  const baseAnalysis = adaptLegacyAnalysisToV2({
    serviceName: payload.service_name,
    legacyResponse,
    sourcePhotoCount: payload.photo_count,
    provider,
    model: getSelectedGeminiModel(payload.model),
    modelParams: getAnalysisModelParams(),
  });

  const validationErrors = validateAnalysisV2(baseAnalysis);
  const analysis_v2 = validationErrors.length === 0
    ? baseAnalysis
    : adaptLegacyAnalysisToV2({
        serviceName: payload.service_name,
        legacyResponse: { reasons: [STANDARD_TECHNICAL_REASONS.analysisValidationFailed, ...validationErrors] },
        sourcePhotoCount: payload.photo_count,
        provider: 'internal',
        model: getSelectedGeminiModel(payload.model),
        modelParams: {
          ...getAnalysisModelParams(),
          validation_failed: true,
        },
      });

  const safeReasons = validationErrors.length === 0
    ? legacyResponse.reasons
    : [...new Set([...(legacyResponse.reasons || []), ...validationErrors])];

  return {
    ...legacyResponse,
    reasons: safeReasons,
    analysis_v2,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Payload;

    // Modo: cálculo de precios de palmeras
    if (payload.mode === 'calculate_palm_pricing' && Array.isArray(payload.palms)) {
        const result = calculatePalmEstimation(payload.palms);
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Nuevo modo: auditoría de repetibilidad para prompt de desbroce
    if (payload.mode === 'weeding_prompt_quality_check') {
      const qaPayload: Payload = {
        ...payload,
        service_name: WEEDING_SERVICE_NAME
      };
      const runs = clampWeedingRuns(payload.qa_runs);
      const rawRuns: Array<{ index: number; parsed: WeedingNormalizedTask | null; reasons?: string[] }> = [];

      for (let i = 0; i < runs; i++) {
        const messages = buildMessages(qaPayload);
        const ai = await callGemini(messages, payload.model);
        rawRuns.push({
          index: i + 1,
          parsed: parseWeedingResult(ai),
          reasons: Array.isArray(ai?.reasons) ? ai.reasons : []
        });
      }

      const validRuns = rawRuns
        .map((run) => run.parsed)
        .filter((item): item is WeedingNormalizedTask => Boolean(item));

      const metrics = computeRepeatabilityMetrics(validRuns);
      const thresholds = {
        state_match_ratio_min: 0.8,
        level_match_ratio_min: 0.8,
        area_band_match_ratio_min: 0.7,
        area_cv_max: 0.25,
        min_valid_runs: 3
      };

      const accepted =
        metrics.sample_size >= thresholds.min_valid_runs &&
        metrics.state_match_ratio >= thresholds.state_match_ratio_min &&
        metrics.level_match_ratio >= thresholds.level_match_ratio_min &&
        metrics.area_band_match_ratio >= thresholds.area_band_match_ratio_min &&
        metrics.area_cv <= thresholds.area_cv_max;

      const report = {
        service: WEEDING_SERVICE_NAME,
        temperature: DETERMINISTIC_PROMPT_SETTINGS.temperature,
        runs_requested: runs,
        runs_valid: metrics.sample_size,
        accepted,
        thresholds,
        metrics,
        valid_outputs: validRuns,
        raw_runs: rawRuns
      };

      return new Response(JSON.stringify(report), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Modo existente: estimación de tareas múltiples desde imágenes/texto
    const messages = buildMessages(payload);
    
    // SOLO GEMINI
    const ai = await callGemini(messages, payload.model);

    if (isPhytosanitaryService(payload.service_name)) {
      // Devolver la respuesta limpia, ya agregada por Gemini, pero con el middleware de filtrado de scopes
      if (ai.metricas_fitosanitarias) {
        const scopes = getPhytosanitaryScope(payload);
        ai.metricas_fitosanitarias = filterPhytosanitaryMetricsByScope(ai.metricas_fitosanitarias, scopes);
      }
      return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, ai)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (isWeedingServiceName(payload.service_name)) {
      const normalizedTask = parseWeedingResult(ai);
      if (normalizedTask) {
        return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { tareas: [normalizedTask] })), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, {
        tareas: [{
          tipo_servicio: WEEDING_SERVICE_NAME,
          estado_malas_hierbas: null,
          superficie_malas_hierbas_m2: 0,
          nivel_analisis: 3,
          observaciones: ['ELEMENTS_NOT_DETECTED']
        }],
        reasons: ai?.reasons || [STANDARD_TECHNICAL_REASONS.modelOutputInvalid]
      })), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Support for Palm Analysis Response
    // Handle both 'palmas' (legacy/code) and 'palmeras' (prompt standard)
    const palmResult = ai?.palmas || ai?.palmeras;
    
    if (Array.isArray(palmResult)) {
      calculatePalmEstimation(palmResult);
    }

    // STRICTER CHECK: If service is Palm Pruning, we prioritize palm result even if empty
    if (payload.service_name === 'Poda de palmeras') {
        // If valid array, return it
        if (Array.isArray(palmResult)) {
             return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { palmas: palmResult })), {
               headers: { ...corsHeaders, 'Content-Type': 'application/json' }
             });
        }
        // If AI returned empty/missing key for this specific service, return empty list instead of generic error
        // allowing the frontend to show "0 palms found" instead of "Error"
        return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { palmas: [] })), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    if (palmResult && Array.isArray(palmResult)) {
      return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { palmas: palmResult })), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Support for Tree Analysis Response
    if (ai?.arboles && Array.isArray(ai.arboles)) {
      const sanitizedTrees = ai.arboles.map((tree: any) => sanitizeTreeResult(tree));
      return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { arboles: sanitizedTrees })), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let tareas = Array.isArray(ai?.tareas) ? ai.tareas : [];

    // Post-validación de césped: clamps de confidences, estado normalizado y plausibilidad.
    if (payload.service_name === 'Corte de césped' && tareas.length > 0) {
      tareas = tareas.map((task: any) => {
        if (task?.tipo_servicio !== 'Corte de césped') return task;
        let normalizedLevel = [1, 2, 3].includes(Number(task.nivel_analisis)) ? Number(task.nivel_analisis) : 3;
        const normalizedObs = Array.isArray(task.observaciones)
          ? task.observaciones.filter((item: unknown) => typeof item === 'string')
          : [];
        const superficie = Number(task.superficie_m2);
        // Anti-alucinación: un césped doméstico rara vez supera 2000 m² → revisión, nunca forzar.
        if (normalizedLevel < 3 && Number.isFinite(superficie) && superficie > LAWN_MAX_PLAUSIBLE_AREA_M2) {
          normalizedLevel = 2;
          if (!normalizedObs.includes('AMBIGUOUS_SIZE')) normalizedObs.push('AMBIGUOUS_SIZE');
        }
        return {
          ...task,
          nivel_analisis: normalizedLevel,
          estado_jardin: normalizedLevel === 3 ? null : normalizeLawnState(task.estado_jardin),
          superficie_confidence: clampConfidence(task.superficie_confidence),
          estado_confidence: clampConfidence(task.estado_confidence),
          observaciones: normalizedObs.length > 0 ? normalizedObs : task.observaciones ?? null,
        };
      });
    }

    // Post-validación de setos: clamps de confidences, estado normalizado y plausibilidad.
    if (payload.service_name === 'Poda de setos' && tareas.length > 0) {
      tareas = tareas.map((task: any) => {
        if (task?.tipo_servicio !== 'Poda de setos') return task;
        let normalizedLevel = [1, 2, 3].includes(Number(task.nivel_analisis)) ? Number(task.nivel_analisis) : 3;
        const normalizedObs = Array.isArray(task.observaciones)
          ? task.observaciones.filter((item: unknown) => typeof item === 'string')
          : [];
        const altura = Number(task.altura_m);
        const longitud = Number(task.longitud_m);
        // Anti-alucinación: fuera de rango plausible → revisión, nunca forzar el valor.
        if (
          normalizedLevel < 3 &&
          ((Number.isFinite(altura) && altura > HEDGE_MAX_PLAUSIBLE_HEIGHT_M) ||
            (Number.isFinite(longitud) && longitud > HEDGE_MAX_PLAUSIBLE_LENGTH_M))
        ) {
          normalizedLevel = 2;
          if (!normalizedObs.includes('AMBIGUOUS_SIZE')) normalizedObs.push('AMBIGUOUS_SIZE');
        }
        return {
          ...task,
          nivel_analisis: normalizedLevel,
          estado_seto: normalizeHedgeState(task.estado_seto),
          longitud_confidence: clampConfidence(task.longitud_confidence),
          altura_confidence: clampConfidence(task.altura_confidence),
          estado_confidence: clampConfidence(task.estado_confidence),
          observaciones: normalizedObs.length > 0 ? normalizedObs : task.observaciones ?? null,
        };
      });
    }

    // Post-processing: normalize + merge "Poda de plantas y arbustos" tasks
    if (payload.service_name === 'Poda de plantas y arbustos' && tareas.length > 0) {
        const mergedTasks: Record<string, any> = {};
        
        tareas.forEach((task: any, taskIndex: number) => {
            if (task.tipo_servicio === 'Poda de plantas y arbustos') {
                let normalizedLevel = [1, 2, 3].includes(Number(task.nivel_analisis))
                  ? Number(task.nivel_analisis)
                  : 3;
                const normalizedSize = normalizeShrubSize(task.tamano_dominante);
                const normalizedArea = getShrubAreaFromTask(task);
                const normalizedObs = Array.isArray(task.observaciones)
                  ? task.observaciones.filter((item: unknown) => typeof item === 'string')
                  : [];
                const normalizedIndices = Array.isArray(task.indices_imagenes)
                  ? task.indices_imagenes.filter((index: unknown) => Number.isInteger(index))
                  : [];

                // Post-validación anti-alucinación: superficie plausible de macizo residencial.
                if (normalizedLevel < 3 && normalizedArea > SHRUB_MAX_PLAUSIBLE_AREA_M2) {
                  normalizedLevel = 2;
                  if (!normalizedObs.includes('AMBIGUOUS_SIZE')) normalizedObs.push('AMBIGUOUS_SIZE');
                }

                const normalizedTask = {
                  ...task,
                  tipo_servicio: 'Poda de plantas y arbustos',
                  nivel_analisis: normalizedLevel,
                  tamano_dominante: normalizedLevel === 3 ? null : normalizedSize,
                  superficie_m2: normalizedLevel === 3 ? 0 : normalizedArea,
                  estado_plantas: normalizedLevel === 3 ? null : normalizeShrubState(task.estado_plantas),
                  superficie_confidence: clampConfidence(task.superficie_confidence),
                  tamano_confidence: clampConfidence(task.tamano_confidence),
                  estado_confidence: clampConfidence(task.estado_confidence),
                  observaciones: normalizedLevel === 3
                    ? ['ELEMENTS_NOT_DETECTED']
                    : (normalizedObs.length > 0 ? normalizedObs : null),
                  indices_imagenes: normalizedIndices
                };

                // Group by dominant size; invalid or failed results are isolated as fallback_group.
                const key = normalizedTask.tamano_dominante || 'fallback_group';
                
                if (!mergedTasks[key]) {
                    mergedTasks[key] = { ...normalizedTask };
                    // Ensure arrays are initialized
                    mergedTasks[key].indices_imagenes = normalizedTask.indices_imagenes || [];
                    mergedTasks[key].observaciones = normalizedTask.observaciones || [];
                } else {
                    // Merge m2 directly extracted by IA (legacy fallback already normalized upstream)
                    mergedTasks[key].superficie_m2 += normalizedTask.superficie_m2;

                    // Merge image indices
                    const newIndices = normalizedTask.indices_imagenes || [];
                    mergedTasks[key].indices_imagenes = [...new Set([...mergedTasks[key].indices_imagenes, ...newIndices])].sort();

                    // Merge observations
                    const newObs = normalizedTask.observaciones || [];
                    mergedTasks[key].observaciones = [...new Set([...mergedTasks[key].observaciones, ...newObs])];

                    // El estado más severo manda (criterio del motor: el peor estado de la zona)
                    mergedTasks[key].estado_plantas = worstShrubState(mergedTasks[key].estado_plantas ?? null, normalizedTask.estado_plantas ?? null);

                    // Keep the worst analysis level (highest number)
                    mergedTasks[key].nivel_analisis = Math.max(mergedTasks[key].nivel_analisis, normalizedTask.nivel_analisis || 1);
                    if (mergedTasks[key].nivel_analisis === 3) {
                      mergedTasks[key].superficie_m2 = 0;
                      mergedTasks[key].tamano_dominante = null;
                      mergedTasks[key].estado_plantas = null;
                      mergedTasks[key].observaciones = ['ELEMENTS_NOT_DETECTED'];
                    }
                }
            } else {
                // If mixed services (unlikely but possible), keep them separate or handle accordingly
                // For now, just append with a unique key or skip merging logic for non-matching types
                const key = `OTHER_${taskIndex}`;
                mergedTasks[key] = task;
            }
        });
        
        tareas = Object.values(mergedTasks);
    }

    if (tareas.length > 0) {
      return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, { tareas })), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Sin tareas: distinguir fallo técnico (reintentar) de "no se detectó nada"
    // (respuesta válida sin elementos → el cliente necesita mejores fotos).
    const noResultReasons = hasTechnicalFailure(ai)
      ? ai.reasons
      : ['ELEMENTS_NOT_DETECTED'];
    return new Response(JSON.stringify(buildResponseWithAnalysisV2(payload, {
      tareas: [],
      reasons: noResultReasons,
    })), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Estimator error:', err);
    const h = heuristicTasks({ description: '', photo_count: 0 });
    return new Response(
      JSON.stringify(buildResponseWithAnalysisV2({ description: '', photo_count: 0 }, {
        ...h,
        reasons: [STANDARD_TECHNICAL_REASONS.internalError]
      }, 'internal')),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
