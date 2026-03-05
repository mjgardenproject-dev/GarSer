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
  photo_count?: number;
  service_name?: string; // Nombre del servicio (opcional, para lógica específica)
  // Nuevo modo de auto‑presupuesto por servicio
  mode?: 'auto_quote' | 'calculate_palm_pricing';
  service?: string; // nombre exacto del servicio
  image_url?: string; // http(s) o dataURL
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash';
  palms?: any[]; // Array for palm pricing calculation
}

// --- PALM PRICING LOGIC ---
const PALM_CONSTANTS = {
  GROUP_A: [
    "Phoenix (datilera o canaria)", 
    "Washingtonia", 
    "Roystonea regia (cubana)", 
    "Syagrus romanzoffiana (cocotera)", 
    "Trachycarpus fortunei"
  ],
  GROUP_B: [
    "Livistona", 
    "Kentia (palmito)", 
    "Phoenix roebelenii(pigmea)", 
    "cycas revoluta (falsa palmera)"
  ],
  PRICING: {
    A: {
      "0-5": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
      "5-12": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
      "12-20": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
      "20+": { normal: 2.5, descuidado: 3.5, "muy descuidado": 5.0 }
    },
    B: {
      "0-2": { normal: 0.25, descuidado: 0.5, "muy descuidado": 0.75 },
      "2+": { normal: 0.5, descuidado: 0.75, "muy descuidado": 1.0 }
    }
  }
};

function normalizeStr(s: string) {
  return (s || '').toLowerCase().trim();
}

