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
  analysis_v2?: AnalysisV2Envelope;
  rawResponse?: any; // New field for debug
}

// Eliminar fallback: solo OpenAI
import { adaptLegacyAnalysisToV2, type AnalysisV2Envelope } from '../shared/analysisV2';
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
      throw new Error(error.message || 'EDGE_FUNCTION_INVOCATION_FAILED');
    }
    const tareas = Array.isArray((data as any)?.tareas) ? (data as any).tareas : [];
    const palmas = Array.isArray((data as any)?.palmas) ? (data as any).palmas : undefined;
    const arboles = Array.isArray((data as any)?.arboles) ? (data as any).arboles : undefined;
    const reasons = Array.isArray((data as any)?.reasons) ? (data as any).reasons : undefined;
    const metricas_fitosanitarias = (data as any)?.metricas_fitosanitarias;
    const analysis_v2 = (data as any)?.analysis_v2 || adaptLegacyAnalysisToV2({
      serviceName: input.serviceName,
      legacyResponse: {
        tareas,
        palmas,
        arboles,
        metricas_fitosanitarias,
        reasons,
      },
      sourcePhotoCount: input.photoCount,
      provider: 'google',
      model: input.model || 'gemini-2.0-flash',
    });
    return { tareas, palmas, arboles, reasons, metricas_fitosanitarias, analysis_v2, rawResponse: data };
  } catch (e) {
    console.warn('[AI] Fallo invocando Edge Function:', e);
    const analysis_v2 = adaptLegacyAnalysisToV2({
      serviceName: input.serviceName,
      legacyResponse: { tareas: [], reasons: ['EDGE_FUNCTION_INVOCATION_FAILED'] },
      sourcePhotoCount: input.photoCount,
      provider: 'internal',
      model: input.model || 'gemini-2.0-flash',
    });
    return { tareas: [], analysis_v2, rawResponse: { exception: e } };
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
