export const ANALYSIS_V2_SCHEMA_VERSION = 'analysis_v2' as const;

export const ANALYSIS_SERVICES = [
  'Corte de césped',
  'Poda de setos',
  'Poda de palmeras',
  'Poda de árboles',
  'Poda de plantas y arbustos',
  'Desbroce de malas hierbas',
  'Servicios fitosanitarios',
] as const;

export type AnalysisService = typeof ANALYSIS_SERVICES[number];
export type AnalysisStatus = 'success' | 'partial' | 'failed' | 'technical_error';
export type AnalysisLevel = 1 | 2 | 3;
export type AnalysisQualitySummaryCode =
  | 'READY_FOR_PRICING'
  | 'PARTIAL_ESTIMATE'
  | 'INSUFFICIENT_VISUAL_EVIDENCE'
  | 'TECHNICAL_FAILURE';

export type AnalysisQualityReasonCode =
  | 'ELEMENT_NOT_FULLY_VISIBLE'
  | 'LOW_LIGHT'
  | 'LOW_SHARPNESS'
  | 'OCCLUSION_PRESENT'
  | 'PARTIAL_FRAME'
  | 'AMBIGUOUS_COUNT'
  | 'AMBIGUOUS_SIZE'
  | 'ELEMENTS_NOT_DETECTED'
  | 'CONFLICTING_ANGLES'
  | 'INSUFFICIENT_COVERAGE'
  | 'ANALYSIS_TECHNICAL_FAILURE'
  | 'SERVICE_SPECIFIC_NOTE';

export type AnalysisTechnicalErrorCode =
  | 'PROVIDER_AUTH_MISSING'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_REQUEST_FAILED'
  | 'MODEL_OUTPUT_INVALID'
  | 'ANALYSIS_VALIDATION_FAILED'
  | 'EDGE_FUNCTION_INVOCATION_FAILED'
  | 'INTERNAL_ERROR';

export type AnalysisObservationSeverity = 'info' | 'warning' | 'critical';

export interface AnalysisClientObservation {
  code: AnalysisQualityReasonCode;
  severity: AnalysisObservationSeverity;
  default_copy: string;
  service_overrides?: Partial<Record<AnalysisService, string>>;
}

export interface AnalysisTechnicalErrorDescriptor {
  safe_message: string;
}

export interface AnalysisInternalReasoning {
  summary: string;
  evidence?: string[];
  deduplication?: string;
  consistency_checks?: string[];
}

export interface HedgeFaceMetrics {
  longitud_m?: number;
  altura_m?: number;
  nivel_analisis?: AnalysisLevel;
  observaciones?: string[];
}

export interface HedgeSummaryMetrics {
  base_longitud_m?: number;
  base_altura_m?: number;
  caras_recortar?: number;
  longitud_calculo_m?: number;
  altura_calculo_m?: number;
  metodo?: string;
}

export interface PalmMetric {
  especie: string;
  altura_m: number;
  estado: string | null;
  /** Banda de altura de precio ('0-4', '4-10', '>10'…) calculada en el edge según la especie. */
  altura_banda?: string | null;
  especie_confidence?: number | null;
  altura_confidence?: number | null;
  estado_confidence?: number | null;
  referencia_escala?: string | null;
}

export interface TreeMetric {
  size_band: 'small' | 'medium' | 'large' | 'over_9';
  especie?: string | null;
  altura_m?: number | null;
  tipo_arbol?: string | null;
  horas_estimadas?: number | null;
  size_band_confidence?: number | null;
  altura_confidence?: number | null;
  referencia_escala?: string | null;
}

export interface PhytosanitaryServiceMetrics {
  cesped_m2: number;
  seto_bajo_medio_ml: number;
  seto_alto_ml: number;
  palmeras_ducha_peq_ud: number;
  palmeras_ducha_med_ud: number;
  palmeras_ducha_alta_ud: number;
  palmeras_cirugia_ud: number;
  palmeras_endoterapia_troncos_ud: number;
  arboles_peq_ud: number;
  arboles_med_ud: number;
  arboles_gran_ud: number;
  herbicida_poca_densidad_m2: number;
  herbicida_mucha_densidad_m2: number;
  plantas_superficie_calculada_m2: number;
  plantas_tamano_dominante: 'pequenas' | 'medianas' | 'grandes' | null;
  observaciones_ia: string[];
}

export interface LawnServiceMetrics {
  superficie_m2: number;
  estado_jardin: string | null;
}

export interface HedgeServiceMetrics {
  longitud_m: number;
  altura_m: number;
  tipo_seto: string | null;
  estado_seto: string | null;
  caras: number;
  /** Confidences de la IA (0-1) para decidir qué campos pedir confirmar al cliente. */
  longitud_confidence?: number | null;
  altura_confidence?: number | null;
  estado_confidence?: number | null;
  referencia_escala?: string | null;
  detalle_caras?: {
    cara_a?: HedgeFaceMetrics;
    cara_b?: HedgeFaceMetrics;
  };
  resumen_medicion?: HedgeSummaryMetrics;
}

export interface PalmServiceMetrics {
  palmas: PalmMetric[];
}

export interface TreeServiceMetrics {
  arboles: TreeMetric[];
}

export interface ShrubServiceMetrics {
  superficie_m2: number;
  tamano_dominante: string | null;
  /** Estado propuesto por la IA; el cliente lo confirma antes del checkout. */
  estado_plantas?: string | null;
  superficie_confidence?: number | null;
  tamano_confidence?: number | null;
  estado_confidence?: number | null;
  referencia_escala?: string | null;
}

