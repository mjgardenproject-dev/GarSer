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
  seto: 'Poda de setos',
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
      '',
      'PROCEDURE (follow in order):',
      '1. Cross-reference all photos and deduplicate repeated angles using persistent anchors (walls, paths, trees, pools, furniture).',
      '2. Locate scale references near the lawn: person ~1.70 m, standard door ~2.0 m, garden fence ~1.2 m, car ~4.5 m long, patio tile ~0.4 m. Record the reference used in "referencia_escala".',
      '3. Measure the total grass area (m2) following the lawn outline. Exclude paths, terraces, beds and pools. If several separate lawn patches belong to the same garden, sum them.',
      '4. Classify estado_jardin using the definitions below.',
      '5. Assign per-field confidence using the calibration below.',
      '',
      'STATE DEFINITIONS (observable criteria):',
      '- "normal": maintained lawn, grass below ~10 cm, clear edges.',
      '- "descuidado": grass ~10-25 cm, uneven height, edges invading paths or beds.',
      '- "muy descuidado": grass above ~25 cm, undefined edges, seed heads or mixed weeds suggesting heavy pre-cut work.',
      '- estado_jardin must be exactly "normal", "descuidado" or "muy descuidado". If grass height is not assessable, use null and lower estado_confidence.',
      '',
      'PLAUSIBLE AREA RANGE:',
      '- Residential lawns measure between 1 and 2000 m2. If your estimate exceeds 2000 m2, set nivel_analisis to 2 or 3 and add "AMBIGUOUS_SIZE" to observaciones instead of forcing the value.',
      '',
      'CONFIDENCE CALIBRATION (applies to superficie_confidence and estado_confidence):',
      '- 0.9-1.0: directly measurable in sharp photos with a clear scale reference and the full lawn visible.',
      '- 0.6-0.89: inferred with partial support (no clear scale reference, lawn partially cropped).',
      '- Below 0.6: weak assumption; the system will ask the client to confirm this field.',
      '- Without a scale reference, superficie_confidence MUST be below 0.9.',
      '',
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
      '      "estado_confidence": number,',
      '      "superficie_m2": number,',
      '      "superficie_confidence": number,',
      '      "referencia_escala": "string" | null,',
      '      "numero_plantas": null,',
      '      "tamaño_plantas": null,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
  },
  'Poda de setos': {
    service: 'Poda de setos',
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
      '',
      'PROCEDURE (follow in order):',
      '1. Photos arrive labeled FACE_A (front, mandatory) and FACE_B (back, optional). Analyze each face separately, then consolidate into the root task.',
      '2. Locate scale references near the hedge: person ~1.70 m, standard door ~2.0 m, garden fence ~1.2 m, wheelie bin ~1.0 m, patio tile ~0.4 m. Record the reference used in "referencia_escala".',
      '3. Measure base LENGTH (m) and base HEIGHT (m, from the ground the gardener stands on to the top of the hedge) per face using the scale reference. If the hedge continues beyond the frame, add PARTIAL_FRAME and lower longitud_confidence.',
      '4. Classify tipo_seto from the base height: "0-2m", "2-4m" or "4-6m". If the height is within ~20 cm of a band boundary (2 m or 4 m), altura_confidence MUST be below 0.8.',
      '5. Classify estado_seto using the definitions below (use the closest views of the foliage).',
      '6. Assign per-field confidence using the calibration below.',
      '',
      'STATE DEFINITIONS (observable criteria):',
      '- "normal": reasonably even surface; shoots protrude less than ~10 cm from the hedge volume.',
      '- "media": shoots protrude ~10-50 cm; shape recognizable but irregular; edges invading paths or lawn.',
      '- "alta": shoots protrude more than ~50 cm, visible gaps or dead wood, or the hedge is invaded by climbing weeds/brambles.',
      '- estado_seto must be exactly "normal", "media" or "alta". If foliage detail is not visible enough, use null and lower estado_confidence.',
      '',
      'PLAUSIBLE RANGES:',
      '- Height: 0.3-8 m. Length: 1-200 m. If your estimate falls outside, set nivel_analisis to 2 or 3 and add "AMBIGUOUS_SIZE" to observaciones instead of forcing the value.',
      '',
      'CONFIDENCE CALIBRATION (applies to longitud_confidence, altura_confidence, estado_confidence):',
      '- 0.9-1.0: directly measurable in sharp photos with a clear scale reference and the full hedge in frame.',
      '- 0.6-0.89: inferred with partial support (no clear scale reference, hedge partially cropped, oblique angle).',
      '- Below 0.6: weak assumption; the system will ask the client to confirm this field.',
      '- Without a scale reference, longitud_confidence and altura_confidence MUST be below 0.9.',
      '',
      '- tipo_seto must be "0-2m", "2-4m", or "4-6m".',
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
      '      "tipo_servicio": "Poda de setos",',
      '      "longitud_m": number,',
      '      "longitud_confidence": number,',
      '      "altura_m": number,',
      '      "altura_confidence": number,',
      '      "referencia_escala": "string" | null,',
      '      "tipo_seto": "0-2m" | "2-4m" | "4-6m" | null,',
      '      "estado_seto": "normal" | "media" | "alta" | null,',
      '      "estado_confidence": number,',
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
      '- For each palm: measure TRUNK height, identify species, classify maintenance state, and report a calibrated confidence per field.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Ignore broadleaf trees, shrubs, forests in the background, and any non-palm vegetation.',
      '- Ignore palms that are clearly outside the property (street palms, neighbor gardens) unless they are the obvious subject of the photos.',
      '',
      'PROCEDURE (follow in order for each photo set):',
      '1. Count distinct palms across ALL photos using persistent anchors (walls, doors, fences, pools). The same palm seen from two angles is ONE palm.',
      '2. Locate scale references near each palm: person ~1.70 m, standard door ~2.0 m, single house floor ~2.8-3.0 m, garden fence ~1.2 m, wheelie bin ~1.0 m, car ~1.5 m tall. Record the reference used in "referencia_escala".',
      '3. Measure TRUNK height in meters: from ground level to the BASE of the crown (where the lowest living fronds emerge). EXCLUDE the fronds/crown from the measurement.',
      '4. Identify the species using the traits below.',
      '5. Classify maintenance state using the operational definitions below.',
      '6. Assign per-field confidence using the calibration below.',
      '',
      'SPECIES IDENTIFICATION TRAITS (allowed list, use EXACTLY these names):',
      '- "Phoenix canariensis": very thick trunk (pineapple-like diamond pattern), huge dense crown of arched pinnate (feather) leaves.',
      '- "Phoenix dactylifera": slimmer trunk than canariensis, grey-blue pinnate leaves, often basal suckers, sparser upright crown.',
      '- "Washingtonia robusta/filifera": very tall slender trunk, fan-shaped (palmate) leaves, frequent skirt of dry hanging leaves under the crown.',
      '- "Syagrus romanzoffiana": smooth grey ringed trunk, soft feathery arching fronds (queen palm).',
      '- "Trachycarpus fortunei": short-to-medium trunk covered in brown fiber/hair, small fan-shaped leaves.',
      '- "Roystonea regia": smooth light-grey columnar trunk, green crownshaft below the fronds (royal palm).',
      '- If the palm resembles one of those species but you are not certain, append " o similar" (e.g. "Washingtonia robusta/filifera o similar").',
      '- NEVER invent a species outside the list. If it matches none, use the closest one with " o similar" and especie_confidence <= 0.5.',
      '',
      'MAINTENANCE STATE DEFINITIONS (observable criteria):',
      '- "normal": green crown, at most a few isolated dry fronds (<15% of the crown), no skirt of dead fronds on the trunk, no hanging fruit stalks.',
      '- "descuidado": visible ring of dry/hanging fronds under the crown covering up to ~1 m of trunk, OR abundant fruit/flower stalks (dates), OR clearly 2+ seasons without pruning.',
      '- "muy descuidado": dense skirt of dead fronds longer than ~1 m down the trunk, dry material dominating the crown, or partial crown collapse.',
      '- estado must be exactly "normal", "descuidado", or "muy descuidado". If the crown is not visible enough to judge, use null and lower the confidence.',
      '',
      'PLAUSIBLE TRUNK HEIGHT RANGES (meters, per species):',
      '- Phoenix canariensis: 0.5-20. Phoenix dactylifera: 0.5-25. Washingtonia robusta/filifera: 0.5-30.',
      '- Syagrus romanzoffiana: 0.5-20. Roystonea regia: 0.5-25. Trachycarpus fortunei: 0.5-12.',
      '- If your estimate falls outside the range for the species, set nivel_analisis to 2 or 3 and add "AMBIGUOUS_SIZE" to observaciones instead of forcing the value.',
      '',
      'CONFIDENCE CALIBRATION (applies to especie_confidence, altura_confidence, estado_confidence):',
      '- 0.9-1.0: directly visible in a sharp photo with a clear scale reference (for height) or unmistakable traits (for species/state).',
      '- 0.6-0.89: inferred with partial support (no clear scale reference, suboptimal angle, crown partially cropped).',
      '- Below 0.6: weak assumption; the system will ask the client to confirm this field.',
      '- Do NOT default everything to high confidence. If there is no scale reference, altura_confidence MUST be below 0.9.',
      '',
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
      '      "especie_confidence": number,',
      '      "altura_m": number,',
      '      "altura_confidence": number,',
      '      "referencia_escala": "string" | null,',
      '      "estado": "normal" | "descuidado" | "muy descuidado" | null,',
      '      "estado_confidence": number,',
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
      '- Detect the distinct target trees of the pruning job after deduplicating repeated angles.',
      '- For each tree: estimate TOTAL height, classify it into a size_band for pricing, and report calibrated confidence.',
      '- Do not classify pruning type or calculate work hours.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Analyze trees only: ignore palms, hedges, shrubs, climbing plants and background forests outside the property.',
      '- The first item in "arboles" must be the main tree of the job (the most prominent/closest to the job context). Additional distinct target trees follow as separate items.',
      '',
      'PROCEDURE (follow in order):',
      '1. Count distinct target trees across ALL photos using persistent anchors (walls, roofs, fences, pavements). The same tree seen from two angles is ONE tree.',
      '2. Locate scale references near each tree: person ~1.70 m, standard door ~2.0 m, single house floor ~2.8-3.0 m, garden fence ~1.2 m, car ~1.5 m tall. Record the reference used in "referencia_escala".',
      '3. Estimate TOTAL height in meters: from ground level to the top of the crown (unlike palms, the crown IS included).',
      '4. Classify size_band using the definitions below.',
      '5. Assign per-field confidence using the calibration below.',
      '',
      'SIZE BAND DEFINITIONS (total tree height):',
      '- "small": less than 3 m (reachable from the ground or a small ladder; roughly up to the height of a ground-floor roof).',
      '- "medium": 3 to less than 5 m (clearly taller than a person on a ladder; around a one-story house with roof).',
      '- "large": 5 to less than 9 m (around two stories; requires elevation equipment).',
      '- "over_9": 9 m or more (above two stories; complex high-risk work).',
      '- If the estimated height is within ±0.5 m of a band boundary, choose the band that matches your height estimate and lower size_band_confidence below 0.8.',
      '',
      'PLAUSIBLE HEIGHT RANGE:',
      '- Residential target trees measure between 1 and 40 m. If your estimate falls outside, set nivel_analisis to 2 or 3 and add "AMBIGUOUS_SIZE" to observaciones instead of forcing the value.',
      '',
      'CONFIDENCE CALIBRATION (applies to size_band_confidence and altura_confidence):',
      '- 0.9-1.0: directly measurable in a sharp photo with a clear scale reference and the full tree in frame.',
      '- 0.6-0.89: inferred with partial support (no clear scale reference, crown or base partially cropped).',
      '- Below 0.6: weak assumption; the system will ask the client to confirm this field.',
      '- Without a scale reference, altura_confidence MUST be below 0.9.',
      '',
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
      '      "altura_m": number,',
      '      "altura_confidence": number,',
      '      "referencia_escala": "string" | null,',
      '      "size_band": "small" | "medium" | "large" | "over_9",',
      '      "size_band_confidence": number,',
      '      "dificultad_alta": false,',
      '      "nivel_analisis": 1 | 2 | 3,',
      '      "observaciones": ["ELEMENT_NOT_FULLY_VISIBLE" | "LOW_LIGHT" | "LOW_SHARPNESS" | "OCCLUSION_PRESENT" | "PARTIAL_FRAME" | "AMBIGUOUS_COUNT" | "AMBIGUOUS_SIZE" | "ELEMENTS_NOT_DETECTED" | "CONFLICTING_ANGLES" | "INSUFFICIENT_COVERAGE"] | null',
      '    }',
      '  ]',
      '}',
    ].join('\n'),
    extraUserInstructions: () => [
      'Each output item must represent one distinct target tree.',
      'Use the image index where the tree is most clearly visible.',
    ],
  },
  'Poda de plantas y arbustos': {
    service: 'Poda de plantas y arbustos',
    maxImages: 5,
    objective: [
      'OBJECTIVE:',
      '- Estimate the pruning footprint area of shrub and ornamental masses using the outer contour of each continuous bed.',
      '- Deduplicate repeated angles and consolidate all visible masses into a single pruning surface for the service zone.',
      '- Classify dominant size, maintenance state, and report calibrated confidence per field.',
    ],
    serviceRules: [
      'SERVICE RULES:',
      '- Include shrubs, bushes, roses, ornamental masses, climbing ornamentals, and large succulents.',
      '- Exclude lawn, trees, and linear hedge trimming.',
      '',
      'PROCEDURE (follow in order):',
      '1. Cross-reference all photos and deduplicate repeated angles using persistent anchors (walls, paths, fences, pots).',
      '2. Locate scale references near the beds: person ~1.70 m, standard door ~2.0 m, garden fence ~1.2 m, wheelie bin ~1.0 m, patio tile ~0.4 m. Record the reference used in "referencia_escala".',
      '3. Measure the footprint area (m2) of each continuous bed using its outer contour, then sum the beds. Use brute bed area policy: include internal natural gaps of the same bed, exclude paths, pavements, and detached non-target islands.',
      '4. Classify dominant size and maintenance state using the definitions below.',
      '5. Assign per-field confidence using the calibration below.',
      '',
      'DOMINANT SIZE DEFINITIONS (height of most of the mass):',
      '- "pequeñas": low plants and compact shrubs below knee height (~0.5 m).',
      '- "medianas": shrubs up to waist/chest height (~0.5-1.4 m).',
      '- "grandes": voluminous masses above head height (~1.8 m or more).',
      '',
      'MAINTENANCE STATE DEFINITIONS (observable criteria):',
      '- "normal": defined shapes, shoots protruding less than ~10 cm from the mass volume, no dead wood visible.',
      '- "descuidado": shoots protruding ~10-50 cm, irregular but recognizable shapes, edges invading paths or lawn.',
      '- "muy descuidado": shoots protruding more than ~50 cm, shapes lost, visible dead wood, or masses invaded by weeds/brambles.',
      '- estado_plantas must be exactly "normal", "descuidado" or "muy descuidado". If foliage detail is not visible enough, use null and lower the confidence.',
      '',
      'PLAUSIBLE AREA RANGE:',
      '- Residential shrub beds measure between 1 and 500 m2. If your estimate exceeds 500 m2, set nivel_analisis to 2 or 3 and add "AMBIGUOUS_SIZE" to observaciones instead of forcing the value.',
      '',
      'CONFIDENCE CALIBRATION (applies to superficie_confidence, tamano_confidence, estado_confidence):',
      '- 0.9-1.0: directly measurable in sharp photos with a clear scale reference and full bed visibility.',
      '- 0.6-0.89: inferred with partial support (no clear scale reference, beds partially cropped).',
      '- Below 0.6: weak assumption; the system will ask the client to confirm this field.',
      '- Without a scale reference, superficie_confidence MUST be below 0.9.',
      '',
      '- If nivel_analisis = 3, superficie_m2 MUST be 0, tamano_dominante MUST be null and estado_plantas MUST be null.',
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
      '      "superficie_confidence": number,',
      '      "referencia_escala": "string" | null,',
      '      "tamano_dominante": "pequeñas" | "medianas" | "grandes" | null,',
      '      "tamano_confidence": number,',
      '      "estado_plantas": "normal" | "descuidado" | "muy descuidado" | null,',
      '      "estado_confidence": number,',
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
