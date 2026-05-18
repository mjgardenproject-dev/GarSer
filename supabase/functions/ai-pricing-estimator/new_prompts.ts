import type { AnalysisQualityReasonCode, AnalysisService } from '../../../src/shared/analysisV2.ts';

export interface PromptPayload {
  description?: string;
  service_name?: string;
  service_ids?: string[];
  photo_urls?: string[];
  hedge_faces?: {
    face_a_urls: string[];
    face_b_urls?: string[];
  };
  phytosanitary_scopes?: string[];
}

export interface PromptMessageImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'high';
  };
}

export interface PromptMessageTextPart {
  type: 'text';
  text: string;
}

export type PromptMessagePart = PromptMessageTextPart | PromptMessageImagePart;

export interface PromptMessage {
  role: 'system' | 'user';
  content: string | PromptMessagePart[];
}

export interface PromptAssembly {
  service: AnalysisService;
  messages: PromptMessage[];
}

export interface PromptModelSettings {
  temperature: number;
  topP: number;
  topK: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

interface PromptModule {
  service: AnalysisService;
  objective: string[];
  serviceRules: string[];
  outputSchema: string;
  maxImages: number;
  imageMode?: 'default' | 'hedge_faces';
  extraUserInstructions?: (payload: PromptPayload) => string[];
}

const UNIVERSAL_QUALITY_CODES: AnalysisQualityReasonCode[] = [
  'ELEMENT_NOT_FULLY_VISIBLE',
  'LOW_LIGHT',
  'LOW_SHARPNESS',
  'OCCLUSION_PRESENT',
  'PARTIAL_FRAME',
  'AMBIGUOUS_COUNT',
  'AMBIGUOUS_SIZE',
  'ELEMENTS_NOT_DETECTED',
  'CONFLICTING_ANGLES',
  'INSUFFICIENT_COVERAGE',
];

export const DETERMINISTIC_PROMPT_SETTINGS: PromptModelSettings = {
  temperature: 0,
  topP: 1,
  topK: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

const FLEXIBLE_SERVICE_MAP: Record<string, AnalysisService> = {
  cesped: 'Corte de césped',
  césped: 'Corte de césped',
  seto: 'Corte de setos',
  palmera: 'Poda de palmeras',
  arbol: 'Poda de árboles',
  árbol: 'Poda de árboles',
  arbusto: 'Poda de plantas y arbustos',
  plantas: 'Poda de plantas y arbustos',
  desbroce: 'Desbroce de malas hierbas',
  hierbas: 'Desbroce de malas hierbas',
  fitosanit: 'Servicios fitosanitarios',
};

const UNIVERSAL_BACKBONE = [
  'You are a deterministic visual analysis engine for a gardening marketplace.',
  'Return ONLY valid JSON. No markdown. No comments. No prose outside JSON.',
  'Analyze ONLY visible evidence. Never infer hidden surfaces or hidden elements.',
  'Never calculate prices, quotes, or hours.',
  'Use conservative estimates. If evidence is incomplete, lower quality instead of guessing.',
  '',
  'UNIVERSAL QUALITY STANDARD:',
  '- Level 1: full element visibility after combining all photos, clear scale anchors, no material ambiguity.',
  '- Level 2: partial visibility or weak scale references, but a conservative estimate is still possible.',
  '- Level 3: evidence is insufficient for a safe estimate or there is severe conflict across photos.',
  '- If the full target cannot be reconstructed across all photos, the result MUST NOT be level 1.',
  '',
  'MULTI-PHOTO DEDUPLICATION RULES:',
  '- Cross-reference all images before counting or measuring.',
  '- If multiple images show the same element or zone from different angles, count it exactly once.',
  '- Use persistent anchors such as walls, doors, fences, pavements, cars, roofs, pools, and corners to prevent double counting.',
  '- When there is overlap between images, keep the maximum visible extent without summing duplicates.',
  '',
  'REASONING AND CONSISTENCY RULES:',
  '- Include a top-level "razonamiento_transversal" object with these keys: "medicion_principal", "deduplicacion", "calidad", "conflictos".',
  '- In "medicion_principal", explain the main measurement or classification basis using visible evidence only.',
  '- In "deduplicacion", explain how duplicated angles were merged or why there was no duplication risk.',
  '- In "calidad", justify the selected nivel_analisis using the universal quality standard above.',
  '- In "conflictos", describe missing evidence, scale ambiguity, or cross-photo conflicts. Use "ninguno" if none.',
  '',
  'CLIENT OBSERVATION RULES:',
  `- Use ONLY these observation codes when there is a limitation: ${UNIVERSAL_QUALITY_CODES.join(', ')}.`,
  '- For nivel_analisis = 1, observaciones should be [] or null.',
  '- For nivel_analisis = 2, observaciones must contain 1-3 relevant codes.',
  '- For nivel_analisis = 3, observaciones must contain at least one failure code such as ELEMENTS_NOT_DETECTED or INSUFFICIENT_COVERAGE.',
  '- Do not output free-text client observations.',
].join('\n');

function getPhytosanitaryScopes(payload: PromptPayload): string[] {
  if (payload.phytosanitary_scopes && payload.phytosanitary_scopes.length > 0) {
    return payload.phytosanitary_scopes;
  }

  const text = String(payload.description || '').toLowerCase();
  const scopes: string[] = [];
  if (text.includes('palmeras')) scopes.push('palmeras');
  if (text.includes('arboles') || text.includes('árboles')) scopes.push('arboles');
  if (text.includes('setos')) scopes.push('setos');
  if (text.includes('cesped') || text.includes('césped')) scopes.push('cesped');
  if (text.includes('malas hierbas')) scopes.push('quitar malas hierbas');
  if (text.includes('plantas')) scopes.push('plantas');
  return scopes.length > 0 ? scopes : ['todo el jardin'];
}

const PROMPT_MODULES: Record<AnalysisService, PromptModule> = {
  'Corte de césped': {
    service: 'Corte de césped',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Measure visible natural grass area in m2.',
      '- Classify lawn condition as "normal", "descuidado", or "muy descuidado".',
      '- Output a single consolidated task for the lawn area shown across all photos.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Analyze only natural grass that clearly belongs to the service scope.',
      '- Use reference objects such as doors, cars, fences, and tiles to estimate scale.',
      '- "normal": maintained lawn with clear edges and low height.',
      '- "descuidado": partial overgrowth, uneven height, visible edge invasion.',
      '- "muy descuidado": strong overgrowth, undefined edges, or vegetation that suggests heavy pre-cut work.',
      '- If nivel_analisis = 3, superficie_m2 MUST be 0 and estado_jardin MUST be null.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "tareas": [',
      '    {',
      '      "tipo_servicio": "Corte de césped",',
      '      "estado_jardin": "normal" | "descuidado" | "muy descuidado" | null,',
      '      "superficie_m2": number,',
      '      "numero_plantas": null,',
      '      "tamaño_plantas": null,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Corte de setos': {
    service: 'Corte de setos',
    maxImages: 4,
    imageMode: 'hedge_faces',
    objective: [
      'OBJECTIVE:',
      '- Analyze one hedge zone that may include FACE_A and optional FACE_B.',
      '- Measure base length and base height, then preserve the consolidated calculation summary used by business logic.',
      '- Return one root task with face detail and summary fields.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Gross height must include any wall, planter, or structure that the gardener must reach from ground level.',
      '- If the hedge turns corners, sum visible sections into the same hedge entity.',
      '- If both faces are reliable, use their average for base measurements. Otherwise use the most reliable face.',
      '- tipo_seto must be "0-2m", "2-4m", or "4-6m".',
      '- estado_seto must be "normal", "media", or "alta".',
      '- If nivel_analisis = 3, keep all measurable fields at 0 or null and propagate failure observations to root and visible faces.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "tareas": [',
      '    {',
      '      "tipo_servicio": "Corte de setos",',
      '      "longitud_m": number,',
      '      "altura_m": number,',
      '      "tipo_seto": "0-2m" | "2-4m" | "4-6m" | null,',
      '      "estado_seto": "normal" | "media" | "alta" | null,',
      '      "caras": 1 | 2,',
      '      "detalle_caras": {',
      '        "cara_a": { "longitud_m": number, "altura_m": number, "nivel_analisis": 1 | 2 | 3, "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] },',
      '        "cara_b": { "longitud_m": number, "altura_m": number, "nivel_analisis": 1 | 2 | 3, "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] }',
      '      },',
      '      "resumen_medicion": {',
      '        "base_longitud_m": number,',
      '        "base_altura_m": number,',
      '        "caras_recortar": 1 | 2,',
      '        "longitud_calculo_m": number,',
      '        "altura_calculo_m": number,',
      '        "metodo": "media_caras" | "cara_mas_fiable"',
      '      },',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"]',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Poda de palmeras': {
    service: 'Poda de palmeras',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Detect distinct palms that actually belong to the pruning job.',
      '- Return one JSON object per distinct palm after deduplicating repeated angles.',
      '- Measure trunk height only, up to the base of the crown, and classify maintenance state.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Ignore broadleaf trees, shrubs, forests in the background, and any non-palm vegetation.',
      '- Allowed species list: "Phoenix canariensis", "Phoenix dactylifera", "Washingtonia robusta/filifera", "Syagrus romanzoffiana", "Trachycarpus fortunei", "Roystonea regia".',
      '- If the palm resembles one of those species but is not exact, append " o similar".',
      '- estado must be exactly "normal", "descuidado", or "muy descuidado".',
      '- If no valid palm is visible, return "palmas": [] or entries with nivel_analisis = 3 only when there is actual failed evidence.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "palmas": [',
      '    {',
      '      "indice_imagen": integer,',
      '      "especie": "string",',
      '      "altura_m": number,',
      '      "estado": "normal" | "descuidado" | "muy descuidado" | null,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
    extraUserInstructions: () => [
      'Each output item must represent one distinct palm.',
      'Use the image index where the palm is most clearly visible.',
    ],
  },
  'Poda de árboles': {
    service: 'Poda de árboles',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Analyze the main tree of the zone and classify it into a size_band for pricing.',
      '- Do not classify pruning type or calculate work hours.',
      '- Return a single consolidated tree result unless there are clearly multiple target trees requested in the same service context.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Focus on the main tree closest to the job context when several trees are visible.',
      '- size_band must be exactly "small", "medium", "large", or "over_9".',
      '- dificultad_alta must remain false because business logic does not depend on AI difficulty here.',
      '- If evidence is insufficient, return nivel_analisis = 3 with size_band = "small" only as a safe fallback and add failure observation codes.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "arboles": [',
      '    {',
      '      "indice_imagen": integer,',
      '      "size_band": "small" | "medium" | "large" | "over_9",',
      '      "dificultad_alta": false,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Poda de plantas y arbustos': {
    service: 'Poda de plantas y arbustos',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Estimate the pruning footprint area of shrub and ornamental masses using the outer contour of each continuous bed.',
      '- Deduplicate repeated angles and consolidate all visible masses into a single pruning surface for the service zone.',
      '- Classify dominant size as "pequeñas", "medianas", or "grandes".',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Include shrubs, bushes, roses, ornamental masses, climbing ornamentals, and large succulents.',
      '- Exclude lawn, trees, and linear hedge trimming.',
      '- Use brute bed area policy: include internal natural gaps of the same bed, exclude paths, pavements, and detached non-target islands.',
      '- If nivel_analisis = 3, superficie_m2 MUST be 0 and tamano_dominante MUST be null.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "tareas": [',
      '    {',
      '      "tipo_servicio": "Poda de plantas y arbustos",',
      '      "razonamiento_cot": {',
      '        "identificacion_escalas": "string",',
      '        "calculo_area_plantas": "string",',
      '        "deduplicacion_multifoto": "string"',
      '      },',
      '      "superficie_m2": number,',
      '      "tamano_dominante": "pequeñas" | "medianas" | "grandes" | null,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null,',
      '      "indices_imagenes": [integer]',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Desbroce de malas hierbas': {
    service: 'Desbroce de malas hierbas',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Measure consolidated visible weed-clearing area in m2.',
      '- Classify weed-clearing state as "normal", "dificultad_media", or "dificultad_alta".',
      '- Return a single consolidated task for the visible weed zone.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- "normal": low and soft weeds with low density.',
      '- "dificultad_media": medium or tall non-woody weeds with medium/high density.',
      '- "dificultad_alta": woody brush, cane-like stems, or very dense/tall mass requiring heavy work.',
      '- If nivel_analisis = 3, superficie_malas_hierbas_m2 MUST be 0 and estado_malas_hierbas MUST be null.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "tareas": [',
      '    {',
      '      "tipo_servicio": "Desbroce de malas hierbas",',
      '      "estado_malas_hierbas": "normal" | "dificultad_media" | "dificultad_alta" | null,',
      '      "superficie_malas_hierbas_m2": number,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Servicios fitosanitarios': {
    service: 'Servicios fitosanitarios',
    maxImages: 6,
    objective: [
      'OBJECTIVE:',
      '- Quantify visible vegetation only inside the requested phytosanitary scope.',
      '- Deduplicate repeated angles and output only the canonical phytosanitary metrics consumed by pricing.',
      '- Do not diagnose hidden pests or invent hidden affected area.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Respect the requested scope strictly. Anything outside scope must be reported as 0.',
      '- For plants beds, use brute bed area policy and return "plantas_superficie_calculada_m2".',
      '- Tree counts must ignore trees shorter than 2m.',
      '- Palm surgery is only allowed when severe crown collapse or trunk holes are visible.',
      '- Return "observaciones_ia" using the same universal observation codes, not free text.',
    ],
    outputSchema: [
      '{',
      '  "razonamiento_transversal": {',
      '    "medicion_principal": "string",',
      '    "deduplicacion": "string",',
      '    "calidad": "string",',
      '    "conflictos": "string"',
      '  },',
      '  "metricas_fitosanitarias": {',
      '    "cesped_m2": number,',
      '    "seto_bajo_medio_ml": number,',
      '    "seto_alto_ml": number,',
      '    "palmeras_ducha_peq_ud": number,',
      '    "palmeras_ducha_med_ud": number,',
      '    "palmeras_ducha_alta_ud": number,',
      '    "palmeras_cirugia_ud": number,',
      '    "arboles_peq_ud": number,',
      '    "arboles_med_ud": number,',
      '    "arboles_gran_ud": number,',
      '    "herbicida_poca_densidad_m2": number,',
      '    "herbicida_mucha_densidad_m2": number,',
      '    "plantas_superficie_calculada_m2": number,',
      '    "plantas_tamano_dominante": "pequenas" | "medianas" | "grandes" | null',
      '  },',
      '  "observaciones_ia": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"]',
      '}',
    ].join('\n'),
    extraUserInstructions: (payload) => {
      const scopes = getPhytosanitaryScopes(payload);
      return [
        `Requested scope: ${scopes.join(', ')}.`,
        'Any metric outside the requested scope must be 0 even if visible in the images.',
      ];
    },
  },
};

export function resolveAnalysisServiceName(serviceName?: string): AnalysisService {
  const normalized = String(serviceName || '').trim();
  if (PROMPT_MODULES[normalized as AnalysisService]) {
    return normalized as AnalysisService;
  }

  const lower = normalized.toLowerCase();
  for (const [key, value] of Object.entries(FLEXIBLE_SERVICE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return 'Corte de césped';
}

function buildSystemPrompt(module: PromptModule): string {
  return [
    UNIVERSAL_BACKBONE,
    '',
    ...module.objective,
    '',
    ...module.serviceRules,
    '',
    'STRICT OUTPUT SCHEMA:',
    module.outputSchema,
  ].join('\n');
}

function buildDefaultUserContent(payload: PromptPayload, module: PromptModule): PromptMessagePart[] {
  const content: PromptMessagePart[] = [
    {
      type: 'text',
      text: `Customer notes: ${String(payload.description || '').trim() || 'none'}`,
    },
    {
      type: 'text',
      text: `Service under analysis: ${module.service}`,
    },
  ];

  const extraInstructions = module.extraUserInstructions ? module.extraUserInstructions(payload) : [];
  if (extraInstructions.length > 0) {
    content.push({
      type: 'text',
      text: `Additional instructions: ${extraInstructions.join(' ')}`,
    });
  }

  if (module.imageMode === 'hedge_faces') {
    const faceAUrls = (payload.hedge_faces?.face_a_urls || []).filter(Boolean).slice(0, module.maxImages);
    const faceBUrls = (payload.hedge_faces?.face_b_urls || []).filter(Boolean).slice(0, module.maxImages);
    content.push({
      type: 'text',
      text: 'All images belong to the same hedge zone. FACE_A is the front side and FACE_B is the optional back side.',
    });
    if (faceAUrls.length > 0) {
      content.push({ type: 'text', text: 'FACE_A:' });
      faceAUrls.forEach((url, index) => {
        content.push({ type: 'text', text: `FACE_A image ${index}:` });
        content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
      });
    }
    if (faceBUrls.length > 0) {
      content.push({ type: 'text', text: 'FACE_B:' });
      faceBUrls.forEach((url, index) => {
        content.push({ type: 'text', text: `FACE_B image ${index}:` });
        content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
      });
    }
    if (faceAUrls.length === 0 && faceBUrls.length === 0) {
      (payload.photo_urls || []).filter(Boolean).slice(0, module.maxImages).forEach((url, index) => {
        content.push({ type: 'text', text: `Image ${index}:` });
        content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
      });
    }
    return content;
  }

  const photoUrls = (payload.photo_urls || []).filter(Boolean).slice(0, module.maxImages);
  if (photoUrls.length > 1) {
    content.push({
      type: 'text',
      text: 'All images belong to the same service context. Deduplicate repeated angles before measuring.',
    });
  }
  photoUrls.forEach((url, index) => {
    content.push({ type: 'text', text: `Image ${index}:` });
    content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
  });
  return content;
}

export function buildAnalysisPromptAssembly(payload: PromptPayload): PromptAssembly {
  const service = resolveAnalysisServiceName(payload.service_name);
  const module = PROMPT_MODULES[service];
  return {
    service,
    messages: [
      { role: 'system', content: buildSystemPrompt(module) },
      { role: 'user', content: buildDefaultUserContent(payload, module) },
    ],
  };
}

export function buildAutoQuotePromptAssembly(input: {
  service: string;
  image_url: string;
  description?: string;
}): PromptAssembly {
  return buildAnalysisPromptAssembly({
    service_name: input.service,
    description: input.description,
    photo_urls: [input.image_url],
  });
}
