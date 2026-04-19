export type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
export type PhytosanitaryTreatmentValue = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
export type PhytosanitaryScope = 'todo_jardin' | 'palmeras' | 'arboles' | 'cesped' | 'setos' | 'plantas';
export type PhytosanitaryRequestTreatment = 'insecticida' | 'fungicida' | 'combo';

export type PhytosanitaryAnalysisMetrics = {
  cesped_m2: number;
  plantas_superficie_calculada_m2?: number;
  plantas_tamano_dominante?: 'pequenas' | 'medianas' | 'grandes';
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
  observaciones_ia: string[];
};
export type PhytosanitaryMetricKey = Exclude<keyof PhytosanitaryAnalysisMetrics, 'observaciones_ia'>;

export const PHYTOSANITARY_SCOPE_OPTIONS: Array<{ value: PhytosanitaryScope; label: string; affectedType: PhytosanitaryAffectedType }> = [
  { value: 'setos', label: 'Setos', affectedType: 'Setos' },
  { value: 'cesped', label: 'Césped', affectedType: 'Césped' },
  { value: 'plantas', label: 'Plantas', affectedType: 'Plantas bajas' },
  { value: 'palmeras', label: 'Palmeras', affectedType: 'Palmeras' },
  { value: 'arboles', label: 'Árboles', affectedType: 'Árboles' },
  { value: 'todo_jardin', label: 'Todo el jardín', affectedType: 'Plantas bajas' }
];

export const PHYTOSANITARY_PROBLEM_OPTIONS: Array<{ value: 'insects' | 'fungus'; label: string }> = [
  { value: 'insects', label: 'Plagas de insectos (insecticida)' },
  { value: 'fungus', label: 'Hongos (fungicida)' }
];

export const getPhytosanitaryIntentOptions = (problems: ('insects' | 'fungus')[]) => {
  if (!problems || problems.length === 0) return [];
  const hasPlagas = problems.includes('insects');
  const hasHongos = problems.includes('fungus');

  const subjects = [];
  if (hasPlagas && hasHongos) subjects.push('plagas y hongos');
  else if (hasPlagas) subjects.push('plagas');
  else if (hasHongos) subjects.push('hongos');
  
  const subjectString = subjects.join(' y ');

  return [
    { value: 'preventive', label: `Prevenir ${subjectString}` },
    { value: 'curative', label: `Eliminar ${subjectString}` }
  ];
};

export const PHYTOSANITARY_REQUEST_TREATMENT_OPTIONS: Array<{ value: PhytosanitaryRequestTreatment; label: string }> = [
  { value: 'insecticida', label: 'Insecticida' },
  { value: 'fungicida', label: 'Fungicida' },
  { value: 'combo', label: 'Combo insecticida + fungicida' }
];

export const EMPTY_PHYTOSANITARY_ANALYSIS_METRICS: PhytosanitaryAnalysisMetrics = {
  cesped_m2: 0,
  plantas_superficie_calculada_m2: 0,
  seto_bajo_medio_ml: 0,
  seto_alto_ml: 0,
  palmeras_ducha_peq_ud: 0,
  palmeras_ducha_med_ud: 0,
  palmeras_ducha_alta_ud: 0,
  palmeras_cirugia_ud: 0,
  palmeras_endoterapia_troncos_ud: 0,
  arboles_peq_ud: 0,
  arboles_med_ud: 0,
  arboles_gran_ud: 0,
  observaciones_ia: []
};

export const getAllowedPhytosanitaryTreatments = (affectedType?: PhytosanitaryAffectedType): PhytosanitaryTreatmentValue[] => {
  if (affectedType === 'Palmeras') return ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'];
  if (affectedType === 'Árboles' || affectedType === 'Setos') return ['insecticida', 'fungicida', 'ecologico_preventivo'];
  return ['insecticida', 'fungicida', 'ecologico_preventivo'];
};

export const buildPhytosanitaryZoneType = (
  scope: string | string[] | undefined,
  requested: PhytosanitaryRequestTreatment | undefined,
  wantsEco: boolean | undefined
) => {
  if (!requested) return '';
  if (requested === 'combo') {
    return wantsEco ? 'insecticida+fungicida+ecologico_preventivo' : 'insecticida+fungicida';
  }
  return wantsEco ? `${requested}+ecologico_preventivo` : requested;
};

export const toPhytosanitaryMetricNumber = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
};

export const getDefaultPhytosanitaryScope = (
  affectedType?: PhytosanitaryAffectedType,
  treatmentType?: string
): PhytosanitaryScope[] => {
  if (affectedType === 'Palmeras') return ['palmeras'];
  if (affectedType === 'Árboles') return ['arboles'];
  if (affectedType === 'Setos') return ['setos'];
  if (affectedType === 'Césped') return ['cesped'];
  return ['todo_jardin'];
};