export interface WeedingServiceMetrics {
  superficie_malas_hierbas_m2: number;
  estado_malas_hierbas: 'normal' | 'dificultad_media' | 'dificultad_alta' | null;
}

export type ServiceMetricsByService = {
  'Corte de césped': LawnServiceMetrics;
  'Poda de setos': HedgeServiceMetrics;
  'Poda de palmeras': PalmServiceMetrics;
  'Poda de árboles': TreeServiceMetrics;
  'Poda de plantas y arbustos': ShrubServiceMetrics;
  'Desbroce de malas hierbas': WeedingServiceMetrics;
  'Servicios fitosanitarios': PhytosanitaryServiceMetrics;
};

export type AnyServiceMetrics = ServiceMetricsByService[AnalysisService];

export interface AnalysisV2Envelope<TService extends AnalysisService = AnalysisService> {
  service: TService;
  schema_version: typeof ANALYSIS_V2_SCHEMA_VERSION;
  analysis_status: AnalysisStatus;
  analysis_level: AnalysisLevel;
  quality_summary_code: AnalysisQualitySummaryCode;
  quality_reasons: AnalysisQualityReasonCode[];
  client_observations: AnalysisClientObservation[];
  internal_reasoning: AnalysisInternalReasoning;
  deduplication_summary: string;
  service_metrics: ServiceMetricsByService[TService];
  source_photo_count: number;
  analyzed_photo_indices: number[];
  provider: string | null;
  model: string | null;
  model_params: Record<string, unknown>;
  error_code: AnalysisTechnicalErrorCode | null;
  error_message_safe: string | null;
}

export interface LegacyAiTask {
  tipo_servicio?: string;
  estado_jardin?: string | null;
  superficie_m2?: number | null;
  superficie_malas_hierbas_m2?: number | null;
  estado_malas_hierbas?: 'normal' | 'dificultad_media' | 'dificultad_alta' | null;
  longitud_m?: number | null;
  altura_m?: number | null;
  tipo_seto?: string | null;
  estado_seto?: string | null;
  /** Confidences de setos (0-1); comparten estado_confidence/referencia_escala con arbustos. */
  longitud_confidence?: number | null;
  altura_confidence?: number | null;
  caras?: number | null;
  detalle_caras?: HedgeServiceMetrics['detalle_caras'];
  resumen_medicion?: HedgeSummaryMetrics;
  cantidad?: number | null;
  tipo_arbol?: string | null;
  size_band?: TreeMetric['size_band'];
  horas_estimadas?: number | null;
  tamano_dominante?: string | null;
  tamano_total_jardin_m2?: number | null;
  porcentaje_superficie_plantas?: number | null;
  /** Estado del macizo de plantas/arbustos (activa condition_surcharges media/alta del motor). */
  estado_plantas?: string | null;
  superficie_confidence?: number | null;
  tamano_confidence?: number | null;
  estado_confidence?: number | null;
  referencia_escala?: string | null;
  metricas_fitosanitarias?: Partial<PhytosanitaryServiceMetrics> | null;
  nivel_analisis?: number | null;
  observaciones?: string[] | null;
  indices_imagenes?: number[] | null;
}

export interface LegacyPalmResult {
  indice_imagen?: number | null;
  especie?: string | null;
  altura_m?: number | null;
  /** Banda de altura de precio calculada por el edge según la especie. */
  altura?: string | null;
  estado?: string | null;
  especie_confidence?: number | null;
  altura_confidence?: number | null;
  estado_confidence?: number | null;
  referencia_escala?: string | null;
  nivel_analisis?: number | null;
  observaciones?: string[] | null;
  tipo_acceso?: string | null;
  tipo_poda?: string | null;
  horas_estimadas?: number | null;
}

export interface LegacyTreeResult {
  indice_imagen?: number | null;
  especie?: string | null;
  altura_m?: number | null;
  size_band?: TreeMetric['size_band'] | null;
  size_band_confidence?: number | null;
  altura_confidence?: number | null;
  referencia_escala?: string | null;
  tipo_arbol?: string | null;
  horas_estimadas?: number | null;
  nivel_analisis?: number | null;
  observaciones?: string[] | null;
}

export interface LegacyAnalysisResponse {
  tareas?: LegacyAiTask[];
  palmas?: LegacyPalmResult[];
  arboles?: LegacyTreeResult[];
  metricas_fitosanitarias?: Partial<PhytosanitaryServiceMetrics> | null;
  reasons?: string[];
  analysis_v2?: AnalysisV2Envelope;
}

export interface AnalysisInventoryEntry {
  legacy_sources: string[];
  pricing_fields: string[];
  time_fields: string[];
  analysis_v2_metrics: string[];
}

