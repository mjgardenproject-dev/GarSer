import {
  adaptLegacyAnalysisToV2,
  type AnalysisClientObservation,
  type AnalysisService,
  type AnalysisStatus,
  type AnalysisV2Envelope,
} from './analysisV2';

type LegacyAnalysisFallback = {
  analysisLevel?: number | null;
  isFailed?: boolean | null;
  observations?: string[] | null;
  analyzedIndices?: number[] | null;
};

type AnalysisPhotoOptions = {
  selectedIndices?: number[] | null;
  analyzedIndices?: number[] | null;
  totalPhotoCount: number;
};

type AnalysisPresentationTone = 'success' | 'partial' | 'failed' | 'technical_error' | 'neutral';

export interface AnalysisPresentation {
  status: AnalysisStatus | null;
  level?: number;
  isFailed: boolean;
  isTechnicalError: boolean;
  tone: AnalysisPresentationTone;
  badgeLabel: string;
  title: string;
  message: string;
  observations: string[];
}

const uniqueStrings = (values: unknown[]) => {
  const flattened = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return Array.from(new Set(flattened.map((value) => String(value || '').trim()).filter(Boolean)));
};

const uniqueNumbers = (values: unknown[]) => {
  const flattened = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return Array.from(
    new Set(
      flattened
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0),
    ),
  );
};

const getObservationCopy = (observation: AnalysisClientObservation, service: AnalysisService) => {
  return observation.service_overrides?.[service] || observation.default_copy;
};

const getFallbackStatus = (fallback?: LegacyAnalysisFallback): AnalysisStatus | null => {
  if (!fallback) return null;
  if (fallback.isFailed || fallback.analysisLevel === 3) return 'failed';
  if (fallback.analysisLevel === 2) return 'partial';
  if (fallback.analysisLevel === 1) return 'success';
  return null;
};

const getStatus = (analysis?: AnalysisV2Envelope | null, fallback?: LegacyAnalysisFallback): AnalysisStatus | null => {
  return analysis?.analysis_status || getFallbackStatus(fallback);
};

export const getDefaultSelectedPhotoIndices = (totalPhotoCount: number, selectedIndices?: number[] | null) => {
  if (Array.isArray(selectedIndices)) {
    return uniqueNumbers([selectedIndices]).filter((index) => index < totalPhotoCount);
  }

  return Array.from({ length: Math.max(0, totalPhotoCount) }, (_, index) => index);
};

export const getCanonicalAnalysisObservations = (
  analysis?: AnalysisV2Envelope | null,
  fallback: string[] = [],
) => {
  if (analysis) {
    const observations = analysis.client_observations.map((observation) =>
      getObservationCopy(observation, analysis.service),
    );

    if (analysis.analysis_status === 'technical_error' && analysis.error_message_safe) {
      return uniqueStrings([analysis.error_message_safe, observations]);
    }

    if (observations.length > 0) {
      return observations;
    }
  }

  return uniqueStrings([fallback]);
};

export const getCanonicalAnalyzedPhotoIndices = (
  analysis?: AnalysisV2Envelope | null,
  options?: AnalysisPhotoOptions,
) => {
  const totalPhotoCount = options?.totalPhotoCount || 0;

  if (analysis?.analyzed_photo_indices?.length) {
    return uniqueNumbers([analysis.analyzed_photo_indices]).filter((index) => index < totalPhotoCount);
  }

  if (options?.analyzedIndices?.length) {
    return uniqueNumbers([options.analyzedIndices]).filter((index) => index < totalPhotoCount);
  }

  if (analysis) {
    return getDefaultSelectedPhotoIndices(totalPhotoCount, options?.selectedIndices);
  }

  return [];
};

export const hasCanonicalAnalysisFailure = (
  analysis?: AnalysisV2Envelope | null,
  fallback?: LegacyAnalysisFallback,
) => {
  const status = getStatus(analysis, fallback);
  return status === 'failed' || status === 'technical_error';
};

export const hasCanonicalAnalysisResult = (
  analysis?: AnalysisV2Envelope | null,
  fallback?: LegacyAnalysisFallback,
) => {
  return getStatus(analysis, fallback) !== null;
};