export const getPhytosanitaryRequestedTreatment = (treatmentType?: string): PhytosanitaryRequestTreatment | undefined => {
  const normalizedType = String(treatmentType || '').toLowerCase();
  if (!normalizedType) return undefined;
  if (normalizedType.includes('insecticida') && normalizedType.includes('fungicida')) return 'combo';
  if (normalizedType.includes('fungicida')) return 'fungicida';
  if (normalizedType.includes('insecticida') || normalizedType.includes('ecologico') || normalizedType.includes('endoterapia')) return 'insecticida';
  return undefined;
};

// Deprecated normalizer - removed


export const sumPhytosanitaryMetrics = (metrics: PhytosanitaryAnalysisMetrics) => {
  return Number(metrics.cesped_m2 || 0)
    + Number(metrics.seto_bajo_medio_ml || 0)
    + Number(metrics.seto_alto_ml || 0)
    + Number(metrics.palmeras_ducha_peq_ud || 0)
    + Number(metrics.palmeras_ducha_med_ud || 0)
    + Number(metrics.palmeras_ducha_alta_ud || 0)
    + Number(metrics.palmeras_cirugia_ud || 0)
    + Number(metrics.palmeras_endoterapia_troncos_ud || 0)
    + Number(metrics.arboles_peq_ud || 0)
    + Number(metrics.arboles_med_ud || 0)
    + Number(metrics.arboles_gran_ud || 0);
};

// Observation Translations
export const OBS_TRANSLATIONS: Record<string, string> = {
  'duplicate_views': 'Posible duplicación de elementos en las fotos.',
  'poor_visibility': 'Mala iluminación o resolución que dificulta el análisis.',
  'risk_environment': 'Riesgo cercano detectado (ej: piscina, mascotas, ventanas).',
  'disease_detected': 'Posibles signos de plaga o enfermedad visibles.',
  'none': 'Análisis completado sin observaciones adicionales.'
};

export const PHYTOSANITARY_GROUPED_FIELDS = {
  'Palmeras': [
    { key: 'palmeras_ducha_peq_ud', label: 'Tratamiento preventivo plagas: pequeña', unit: 'ud' },
    { key: 'palmeras_ducha_med_ud', label: 'Tratamiento preventivo plagas: mediana', unit: 'ud' },
    { key: 'palmeras_ducha_alta_ud', label: 'Tratamiento preventivo plagas: alta', unit: 'ud' },
    { key: 'palmeras_cirugia_ud', label: 'Cirugía por plagas', unit: 'ud' },
    { key: 'palmeras_endoterapia_troncos_ud', label: 'Endoterapia preventiva', unit: 'ud' }
  ],
  'Árboles': [
    { key: 'arboles_peq_ud', label: 'Tratamiento estándar: pequeño', unit: 'ud' },
    { key: 'arboles_med_ud', label: 'Tratamiento estándar: mediano', unit: 'ud' },
    { key: 'arboles_gran_ud', label: 'Tratamiento estándar: grande', unit: 'ud' }
  ],
  'Setos': [
    { key: 'seto_bajo_medio_ml', label: 'Tratamiento lineal: bajo/medio', unit: 'ml' },
    { key: 'seto_alto_ml', label: 'Tratamiento lineal: alto', unit: 'ml' }
  ],
  'Césped': [
    { key: 'cesped_m2', label: 'Tratamiento de superficie', unit: 'm²' }
  ],
  'Plantas y Arbustos': [
    { key: 'plantas_superficie_calculada_m2', label: 'Superficie afectada estimada', unit: 'm²' }
  ]
} as const;

export const PHYTOSANITARY_RESULT_FIELDS: Array<{ key: PhytosanitaryMetricKey; label: string; unit: string }> = [
  { key: 'cesped_m2', label: 'Césped', unit: 'm²' },
  { key: 'plantas_superficie_calculada_m2', label: 'Plantas', unit: 'm²' },
  { key: 'seto_bajo_medio_ml', label: 'Seto bajo/medio', unit: 'ml' },
  { key: 'seto_alto_ml', label: 'Seto alto', unit: 'ml' },
  { key: 'palmeras_ducha_peq_ud', label: 'Palmeras ducha pequeñas', unit: 'ud' },
  { key: 'palmeras_ducha_med_ud', label: 'Palmeras ducha medianas', unit: 'ud' },
  { key: 'palmeras_ducha_alta_ud', label: 'Palmeras ducha altas', unit: 'ud' },
  { key: 'palmeras_cirugia_ud', label: 'Palmeras cirugía', unit: 'ud' },
  { key: 'palmeras_endoterapia_troncos_ud', label: 'Palmeras endoterapia troncos', unit: 'ud' },
  { key: 'arboles_peq_ud', label: 'Árboles pequeños', unit: 'ud' },
  { key: 'arboles_med_ud', label: 'Árboles medianos', unit: 'ud' },
  { key: 'arboles_gran_ud', label: 'Árboles grandes', unit: 'ud' }
];

export const PALM_SPECIES = [
  'Phoenix canariensis',
  'Phoenix dactylifera',
  'Washingtonia robusta/filifera',
  'Syagrus romanzoffiana',
  'Trachycarpus fortunei',
  'Roystonea regia'
];