export const ANALYSIS_CONTRACT_INVENTORY: Record<AnalysisService, AnalysisInventoryEntry> = {
  'Corte de césped': {
    legacy_sources: ['tareas[0].superficie_m2', 'tareas[0].estado_jardin', 'tareas[0].nivel_analisis', 'tareas[0].observaciones'],
    pricing_fields: ['superficie_m2', 'estado_jardin'],
    time_fields: ['superficie_m2', 'estado_jardin'],
    analysis_v2_metrics: ['service_metrics.superficie_m2', 'service_metrics.estado_jardin'],
  },
  'Poda de setos': {
    legacy_sources: [
      'tareas[0].longitud_m',
      'tareas[0].altura_m',
      'tareas[0].tipo_seto',
      'tareas[0].estado_seto',
      'tareas[0].caras',
      'tareas[0].detalle_caras',
      'tareas[0].resumen_medicion',
    ],
    pricing_fields: ['longitud_m', 'altura_m', 'tipo_seto', 'estado_seto', 'caras', 'resumen_medicion.longitud_calculo_m'],
    time_fields: ['longitud_m', 'altura_m', 'estado_seto', 'caras', 'resumen_medicion.altura_calculo_m'],
    analysis_v2_metrics: [
      'service_metrics.longitud_m',
      'service_metrics.altura_m',
      'service_metrics.tipo_seto',
      'service_metrics.estado_seto',
      'service_metrics.caras',
      'service_metrics.detalle_caras',
      'service_metrics.resumen_medicion',
    ],
  },
  'Poda de palmeras': {
    legacy_sources: ['palmas[].especie', 'palmas[].altura_m', 'palmas[].estado', 'palmas[].nivel_analisis', 'palmas[].observaciones'],
    pricing_fields: ['palmas[].especie', 'palmas[].altura_m', 'palmas[].estado'],
    time_fields: ['palmas[].especie', 'palmas[].altura_m', 'palmas[].estado'],
    analysis_v2_metrics: ['service_metrics.palmas[].especie', 'service_metrics.palmas[].altura_m', 'service_metrics.palmas[].estado'],
  },
  'Poda de árboles': {
    legacy_sources: ['arboles[].size_band', 'arboles[].tipo_arbol', 'arboles[].horas_estimadas', 'arboles[].nivel_analisis', 'arboles[].observaciones'],
    pricing_fields: ['arboles[].size_band'],
    time_fields: ['arboles[].size_band', 'arboles[].horas_estimadas'],
    analysis_v2_metrics: [
      'service_metrics.arboles[].size_band',
      'service_metrics.arboles[].tipo_arbol',
      'service_metrics.arboles[].horas_estimadas',
    ],
  },
  'Poda de plantas y arbustos': {
    legacy_sources: [
      'tareas[0].superficie_m2',
      'tareas[0].tamano_dominante',
      'tareas[0].tamano_total_jardin_m2',
      'tareas[0].porcentaje_superficie_plantas',
    ],
    pricing_fields: ['superficie_m2', 'tamano_dominante'],
    time_fields: ['superficie_m2', 'tamano_dominante'],
    analysis_v2_metrics: ['service_metrics.superficie_m2', 'service_metrics.tamano_dominante'],
  },
  'Desbroce de malas hierbas': {
    legacy_sources: ['tareas[0].superficie_malas_hierbas_m2', 'tareas[0].estado_malas_hierbas', 'tareas[0].nivel_analisis', 'tareas[0].observaciones'],
    pricing_fields: ['superficie_malas_hierbas_m2', 'estado_malas_hierbas'],
    time_fields: ['superficie_malas_hierbas_m2', 'estado_malas_hierbas'],
    analysis_v2_metrics: ['service_metrics.superficie_malas_hierbas_m2', 'service_metrics.estado_malas_hierbas'],
  },
  'Servicios fitosanitarios': {
    legacy_sources: ['metricas_fitosanitarias', 'tareas[0].metricas_fitosanitarias', 'tareas[0].nivel_analisis', 'tareas[0].observaciones'],
    pricing_fields: [
      'metricas_fitosanitarias.cesped_m2',
      'metricas_fitosanitarias.seto_bajo_medio_ml',
      'metricas_fitosanitarias.seto_alto_ml',
      'metricas_fitosanitarias.palmeras_ducha_peq_ud',
      'metricas_fitosanitarias.palmeras_ducha_med_ud',
      'metricas_fitosanitarias.palmeras_ducha_alta_ud',
      'metricas_fitosanitarias.palmeras_cirugia_ud',
      'metricas_fitosanitarias.palmeras_endoterapia_troncos_ud',
      'metricas_fitosanitarias.arboles_peq_ud',
      'metricas_fitosanitarias.arboles_med_ud',
      'metricas_fitosanitarias.arboles_gran_ud',
      'metricas_fitosanitarias.herbicida_poca_densidad_m2',
      'metricas_fitosanitarias.herbicida_mucha_densidad_m2',
      'metricas_fitosanitarias.plantas_superficie_calculada_m2',
      'metricas_fitosanitarias.plantas_tamano_dominante',
    ],
    time_fields: [
      'metricas_fitosanitarias.cesped_m2',
      'metricas_fitosanitarias.seto_bajo_medio_ml',
      'metricas_fitosanitarias.seto_alto_ml',
      'metricas_fitosanitarias.palmeras_ducha_peq_ud',
      'metricas_fitosanitarias.palmeras_ducha_med_ud',
      'metricas_fitosanitarias.palmeras_ducha_alta_ud',
      'metricas_fitosanitarias.palmeras_cirugia_ud',
      'metricas_fitosanitarias.palmeras_endoterapia_troncos_ud',
      'metricas_fitosanitarias.arboles_peq_ud',
      'metricas_fitosanitarias.arboles_med_ud',
      'metricas_fitosanitarias.arboles_gran_ud',
      'metricas_fitosanitarias.plantas_superficie_calculada_m2',
    ],
    analysis_v2_metrics: ['service_metrics'],
  },
};

const CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE = 'No hemos podido revisar las fotos en este momento.';

