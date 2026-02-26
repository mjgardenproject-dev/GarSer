export interface AITask {
  tipo_servicio: string;
  // Lawn
  especie_cesped?: string; 
  estado_jardin?: string; 
  superficie_m2?: number | null;
  
  // Generic / Legacy
  numero_plantas?: number | null;
  tamaño_plantas?: string | null; 
  
  // Hedges
  longitud_m?: number | null;
  altura_m?: number | null;
  tipo_seto?: string | null;
  dificultad_acceso?: 1 | 2 | 3 | null;

  // Trees
  cantidad?: number | null;
  altura_aprox_m?: number | null;
  tipo_arbol?: string | null;

  // Shrubs
  cantidad_estimada?: number | null;
  tamano_promedio?: string | null;
  tamaño_promedio?: string | null; // Legacy/Compat
  tipo_plantacion?: string | null;
  indices_imagenes?: number[]; // Added for multi-image tracking

  // Clearing
  densidad_maleza?: string | null;

  // Fumigation
  cantidad_o_superficie?: number | null;
  unidad?: string | null;
  nivel_plaga?: string | null;

  // Common
  nivel_analisis?: number; // 1, 2, 3
  observaciones?: string[];
}

interface EstimationInput {
  description: string;
  photoCount: number;
  selectedServiceIds: string[];
  photoUrls?: string[]; // URLs de las fotos para análisis IA
  serviceName?: string; // Optional: Name of the primary service for specific prompting
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash'; // Nuevo selector de modelo
}

export interface EstimationResult {
  tareas: AITask[];
  palmas?: Array<{
    indice_imagen: number;
    especie: string;
    altura: string;
    estado?: string;
    nivel_analisis?: number;
    observaciones?: string[];
  }>;
  arboles?: Array<{
    indice_imagen: number;
    especie: string;
    altura: string;
    tipo_acceso?: string;
    tipo_poda?: string;
    horas_estimadas?: number;
    nivel_analisis?: number;
    observaciones?: string[];
  }>;
  reasons?: string[];
  rawResponse?: any; // New field for debug
}

// Eliminar fallback: solo OpenAI
import { supabase } from '../lib/supabase';

export async function estimateWorkWithAI(input: EstimationInput): Promise<EstimationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
      body: {
        description: '',
        service_ids: input.selectedServiceIds,
        photo_urls: input.photoUrls,
        photo_count: input.photoCount,
        service_name: input.serviceName,
        model: input.model || 'gemini-2.0-flash',
      },
    });
    if (error) {
      console.warn('[AI] Edge Function error:', error);
      return { tareas: [], rawResponse: { error } };
    }
    const tareas = Array.isArray((data as any)?.tareas) ? (data as any).tareas : [];
    const palmas = Array.isArray((data as any)?.palmas) ? (data as any).palmas : undefined;
    const arboles = Array.isArray((data as any)?.arboles) ? (data as any).arboles : undefined;
    const reasons = Array.isArray((data as any)?.reasons) ? (data as any).reasons : undefined;
    return { tareas, palmas, arboles, reasons, rawResponse: data };
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

export async function estimateServiceAutoQuote(params: { service: string; imageUrl: string; description?: string; model?: 'gpt-4o-mini' | 'gemini-2.0-flash' }): Promise<AutoQuoteResponse | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
      body: {
        mode: 'auto_quote',
        service: params.service,
        image_url: params.imageUrl,
        description: '',
        model: params.model || 'gemini-2.0-flash',
      },
    });
    if (error) {
      console.warn('[AI] auto_quote error:', error);
      return null;
    }
    const analysis = (data as any)?.analysis;
    const result = (data as any)?.result;
    if (analysis && result) {
      return { analysis, result, version: (data as any)?.version } as AutoQuoteResponse;
    }
    return null;
  } catch (e) {
    console.warn('[AI] auto_quote invoke failed:', e);
    return null;
  }
}

const LOCAL_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 1.0, 2: 1.3, 3: 1.7 };
const LOCAL_PERF: Record<string, { performance: number; pricePerUnit: number }> = {
  'Corte de césped': { performance: 100, pricePerUnit: 0.30 },
  'Corte de setos': { performance: 25, pricePerUnit: 3.50 },
  'Fumigación': { performance: 40, pricePerUnit: 2.50 },
  'Poda de plantas': { performance: 8, pricePerUnit: 6.00 },
  'Poda de árboles': { performance: 0.8, pricePerUnit: 45.00 },
  'Labrar y quitar malas hierbas': { performance: 15, pricePerUnit: 10.00 },
};

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
Eres una IA especializada en análisis de jardines llamada 'HedgeMap'. Tu objetivo es analizar imágenes para presupuestar recorte de setos.

