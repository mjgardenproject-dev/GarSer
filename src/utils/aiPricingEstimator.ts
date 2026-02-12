export interface AITask {
  tipo_servicio: string;
  especie_cesped?: string; // "Bermuda...", "Gramón...", "Dichondra...", "Césped Mixto..."
  estado_jardin: string; // "normal" | "descuidado" | "muy descuidado"
  superficie_m2: number | null;
  numero_plantas: number | null;
  tamaño_plantas: string | null; // "pequeñas" | "medianas" | "grandes" | "muy grandes"
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

interface EstimationResult {
  tareas: AITask[];
  palmas?: Array<{
    indice_imagen: number;
    especie: string;
    altura: string;
    estado?: string;
  }>;
  reasons?: string[];
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
        model: input.model || 'gpt-4o-mini',
      },
    });
    if (error) {
      console.warn('[AI] Edge Function error:', error);
      return { tareas: [] };
    }
    const tareas = Array.isArray((data as any)?.tareas) ? (data as any).tareas : [];
    const palmas = Array.isArray((data as any)?.palmas) ? (data as any).palmas : undefined;
    const reasons = Array.isArray((data as any)?.reasons) ? (data as any).reasons : undefined;
    return { tareas, palmas, reasons };
  } catch (e) {
    console.warn('[AI] Fallo invocando Edge Function:', e);
    return { tareas: [] };
  }
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
        model: params.model || 'gpt-4o-mini',
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
      "tamaño_plantas": null
    }
  ]
}
---`,
  'Corte de setos': "Eres una IA especializada en análisis de jardines llamada 'HedgeMap'. Tu objetivo es analizar imágenes para presupuestar recorte de setos.\n\nINSTRUCCIONES DE ANÁLISIS:\n1. Detecta la superficie total de setos (largo × altura) en m².\n2. Analiza densidad, grosor de ramas y uniformidad.\n3. Evalúa accesibilidad frontal y trasera, necesidad de escalera o pértiga.\n4. Detecta obstáculos cercanos (macetas, vallas) y terreno irregular.\n\nDETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):\n- Nivel 1: Altura ≤1,5 m, ramas finas, accesible desde el suelo.\n- Nivel 2: Altura 1,5–2,5 m, ramas medianas, obstáculos moderados.\n- Nivel 3: Altura >2,5 m, ramas gruesas o densas, acceso limitado, requiere poda fuerte.\n\nFORMATO DE SALIDA (JSON ÚNICAMENTE):\n{\n  \"servicio\": \"Corte de setos\",\n  \"cantidad\": [número estimado de m2],\n  \"unidad\": \"m2\",\n  \"dificultad\": [1, 2 o 3]\n}",
  'Fumigación': "Eres una IA especializada en análisis de jardines llamada 'PestVision'. Tu objetivo es analizar imágenes para presupuestar fumigación.\n\nINSTRUCCIONES DE ANÁLISIS:\n1. Detecta plantas afectadas por plagas o áreas continuas.\n2. IMPORTANTE: Para calcular la cantidad, convierte las plantas reales a \"plantas equivalentes\" usando esta fórmula mental:\n   Plantas_equivalentes = (altura_real_cm / 40) × (diametro_real_cm / 35)\n3. Detecta densidad de plaga y gravedad de daños.\n\nDETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):\n- Nivel 1: Plaga leve, <20% afectación, plantas ≤2 equivalentes.\n- Nivel 2: Afectación 20–60%, plantas 2–5 equivalentes, acceso parcial.\n- Nivel 3: >60% afectación, plantas >5 equivalentes, acceso difícil, plaga severa.\n\nFORMATO DE SALIDA (JSON ÚNICAMENTE):\n{\n  \"servicio\": \"Fumigación\",\n  \"cantidad\": [número de plantas equivalentes],\n  \"unidad\": \"plantas\",\n  \"dificultad\": [1, 2 o 3]\n}",
  'Poda de plantas': "Eres una IA especializada en análisis de jardines llamada 'PlantShapeAI'. Tu objetivo es analizar arbustos, rosales u ornamentales (excluye árboles grandes).\n\nINSTRUCCIONES DE ANÁLISIS:\n1. Detecta plantas que requieren poda.\n2. IMPORTANTE: Convierte cada planta a \"plantas equivalentes\" usando esta fórmula:\n   Plantas_equivalentes = (altura_real_cm / 40) × (diametro_real_cm / 35)\n3. Evalúa densidad de ramas y dureza aparente.\n\nDETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):\n- Nivel 1: Plantas ≤1 m (≤2,5 equivalentes), ramas finas, accesibles, poda ligera.\n- Nivel 2: Plantas 1–1,8 m (2,5–4,5 equivalentes), ramas medianas, acceso parcial.\n- Nivel 3: Plantas >1,8 m (>4,5 equivalentes), ramas gruesas, densas, espacios reducidos, poda fuerte.\n\nFORMATO DE SALIDA (JSON ÚNICAMENTE):\n{\n  \"servicio\": \"Poda de plantas\",\n  \"cantidad\": [número de plantas equivalentes],\n  \"unidad\": \"plantas\",\n  \"dificultad\": [1, 2 o 3]\n}",
  'Poda de árboles': "Eres una IA especializada en análisis de jardines llamada 'TreeScale'. Tu objetivo es analizar árboles para poda.\n\nINSTRUCCIONES DE ANÁLISIS:\n1. Detecta árboles que requieren poda.\n2. IMPORTANTE: Convierte a \"árboles equivalentes\" usando esta fórmula:\n   Árbol_equivalente = (altura_real_m / 3) × (diametro_copa_real_m / 2)\n3. Determina si se necesita escalera, pértiga o trabajo en altura.\n\nDETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):\n- Nivel 1: Árboles <3 m (≤1 equivalente), ramas finas, acceso fácil.\n- Nivel 2: Árboles 3–5 m (1–3 equivalentes), escalera o pértiga, obstáculos moderados.\n- Nivel 3: Árboles >5 m (>3 equivalentes), ramas gruesas, acceso difícil, trabajo en altura.\n\nFORMATO DE SALIDA (JSON ÚNICAMENTE):\n{\n  \"servicio\": \"Poda de árboles\",\n  \"cantidad\": [número de árboles equivalentes],\n  \"unidad\": \"árboles\",\n  \"dificultad\": [1, 2 o 3]\n}",
  'Labrar y quitar malas hierbas': "Eres una IA especializada en análisis de jardines llamada 'SoilSense'. Tu objetivo es analizar terreno para deshierbe manual y labrado.\n\nINSTRUCCIONES DE ANÁLISIS:\n1. Detecta zonas con malas hierbas y calcula superficie en m².\n2. Evalúa densidad, tamaño de hierbas, dureza del suelo y piedras/raíces.\n\nDETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):\n- Nivel 1: Hierbas pequeñas, poco densas, terreno suelto y llano.\n- Nivel 2: Hierbas medianas, densidad moderada, tierra parcialmente compacta.\n- Nivel 3: Hierbas grandes, densas, raíces profundas, terreno duro, acceso difícil.\n\nFORMATO DE SALIDA (JSON ÚNICAMENTE):\n{\n  \"servicio\": \"Labrar y quitar malas hierbas\",\n  \"cantidad\": [número estimado de m2],\n  \"unidad\": \"m2\",\n  \"dificultad\": [1, 2 o 3]\n}",
};

async function estimateServiceAutoQuoteLocal(): Promise<AutoQuoteResponse | null> { return null; }