export const buildAnalysisCommonFields = ({
  analysis,
  analysisLevel,
  isFailed,
  observations,
  analyzedIndices,
  selectedIndices,
  totalPhotoCount,
}: LegacyAnalysisFallback & AnalysisPhotoOptions & { analysis?: AnalysisV2Envelope | null }) => {
  const fallback = { analysisLevel, isFailed, observations, analyzedIndices };

  return {
    analysisV2: analysis || undefined,
    analysisLevel: analysis?.analysis_level ?? analysisLevel ?? undefined,
    isFailed: hasCanonicalAnalysisFailure(analysis, fallback),
    observations: getCanonicalAnalysisObservations(analysis, observations || []),
    analyzedIndices: getCanonicalAnalyzedPhotoIndices(analysis, {
      analyzedIndices,
      selectedIndices,
      totalPhotoCount,
    }),
  };
};

export const resetAnalysisCommonFields = <
  T extends {
    analysisLevel?: number;
    isFailed?: boolean;
    observations?: string[];
    analyzedIndices?: number[];
    analysisV2?: AnalysisV2Envelope;
  },
>(
  entity: T,
  overrides: Partial<T> = {},
): T => {
  return {
    ...entity,
    analysisLevel: undefined,
    isFailed: false,
    observations: [],
    analyzedIndices: [],
    analysisV2: undefined,
    ...overrides,
  };
};

export const buildTechnicalFailureAnalysis = (
  serviceName: AnalysisService,
  sourcePhotoCount: number,
) => {
  return adaptLegacyAnalysisToV2({
    serviceName,
    sourcePhotoCount,
    legacyResponse: {
      reasons: ['INTERNAL_ERROR'],
    },
    provider: 'internal',
    model: 'ui-fallback',
  });
};

export const getAnalysisPresentation = (
  analysis?: AnalysisV2Envelope | null,
  fallback?: LegacyAnalysisFallback,
): AnalysisPresentation => {
  const status = getStatus(analysis, fallback);
  const level = analysis?.analysis_level ?? fallback?.analysisLevel ?? undefined;
  const observations = getCanonicalAnalysisObservations(analysis, fallback?.observations || []);

  if (status === 'technical_error') {
    return {
      status,
      level,
      isFailed: true,
      isTechnicalError: true,
      tone: 'technical_error',
      badgeLabel: 'Error técnico controlado',
      title: 'No se ha podido completar el análisis',
      message: analysis?.error_message_safe || observations[0] || 'Ha ocurrido un error técnico controlado durante el análisis.',
      observations,
    };
  }

  if (status === 'failed') {
    return {
      status,
      level,
      isFailed: true,
      isTechnicalError: false,
      tone: 'failed',
      badgeLabel: 'Sin evidencia suficiente',
      title: 'No se ha podido estimar con fiabilidad',
      message: observations[0] || 'Necesitamos mejores fotos para generar una estimación segura.',
      observations,
    };
  }

  if (status === 'partial') {
    return {
      status,
      level,
      isFailed: false,
      isTechnicalError: false,
      tone: 'partial',
      badgeLabel: 'Estimación parcial',
      title: 'Resultado con observaciones',
      message: observations[0] || 'La estimación es válida, pero conviene revisar las observaciones.',
      observations,
    };
  }

  if (status === 'success') {
    return {
      status,
      level,
      isFailed: false,
      isTechnicalError: false,
      tone: 'success',
      badgeLabel: 'Análisis fiable',
      title: 'Resultado listo para presupuesto',
      message: 'Las métricas detectadas son aptas para calcular precio y tiempo.',
      observations,
    };
  }

  return {
    status: null,
    level,
    isFailed: false,
    isTechnicalError: false,
    tone: 'neutral',
    badgeLabel: 'Pendiente',
    title: 'Pendiente de análisis',
    message: 'Añade y selecciona fotos para analizar esta zona.',
    observations,
  };
};

export const getAnalysisLoadingMessage = (service: AnalysisService) => {
  switch (service) {
    case 'Corte de césped':
      return 'Analizando zona de césped...';
    case 'Corte de setos':
      return 'Analizando zona de setos...';
    case 'Poda de palmeras':
      return 'Analizando palmeras...';
    case 'Poda de árboles':
      return 'Analizando árboles...';
    case 'Poda de plantas y arbustos':
      return 'Analizando plantas y arbustos...';
    case 'Desbroce de malas hierbas':
      return 'Analizando desbroce...';
    case 'Servicios fitosanitarios':
      return 'Analizando zona de tratamientos...';
    default:
      return 'Analizando...';
  }
};