export const ANALYSIS_CLIENT_OBSERVATION_CATALOG: Record<AnalysisQualityReasonCode, AnalysisClientObservation> = {
  ELEMENT_NOT_FULLY_VISIBLE: { code: 'ELEMENT_NOT_FULLY_VISIBLE', severity: 'warning', default_copy: 'No se ve el elemento completo en las fotos disponibles.' },
  LOW_LIGHT: { code: 'LOW_LIGHT', severity: 'warning', default_copy: 'La iluminacion limita parte del analisis visual.' },
  LOW_SHARPNESS: { code: 'LOW_SHARPNESS', severity: 'warning', default_copy: 'La nitidez de la foto reduce la precision del analisis.' },
  OCCLUSION_PRESENT: { code: 'OCCLUSION_PRESENT', severity: 'warning', default_copy: 'Hay elementos que tapan parte de la zona a analizar.' },
  PARTIAL_FRAME: { code: 'PARTIAL_FRAME', severity: 'warning', default_copy: 'Parte de la zona queda fuera del encuadre.' },
  AMBIGUOUS_COUNT: { code: 'AMBIGUOUS_COUNT', severity: 'warning', default_copy: 'No se puede confirmar con total precision el recuento visible.' },
  AMBIGUOUS_SIZE: { code: 'AMBIGUOUS_SIZE', severity: 'warning', default_copy: 'El tamano visible requiere una estimacion conservadora.' },
  ELEMENTS_NOT_DETECTED: { code: 'ELEMENTS_NOT_DETECTED', severity: 'critical', default_copy: 'No se detecta con fiabilidad el elemento a analizar.' },
  CONFLICTING_ANGLES: { code: 'CONFLICTING_ANGLES', severity: 'warning', default_copy: 'Las fotos muestran angulos conflictivos para una medicion exacta.' },
  INSUFFICIENT_COVERAGE: { code: 'INSUFFICIENT_COVERAGE', severity: 'critical', default_copy: 'La cobertura fotografica no permite un analisis fiable.' },
  ANALYSIS_TECHNICAL_FAILURE: { code: 'ANALYSIS_TECHNICAL_FAILURE', severity: 'critical', default_copy: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  SERVICE_SPECIFIC_NOTE: { code: 'SERVICE_SPECIFIC_NOTE', severity: 'info', default_copy: 'Se ha registrado una observacion especifica del servicio.' },
};

export const ANALYSIS_TECHNICAL_ERROR_CATALOG: Record<AnalysisTechnicalErrorCode, AnalysisTechnicalErrorDescriptor> = {
  PROVIDER_AUTH_MISSING: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  PROVIDER_RATE_LIMIT: { safe_message: 'Ahora mismo no hemos podido revisar las fotos. Puedes intentarlo de nuevo en unos minutos.' },
  PROVIDER_REQUEST_FAILED: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  MODEL_OUTPUT_INVALID: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  ANALYSIS_VALIDATION_FAILED: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  EDGE_FUNCTION_INVOCATION_FAILED: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
  INTERNAL_ERROR: { safe_message: CLIENT_VISIBLE_ANALYSIS_ERROR_MESSAGE },
};

export interface AdaptAnalysisV2Options {
  serviceName?: string;
  legacyResponse: LegacyAnalysisResponse | null | undefined;
  sourcePhotoCount?: number;
  provider?: string | null;
  model?: string | null;
  modelParams?: Record<string, unknown>;
}

const QUALITY_REASON_MAP: Array<{ pattern: RegExp; code: AnalysisQualityReasonCode }> = [
  { pattern: /^ELEMENT_NOT_FULLY_VISIBLE$/i, code: 'ELEMENT_NOT_FULLY_VISIBLE' },
  { pattern: /^LOW_LIGHT$/i, code: 'LOW_LIGHT' },
  { pattern: /^LOW_SHARPNESS$/i, code: 'LOW_SHARPNESS' },
  { pattern: /^OCCLUSION_PRESENT$/i, code: 'OCCLUSION_PRESENT' },
  { pattern: /^PARTIAL_FRAME$/i, code: 'PARTIAL_FRAME' },
  { pattern: /^AMBIGUOUS_COUNT$/i, code: 'AMBIGUOUS_COUNT' },
  { pattern: /^AMBIGUOUS_SIZE$/i, code: 'AMBIGUOUS_SIZE' },
  { pattern: /^ELEMENTS_NOT_DETECTED$/i, code: 'ELEMENTS_NOT_DETECTED' },
  { pattern: /^CONFLICTING_ANGLES$/i, code: 'CONFLICTING_ANGLES' },
  { pattern: /^INSUFFICIENT_COVERAGE$/i, code: 'INSUFFICIENT_COVERAGE' },
  { pattern: /^ANALYSIS_TECHNICAL_FAILURE$/i, code: 'ANALYSIS_TECHNICAL_FAILURE' },
  { pattern: /oscur|dark|mala luz|low light/i, code: 'LOW_LIGHT' },
  { pattern: /borros|blur|enfoque/i, code: 'LOW_SHARPNESS' },
  { pattern: /ocult|tapa|occlu/i, code: 'OCCLUSION_PRESENT' },
  { pattern: /fuera de encuadre|partial frame|ángulo limitado|vista parcial/i, code: 'PARTIAL_FRAME' },
  { pattern: /no detect|no visible/i, code: 'ELEMENTS_NOT_DETECTED' },
  { pattern: /insuficiente|insufficient/i, code: 'INSUFFICIENT_COVERAGE' },
  { pattern: /conflict|contradict/i, code: 'CONFLICTING_ANGLES' },
  { pattern: /count|duplic/i, code: 'AMBIGUOUS_COUNT' },
  { pattern: /size|altura|height|tamano/i, code: 'AMBIGUOUS_SIZE' },
  { pattern: /technical|error|failed|gemini|openai|parseable|api key|quota/i, code: 'ANALYSIS_TECHNICAL_FAILURE' },
];

const TECHNICAL_ERROR_MAP: Array<{ pattern: RegExp; code: AnalysisTechnicalErrorCode }> = [
  { pattern: /^PROVIDER_AUTH_MISSING$/i, code: 'PROVIDER_AUTH_MISSING' },
  { pattern: /^PROVIDER_RATE_LIMIT$/i, code: 'PROVIDER_RATE_LIMIT' },
  { pattern: /^PROVIDER_REQUEST_FAILED$/i, code: 'PROVIDER_REQUEST_FAILED' },
  { pattern: /^MODEL_OUTPUT_INVALID$/i, code: 'MODEL_OUTPUT_INVALID' },
  { pattern: /^ANALYSIS_VALIDATION_FAILED$/i, code: 'ANALYSIS_VALIDATION_FAILED' },
  { pattern: /^EDGE_FUNCTION_INVOCATION_FAILED$/i, code: 'EDGE_FUNCTION_INVOCATION_FAILED' },
  { pattern: /^INTERNAL_ERROR$/i, code: 'INTERNAL_ERROR' },
  { pattern: /auth|api key|missing key|sin clave|sin configuracion/i, code: 'PROVIDER_AUTH_MISSING' },
  { pattern: /rate limit|quota|429/i, code: 'PROVIDER_RATE_LIMIT' },
  { pattern: /parse|schema|format/i, code: 'MODEL_OUTPUT_INVALID' },
  { pattern: /validaci|validation/i, code: 'ANALYSIS_VALIDATION_FAILED' },
  { pattern: /invoke|invoc/i, code: 'EDGE_FUNCTION_INVOCATION_FAILED' },
  { pattern: /internal|provider|network|request|gemini|openai|technical|error|failed/i, code: 'PROVIDER_REQUEST_FAILED' },
];

const toSafeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return parsed;
};