INSTRUCCIONES DE ANÁLISIS:
1. Detecta la longitud total de setos en metros lineales.
2. Estima la altura promedio.
3. Clasifica el tipo de seto.
4. Evalúa la dificultad de acceso (obstáculos, altura, densidad).

VARIABLES A EXTRAER:
- tipo_servicio: "Corte de setos"
- longitud_m: Longitud estimada en metros.
- altura_m: Altura estimada en metros.
- tipo_seto: "Conífera (Ciprés/Tuya)", "Laurel/Hoja ancha", "Hiedra/Trepandora", "Seto Mixto/Otro".
- dificultad_acceso: 1 (Fácil), 2 (Medio/Escalera), 3 (Difícil/Andamio/Pértiga).
- nivel_analisis: 1 (Claro), 2 (Parcial/Borroso), 3 (Inutilizable).
- observaciones: Lista de observaciones visuales (ej. "Seto muy denso", "Requiere escalera alta").

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Corte de setos",
      "longitud_m": number,
      "altura_m": number,
      "tipo_seto": string,
      "dificultad_acceso": 1 | 2 | 3,
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
2. Estima la altura promedio.
3. Clasifica el tipo de árbol.

VARIABLES A EXTRAER:
- tipo_servicio: "Poda de árboles"
- cantidad: Número de árboles.
- altura_aprox_m: Altura aproximada en metros.
- tipo_arbol: "Frutal", "Decorativo", "Conífera".
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles (ej. "Ramas cerca de cables", "Árbol muy alto").

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Poda de árboles",
      "cantidad": number,
      "altura_aprox_m": number,
      "tipo_arbol": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Poda de plantas': `---
Eres una IA especializada en análisis de jardines llamada 'PlantShapeAI'. Tu objetivo es analizar arbustos, rosales u ornamentales.

INSTRUCCIONES DE ANÁLISIS:
1. Estima la cantidad de plantas (o plantas equivalentes si son setos bajos).
2. Determina el tamaño promedio.
3. Clasifica el tipo de plantación.

VARIABLES A EXTRAER:
- tipo_servicio: "Poda de plantas"
- cantidad_estimada: Número estimado de plantas.
- tamano_promedio: "Pequeño (hasta 1m)", "Mediano (1-2.5m)", "Grande (>2.5m)".
- tipo_plantacion: "Arbustos ornamentales", "Rosales y plantas florales", "Trepadoras", "Cactus y suculentas grandes".
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles.

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Poda de plantas",
      "cantidad_estimada": number,
      "tamano_promedio": string,
      "tipo_plantacion": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Labrar y quitar malas hierbas': `---
Eres una IA especializada en análisis de jardines llamada 'SoilSense'. Tu objetivo es analizar terreno para deshierbe manual y labrado.

INSTRUCCIONES DE ANÁLISIS:
1. Estima la superficie afectada en m2.
2. Evalúa la densidad de la maleza.

VARIABLES A EXTRAER:
- tipo_servicio: "Labrar y quitar malas hierbas"
- superficie_m2: Área estimada en m2.
- densidad_maleza: "Baja" (Maleza ligera), "Media" (Maleza densa), "Alta" (Cañaveral/Zarzas).
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles (ej. "Terreno pedregoso", "Raíces profundas").

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Labrar y quitar malas hierbas",
      "superficie_m2": number,
      "densidad_maleza": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`,
  'Fumigación': `---
Eres una IA especializada en análisis de jardines llamada 'PestVision'. Tu objetivo es analizar imágenes para presupuestar fumigación.

INSTRUCCIONES DE ANÁLISIS:
1. Estima la cantidad o superficie afectada.
2. Determina el tipo de tratamiento necesario (Preventivo o Curativo).

VARIABLES A EXTRAER:
- tipo_servicio: "Fumigación"
- cantidad_o_superficie: Número (si son plantas) o m2 (si es área).
- unidad: "plantas" o "m2".
- nivel_plaga: "Insecticida" (Insectos/Preventivo), "Fungicida" (Hongos/Manchas), "Herbicida" (Malas hierbas en superficie dura).
- nivel_analisis: 1 (Claro), 2 (Parcial), 3 (Inutilizable).
- observaciones: Lista de detalles (ej. "Pulgón visible", "Hojas comidas").

FORMATO DE SALIDA (JSON ÚNICAMENTE):
{
  "tareas": [
    {
      "tipo_servicio": "Fumigación",
      "cantidad_o_superficie": number,
      "unidad": string,
      "nivel_plaga": string,
      "nivel_analisis": 1 | 2 | 3,
      "observaciones": string[]
    }
  ]
}
---`
};

async function estimateServiceAutoQuoteLocal(): Promise<AutoQuoteResponse | null> { return null; }
