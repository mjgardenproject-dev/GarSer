export interface AITask {
  tipo_servicio: string;
  // Lawn
  especie_cesped?: string; 
  estado_jardin?: string; 
  superficie_m2?: number | null;
  
  // Desbroce de malas hierbas
  superficie_malas_hierbas_m2?: number | null;
  estado_malas_hierbas?: 'normal' | 'dificultad_media' | 'dificultad_alta' | null;

  // Generic / Legacy
  numero_plantas?: number | null;
  tamaño_plantas?: string | null; 
  
  // Hedges
  longitud_m?: number | null;
  altura_m?: number | null;
  tipo_seto?: string | null;
  estado_seto?: string | null;
  dificultad_acceso?: 1 | 2 | 3 | null; // Legacy
  caras?: number | {
    cara_a?: {
      longitud_m?: number;
      altura_m?: number;
      nivel_analisis?: number;
      observaciones?: string[];
    };
    cara_b?: {
      longitud_m?: number;
      altura_m?: number;
      nivel_analisis?: number;
      observaciones?: string[];
    };
  };
  detalle_caras?: {
    cara_a?: {
      longitud_m?: number;
      altura_m?: number;
      nivel_analisis?: number;
      observaciones?: string[];
    };
    cara_b?: {
      longitud_m?: number;
      altura_m?: number;
      nivel_analisis?: number;
      observaciones?: string[];
    };
  };
  resumen_medicion?: {
    base_longitud_m?: number;
    base_altura_m?: number;
    caras_recortar?: number;
    longitud_calculo_m?: number;
    altura_calculo_m?: number;
    metodo?: string;
  };

  // Trees
  cantidad?: number | null;
  altura_aprox_m?: number | null;
  tipo_arbol?: string | null;

  // Shrubs
  razonamiento_cot?: {
    identificacion_escalas?: string;
    calculo_area_total?: string;
    calculo_area_plantas?: string;
    derivacion_porcentaje?: string;
  };
  cantidad_estimada?: number | null;
  tamano_total_jardin_m2?: number | null;
  porcentaje_superficie_plantas?: number | null;
  tamano_promedio?: string | null;
  tamaño_promedio?: string | null; // Legacy/Compat
  tipo_plantacion?: string | null;
  indices_imagenes?: number[]; // Added for multi-image tracking
  tamano_dominante?: string | null;

  // Phytosanitary
  cantidad_o_superficie?: number | null;
  unidad?: string | null;
  nivel_plaga?: string | null;
  tipo_afectado?: 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras' | null;
  tratamiento_recomendado?: 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia' | 'inconclusive' | null;
  confidence?: number | null;
  altura_tramo?: 'bajos_medios' | 'altos' | 'pequenos' | 'medianos' | 'grandes' | 'pequenas' | 'medianas' | 'altas' | null;
  supera_2m?: boolean | null;
  supera_3m?: boolean | null;
  palmeras_cirugia?: boolean | null;
  elementos_detectados?: {
    setos?: {
      ml_bands?: {
        bajos_medios?: number;
        altos?: number;
      };
    };
    arboles?: {
      size_bands?: {
        pequenos?: number;
        medianos?: number;
        grandes?: number;
      };
    };
    palmeras?: {
      size_bands?: {
        pequenas?: number;
        medianas?: number;
        altas?: number;
      };
      surgery_recommended?: boolean;
    };
  };

  // Common
  nivel_analisis?: number; // 1, 2, 3
  observaciones?: string[];
}

interface EstimationInput {
  description: string;
  photoCount: number;
  selectedServiceIds: string[];
  photoUrls?: string[]; // URLs de las fotos para análisis IA
  hedgeFaces?: {
    face_a_urls: string[];
    face_b_urls?: string[];
  };
  serviceName?: string; // Optional: Name of the primary service for specific prompting
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash'; // Nuevo selector de modelo
  phytosanitary_scopes?: string[];
}

export interface EstimationResult {
  tareas: AITask[];
  palmas?: Array<{
    indice_imagen: number;
    especie: 'Phoenix canariensis' | 'Phoenix dactylifera' | 'Washingtonia robusta/filifera' | 'Syagrus romanzoffiana' | 'Trachycarpus fortunei' | 'Roystonea regia';
    altura: string;
    estado?: string;
    nivel_analisis?: number;
    observaciones?: string[];
    hasPhytosanitary?: boolean;
    hasTrunkPeeling?: boolean;
    lowestRangeThreshold?: string;
    highestOpenRangeThreshold?: string;
    isTerminalOpenRange?: boolean;
    allowsPriceChange?: boolean;
    // Legacy compatibility
    needsPhytosanitary?: boolean;
    needsTrunkFinish?: boolean;
    hasAccessDifficulty?: boolean;
  }>;
  arboles?: Array<{
    indice_imagen: number;
    especie?: string;
    altura?: string;
    size_band?: 'small' | 'medium' | 'large' | 'over_9';
    altura_m?: number;
    // Legacy field; business logic should not depend on IA difficulty.
    dificultad_alta?: boolean;
    tipo_acceso?: string;
    tipo_poda?: string;
    horas_estimadas?: number;
    nivel_analisis?: number;
    observaciones?: string[];
  }>;
  metricas_fitosanitarias?: any;
  reasons?: string[];
  rawResponse?: any; // New field for debug
}

