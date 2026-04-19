// src/types/treePruning.ts

/**
 * Tipos de poda soportados por el servicio.
 */
export type PruningServiceType = 'estructural' | 'formacion';

/**
 * Rangos de altura para la configuración de precios del profesional.
 */
export interface TreeHeightBandPricing {
  small: number; // Hasta 3m (incl.)
  medium: number; // >3m y hasta 5m (incl.)
  large?: number; // >5m y hasta 9m (incl.) - opcional
}

/**
 * Configuración completa del servicio de Poda de árboles para un profesional.
 *
 * Campo opcional (5-9m):
 * - Se habilita desde la UI con el botón “Añadir poda de árboles en altura”.
 * - Si un rango no está configurado, el profesional no debe aparecer para árboles que lo requieran.
 */
export interface TreePruningServiceConfig {
  minimumPrice: number; // Precio mínimo de la reserva
  formacion: TreeHeightBandPricing;
  estructural: TreeHeightBandPricing;
  difficultyIncrease: number; // Incremento porcentual (%) por dificultad alta
  wasteRemovalMultiplier: number; // Incremento porcentual (%) por retirada de restos
}

/**
 * Representa una zona (árbol individual) en la solicitud del cliente.
 */
export interface TreePruningZone {
  id: string; // UUID único
  pruningType: PruningServiceType; // Tipo de poda seleccionado
  photos: File[]; // Fotos específicas de este árbol
}

/**
 * Resultado del análisis de IA para un árbol.
 */
export interface AITreeAnalysisResult {
  zoneId: string;
  altura_m: number; // Altura estimada en metros
  dificultad_alta: boolean; // true si terreno irregular u obstáculos cercanos
  nivel_analisis?: 1 | 2 | 3;
  observaciones?: string[] | null;
}

/**
 * Cotización individual para un árbol.
 */
export interface PerTreeQuote {
  zoneId: string;
  pruningType: PruningServiceType;
  altura_m: number;
  basePrice: number;
  finalPrice: number;
  appliedDifficultyIncrease: boolean;
  warnings: string[];
}

/**
 * Cotización completa para todos los árboles.
 */
export interface TreePruningQuote {
  totalPrice: number;
  perTreeQuotes: PerTreeQuote[];
  isProfessionalSuitable: boolean; // false si algún árbol excede capacidades
  overallWarnings: string[];
}