function calculatePalmEstimation(palms: any[]) {
  let tiempoPodaBruto = 0;
  
  // Setup Time Logic
  // - "12-20" or "20+" -> 2.0h (Tier 3)
  // - "5-12" -> 1.5h (Tier 2)
  // - "0-5", "0-2", "2+" -> 1.0h (Tier 1)
  let maxSetupTier = 0; 

  palms.forEach(p => {
      // Skip failed or undetected palms
      if (p.nivel_analisis === 3 || p.especie === 'No detectada') return;

      const species = normalizeStr(p.especie);
      const height = p.altura;
      const state = normalizeStr(p.estado || 'normal');
      
      // Determine Group
      let group = 'A';
      if (PALM_CONSTANTS.GROUP_B.some(s => normalizeStr(s) === species)) {
          group = 'B';
      }
      
      // Calculate Hours
      let hours = 0;
      const groupPrices = (PALM_CONSTANTS.PRICING as any)[group];
      
      // Fallback/Safety
      if (groupPrices && groupPrices[height]) {
          if (groupPrices[height][state] !== undefined) {
              hours = groupPrices[height][state];
          } else {
              hours = groupPrices[height]['normal'] || 0;
          }
      } else {
           // Default fallback: Group A, 5-12, normal
           hours = PALM_CONSTANTS.PRICING.A['5-12'].normal; 
      }
      
      tiempoPodaBruto += hours;
      
      // Determine Setup Tier
      let tier = 1;
      if (height === '12-20' || height === '20+') tier = 3;
      else if (height === '5-12') tier = 2;
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
  'Poda de palmeras': [ 
     `--- 
  You are an expert, highly deterministic palm arborist AI estimating pruning workloads from one or multiple images. 
  Your goal is conservative, highly reproducible accuracy. NEVER overestimate sizes. 
  
  0. DETECTION VALIDATION (MANDATORY FIRST STEP): 
  - Scan the image for TRUE palms (Arecaceae family: unbranched trunks with a tuft of large leaves/fronds at the top). 
  - IGNORE: Broadleaf trees, conifers, shrubs, bushes, potted indoor plants, and background forests not part of the garden. 
  - IF NO VALID PRUNABLE PALM IS FOUND IN AN IMAGE: You MUST return an entry for that image with "nivel_analisis": 3, "observaciones": ["No se detectó ninguna palmera"], "especie": "No detectada" and "altura": "0-0".
  - IF UNCLEAR: Better to return empty than false positives. 
  
  1. MULTI-PHOTO DEDUPLICATION & COUNTING (CRITICAL): 
 	 • 	 Carefully cross-reference all images. If multiple images show the same palm from different angles, merge them into one single entity. 
 	 • 	 Only count distinct target palms clearly in focus for pruning. 
 	 • 	 For "indice_imagen", use the index of the photo where the palm is most clearly visible. 
 	 • 	 DO NOT group multiple distinct palms into a single entry. Create one JSON object for EACH distinct palm found. 
  
  2. SPECIES CLASSIFICATION (STRICT): 
  You must classify each palm into EXACTLY ONE of these species: 
  - "Phoenix (datilera o canaria)" 
  - "Washingtonia" 
  - "Roystonea regia (cubana)" 
  - "Syagrus romanzoffiana (cocotera)" 
  - "Trachycarpus fortunei" 
  - "Livistona" 
  - "Kentia (palmito)" 
  - "Phoenix roebelenii(pigmea)" 
  - "cycas revoluta (falsa palmera)" 
  
  3. CONSERVATIVE SIZE ESTIMATION & HEIGHT RANGES: 
  Anchor height estimates to visual reference points: doors (~2m), fences (~1.5m), roofs (~3m), or cars. 
  You MUST use the specific height range allowed for the identified species: 
  GROUP A ("Phoenix (datilera o canaria)", "Washingtonia", "Roystonea regia (cubana)", "Syagrus romanzoffiana (cocotera)", "Trachycarpus fortunei"): 
    - "0-5": Less than 5 meters. 
    - "5-12": Between 5 and 12 meters. 
    - "12-20": Between 12 and 20 meters. 
    - "20+": More than 20 meters. 
  GROUP B ("Livistona", "Kentia (palmito)", "Phoenix roebelenii(pigmea)", "cycas revoluta (falsa palmera)"): 
    - "0-2": Less than 2 meters. 
    - "2+": More than 2 meters. 
  
  4. STATE (MAINTENANCE CONDITION) CLASSIFICATION: 
  - "normal": Standard condition. Few dry fronds. Evidence of regular maintenance. Clean appearance. 
  - "descuidado": Some accumulation of dry/brown fronds (partial beard). Presence of some fruit clusters. Slightly overgrown. 
  - "muy descuidado": Heavy accumulation of dry fronds (full/long beard covering a large part of the trunk). Abundant fruit clusters. Wild, unkempt appearance. Neglected for a long time. 
  
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
        "altura": "string", 
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
- Output: superficie_m2 = 0, especie_cesped = null, estado_jardin = null. observaciones = ARRAY with failure notes.

---------------------------------------------------------------------
DATA EXTRACTION RULES:

A) SURFACE AREA (superficie_m2):
- Estimate ONLY visible natural grass.
- USE REFERENCES: Look for standard objects (doors ~0.9m wide, cars ~4.5m long, standard tiles) to calibrate scale.
- If scale is impossible to determine (no references), set nivel_analisis = 2 and add "pocas referencias de escala".

B) SPECIES (especie_cesped):
- "Dichondra (oreja de ratón o similares)" -> Round leaves.
- "Gramón (Kikuyu, San Agustín o similares)" -> Very wide blades, creeping runners.
- "Bermuda (fina o gramilla)" -> Very fine, dense needle-like blades.
- "Césped Mixto (Festuca/Raygrass)" -> DEFAULT. Use this if distance prevents blade analysis.

C) CONDITION (estado_jardin):
- "normal" -> Even surface, defined edges.
- "descuidado" -> Uneven height, invading edges.
- "muy descuidado" -> High weeds, undefined edges, wild appearance.

D) OBSERVACIONES (Allowed values ONLY):
- Level 2: "mala luz", "zonas no visibles", "foto de baja calidad", "pocas referencias de escala", "ángulo limitado", "parte del jardín fuera de encuadre", "posible solapamiento entre imágenes".
- Level 3: "muy mala luz", "foto extremadamente borrosa", "césped no detectable", "imagen no corresponde a un jardín", "superficie completamente fuera de encuadre", "imagen obstruida".

---------------------------------------------------------------------
RESPONSE FORMAT (JSON Schema):

{
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "especie_cesped": "string OR null",
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
Eres una IA especializada en análisis de jardines llamada 'HedgeMap'. Tu objetivo es analizar imágenes para presupuestar recorte de setos.

INSTRUCCIONES DE ANÁLISIS:
1. Detecta la longitud total de setos en metros lineales.
2. Estima la altura promedio.
3. Clasifica el tipo de seto.
4. Evalúa el ESTADO DEL SETO basándote en su nivel de crecimiento y mantenimiento.

VARIABLES A EXTRAER:
- tipo_servicio: "Corte de setos"
- longitud_m: Longitud estimada en metros.
- altura_m: Altura estimada en metros.
- tipo_seto: "Conífera (Ciprés/Tuya)", "Laurel/Hoja ancha", "Hiedra/Trepandora", "Seto Mixto/Otro".
- estado_seto: "normal" | "descuidado" | "muy descuidado".
- nivel_analisis: 1 (Claro), 2 (Parcial/Borroso), 3 (Inutilizable).
- observaciones: Lista de observaciones visuales (ej. "Seto muy denso", "Requiere escalera alta").

PAUTAS PARA CLASIFICACIÓN DE ESTADO (estado_seto):

1. "normal"
   - Apariencia cuidada, forma geométrica definida.
   - Brotes nuevos cortos (< 10 cm).
   - No hay huecos grandes ni ramas secas evidentes.
   - Mantenimiento reciente visible.

2. "descuidado"
   - Pérdida parcial de la forma geométrica.
   - Brotes nuevos largos (10-30 cm) que sobresalen desordenadamente.
   - Aspecto "peludo" o ligeramente salvaje.
   - Necesita un recorte correctivo moderado.

3. "muy descuidado"
   - Pérdida total de la forma original.
   - Brotes muy largos (> 30 cm) o ramas leñosas invasivas.
   - Invasión de caminos, aceras u otras plantas.
   - Densidad extrema o partes secas/muertas visibles.
   - Requiere poda drástica o de renovación.

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Corte de setos",
      "longitud_m": number,
      "altura_m": number,
      "tipo_seto": string,
      "estado_seto": "normal" | "descuidado" | "muy descuidado",
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`
  ].join('\n'),
  'Poda de árboles': [
    `---
You are an expert, highly deterministic arborist AI estimating pruning workloads from one or multiple images.
Your goal is conservative, highly reproducible accuracy. NEVER overestimate sizes or times.

0. DETECTION VALIDATION (MANDATORY FIRST STEP):
- Scan the image for TRUE trees (woody perennial plants with a single main stem or trunk).
- IGNORE: Shrubs, bushes, hedges, potted plants, small saplings (<2m), and background forests.
- IF NO VALID PRUNABLE TREE IS FOUND IN AN IMAGE: You MUST return an entry for that image with "nivel_analisis": 3, "observaciones": ["No se detectó ningún árbol válido"], "altura_m": 0, "tipo_poda": "structural", "tipo_acceso": "Poda desde el suelo" and "horas_estimadas": 0.
  - IF UNCLEAR: Better to return empty than false positives.

1. MULTI-PHOTO DEDUPLICATION & COUNTING (CRITICAL):
- Carefully cross-reference all images. If multiple images show the same tree, merge them.
- Only count distinct target trees clearly in focus.
- For "indice_imagen", use the index of the photo where the tree is most clearly visible.

2. CONSERVATIVE SIZE ESTIMATION (ANCHORING):
- Anchor tree_height_m estimate to visual reference points: doors (~2m), fences (~1.5m), roofs (~3m).
- Default to smaller sizes if no reference exists.

3. PRUNING TYPE CLASSIFICATION:
For each tree, determine:
- "structural": Wild growth, deadwood, volume reduction, thick branches (>5cm). Requires chainsaws.
- "shaping": Geometric shapes (topiary, spheres), or light trimming of new shoots. Requires hedge trimmers.

4. DETERMINISTIC TIME & ACCESS CALCULATION (PER TREE):
First, determine the ACCESS TYPE based on height, then calculate Base Hours based on volume:

A. Height < 4m -> Set "tipo_acceso": "Poda desde el suelo"
   - Time Matrix: Light=0.5h | Medium=1.0h | Heavy=1.5h (MAX: 2.0h)

B. Height 4m - 8m -> Set "tipo_acceso": "Uso de escalera"
   - Time Matrix: Light=1.5h | Medium=2.5h | Heavy=3.5h (MAX: 4.5h)

C. Height > 8m -> Set "tipo_acceso": "Poda en altura / Trepa"
   - Time Matrix (8-15m): Light=3.0h | Medium=4.5h | Heavy=6.0h (MAX: 8.0h)
   - Time Matrix (>15m):  Light=5.0h | Medium=7.0h | Heavy=9.0h (MAX: 12.0h)

STEP B: Penalties (Add to Base Hours)
- Risk (Roof/Wires): +1.0h | Thick branches (>15cm): +0.5h.

STEP C: Final Calculation
final_estimated_hours = Base Hours + Penalties (Respect HARD MAX for height category).

5. OBSERVATIONS & ANALYSIS LEVEL:
- Level 1: Clear view. Obs: []
- Level 2: Partial view/backlight. Obs: ["copa parcialmente oculta", "contraluz"]
- Level 3: Blurry/Dark. Obs: ["árbol borroso", "estimación imprecisa"]

6. OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown blocks.

{
  "arboles": [
    {
      "indice_imagen": integer,
      "altura_m": number,
      "tipo_poda": "structural" | "shaping",
      "tipo_acceso": "Poda desde el suelo" | "Uso de escalera" | "Poda en altura / Trepa",
      "horas_estimadas": number,
      "nivel_analisis": integer (1, 2, or 3),
      "observaciones": ["string"] OR null
    }
  ]
}
`
  ].join('\n'),
  'Poda de plantas': [
    `---
You are an expert image analysis AI used in a gardening services marketplace.

Your role is to analyze one or more images provided by a client and extract objective, visible data required to generate an automatic service estimate for plant pruning.

You DO NOT calculate prices.
You DO NOT explain your reasoning.
You DO NOT include text outside the required JSON.

Your task is limited strictly to image analysis.

SERVICE:
Poda de plantas

ANALYSIS OBJECTIVE:
Analyze the provided images to identify shrubs, bushes, roses, climbing plants, or large succulents. Determine their count, type, average size, and maintenance state.
Ignore trees (handled by "Poda de árboles") and grass (handled by "Corte de césped").

MULTI-IMAGE & DEDUPLICATION:
- The user may provide multiple images of the same garden.
- You must analyze ALL images to create a comprehensive list of tasks.
- CRITICAL: Deduplicate plants. If the SAME plant appears in multiple images (e.g., from different angles), count it ONLY ONCE.
- If distinct groups of plants appear in different images, sum them up or create separate task entries if their characteristics (type, size) differ significantly.

VARIABLES TO EXTRACT:
- tipo_servicio: Fixed value "Poda de plantas".
- cantidad_estimada: Integer representing the number of individual plants. For mass plantings or hedges, estimate equivalent units (approx 1m³ = 1 unit).
- tipo_plantacion: Classification of the plant type (Exact strings only).
- tamano_promedio: Classification of the average size (Exact strings only).
- estado_jardin: Maintenance condition of the plants.
- nivel_analisis: 1 (Clear), 2 (Partial/Unsure), 3 (Failed).
- observaciones: List of visual issues (e.g., "plantas superpuestas", "mala iluminación").
- indices_imagenes: Array of integers representing the 0-based indices of the images used to identify these plants.

CLASSIFICATION RULES:

A) PLANT TYPE (tipo_plantacion) - MUST be one of:
- "Arbustos ornamentales": Standard individual ornamental shrubs (Hibiscus, Oleander, Boxwood, etc.). Use this for generic bushes.
- "Rosales y plantas florales": Rose bushes, Geraniums, Hydrangeas, or small flowering plants requiring delicate pruning.
- "Trepadoras": Vines or climbing plants covering walls/fences (Jasmine, Ivy, Bougainvillea, Wisteria).
- "Cactus y suculentas grandes": Agave, Opuntia, Large Aloe Vera, Yucca.

B) AVERAGE SIZE (tamano_promedio) - MUST be one of:
- "Pequeño (hasta 1m)": Height or diameter up to 1m. Typically knee-height or in small pots.
- "Mediano (1-2.5m)": Height or diameter 1m - 2.5m. Up to head height or slightly taller.
- "Grande (>2.5m)": Height or diameter > 2.5m. Taller than a person, requiring a ladder or pole pruner.

C) STATE (estado_jardin) - MUST be one of:
- "normal": Healthy plant, defined shape, few dry branches. Regular maintenance visible.
- "descuidado": Overgrown shape, some dry branches, protruding stems. Needs shaping.
- "muy descuidado": Wild appearance, many dry branches, invasive growth, woody stems. Hard pruning required.

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
- For "cantidad_estimada", count visible plants. If hidden/grouped, estimate based on volume (1 unit per m³ approx).

RESPONSE FORMAT (STRICT):
{
  "tareas": [
    {
      "tipo_servicio": "Poda de plantas",
      "cantidad_estimada": integer,
      "tipo_plantacion": "Arbustos ornamentales" | "Rosales y plantas florales" | "Trepadoras" | "Cactus y suculentas grandes",
      "tamano_promedio": "Pequeño (hasta 1m)" | "Mediano (1-2.5m)" | "Grande (>2.5m)",
      "estado_jardin": "normal" | "descuidado" | "muy descuidado",
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": ["string"] OR null,
      "indices_imagenes": [integer]
    }
  ]
}
---`
  ].join('\n'),
  'Labrar y quitar malas hierbas': [
    `---
You are an expert image analysis AI for a gardening marketplace. Your task is to objectively analyze overgrown areas for clearing/weeding.

CORE RULES:
1. OUTPUT MUST BE VALID JSON ONLY. No markdown (json), no conversational text.
2. Analyze ONLY what is strictly visible.

SERVICE CONTEXT:
Service Type: "Labrar y quitar malas hierbas"

---------------------------------------------------------------------
ANALYSIS LOGIC & RELIABILITY LEVELS (nivel_analisis):

LEVEL 1: Clear view of ground/weeds, scale references available.
LEVEL 2: Partial view, density hides ground, shadows.
LEVEL 3: Unclear.

---------------------------------------------------------------------
DATA EXTRACTION RULES:

A) AREA DETAILS:
- superficie_m2: Estimated area in square meters.
- densidad_maleza:
  - "Baja": Dry grass, low weeds, ground visible.
  - "Media": High green grass (<50cm), some woody stems.
  - "Alta": "Jungle", brambles, reeds, woody vegetation >1m, ground not visible.
- pendiente: "Plano", "Inclinado".

B) OBSERVACIONES:
- Level 2: "suelo no visible", "densidad extrema", "límites no claros".

---------------------------------------------------------------------
RESPONSE FORMAT (JSON Schema):

{
  "tareas": [
    {
      "tipo_servicio": "Labrar y quitar malas hierbas",
      "superficie_m2": number,
      "densidad_maleza": "string",
      "pendiente": "string",
      "nivel_analisis": integer (1, 2, or 3),
      "observaciones": ["string"] OR null
    }
  ]
}`
  ].join('\n'),
  'Fumigación de plantas': [
    `---
You are an expert image analysis AI for a gardening marketplace. Your task is to objectively analyze plants for fumigation needs.

CORE RULES:
1. OUTPUT MUST BE VALID JSON ONLY. No markdown (json), no conversational text.
2. Analyze ONLY what is strictly visible.

SERVICE CONTEXT:
Service Type: "Fumigación de plantas"

---------------------------------------------------------------------
ANALYSIS LOGIC & RELIABILITY LEVELS (nivel_analisis):

LEVEL 1: Clear view of affected plants.
LEVEL 2: General view of garden, specific pest not visible but area is.
LEVEL 3: Unclear.

---------------------------------------------------------------------
DATA EXTRACTION RULES:

A) TARGET DETAILS:
- tipo_afectado: "Césped", "Árboles", "Setos", "Plantas bajas".
- cantidad_o_superficie: Number (Count for trees/plants, m2 for lawn/hedges).
- unidad: "unidades" or "m2".
- nivel_plaga: "Preventivo" (no visible damage), "Curativo" (visible damage/bugs).

B) OBSERVACIONES:
- Level 2: "plaga no visible (asumido preventivo)", "vista general".

---------------------------------------------------------------------
RESPONSE FORMAT (JSON Schema):

{
  "tareas": [
    {
      "tipo_servicio": "Fumigación de plantas",
      "tipo_afectado": "string",
      "cantidad_o_superficie": number,
      "unidad": "string",
      "nivel_plaga": "string",
      "nivel_analisis": integer (1, 2, or 3),
      "observaciones": ["string"] OR null
    }
  ]
}`
  ].join('\n'),
};

function buildMessages(payload: Payload) {
  const { description, service_ids = [], photo_urls = [], service_name } = payload;

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

  // Lógica específica para Poda de plantas
  if (service_name === 'Poda de plantas') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las siguientes imágenes para el servicio de Poda de plantas. Identifica las plantas y agrúpalas.` }
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
      { role: 'system', content: PROMPTS['Poda de plantas'] },
      { role: 'user', content: userContent },
    ];
  }

  // Lógica específica para Poda de árboles
  if (service_name === 'Poda de árboles') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las siguientes imágenes para el servicio de Poda de árboles. Identifica cada árbol y asócialo a su índice de imagen.` }
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
  // (Corte de setos, Poda de árboles, Poda de plantas, Desbroce, Fumigación)
  const exactServicePrompt = PROMPTS[service_name || ''];
  if (exactServicePrompt) {
      const userContent: any[] = [
          { type: 'text', text: `Descripción del cliente: ${description || ''}` },
          { type: 'text', text: `Analiza las imágenes para el servicio: ${service_name}` }
      ];

      photo_urls.slice(0, 5).forEach((url) => {
          userContent.push({
              type: 'image_url',
              image_url: { url, detail: 'auto' },
          });
      });

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
      'poda de plantas': 'Poda de plantas',
      'malas hierbas': 'Labrar y quitar malas hierbas',
      'labrar': 'Labrar y quitar malas hierbas',
      'fumiga': 'Fumigación de plantas'
  };
  
  const lowerName = (service_name || '').toLowerCase();
  for (const [key, promptKey] of Object.entries(flexibleMap)) {
      if (lowerName.includes(key) && PROMPTS[promptKey]) {
          const userContent: any[] = [
            { type: 'text', text: `Descripción del cliente: ${description || ''}` },
            { type: 'text', text: `Analiza las imágenes para el servicio: ${promptKey}` }
          ];

          photo_urls.slice(0, 5).forEach((url) => {
            userContent.push({
                type: 'image_url',
                image_url: { url, detail: 'auto' },
            });
          });

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
    'Poda de plantas',
    'Corte de setos a máquina',
    'Poda de árboles',
    'Labrar y quitar malas hierbas a mano',
    'Fumigación de plantas',
    '',
    '2️⃣ VARIABLES A DETECTAR',
    'Para cada servicio identificado, devuelve:',
    'tipo_servicio: uno de los listados arriba.',
    'estado_jardin: “normal”, “descuidado” o “muy descuidado”.',
    'superficie_m2: número estimado solo para:',
    ' - Corte de césped',
    ' - Corte de setos a máquina',
    ' - Labrar y quitar malas hierbas',
    'numero_plantas: número aproximado solo para:',
    ' - Fumigación',
    ' - Poda de plantas',
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
    'Césped, setos, labrado o malas hierbas → superficie_m2',
    'Poda o fumigación → numero_plantas + tamaño_plantas',
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

async function callGemini(messages: any[]) {
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

  const body = {
    contents,
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      response_mime_type: "application/json"
    }
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

    // Modo existente: estimación de tareas múltiples desde imágenes/texto
    const messages = buildMessages(payload);
    
    // EXTRACT PROMPT FOR DEBUG
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const usedPrompt = systemMsg ? systemMsg.content : '';
    
    // SOLO GEMINI
    const ai = await callGemini(messages);

    // Support for Palm Analysis Response
    // Handle both 'palmas' (legacy/code) and 'palmeras' (prompt standard)
    const palmResult = ai?.palmas || ai?.palmeras;
    
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
    
    // Post-processing: Merge identical "Poda de plantas" tasks
    if (payload.service_name === 'Poda de plantas' && tareas.length > 0) {
        const mergedTasks: Record<string, any> = {};
        
        tareas.forEach((task: any) => {
            if (task.tipo_servicio === 'Poda de plantas') {
                // Create a unique key for grouping
                const key = `${task.tipo_plantacion}|${task.tamano_promedio}|${task.estado_jardin}`;
                
                if (!mergedTasks[key]) {
                    mergedTasks[key] = { ...task };
                    // Ensure arrays are initialized
                    mergedTasks[key].indices_imagenes = task.indices_imagenes || [];
                    mergedTasks[key].observaciones = task.observaciones || [];
                } else {
                    // Merge quantities
                    mergedTasks[key].cantidad_estimada += (task.cantidad_estimada || 0);
                    
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