const toNonNegativeNumber = (value: unknown, fallback = 0): number => {
  return Math.max(0, toSafeNumber(value, fallback));
};

const normalizeLevel = (value: unknown, fallback: AnalysisLevel = 3): AnalysisLevel => {
  const parsed = Math.round(toSafeNumber(value, fallback));
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return fallback;
};

const normalizeString = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
};

const uniqueStrings = (values: unknown[]): string[] => {
  const normalized = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const uniqueNumbers = (values: unknown[]): number[] => {
  const normalized = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
};

const getShrubAreaFromTask = (task: LegacyAiTask | undefined): number => {
  const directArea = toSafeNumber(task?.superficie_m2, Number.NaN);
  if (Number.isFinite(directArea)) return Math.max(0, Math.round(directArea));

  const totalM2 = toSafeNumber(task?.tamano_total_jardin_m2, Number.NaN);
  const percentage = toSafeNumber(task?.porcentaje_superficie_plantas, Number.NaN);
  if (Number.isFinite(totalM2) && Number.isFinite(percentage)) {
    return Math.max(0, Math.round(totalM2 * (percentage / 100)));
  }

  return 0;
};

const buildPhytosanitaryMetrics = (raw: Partial<PhytosanitaryServiceMetrics> | null | undefined): PhytosanitaryServiceMetrics => ({
  cesped_m2: toNonNegativeNumber(raw?.cesped_m2),
  seto_bajo_medio_ml: toNonNegativeNumber(raw?.seto_bajo_medio_ml),
  seto_alto_ml: toNonNegativeNumber(raw?.seto_alto_ml),
  palmeras_ducha_peq_ud: toNonNegativeNumber(raw?.palmeras_ducha_peq_ud),
  palmeras_ducha_med_ud: toNonNegativeNumber(raw?.palmeras_ducha_med_ud),
  palmeras_ducha_alta_ud: toNonNegativeNumber(raw?.palmeras_ducha_alta_ud),
  palmeras_cirugia_ud: toNonNegativeNumber(raw?.palmeras_cirugia_ud),
  palmeras_endoterapia_troncos_ud: toNonNegativeNumber(raw?.palmeras_endoterapia_troncos_ud),
  arboles_peq_ud: toNonNegativeNumber(raw?.arboles_peq_ud),
  arboles_med_ud: toNonNegativeNumber(raw?.arboles_med_ud),
  arboles_gran_ud: toNonNegativeNumber(raw?.arboles_gran_ud),
  herbicida_poca_densidad_m2: toNonNegativeNumber(raw?.herbicida_poca_densidad_m2),
  herbicida_mucha_densidad_m2: toNonNegativeNumber(raw?.herbicida_mucha_densidad_m2),
  plantas_superficie_calculada_m2: toNonNegativeNumber(raw?.plantas_superficie_calculada_m2),
  plantas_tamano_dominante: raw?.plantas_tamano_dominante === 'pequenas' || raw?.plantas_tamano_dominante === 'medianas' || raw?.plantas_tamano_dominante === 'grandes'
    ? raw.plantas_tamano_dominante
    : null,
  observaciones_ia: uniqueStrings([raw?.observaciones_ia || []]),
});

const detectServiceFromPayload = (serviceName: string | undefined, legacy: LegacyAnalysisResponse): AnalysisService => {
  const normalized = String(serviceName || '').trim();
  if ((ANALYSIS_SERVICES as readonly string[]).includes(normalized)) {
    return normalized as AnalysisService;
  }

  if (Array.isArray(legacy.palmas)) return 'Poda de palmeras';
  if (Array.isArray(legacy.arboles)) return 'Poda de árboles';
  if (legacy.metricas_fitosanitarias) return 'Servicios fitosanitarios';

  const firstTask = legacy.tareas?.[0];
  const taskService = String(firstTask?.tipo_servicio || '').trim();
  if ((ANALYSIS_SERVICES as readonly string[]).includes(taskService)) {
    return taskService as AnalysisService;
  }

  return 'Corte de césped';
};

const mapReasonToCode = (value: string): AnalysisQualityReasonCode => {
  const match = QUALITY_REASON_MAP.find((entry) => entry.pattern.test(value));
  return match?.code || 'SERVICE_SPECIFIC_NOTE';
};

const mapReasonToErrorCode = (value: string): AnalysisTechnicalErrorCode | null => {
  const match = TECHNICAL_ERROR_MAP.find((entry) => entry.pattern.test(value));
  return match?.code || null;
};

const normalizeQualityReasonCodes = (reasons: string[], level: AnalysisLevel, errorCode: AnalysisTechnicalErrorCode | null): AnalysisQualityReasonCode[] => {
  const codes = uniqueStrings(reasons).map(mapReasonToCode);
  if (errorCode) {
    codes.push('ANALYSIS_TECHNICAL_FAILURE');
  }
  if (level === 2 && codes.length === 0) {
    codes.push('INSUFFICIENT_COVERAGE');
  }
  if (level === 3 && !errorCode && codes.length === 0) {
    codes.push('ELEMENTS_NOT_DETECTED');
    codes.push('INSUFFICIENT_COVERAGE');
  }
  return Array.from(new Set(codes));
};

const buildClientObservations = (codes: AnalysisQualityReasonCode[], service: AnalysisService): AnalysisClientObservation[] => {
  return Array.from(new Set(codes)).map((code) => {
    const catalogEntry = ANALYSIS_CLIENT_OBSERVATION_CATALOG[code];
    return {
      code,
      severity: catalogEntry.severity,
      default_copy: catalogEntry.default_copy,
      service_overrides: catalogEntry.service_overrides?.[service]
        ? { [service]: catalogEntry.service_overrides[service] as string }
        : undefined,
    };
  });
};

const buildStatus = (level: AnalysisLevel, errorCode: AnalysisTechnicalErrorCode | null): AnalysisStatus => {
  if (errorCode) return 'technical_error';
  if (level === 3) return 'failed';
  if (level === 2) return 'partial';
  return 'success';
};

const buildSummaryCode = (status: AnalysisStatus): AnalysisQualitySummaryCode => {
  if (status === 'technical_error') return 'TECHNICAL_FAILURE';
  if (status === 'failed') return 'INSUFFICIENT_VISUAL_EVIDENCE';
  if (status === 'partial') return 'PARTIAL_ESTIMATE';
  return 'READY_FOR_PRICING';
};

const adaptLawnMetrics = (legacy: LegacyAnalysisResponse) => {
  const task = legacy.tareas?.[0];
  return {
    metrics: {
      superficie_m2: toNonNegativeNumber(task?.superficie_m2),
      estado_jardin: normalizeString(task?.estado_jardin),
    } satisfies LawnServiceMetrics,
    level: normalizeLevel(task?.nivel_analisis, legacy.reasons?.length ? 3 : 1),
    observations: uniqueStrings([task?.observaciones || [], legacy.reasons || []]),
    indices: uniqueNumbers([task?.indices_imagenes || []]),
  };
};

const adaptHedgeMetrics = (legacy: LegacyAnalysisResponse) => {
  const task = legacy.tareas?.[0];
  const metrics: HedgeServiceMetrics = {
    longitud_m: toNonNegativeNumber(task?.longitud_m),
    altura_m: toNonNegativeNumber(task?.altura_m),
    tipo_seto: normalizeString(task?.tipo_seto),
    estado_seto: normalizeString(task?.estado_seto),
    caras: Math.max(1, Math.round(toSafeNumber(task?.caras, 1))),
    longitud_confidence: toConfidence(task?.longitud_confidence),
    altura_confidence: toConfidence(task?.altura_confidence),
    estado_confidence: toConfidence(task?.estado_confidence),
    referencia_escala: normalizeString(task?.referencia_escala),
    detalle_caras: task?.detalle_caras,
    resumen_medicion: task?.resumen_medicion,
  };

  return {
    metrics,
    level: normalizeLevel(task?.nivel_analisis, legacy.reasons?.length ? 3 : 1),
    observations: uniqueStrings([
      task?.observaciones || [],
      task?.detalle_caras?.cara_a?.observaciones || [],
      task?.detalle_caras?.cara_b?.observaciones || [],
      legacy.reasons || [],
    ]),
    indices: uniqueNumbers([task?.indices_imagenes || []]),
  };
};

const toConfidence = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
};

