// Supabase Edge Function: IA de estimación y auto‑presupuesto
// Requiere configurar el secreto OPENAI_API_KEY
declare const Deno: any;
import * as cfg from './config.ts';

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
  // Nuevo modo de auto‑presupuesto por servicio
  mode?: 'auto_quote' | 'calculate_palm_pricing' | 'weeding_prompt_quality_check';
  service?: string; // nombre exacto del servicio
  image_url?: string; // http(s) o dataURL
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash';
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

function buildPhytosanitarySystemPrompt(payload: Payload) {
  const scopes = getPhytosanitaryScope(payload);
  const scopeStr = scopes.join(', ').toUpperCase();

  const systemPrompt = [
    'You are a strict, deterministic vision-analysis engine for a gardening marketplace specializing in phytosanitary treatments.',
    'Your ONLY goal is to quantify visible vegetation into specific UI buckets based on scale references. DO NOT guess hidden areas.',
    '',
    `### CRITICAL SCOPE RESTRICTION ###`,
    `The user has explicitly restricted the analysis to: [${scopeStr}].`,
    `You MUST ONLY analyze and count elements that belong to this scope.`,
    `Any other element outside this scope MUST BE STRICTLY 0, even if it is clearly visible in the image.`,
  ];

  systemPrompt.push(
    '',
    '### MANDATORY CHAIN OF THOUGHT (CoT) ###',
    'You must populate the "razonamiento_cot" object FIRST:',
    '1. "identificacion_escalas": Identify visual anchors (doors ~2m, fences ~2m).',
    '2. "analisis_deduplicacion": Explain how you ensure elements across multiple photos are counted only once.',
    '',
    '### EXACT BUSINESS THRESHOLDS (MATCH UI STRICLY) ###',
    'Aggregate counts/measurements into these exact keys in "metricas_fitosanitarias":',
    '- HEDGES (ml): "seto_bajo_medio_ml" (< 2.5m) vs "seto_alto_ml" (2.5m - 5m).',
    '- TREES (units): CRITICAL RULE: Ignore ANY tree shorter than 2 meters. Trees < 2m must be considered "Plantas" and excluded from the tree count. Categorize STRICTLY by height: Between 2m and 4m = "arboles_peq_ud". Between 4m and 6m = "arboles_med_ud". > 6m = "arboles_gran_ud". Use reference objects (doors, fences) to calculate height accurately.',
    '- PALMS (units): "palmeras_ducha_peq_ud" (< 3.5m), "palmeras_ducha_med_ud" (3.5m - 8m), "palmeras_ducha_alta_ud" (> 8m).',
    '- PALM SURGERY: "palmeras_cirugia_ud" (Count ONLY if severe crown collapse or trunk holes are visible. Otherwise 0).',
    '- SURFACES (m2): "cesped_m2" (Lawn).',
    '',
    '### OUTPUT RULES ###',
    '1. Return ONLY valid JSON.',
    '2. "observaciones_ia" should only contain operational risks in Spanish. No pest diagnoses.',
    '3. If a category is not present in the images or not requested in the scope, output 0.',
    '',
    '### JSON SCHEMA ###',
    '{',
    '  "razonamiento_cot": {',
    '    "identificacion_escalas": "string",',
    '    "analisis_deduplicacion": "string",',
    '    "evaluacion_riesgos_acceso": "string"',
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
    '    "porcentaje_superficie_plantas": number,',
    '    "plantas_tamano_dominante": "pequenas" | "medianas" | "grandes" | null',
    '  },',
    '  "observaciones_ia": ["string"]',
    '}'
  );

  return systemPrompt.join('\n');
}