// Eliminar fallback: solo OpenAI
import { supabase } from '../lib/supabase';

export async function estimateWorkWithAI(input: EstimationInput): Promise<EstimationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
      body: {
        description: input.serviceName === 'Servicios fitosanitarios' ? input.description : '',
        service_ids: input.selectedServiceIds,
        photo_urls: input.photoUrls,
        hedge_faces: input.hedgeFaces,
        photo_count: input.photoCount,
        service_name: input.serviceName,
        model: input.model || 'gemini-2.0-flash',
        phytosanitary_scopes: input.phytosanitary_scopes,
      },
    });
    if (error) {
      console.warn('[AI] Edge Function error:', error);
      throw new Error(error.message || 'System Error');
    }
    const tareas = Array.isArray((data as any)?.tareas) ? (data as any).tareas : [];
    const palmas = Array.isArray((data as any)?.palmas) ? (data as any).palmas : undefined;
    const arboles = Array.isArray((data as any)?.arboles) ? (data as any).arboles : undefined;
    const reasons = Array.isArray((data as any)?.reasons) ? (data as any).reasons : undefined;
    const metricas_fitosanitarias = (data as any)?.metricas_fitosanitarias;
    return { tareas, palmas, arboles, reasons, metricas_fitosanitarias, rawResponse: data };
  } catch (e) {
    console.warn('[AI] Fallo invocando Edge Function:', e);
    return { tareas: [], rawResponse: { exception: e } };
  }
}

export interface PalmPricingResult {
    tiempoPreparacion: number;
    tiempoPodaBruto: number;
    factorEficiencia: number;
    tiempoTotalEstimado: number;
}

export async function calculatePalmHours(palms: any[]): Promise<PalmPricingResult> {
    const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
        body: {
            mode: 'calculate_palm_pricing',
            palms
        }
    });
    if (error) {
        console.warn('[AI] Palm pricing calculation error:', error);
        throw error;
    }
    return data as PalmPricingResult;
}

/* Merged into primary estimateWorkWithAI; duplicate removed to avoid conflicts */

export interface AutoQuoteAnalysis {
  servicio: string;
  cantidad: number;
  unidad: string;
  dificultad: 1 | 2 | 3;
}

export interface AutoQuoteResponse {
  analysis: AutoQuoteAnalysis;
  result: { tiempo_estimado_horas: number; precio_estimado: number };
  version?: string;
}

// Removed legacy hardcoded performance pricing logic as it's now handled dynamically in ProvidersPage.tsx
export async function estimateServiceAutoQuote(params: { 
  service: string; 
  imageUrl: string; 
  description?: string; 
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash';
  gardenerConfig?: any;
}): Promise<AutoQuoteResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
      body: {
        mode: 'auto_quote',
        service: params.service,
        image_url: params.imageUrl,
        description: '',
        model: params.model || 'gemini-2.0-flash',
        gardener_config: params.gardenerConfig
      },
    });

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error in estimateServiceAutoQuote:', err);
    return null;
  }
}