const adaptPalmMetrics = (legacy: LegacyAnalysisResponse) => {
  const palms = Array.isArray(legacy.palmas) ? legacy.palmas : [];
  const metrics: PalmServiceMetrics = {
    palmas: palms.map((palm) => ({
      especie: normalizeString(palm.especie) || 'No detectada',
      altura_m: toNonNegativeNumber(palm.altura_m),
      estado: normalizeString(palm.estado),
      altura_banda: normalizeString(palm.altura),
      especie_confidence: toConfidence(palm.especie_confidence),
      altura_confidence: toConfidence(palm.altura_confidence),
      estado_confidence: toConfidence(palm.estado_confidence),
      referencia_escala: normalizeString(palm.referencia_escala),
    })),
  };

  const levels = palms.map((palm) => normalizeLevel(palm.nivel_analisis, 3));
  return {
    metrics,
    level: (levels.length > 0 ? Math.max(...levels) : (legacy.reasons?.length ? 3 : 1)) as AnalysisLevel,
    observations: uniqueStrings([palms.map((palm) => palm.observaciones || []), legacy.reasons || []]),
    indices: uniqueNumbers([palms.map((palm) => palm.indice_imagen)]),
  };
};

const adaptTreeMetrics = (legacy: LegacyAnalysisResponse) => {
  const trees = Array.isArray(legacy.arboles) ? legacy.arboles : [];
  const metrics: TreeServiceMetrics = {
    arboles: trees
      .filter((tree): tree is LegacyTreeResult & { size_band: TreeMetric['size_band'] } =>
        tree.size_band === 'small' || tree.size_band === 'medium' || tree.size_band === 'large' || tree.size_band === 'over_9')
      .map((tree) => ({
        size_band: tree.size_band,
        especie: normalizeString(tree.especie),
        altura_m: tree.altura_m == null ? null : toNonNegativeNumber(tree.altura_m),
        tipo_arbol: normalizeString(tree.tipo_arbol),
        horas_estimadas: tree.horas_estimadas == null ? null : toNonNegativeNumber(tree.horas_estimadas),
        size_band_confidence: toConfidence(tree.size_band_confidence),
        altura_confidence: toConfidence(tree.altura_confidence),
        referencia_escala: normalizeString(tree.referencia_escala),
      })),
  };

  const levels = trees.map((tree) => normalizeLevel(tree.nivel_analisis, 3));
  return {
    metrics,
    level: (levels.length > 0 ? Math.max(...levels) : (legacy.reasons?.length ? 3 : 1)) as AnalysisLevel,
    observations: uniqueStrings([trees.map((tree) => tree.observaciones || []), legacy.reasons || []]),
    indices: uniqueNumbers([trees.map((tree) => tree.indice_imagen)]),
  };
};