function buildPhytosanitaryUserContent(payload: Payload) {
  const { photo_urls = [], description, phytosanitary_scopes = [] } = payload;
  const scopes = getPhytosanitaryScope(payload);
  
  // Custom instructions based on scope
  const instructions = ['INSTRUCTIONS: 1. Identify scale anchors. 2. Map objects to landmarks for deduplication. 3. Assess spraying risks. 4. Output JSON.'];
  
  if (phytosanitary_scopes.includes('plantas') || phytosanitary_scopes.includes('todo_jardin')) {
    instructions.push('CRITICAL FOR PLANTAS: "Plantas bajas" includes shrubs, bushes, flowers, AND small trees under 2 meters. You MUST analyze the images and extract two specific values for plants:');
    instructions.push('1) "porcentaje_superficie_plantas": A strict number representing the percentage of the total garden area covered by these plants. You MUST round to one of these exact values: 5, 10, 25, 50, 75, or 100.');
    instructions.push('2) "plantas_tamano_dominante": A strict string representing the average height of these plants. MUST be exactly one of: "pequenas" (<0.5m), "medianas" (0.5-1.5m), or "grandes" (1.5-2m). Small trees (<2m) must be classified into these ranges based on their actual height.');
  }

  const userContent: any[] = [
    { type: 'text', text: `Customer notes: ${String(description || '').trim() || 'none'}` },
    { type: 'text', text: `Scope: ${scopes.join(', ')}` },
    { type: 'text', text: instructions.join(' ') },
  ];
  photo_urls.slice(0, 6).forEach((url, idx) => {
    userContent.push({ type: 'text', text: `--- Image Index ${idx} ---` });
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  });
  return userContent;
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
    filtered.porcentaje_superficie_plantas = 0;
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
const SPECIES_RANGES: Record<string, string[]> = {
  'Phoenix canariensis': ['0-4', '4-10', '>10'],
  'Phoenix dactylifera': ['0-5', '5-10', '10-15', '>15'],
  'Washingtonia robusta/filifera': ['0-4', '4-12', '12-20', '>20'],
  'Syagrus romanzoffiana': ['0-5', '5-10', '>10'],
  'Trachycarpus fortunei': ['0-3', '3-6', '>6'],
  'Roystonea regia': ['0-6', '>6']
};

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

// Mapeo de System Prompts por servicio (estrictamente detallados)
const PROMPTS: Record<string, string> = {
  'Desbroce de malas hierbas': [
    `---
You are "DesbroceVision", a deterministic visual analysis engine for a gardening marketplace.
Your responsibility is to extract repeatable and auditable measurements for the service "Desbroce de malas hierbas".

GLOBAL CONSTRAINTS (MANDATORY):
1) Return ONLY valid JSON. No markdown, no explanations outside JSON.
2) Analyze ONLY visible evidence. Never infer hidden surfaces.
3) Never calculate prices.
4) If uncertainty is high, downgrade reliability level instead of guessing.

MULTI-PHOTO DEDUPLICATION & SINGLE-ZONE CONSOLIDATION (CRITICAL):
- Carefully cross-reference all images. If multiple images show the same weed area from different angles, merge them into one single consolidated entity.
- Only count distinct weed zones clearly in focus for clearing. Do NOT count the same zone multiple times.
- For consolidation, use common spatial anchors (fence, door, car, curb, house wall) to verify it's the same area.
- EXPLICITLY PROHIBIT: Adding m2 from different images of the same zone. Always produce ONE consolidated estimate per unique weed zone.
- If images show overlapping views of the same area, take the maximum visible extent without double-counting.
- Output MUST be a single task object representing the consolidated zone.

SERVICE CONTEXT:
- tipo_servicio fixed value: "Desbroce de malas hierbas"
- objective fields: superficie_malas_hierbas_m2, estado_malas_hierbas, nivel_analisis, observaciones.

STEP-BY-STEP DECISION POLICY (OUTPUT-ORIENTED):
Step A: Detect visible scale anchors (door ~2m tall, car ~4.5m long, fence modules, paving tiles).
Step B: Delimit only visible weeded polygons that require clearing.
Step C: Estimate visible total area (m2) and round to the nearest integer.
Step D: Classify weed condition using strict thresholds below.
Step E: Assign reliability level based on visibility quality and evidence.

CLASSIFICATION THRESHOLDS (QUANTIFIABLE):
A) estado_malas_hierbas
- "normal": dominant height <30cm, soft stems, low density.
- "dificultad_media": dominant height >=30cm with medium/high density and mostly non-woody stems.
- "dificultad_alta": clear woody stems/brush (zarzas, cañas leñosas) OR very dense/tall mass requiring heavy blade work.

B) nivel_analisis
- 1 (alta confianza): area boundaries clear + scale references clear + lighting adequate.
- 2 (confianza media): partial boundaries OR weak scale references OR partial occlusion/shadows.
- 3 (fallo): no measurable weed area (blur, darkness, obstruction, non-detectable weeds).

OBSERVACIONES CONTROLLED VOCABULARY (ONLY THESE):
- For nivel_analisis=2: "mala luz", "zonas no visibles", "foto de baja calidad", "pocas referencias de escala", "ángulo limitado".
- For nivel_analisis=3: "muy mala luz", "foto extremadamente borrosa", "malas hierbas no detectables", "imagen obstruida".

OUTPUT CONSISTENCY RULES:
- If nivel_analisis = 3:
  - superficie_malas_hierbas_m2 MUST be 0
  - estado_malas_hierbas MUST be null
  - observaciones MUST be non-empty array (allowed vocabulary)
- If nivel_analisis in (1,2):
  - superficie_malas_hierbas_m2 MUST be an integer >= 0
  - estado_malas_hierbas MUST be one of: normal, dificultad_media, dificultad_alta

FEW-SHOT EXAMPLES (FORMAT REFERENCE):
Example 1 (clear scene):
INPUT SUMMARY: visible weed patch with clear fence modules and a parked car; weeds around 20cm.
OUTPUT:
{
  "tareas": [{
    "tipo_servicio": "Desbroce de malas hierbas",
    "estado_malas_hierbas": "normal",
    "superficie_malas_hierbas_m2": 35,
    "nivel_analisis": 1,
    "observaciones": null
  }]
}

Example 2 (partial visibility):
INPUT SUMMARY: only part of the lot is visible, heavy shadows, tall dense non-woody weeds.
OUTPUT:
{
  "tareas": [{
    "tipo_servicio": "Desbroce de malas hierbas",
    "estado_malas_hierbas": "dificultad_media",
    "superficie_malas_hierbas_m2": 18,
    "nivel_analisis": 2,
    "observaciones": ["zonas no visibles", "mala luz"]
  }]
}

Example 3 (unusable image):
INPUT SUMMARY: image is extremely blurred and weeds are not distinguishable.
OUTPUT:
{
  "tareas": [{
    "tipo_servicio": "Desbroce de malas hierbas",
    "estado_malas_hierbas": null,
    "superficie_malas_hierbas_m2": 0,
    "nivel_analisis": 3,
    "observaciones": ["foto extremadamente borrosa", "malas hierbas no detectables"]
  }]
}

FINAL RESPONSE SCHEMA (STRICT):
{
  "tareas": [
    {
      "tipo_servicio": "Desbroce de malas hierbas",
      "estado_malas_hierbas": "normal" | "dificultad_media" | "dificultad_alta" | null,
      "superficie_malas_hierbas_m2": number,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": ["string"] | null
    }
  ]
}
---`
  ].join('\n'),
  'Poda de palmeras': [ 
     `--- 
  You are an expert, highly deterministic palm arborist AI estimating pruning workloads from one or multiple images. 
  Your goal is conservative, highly reproducible accuracy. NEVER overestimate sizes. 
  
  0. DETECTION VALIDATION (MANDATORY FIRST STEP): 
  - Scan the image for TRUE palms (Arecaceae family: unbranched trunks with a tuft of large leaves/fronds at the top). 
  - IGNORE: Broadleaf trees, conifers, shrubs, bushes, potted indoor plants, and background forests not part of the garden. 
  - IF NO VALID PRUNABLE PALM IS FOUND IN AN IMAGE: You MUST return an entry for that image with "nivel_analisis": 3, "observaciones": ["No se detectó ninguna palmera"], "especie": "No detectada" and "altura_m": 0.
  - IF UNCLEAR: Better to return empty than false positives. 
  
  1. MULTI-PHOTO DEDUPLICATION & COUNTING (CRITICAL): 
 	 • 	 Carefully cross-reference all images. If multiple images show the same palm from different angles, merge them into one single entity. 
 	 • 	 Only count distinct target palms clearly in focus for pruning. 
 	 • 	 For "indice_imagen", use the index of the photo where the palm is most clearly visible. 
 	 • 	 DO NOT group multiple distinct palms into a single entry. Create one JSON object for EACH distinct palm found. 
  
  2. SPECIES CLASSIFICATION (STRICT): 
  You must classify each palm using ONLY the following strict species list: 
  - "Phoenix canariensis"
  - "Phoenix dactylifera"
  - "Washingtonia robusta/filifera"
  - "Syagrus romanzoffiana"
  - "Trachycarpus fortunei"
  - "Roystonea regia"
  If the detected palm species is not exactly in this list but resembles one of them, return the closest matching species name from the list and append " o similar" to it (e.g., "Phoenix canariensis o similar").
  
  3. CONSERVATIVE SIZE ESTIMATION & HEIGHT (STRICT TRUNK MEASUREMENT): 
  Anchor height estimates to visual reference points: doors (~2m), fences (~1.5m), roofs (~3m), or cars. 
  You MUST measure the height STRICTLY up to the base of the crown (the top of the clear trunk/stipe). DO NOT include the leaves/fronds in the height measurement.
  You MUST estimate this EXACT TRUNK HEIGHT in meters as a number (altura_m).
  
  4. STATE (MAINTENANCE CONDITION) CLASSIFICATION: 
  You MUST output EXACTLY one of these strings (case-insensitive): "normal", "descuidado", or "muy descuidado".
  - "normal": Palmera con mantenimiento regular. Presenta hojas secas habituales pero no acumulación. Es una poda estándar que no requiere tiempo ni esfuerzo adicional.
  - "descuidado": Palmera con una falda (acumulación de hojas secas) de tamaño moderado. Implica una dificultad técnica y un tiempo de ejecución superiores a la poda estándar.
  - "muy descuidado": Palmera en estado de abandono notable. Presenta una falda grande y densa. Exige al podador el nivel máximo de esfuerzo y tiempo para su limpieza y preparación.
  
  5. OBSERVATIONS & ANALYSIS LEVEL: 
  - Level 1: Clear view, full palm visible. Observations:[] 
  - Level 2: Partial view, backlight, or minor obstruction. Observations:["copa parcialmente oculta", "contraluz", "posiblemente más alta de lo visible"] 
  - Level 3: Blurry, dark, or major obstruction. Observations:["palmera borrosa", "muy oscuro", "no se ve la base", "estimación imprecisa por mala foto"] 
  
  6. OUTPUT FORMAT: 
  Return ONLY a valid JSON object. No markdown blocks. No explanations. 
  
  { 
    "palmas":[ 
      { 
        "indice_imagen": integer, 
        "especie": "string", 
        "altura_m": number, 
        "estado": "normal" | "descuidado" | "muy descuidado", 
        "nivel_analisis": integer (1, 2, or 3), 
        "observaciones": ["string"] OR null 
      } 
    ] 
  } 
  ---`
  ].join('\n'),
  'Corte de césped': [
    `---
You are an expert image analysis AI for a gardening marketplace. Your task is to objectively analyze lawn areas visible in images to extract structured data.

CORE RULES:
1. OUTPUT MUST BE VALID JSON ONLY. No markdown (json), no conversational text.
2. DO NOT infer hidden areas. Analyze ONLY what is strictly visible.
3. DO NOT calculate prices.
4. Accuracy is priority over completeness. If unsure, declare lower reliability.

SERVICE CONTEXT:
Service Type: "Corte de césped"

---------------------------------------------------------------------
ANALYSIS LOGIC & RELIABILITY LEVELS (nivel_analisis):

Determine the level based on visibility, lighting, and scale references.

LEVEL 1 (High Confidence):
- Criteria: Entire lawn visible, perfect lighting, clear scale references (doors, people, standard paving).
- Output: All fields populated. observaciones = null.

LEVEL 2 (Moderate Limitations):
- Criteria: Partial visibility, shadows, awkward angles, or lack of scale references.
- Output: All fields populated (best estimate). observaciones = ARRAY with specific allowed notes.

LEVEL 3 (Failed/Unusable):
- Criteria: Lawn not detectable, extreme blur, pitch black, or not a garden.
- Output: superficie_m2 = 0, estado_jardin = null. observaciones = ARRAY with failure notes.

---------------------------------------------------------------------
DATA EXTRACTION RULES:

A) SURFACE AREA (superficie_m2):
- Estimate ONLY visible natural grass.
- USE REFERENCES: Look for standard objects (doors ~0.9m wide, cars ~4.5m long, standard tiles) to calibrate scale.
- If scale is impossible to determine (no references), set nivel_analisis = 2 and add "pocas referencias de escala".

B) CONDITION (estado_jardin):
- "normal" -> Even surface, defined edges.
- "descuidado" -> Uneven height, invading edges.
- "muy descuidado" -> High weeds, undefined edges, wild appearance.

C) OBSERVACIONES (Allowed values ONLY):
- Level 2: "mala luz", "zonas no visibles", "foto de baja calidad", "pocas referencias de escala", "ángulo limitado", "parte del jardín fuera de encuadre", "posible solapamiento entre imágenes".
- Level 3: "muy mala luz", "foto extremadamente borrosa", "césped no detectable", "imagen no corresponde a un jardín", "superficie completamente fuera de encuadre", "imagen obstruida".

---------------------------------------------------------------------
RESPONSE FORMAT (JSON Schema):

{
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "estado_jardin": "string OR null",
      "superficie_m2": number,
      "numero_plantas": null,
      "tamaño_plantas": null,
      "nivel_analisis": integer (1, 2, or 3),
      "observaciones": ["string"] OR null
    }
  ]
}`
  ].join('\n'),
  'Corte de setos': [
    `---
SYSTEM ROLE:
You are 'HedgeMap', an expert AI specialized in landscape analysis and estimating hedge trimming jobs.

INPUT CONTEXT:
You will receive one or multiple images in a single request. ALL provided images belong to the EXACT SAME HEDGE (same zone).
Images are grouped by explicit labels:
- FACE_A: front/main side (always present)
- FACE_B: back/opposite side (optional)
You must never infer or invent additional faces. Use only the provided groups.

CORE MEASUREMENT RULES (STRICT STRICT STRICT):
1. GROSS HEIGHT RULE (altura_m):
   - Measure the GROSS height from the ground to the top of the foliage.
   - If the hedge is growing on top of a wall, fence, planter, or slope, you MUST include the height of the wall/structure because the gardener must reach that total height from the ground.
   - Example: A 1.5m hedge sitting on a 1m brick wall has an altura_m of 2.5.

2. LENGTH & SHAPE RULE (longitud_m):
   - Estimate the linear length of the hedge.
   - L-Shape / U-Shape Handling: If the hedge turns a corner, sum the lengths of all visible sections (e.g., a 5m section + a 3m section = 8m base length).

3. FACE-BASED CALCULATION (CRITICAL):
   - Measure FACE_A and FACE_B independently if both are provided.
   - Determine base_longitud_m and base_altura_m using:
     a) Average of both faces when both are reliable (nivel_analisis 1 or 2),
     b) Otherwise, the most reliable face.
   - Determine caras_recortar:
     - 1 if only FACE_A is provided,
     - 2 if FACE_B is provided.
   - Compute:
     - longitud_calculo_m = base_longitud_m * caras_recortar
     - altura_calculo_m = base_altura_m * caras_recortar
   - Also return longitud_m as base_longitud_m for backward compatibility.
   - Also return altura_m as base_altura_m for backward compatibility.

CLASSIFICATION & STATE RULES:
Translate your visual findings into the exact following Spanish categories.

A. Operational Height Band (tipo_seto) - Choose EXACTLY ONE:
   - "0-2m": Use when base_altura_m <= 2.0m.
   - "2-4m": Use when base_altura_m is >2.0m and <=4.0m.
   - "4-6m": Use when base_altura_m is >4.0m.

A2. Height band guidance:
   - Keep numeric altura_m as your measured foliage height.
   - tipo_seto must follow the 3 bands above.
   - If estimated base_altura_m exceeds 6m, keep numeric altura_m as estimated and add an observation indicating manual safety review is required.

B. Cutting Difficulty (estado_seto) - Choose EXACTLY ONE:
   - "normal": Flat shape, preserves geometry, short new shoots. Easy to trim.
   - "media": Loss of geometry, requires extra effort to recover straight lines, slightly thicker branches.
   - "alta": Uncontrolled growth, very thick branches protruding, entangled vines, or requires heavy tools.
   - DO NOT factor height into difficulty, as height is already priced separately.

C. Image Quality (nivel_analisis):
   - 1: Clear, fully usable for 3D estimation.
   - 2: Partially blurry or obstructed, but estimation is possible.
   - 3: Unusable, too dark, or doesn't show the hedge.

D. PRESET OBSERVATIONS (STRICT):
Use ONLY these exact Spanish phrases:
- "vista parcial por ángulo"
- "zona con sombras"
- "vegetación tapa parte del seto"
- "parte del seto fuera de encuadre"
- "imagen con enfoque limitado"
- "foto borrosa"
- "foto oscura"
- "seto no visible con claridad"

Rules:
- nivel_analisis = 1 -> "observaciones": []
- nivel_analisis = 2 -> include 1-2 phrases from the list
- nivel_analisis = 3 -> include 1-2 phrases from the list

OUTPUT FORMAT:
You must output ONLY a valid JSON object. No markdown formatting (json), no introductory text, no explanations outside the JSON.

{
  "tareas":[
    {
      "tipo_servicio": "Corte de setos",
      "longitud_m": number,
      "altura_m": number,
      "tipo_seto": "0-2m" | "2-4m" | "4-6m",
      "estado_seto": "normal" | "media" | "alta",
      "caras": 1 | 2,
      "detalle_caras": {
        "cara_a": {
          "longitud_m": number,
          "altura_m": number,
          "nivel_analisis": 1 | 2 | 3,
          "observaciones": string[]
        },
        "cara_b": {
          "longitud_m": number,
          "altura_m": number,
          "nivel_analisis": 1 | 2 | 3,
          "observaciones": string[]
        }
      },
      "resumen_medicion": {
        "base_longitud_m": number,
        "base_altura_m": number,
        "caras_recortar": 1 | 2,
        "longitud_calculo_m": number,
        "altura_calculo_m": number,
        "metodo": "media_caras" | "cara_mas_fiable"
      },
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`
  ].join('\n'),
  'Poda de árboles': [
    `---
Eres un motor determinista de análisis visual para un marketplace de jardinería.
Tu tarea para este servicio es analizar 1 árbol (una zona) a partir de 1 o más fotos del MISMO árbol.

OBJETIVO:
- Estimar la altura del árbol en metros (altura_m).
- Determinar si la poda es de dificultad alta (dificultad_alta) por:
  - terreno irregular/inclinado/inestable en la base, o
  - obstáculos cercanos (cables, tejados, muros, piscinas, mobiliario grande, otros árboles muy próximos) que dificulten el trabajo o la caída de ramas.

REGLAS:
1) No calcules precios.
2) No estimes horas.
3) No clasifiques tipo de poda.
4) Si hay varios árboles visibles, analiza SOLO el árbol principal (más cercano/centrado en la imagen).
5) Si NO hay un árbol válido claramente visible: nivel_analisis = 3, altura_m = 0, dificultad_alta = false, observaciones incluye "No se detectó ningún árbol válido".
6) Si hay visibilidad parcial o poca referencia de escala: nivel_analisis = 2.
7) Si la vista es clara: nivel_analisis = 1.
8) Usa referencias comunes para escala (persona ~1.7m, puerta ~2m, valla ~1.5-2m, planta baja ~3m).

SALIDA:
Devuelve SOLO JSON válido, sin texto adicional.

{
  "arboles": [
    {
      "indice_imagen": integer,
      "altura_m": number,
      "dificultad_alta": boolean,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": ["string"] OR null
    }
  ]
}
---`
  ].join('\n'),
  'Poda de plantas y arbustos': [
    `---
You are an expert image analysis AI used in a gardening services marketplace.

Your role is to analyze one or more images provided by a client and extract objective, visible data required to generate an automatic service estimate for plant pruning.

You DO NOT calculate prices.
You DO NOT explain your reasoning.
You DO NOT include text outside the required JSON.

Your task is limited strictly to image analysis.

SERVICE:
Poda de plantas y arbustos

ANALYSIS OBJECTIVE:
Analyze the provided images to identify shrubs, bushes, roses, climbing plants, or large succulents. Determine the total surface area of the visible garden, the percentage of that area covered by these plants, and their dominant size.
Ignore trees (handled by "Poda de árboles") and grass (handled by "Corte de césped").

MULTI-IMAGE & DEDUPLICATION:
- The user may provide multiple images of the same garden.
- You must analyze ALL images to create a comprehensive list of tasks.
- CRITICAL: Deduplicate plants. If the SAME plant appears in multiple images (e.g., from different angles), measure it ONLY ONCE.
- If distinct groups of plants appear in different images, evaluate the overall garden size and the total percentage covered across all visible areas.

VARIABLES TO EXTRACT:
- tipo_servicio: Fixed value "Poda de plantas y arbustos".
- razonamiento_cot: Object explaining your rationale before extracting metrics.
- tamano_total_jardin_m2: Integer representing the estimated total surface area of the visible garden in square meters.
- porcentaje_superficie_plantas: Integer representing the percentage of the garden area covered by the plants to prune. MUST be exactly one of: 10, 25, 50, 75, 100.
- tamano_dominante: Classification of the average/dominant size (Exact strings only).
- nivel_analisis: 1 (Clear), 2 (Partial/Unsure), 3 (Failed).
- observaciones: List of visual issues (e.g., "plantas superpuestas", "mala iluminación").
- indices_imagenes: Array of integers representing the 0-based indices of the images used to identify these plants.

### MANDATORY CHAIN OF THOUGHT (CoT) ###
You must populate the "razonamiento_cot" object FIRST:
1. "identificacion_escalas": Identify visual anchors (doors ~2m, cars ~4.5m, fences ~1.5m).
2. "calculo_area_total": Explain your mathematical estimation of the visible garden (width x depth).
3. "calculo_area_plantas": Explain your mathematical estimation of the area covered ONLY by the plants to prune.
4. "derivacion_porcentaje": Show the calculation that forces you to choose exactly 10, 25, 50, 75, or 100%.

CLASSIFICATION RULES:

A) DOMINANT SIZE (tamano_dominante) - MUST be exactly one of:
- "pequeñas": Height or diameter 0m - 1m. Typically knee to waist height.
- "medianas": Height or diameter 1m - 2m. Up to head height.
- "grandes": Height or diameter 2m - 3m. Taller than a person, requiring a ladder.

OUTPUT RULES (MANDATORY):
- Return ONLY valid JSON
- No explanations
- No comments
- No additional fields
- No markdown
- No text outside the JSON

ESTIMATION RULES:
- If a value cannot be determined with absolute certainty, provide the most reasonable estimate based on visible information.
- Never return null or empty values unless explicitly allowed.
- Ensure porcentaje_superficie_plantas is one of the allowed values: 10, 25, 50, 75, 100.

RESPONSE FORMAT (STRICT):
{
  "tareas": [
    {
      "tipo_servicio": "Poda de plantas y arbustos",
      "razonamiento_cot": {
        "identificacion_escalas": "string",
        "calculo_area_total": "string",
        "calculo_area_plantas": "string",
        "derivacion_porcentaje": "string"
      },
      "tamano_total_jardin_m2": integer,
      "porcentaje_superficie_plantas": 10 | 25 | 50 | 75 | 100,
      "tamano_dominante": "pequeñas" | "medianas" | "grandes",
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": ["string"] OR null,
      "indices_imagenes": [integer]
    }
  ]
}
---`
  ].join('\n'),
};

const WEEDING_SERVICE_NAME = 'Desbroce de malas hierbas';
const WEEDING_PROMPT_TEMPERATURE = 0.05;

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
  const { description, service_ids = [], photo_urls = [], service_name, hedge_faces } = payload;

  // Lógica específica para Poda de Palmeras
  if (service_name === 'Poda de palmeras') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las siguientes imágenes e identifica las palmeras según el índice.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
      userContent.push({
        type: 'text',
        text: `Imagen Índice ${idx}:`
      });
      userContent.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      });
    });

    return [
      { role: 'system', content: PROMPTS['Poda de palmeras'] },
      { role: 'user', content: userContent },
    ];
  }

  // Lógica específica para Corte de césped
  if (service_name === 'Corte de césped' || (service_name && service_name.toLowerCase().includes('césped'))) {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las imágenes para el servicio de corte de césped.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
        userContent.push({
            type: 'image_url',
            image_url: { url, detail: 'auto' },
        });
    });

    return [
        { role: 'system', content: PROMPTS['Corte de césped'] },
        { role: 'user', content: userContent },
    ];
  }

  if (isPhytosanitaryService(service_name)) {
    return [
      { role: 'system', content: buildPhytosanitarySystemPrompt(payload) },
      { role: 'user', content: buildPhytosanitaryUserContent(payload) },
    ];
  }

  // Lógica específica para Poda de plantas y arbustos
  if (service_name === 'Poda de plantas y arbustos') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las siguientes imágenes para el servicio de Poda de plantas y arbustos. Identifica las plantas y agrúpalas.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
      userContent.push({
        type: 'text',
        text: `Imagen Índice ${idx}:`
      });
      userContent.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      });
    });

    return [
      { role: 'system', content: PROMPTS['Poda de plantas y arbustos'] },
      { role: 'user', content: userContent },
    ];
  }

  // Lógica específica para Poda de árboles
  if (service_name === 'Poda de árboles') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Estas imágenes corresponden a un único árbol (una zona). Devuelve un único análisis consolidado.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
      userContent.push({
        type: 'text',
        text: `Imagen Índice ${idx}:`
      });
      userContent.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      });
    });

    return [
      { role: 'system', content: PROMPTS['Poda de árboles'] },
      { role: 'user', content: userContent },
    ];
  }

  // Lógica genérica para otros servicios con prompts específicos
  // (Corte de setos, Poda de árboles, Poda de plantas y arbustos, Desbroce, Servicios fitosanitarios)
  const exactServicePrompt = PROMPTS[service_name || ''];
  if (exactServicePrompt) {
      const isHedgeService = (service_name || '').toLowerCase().includes('seto');
      const isWeedingService = isWeedingServiceName(service_name);
      const userContent: any[] = [
          { type: 'text', text: `Descripción del cliente: ${description || ''}` },
          { type: 'text', text: `Analiza las imágenes para el servicio: ${service_name}` }
      ];
      if (isHedgeService) {
        const faceAUrls = (hedge_faces?.face_a_urls || []).filter(Boolean).slice(0, 4);
        const faceBUrls = (hedge_faces?.face_b_urls || []).filter(Boolean).slice(0, 4);
        userContent.push({ type: 'text', text: 'Todas las imágenes corresponden al mismo seto/zona. Debes cruzar todas las vistas para una única estimación consolidada.' });
        if (faceAUrls.length > 0) {
          userContent.push({ type: 'text', text: 'FACE_A (cara delantera/principal):' });
          faceAUrls.forEach((url) => {
            userContent.push({
              type: 'image_url',
              image_url: { url, detail: 'auto' },
            });
          });
        }
        if (faceBUrls.length > 0) {
          userContent.push({ type: 'text', text: 'FACE_B (cara trasera/opcional):' });
          faceBUrls.forEach((url) => {
            userContent.push({
              type: 'image_url',
              image_url: { url, detail: 'auto' },
            });
          });
        }
        if (faceAUrls.length === 0 && faceBUrls.length === 0) {
          photo_urls.slice(0, 5).forEach((url) => {
            userContent.push({
              type: 'image_url',
              image_url: { url, detail: 'auto' },
            });
          });
        }
      } else if (isWeedingService) {
        userContent.push({ type: 'text', text: 'Todas las imágenes pertenecen a la misma zona de malas hierbas; consolidar una única estimación.' });
        photo_urls.slice(0, 5).forEach((url) => {
          userContent.push({
            type: 'image_url',
            image_url: { url, detail: 'auto' },
          });
        });
      } else {
        photo_urls.slice(0, 5).forEach((url) => {
          userContent.push({
            type: 'image_url',
            image_url: { url, detail: 'auto' },
          });
        });
      }

      return [
          { role: 'system', content: exactServicePrompt },
          { role: 'user', content: userContent },
      ];
  }
  
  // Mapeo flexible para nombres que no coincidan exactamente
  const flexibleMap: Record<string, string> = {
      'seto': 'Corte de setos',
      'árbol': 'Poda de árboles',
      'arbol': 'Poda de árboles',
      'poda de plantas': 'Poda de plantas y arbustos',
      'fitosanitarios': 'Servicios fitosanitarios',
      'desbroce': 'Desbroce de malas hierbas'
  };
  
  const lowerName = (service_name || '').toLowerCase();
  for (const [key, promptKey] of Object.entries(flexibleMap)) {
      if (lowerName.includes(key) && PROMPTS[promptKey]) {
          const isHedgeService = promptKey === 'Corte de setos';
          const userContent: any[] = [
            { type: 'text', text: `Descripción del cliente: ${description || ''}` },
            { type: 'text', text: `Analiza las imágenes para el servicio: ${promptKey}` }
          ];
          if (isHedgeService) {
            const faceAUrls = (hedge_faces?.face_a_urls || []).filter(Boolean).slice(0, 4);
            const faceBUrls = (hedge_faces?.face_b_urls || []).filter(Boolean).slice(0, 4);
            userContent.push({ type: 'text', text: 'Todas las imágenes corresponden al mismo seto/zona. Debes cruzar todas las vistas para una única estimación consolidada.' });
            if (faceAUrls.length > 0) {
              userContent.push({ type: 'text', text: 'FACE_A (cara delantera/principal):' });
              faceAUrls.forEach((url) => {
                userContent.push({
                  type: 'image_url',
                  image_url: { url, detail: 'auto' },
                });
              });
            }
            if (faceBUrls.length > 0) {
              userContent.push({ type: 'text', text: 'FACE_B (cara trasera/opcional):' });
              faceBUrls.forEach((url) => {
                userContent.push({
                  type: 'image_url',
                  image_url: { url, detail: 'auto' },
                });
              });
            }
            if (faceAUrls.length === 0 && faceBUrls.length === 0) {
              photo_urls.slice(0, 5).forEach((url) => {
                userContent.push({
                  type: 'image_url',
                  image_url: { url, detail: 'auto' },
                });
              });
            }
          } else {
            photo_urls.slice(0, 5).forEach((url) => {
              userContent.push({
                  type: 'image_url',
                  image_url: { url, detail: 'auto' },
              });
            });
          }

          return [
            { role: 'system', content: PROMPTS[promptKey] },
            { role: 'user', content: userContent },
          ];
      }
  }

  // FALLBACK GENÉRICO (Legacy)
  const userContent: any[] = [
    { type: 'text', text: `Descripción del cliente: ${description || ''}` },
    { type: 'text', text: `Servicios seleccionados (informativo): ${service_ids.join(', ')}` },
  ];

  // Adjuntar hasta 4 imágenes para limitar coste/tiempo
  photo_urls.slice(0, 4).forEach((url) => {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'auto' },
    });
  });

  const systemPrompt = [
    'Actúa como un asistente especializado en jardinería. Tu tarea es analizar una imagen del jardín y la descripción escrita del cliente para generar una lista estructurada de tareas necesarias.',
    'Tu salida será un JSON válido y limpio, sin texto adicional, que contenga todos los tipos de trabajos detectados junto con las variables necesarias para que un sistema de presupuestos los procese automáticamente.',
    '',
    '1️⃣ SERVICIOS POSIBLES',
    'Solo puedes detectar los siguientes tipos de servicio:',
    'Corte de césped',
    'Poda de plantas y arbustos',
    'Corte de setos a máquina',
    'Poda de árboles',
    'Servicios fitosanitarios',
    'Desbroce de malas hierbas',
    '',
    '2️⃣ VARIABLES A DETECTAR',
    'Para cada servicio identificado, devuelve:',
    'tipo_servicio: uno de los listados arriba.',
    'estado_jardin: “normal”, “descuidado” o “muy descuidado”. (O estado_malas_hierbas para Desbroce: “normal”, “dificultad_media”, “dificultad_alta”).',
    'superficie_m2: número estimado solo para:',
    ' - Corte de césped',
    ' - Corte de setos a máquina',
    'superficie_malas_hierbas_m2: número estimado solo para:',
    ' - Desbroce de malas hierbas',
    'numero_plantas: número aproximado solo para:',
    ' - Servicios fitosanitarios',
    ' - Poda de plantas y arbustos',
    ' - Poda de árboles',
    'tamaño_plantas: “pequeñas” (<0,5 m), “medianas” (0,5–1 m), “grandes” (1–1,5 m), “muy grandes” (1,5–2 m).',
    '',
    '3️⃣ CONTROL DE INCERTIDUMBRE',
    'Si no estás completamente seguro de alguno de los valores, no lo inventes. En esos casos, usa el valor null.',
    '',
    '4️⃣ SUPERFICIE VISIBLE',
    'Calcula únicamente la superficie visible en la imagen, sin estimar zonas que no se vean con claridad.',
    'Si solo se muestra una parte del jardín, estima el área de la parte visible y trabajable, no de toda la propiedad.',
    '',
    '5️⃣ NORMALIZACIÓN DE UNIDADES',
    'Devuelve siempre solo una unidad válida según el tipo de servicio:',
    'Césped, setos → superficie_m2',
    'Desbroce → superficie_malas_hierbas_m2',
    'Poda o servicios fitosanitarios → numero_plantas + tamaño_plantas',
    'No mezcles unidades dentro de una misma tarea.',
    '',
    '6️⃣ ESTRUCTURA DE RESPUESTA',
    'Devuelve únicamente un JSON con esta estructura exacta:',
    '{',
    '  "tareas": [',
    '    {',
    '      "tipo_servicio": "",',
    '      "estado_jardin": "",',
    '      "superficie_m2": null,',
    '      "superficie_malas_hierbas_m2": null,',
    '      "estado_malas_hierbas": null,',
    '      "numero_plantas": null,',
    '      "tamaño_plantas": null',
    '    }',
    '  ]',
    '}',
    'Puedes incluir tantas tareas como sean necesarias dentro del array "tareas".',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

async function callOpenAI(messages: any[]) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return { tareas: [], reasons: ['Falta OPENAI_API_KEY'] };
  }

  const body = {
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('OpenAI error:', txt);
    return { tareas: [], reasons: ['Error llamando a OpenAI'] };
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return { tareas: [], reasons: ['Respuesta no parseable'] };
  }
}