const PROMPTS_MAP: Record<string, string> = {
  'Corte de césped': `---
You are an image analysis AI used in a gardening services marketplace.

Your role is to analyze one or more images provided by a client and extract objective, visible data required to generate an automatic service estimate.

You DO NOT calculate prices.
You DO NOT explain your reasoning.
You DO NOT include text outside the required JSON.

Your task is limited strictly to image analysis.

SERVICE:
Corte de césped

ANALYSIS OBJECTIVE:
Analyze the lawn area to determine its surface area in square meters and its current state based on height, invasion of boundaries, and uniformity.

VARIABLES TO EXTRACT:
- tipo_servicio (Fixed value: "Corte de césped")
- estado_jardin (Classification based on rules below)
- superficie_m2 (Visual estimation of the total lawn area)
- numero_plantas (Always null for this service)
- tamaño_plantas (Always null for this service)
- nivel_analisis (1=Clear/High Confidence, 2=Partial/Blurry/Medium Confidence, 3=Unusable/Fail)
- observaciones (List of specific visual observations, issues, or warnings)

CLASSIFICATION RULES (estado_jardin):

1. normal
   - Height: Max 5 cm. Stem base visible if close. Sprinkler heads not hidden.
   - Invasion: Respects boundaries (paths/curbs). No grass hanging over pavement.
   - Uniformity: 100% grass (or dominant species). No broad-leaf weeds or woody stems.

2. descuidado
   - Height: 6-12 cm. Tips bending due to weight. Sprinklers/furniture legs hidden.
   - Invasion: Overhangs >5 cm onto paths/stones. Requires edge trimming.
   - Uniformity: Patchy heights or seed heads (flowering) visible. Indicates lack of recent cut.

3. muy descuidado
   - Height: >12-15 cm. Soil/plant bases not visible due to density.
   - Invasion: No defined edges; grass colonized paths/beds.
   - Uniformity: Tall weeds, hard stems, or non-grass vegetation present. Requires brush cutter before mowing.

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
- For "superficie_m2", estimate the total visible lawn area across all images.

RESPONSE FORMAT (STRICT):
{
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "estado_jardin": "normal" | "descuidado" | "muy descuidado",
      "superficie_m2": number,
      "numero_plantas": null,
      "tamaño_plantas": null,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Corte de setos': `---
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
---`,
  'Poda de árboles': `---
Eres una IA especializada en análisis de jardines llamada 'TreeScale'. Tu objetivo es analizar árboles para poda.

INSTRUCCIONES DE ANÁLISIS:
1. Cuenta el número de árboles a podar.
2. Clasifica el tamaño en bandas, sin calcular altura exacta.
3. Clasifica el tipo de árbol.

VARIABLES A EXTRAER:
- tipo_servicio: "Poda de árboles"
- cantidad: Número de árboles.
- size_band: "small" | "medium" | "large" | "over_9".
- tipo_arbol: "Frutal", "Decorativo", "Conífera".
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles (ej. "Ramas cerca de cables", "Árbol muy alto").

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Poda de árboles",
      "cantidad": number,
      "size_band": "small" | "medium" | "large" | "over_9",
      "tipo_arbol": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Poda de plantas y arbustos': `---
Eres una IA especializada en análisis de jardines llamada 'PlantShapeAI'. Tu objetivo es analizar arbustos, rosales u ornamentales para el servicio de poda.

INSTRUCCIONES DE ANÁLISIS:
1. Estima el tamaño total del jardín visible en la imagen (m2).
2. Determina el porcentaje de la superficie de ese jardín que está cubierta por las plantas a podar.
3. Determina el tamaño dominante de las plantas.

### MANDATORY CHAIN OF THOUGHT (CoT) ###
Debes rellenar el objeto "razonamiento_cot" ANTES de dar los resultados numéricos:
1. "identificacion_escalas": Explica qué objetos estándar usaste para calibrar los metros cuadrados (ej. puertas, vallas, coches).
2. "calculo_area_total": Explica tu estimación matemática del ancho x fondo del jardín visible.
3. "calculo_area_plantas": Explica tu estimación matemática del área cubierta solo por las plantas.
4. "derivacion_porcentaje": El cálculo que te lleva a elegir obligatoriamente 10, 25, 50, 75 o 100.

VARIABLES A EXTRAER:
- tipo_servicio: "Poda de plantas y arbustos"
- razonamiento_cot: Objeto con la explicación matemática de las áreas y porcentajes.
- tamano_total_jardin_m2: Número entero con la estimación del área total del jardín visible.
- porcentaje_superficie_plantas: Porcentaje del área cubierta por las plantas a podar. SOLO puede ser: 10, 25, 50, 75 o 100.
- tamano_dominante: "pequeñas" (0-1m), "medianas" (1-2m), "grandes" (2-3m).
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles.

FORMATO DE SALIDA (JSON ÚNICAMENTE):
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
      "tamano_total_jardin_m2": number,
      "porcentaje_superficie_plantas": number,
      "tamano_dominante": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Servicios fitosanitarios': `---
Eres una IA especializada en análisis de jardines llamada 'PestVision'. Tu objetivo es analizar imágenes para presupuestar tratamientos fitosanitarios.

INSTRUCCIONES DE ANÁLISIS:
1. Estima la cantidad o superficie afectada.
2. Determina el tipo de tratamiento necesario (Preventivo o Curativo).

VARIABLES A EXTRAER:
- tipo_servicio: "Servicios fitosanitarios"
- tipo_afectado: "Césped" | "Árboles" | "Setos" | "Plantas bajas" | "Palmeras".
- cantidad_o_superficie: Número (si son plantas) o m2 (si es área).
- unidad: "unidades" o "m2".
- tratamiento_recomendado: "insecticida" | "fungicida" | "ecologico_preventivo" | "endoterapia" | "inconclusive".
- altura_tramo: "bajos_medios" | "altos" | "pequenos" | "medianos" | "grandes" | "pequenas" | "medianas" | "altas" | null.
- palmeras_cirugia: boolean | null.
- confidence: número entre 0 y 1.
- nivel_plaga: etiqueta corta alineada con el tratamiento.
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles (ej. "Pulgón visible", "Hojas comidas").
- elementos_detectados:
  - setos.ml_bands.bajos_medios | altos
  - arboles.size_bands.pequenos | medianos | grandes
  - palmeras.size_bands.pequenas | medianas | altas
  - palmeras.surgery_recommended

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Servicios fitosanitarios",
      "tipo_afectado": string,
      "cantidad_o_superficie": number,
      "unidad": string,
      "tratamiento_recomendado": string,
      "nivel_plaga": string,
      "altura_tramo": string | null,
      "palmeras_cirugia": boolean | null,
      "confidence": number,
      "elementos_detectados": object,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`
};

async function estimateServiceAutoQuoteLocal(): Promise<AutoQuoteResponse | null> { return null; }