const adaptShrubMetrics = (legacy: LegacyAnalysisResponse) => {
  const task = legacy.tareas?.[0];
  return {
    metrics: {
      superficie_m2: getShrubAreaFromTask(task),
      tamano_dominante: normalizeString(task?.tamano_dominante),
      estado_plantas: normalizeString(task?.estado_plantas),
      superficie_confidence: toConfidence(task?.superficie_confidence),
      tamano_confidence: toConfidence(task?.tamano_confidence),
      estado_confidence: toConfidence(task?.estado_confidence),
      referencia_escala: normalizeString(task?.referencia_escala),
    } satisfies ShrubServiceMetrics,
    level: normalizeLevel(task?.nivel_analisis, legacy.reasons?.length ? 3 : 1),
    observations: uniqueStrings([task?.observaciones || [], legacy.reasons || []]),
    indices: uniqueNumbers([task?.indices_imagenes || []]),
  };
};

const adaptWeedingMetrics = (legacy: LegacyAnalysisResponse) => {
  const task = legacy.tareas?.[0];
  const normalizedState = task?.estado_malas_hierbas === 'normal' || task?.estado_malas_hierbas === 'dificultad_media' || task?.estado_malas_hierbas === 'dificultad_alta'
    ? task.estado_malas_hierbas
    : null;

  return {
    metrics: {
      superficie_malas_hierbas_m2: toNonNegativeNumber(task?.superficie_malas_hierbas_m2),
      estado_malas_hierbas: normalizedState,
    } satisfies WeedingServiceMetrics,
    level: normalizeLevel(task?.nivel_analisis, legacy.reasons?.length ? 3 : 1),
    observations: uniqueStrings([task?.observaciones || [], legacy.reasons || []]),
    indices: uniqueNumbers([task?.indices_imagenes || []]),
  };
};

const adaptPhytosanitaryMetrics = (legacy: LegacyAnalysisResponse) => {
  const task = legacy.tareas?.[0];
  const taskMetrics = task?.metricas_fitosanitarias || legacy.metricas_fitosanitarias;
  const metrics = buildPhytosanitaryMetrics(taskMetrics);
  return {
    metrics,
    level: normalizeLevel(task?.nivel_analisis, legacy.reasons?.length ? 3 : 1),
    observations: uniqueStrings([task?.observaciones || [], metrics.observaciones_ia, legacy.reasons || []]),
    indices: uniqueNumbers([task?.indices_imagenes || []]),
  };
};