function heuristicTasks(payload: Payload) {
  // Cuando falla la IA, no devolvemos datos inventados.
  // Devolvemos una señal clara de error para que el frontend pida reintentar.
  return { 
      tareas: [], 
      reasons: ['AI_FAILED_CRITICAL'] 
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
  surfacesArr.forEach((surface: any) => {
    const area = Number.isFinite(Number(surface?.estimated_area_m2))
      ? Math.max(0, Number(surface.estimated_area_m2))
      : mapSeverityToArea(String(surface?.estimated_severity || 'unknown'));
    if (area > 0) {
      pushTask({
        ai_ref_id: surface.ai_ref_id || `surface_${Math.random().toString(36).substring(7)}`,
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
  hedgesArr.forEach((hedge: any) => {
    const ml = Math.round(toNonNegativeNumber(hedge.ml));
    const band = String(hedge.size_band || 'bajos_medios').toLowerCase();
    if (ml > 0) {
      pushTask({
        ai_ref_id: hedge.ai_ref_id || `hedge_${Math.random().toString(36).substring(7)}`,
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
  treesArr.forEach((tree: any) => {
    const band = String(tree.size_band || 'pequenos').toLowerCase();
    pushTask({
      ai_ref_id: tree.ai_ref_id || `tree_${Math.random().toString(36).substring(7)}`,
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
  palmsArr.forEach((palm: any) => {
    const band = String(palm.size_band || 'pequenas').toLowerCase();
    const palmSurgery = Boolean(palm.surgery_recommended);
    pushTask({
      ai_ref_id: palm.ai_ref_id || `palm_${Math.random().toString(36).substring(7)}`,
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

async function callGemini(messages: any[], temperature?: number) {
  const apiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!apiKey) {
    return { tareas: [], reasons: ['Falta GOOGLE_API_KEY'] };
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
    response_mime_type: "application/json"
  };
  if (typeof temperature === 'number') {
    generationConfig.temperature = temperature;
  }

  const body = {
    contents,
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig
  };

  const MODEL_NAME = 'gemini-2.0-flash';
  console.log(`Calling Gemini Model: ${MODEL_NAME}`);

  // Implement exponential backoff retry logic for 429
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
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
              return { tareas: [], reasons: ['Respuesta Gemini no parseable'] };
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
          return { tareas: [], reasons: ['Gemini Rate Limit Exceeded (Daily Quota or RPM)'] };
      }

      const txt = await resp.text();
      console.error(`Gemini API Error (${resp.status} - ${MODEL_NAME}):`, txt);
      
      return { tareas: [], reasons: [`Error Gemini: ${resp.status}`] };
    } catch (networkError) {
      console.error(`[Gemini] Network/Fetch Error:`, networkError);
      if (attempts < maxAttempts) {
         const delay = 1000 * attempts;
         await new Promise(r => setTimeout(r, delay));
         continue;
      }
      return { tareas: [], reasons: ['Error de Red al llamar a Gemini'] };
    }
  }
  return { tareas: [], reasons: ['Gemini Failed'] };
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

    // Nuevo modo: auto‑presupuesto por servicio único
    if (payload.mode === 'auto_quote' && payload.service && payload.image_url) {
      const system = PROMPTS[payload.service];
      if (!system) {
        return new Response(JSON.stringify({ error: 'Servicio no soportado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const userContent: any[] = [
        { type: 'text', text: `Analiza la imagen y devuelve SOLO JSON. Servicio: ${payload.service}.` },
        { type: 'image_url', image_url: { url: payload.image_url, detail: 'auto' } },
      ];
      if (payload.description) userContent.unshift({ type: 'text', text: `Notas del cliente: ${payload.description}` });

      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ];
      
      // SOLO GEMINI
      const analysis = await callGemini(messages);

      const servicio = analysis?.servicio as string | undefined;
      const cantidad = Number(analysis?.cantidad ?? 0);
      const unidad = analysis?.unidad as string | undefined;
      const dificultad = Number(analysis?.dificultad ?? 1) as 1 | 2 | 3;

      const perf = cfg.PERFORMANCE_PRICING[payload.service];
      const mult = cfg.DIFFICULTY_MULTIPLIER[dificultad] ?? 1.0;
      if (!perf) {
        // Fallback or error?
        // return new Response(JSON.stringify({ error: 'Config no disponible' }), ...
        // Better to return 0 values than error 500
      }
      
      const tiempo_estimado_horas = perf ? (cantidad / perf.performance) * mult : 0;
      const precio_estimado = perf ? (cantidad * perf.pricePerUnit) * mult : 0;

      const out = {
        analysis: { servicio, cantidad, unidad, dificultad },
        result: {
          tiempo_estimado_horas: Math.round(tiempo_estimado_horas * 100) / 100,
          precio_estimado: Math.round(precio_estimado * 100) / 100,
        },
        version: 'v1-gemini-only',
        reasons: analysis.reasons || []
      };
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Nuevo modo: cálculo de precios de palmeras
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
        const ai = await callGemini(messages, WEEDING_PROMPT_TEMPERATURE);
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
        temperature: WEEDING_PROMPT_TEMPERATURE,
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
    
    // EXTRACT PROMPT FOR DEBUG
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const usedPrompt = systemMsg ? systemMsg.content : '';
    
    // SOLO GEMINI
    let ai;
    if (isPhytosanitaryService(payload.service_name) || payload.service_name === 'Poda de plantas y arbustos') {
      ai = await callGemini(messages, 0.0);
    } else if (isWeedingServiceName(payload.service_name)) {
      ai = await callGemini(messages, WEEDING_PROMPT_TEMPERATURE);
    } else {
      ai = await callGemini(messages);
    }

    if (isPhytosanitaryService(payload.service_name)) {
      // Devolver la respuesta limpia, ya agregada por Gemini, pero con el middleware de filtrado de scopes
      if (ai.metricas_fitosanitarias) {
        const scopes = getPhytosanitaryScope(payload);
        ai.metricas_fitosanitarias = filterPhytosanitaryMetricsByScope(ai.metricas_fitosanitarias, scopes);
      }
      return new Response(JSON.stringify(ai), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (isWeedingServiceName(payload.service_name)) {
      const normalizedTask = parseWeedingResult(ai);
      if (normalizedTask) {
        return new Response(JSON.stringify({ tareas: [normalizedTask] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        tareas: [{
          tipo_servicio: WEEDING_SERVICE_NAME,
          estado_malas_hierbas: null,
          superficie_malas_hierbas_m2: 0,
          nivel_analisis: 3,
          observaciones: ['malas hierbas no detectables']
        }],
        reasons: ai?.reasons || ['Salida de desbroce no válida']
      }), {
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
             return new Response(JSON.stringify({ palmas: palmResult }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        // If AI returned empty/missing key for this specific service, return empty list instead of generic error
        // allowing the frontend to show "0 palms found" instead of "Error"
        return new Response(JSON.stringify({ palmas: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (palmResult && Array.isArray(palmResult)) {
      return new Response(JSON.stringify({ palmas: palmResult }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Support for Tree Analysis Response
    if (ai?.arboles && Array.isArray(ai.arboles)) {
      return new Response(JSON.stringify({ arboles: ai.arboles }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let tareas = Array.isArray(ai?.tareas) ? ai.tareas : [];
    
    // Post-processing: Merge identical "Poda de plantas y arbustos" tasks
    if (payload.service_name === 'Poda de plantas y arbustos' && tareas.length > 0) {
        const mergedTasks: Record<string, any> = {};
        
        tareas.forEach((task: any) => {
            if (task.tipo_servicio === 'Poda de plantas y arbustos') {
                // Calculate superficie_m2 from total garden size and percentage
                const totalM2 = Number(task.tamano_total_jardin_m2 || 1);
                const porcentaje = Number(task.porcentaje_superficie_plantas || 10);
                const calculatedArea = Math.ceil(totalM2 * (porcentaje / 100));
                
                // We use calculatedArea directly on the task so the frontend consumes it normally
                task.superficie_m2 = Math.max(1, calculatedArea);

                // Create a unique key for grouping
                const key = `${task.tamano_dominante}`;
                
                if (!mergedTasks[key]) {
                    mergedTasks[key] = { ...task };
                    // Ensure arrays are initialized
                    mergedTasks[key].indices_imagenes = task.indices_imagenes || [];
                    mergedTasks[key].observaciones = task.observaciones || [];
                } else {
                    // Merge calculated areas
                    mergedTasks[key].superficie_m2 += task.superficie_m2;
                    
                    // Merge image indices
                    const newIndices = task.indices_imagenes || [];
                    mergedTasks[key].indices_imagenes = [...new Set([...mergedTasks[key].indices_imagenes, ...newIndices])].sort();
                    
                    // Merge observations
                    const newObs = task.observaciones || [];
                    mergedTasks[key].observaciones = [...new Set([...mergedTasks[key].observaciones, ...newObs])];
                    
                    // Keep the worst analysis level (highest number)
                    mergedTasks[key].nivel_analisis = Math.max(mergedTasks[key].nivel_analisis, task.nivel_analisis || 1);
                }
            } else {
                // If mixed services (unlikely but possible), keep them separate or handle accordingly
                // For now, just append with a unique key or skip merging logic for non-matching types
                const key = `OTHER_${Math.random()}`;
                mergedTasks[key] = task;
            }
        });
        
        tareas = Object.values(mergedTasks);
    }

    if (tareas.length > 0) {
      return new Response(JSON.stringify({ tareas }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const h = heuristicTasks(payload);
    return new Response(JSON.stringify({ ...h, reasons: ai.reasons || ['No se detectaron tareas (Gemini)'] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Estimator error:', err);
    const h = heuristicTasks({ description: '', photo_count: 0 });
    return new Response(
      JSON.stringify({ ...h, reasons: ['Error interno crítico'] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