export const adaptLegacyAnalysisToV2 = (options: AdaptAnalysisV2Options): AnalysisV2Envelope => {
  const legacy = options.legacyResponse || {};
  const service = detectServiceFromPayload(options.serviceName, legacy);

  const adaptedByService = (() => {
    switch (service) {
      case 'Poda de setos':
        return adaptHedgeMetrics(legacy);
      case 'Poda de palmeras':
        return adaptPalmMetrics(legacy);
      case 'Poda de árboles':
        return adaptTreeMetrics(legacy);
      case 'Poda de plantas y arbustos':
        return adaptShrubMetrics(legacy);
      case 'Desbroce de malas hierbas':
        return adaptWeedingMetrics(legacy);
      case 'Servicios fitosanitarios':
        return adaptPhytosanitaryMetrics(legacy);
      case 'Corte de césped':
      default:
        return adaptLawnMetrics(legacy);
    }
  })();

  const reasons = uniqueStrings([adaptedByService.observations, legacy.reasons || []]);
  const errorCode = reasons.map(mapReasonToErrorCode).find((value): value is AnalysisTechnicalErrorCode => Boolean(value)) || null;
  const qualityReasonCodes = normalizeQualityReasonCodes(reasons, adaptedByService.level, errorCode);
  const status = buildStatus(adaptedByService.level, errorCode);
  const photoCount = Math.max(0, Math.round(toSafeNumber(options.sourcePhotoCount, 0)));

  return {
    service,
    schema_version: ANALYSIS_V2_SCHEMA_VERSION,
    analysis_status: status,
    analysis_level: adaptedByService.level,
    quality_summary_code: buildSummaryCode(status),
    quality_reasons: qualityReasonCodes,
    client_observations: buildClientObservations(qualityReasonCodes, service),
    internal_reasoning: {
      summary: `Adaptado desde contrato legacy para ${service}.`,
      evidence: uniqueStrings([reasons]),
      deduplication: adaptedByService.indices.length > 0
        ? `Se conservaron ${adaptedByService.indices.length} índices de imagen analizados.`
        : 'No hay índices explícitos en el contrato legacy.',
      consistency_checks: [
        `Campos de pricing preservados: ${ANALYSIS_CONTRACT_INVENTORY[service].pricing_fields.join(', ')}`,
        `Campos de tiempo preservados: ${ANALYSIS_CONTRACT_INVENTORY[service].time_fields.join(', ')}`,
      ],
    },
    deduplication_summary: adaptedByService.indices.length > 0
      ? `Índices de imágenes deduplicados: ${adaptedByService.indices.join(', ')}.`
      : 'Sin índices de imágenes explícitos en el payload legacy.',
    service_metrics: adaptedByService.metrics as ServiceMetricsByService[typeof service],
    source_photo_count: photoCount,
    analyzed_photo_indices: adaptedByService.indices,
    provider: options.provider ?? null,
    model: options.model ?? null,
    model_params: options.modelParams || {},
    error_code: status === 'technical_error' ? errorCode : null,
    error_message_safe: status === 'technical_error' && errorCode ? ANALYSIS_TECHNICAL_ERROR_CATALOG[errorCode].safe_message : null,
  };
};

export const validateAnalysisV2 = (analysis: AnalysisV2Envelope): string[] => {
  const errors: string[] = [];

  if (!(ANALYSIS_SERVICES as readonly string[]).includes(analysis.service)) {
    errors.push('service inválido');
  }

  if (analysis.schema_version !== ANALYSIS_V2_SCHEMA_VERSION) {
    errors.push('schema_version inválido');
  }

  if (![1, 2, 3].includes(analysis.analysis_level)) {
    errors.push('analysis_level inválido');
  }

  if (analysis.source_photo_count < 0) {
    errors.push('source_photo_count no puede ser negativo');
  }

  if (!Array.isArray(analysis.analyzed_photo_indices)) {
    errors.push('analyzed_photo_indices debe ser un array');
  }

  switch (analysis.service) {
    case 'Corte de césped': {
      const metrics = analysis.service_metrics as LawnServiceMetrics;
      if (metrics.superficie_m2 < 0) errors.push('lawn.superficie_m2 inválido');
      break;
    }
    case 'Poda de setos': {
      const metrics = analysis.service_metrics as HedgeServiceMetrics;
      if (metrics.longitud_m < 0) errors.push('hedge.longitud_m inválido');
      if (metrics.altura_m < 0) errors.push('hedge.altura_m inválido');
      if (metrics.caras <= 0) errors.push('hedge.caras inválido');
      break;
    }
    case 'Poda de palmeras': {
      const metrics = analysis.service_metrics as PalmServiceMetrics;
      if (!Array.isArray(metrics.palmas)) errors.push('palms.palmas debe ser un array');
      metrics.palmas.forEach((palm, index) => {
        if (!palm.especie) errors.push(`palms.palmas[${index}].especie inválida`);
        if (palm.altura_m < 0) errors.push(`palms.palmas[${index}].altura_m inválida`);
      });
      break;
    }
    case 'Poda de árboles': {
      const metrics = analysis.service_metrics as TreeServiceMetrics;
      if (!Array.isArray(metrics.arboles)) errors.push('trees.arboles debe ser un array');
      metrics.arboles.forEach((tree, index) => {
        if (!tree.size_band) errors.push(`trees.arboles[${index}].size_band inválido`);
      });
      break;
    }
    case 'Poda de plantas y arbustos': {
      const metrics = analysis.service_metrics as ShrubServiceMetrics;
      if (metrics.superficie_m2 < 0) errors.push('shrubs.superficie_m2 inválido');
      break;
    }
    case 'Desbroce de malas hierbas': {
      const metrics = analysis.service_metrics as WeedingServiceMetrics;
      if (metrics.superficie_malas_hierbas_m2 < 0) errors.push('weeding.superficie_malas_hierbas_m2 inválido');
      break;
    }
    case 'Servicios fitosanitarios': {
      const metrics = analysis.service_metrics as PhytosanitaryServiceMetrics;
      const numericFields: Array<keyof PhytosanitaryServiceMetrics> = [
        'cesped_m2',
        'seto_bajo_medio_ml',
        'seto_alto_ml',
        'palmeras_ducha_peq_ud',
        'palmeras_ducha_med_ud',
        'palmeras_ducha_alta_ud',
        'palmeras_cirugia_ud',
        'palmeras_endoterapia_troncos_ud',
        'arboles_peq_ud',
        'arboles_med_ud',
        'arboles_gran_ud',
        'herbicida_poca_densidad_m2',
        'herbicida_mucha_densidad_m2',
        'plantas_superficie_calculada_m2',
      ];
      numericFields.forEach((field) => {
        if (toNonNegativeNumber(metrics[field]) !== metrics[field]) {
          errors.push(`phytosanitary.${field} inválido`);
        }
      });
      break;
    }
  }

  return errors;
};
