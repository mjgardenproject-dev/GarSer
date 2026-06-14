// src/types/treePruning.ts

/**
 * Tipos de poda soportados por el servicio.
 */
export type PruningServiceType = 'estructural' | 'formacion';
export type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';

/**
 * Rangos de altura para la configuración de precios del profesional.
 */
export interface TreeHeightBandPricing {
  small: number; // Hasta 3m (incl.)
  medium: number; // >3m y hasta 5m (incl.)
  large?: number; // >5m y hasta 9m (incl.), opcional si el profesional no atiende grandes alturas
}

/**
 * Configuración completa del servicio de Poda de árboles para un profesional.
 *
 * Los rangos small y medium son obligatorios. El rango large es opcional y define si el
 * profesional acepta árboles grandes (>5m) y muy grandes (>9m).
 */
export interface TreePruningServiceConfig {
  minimumPrice: number; // Precio mínimo de la reserva
  formacion: TreeHeightBandPricing;
  estructural: TreeHeightBandPricing;
  difficultyIncrease: number; // Incremento porcentual (%) por dificultad alta
  wasteRemovalMultiplier: number; // Incremento porcentual (%) por retirada de restos
  // Yields (mandatory for internal time calculation, expressed in units/hour)
  yield_units_per_hour: {
    formacion: TreeHeightBandPricing;
    estructural: TreeHeightBandPricing;
  };
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
  // Legacy field kept for compatibility during migration to size bands.
  altura_m?: number; // Altura estimada en metros
  // Canonical field for pricing consistency. If present, it takes precedence.
  size_band?: TreeSizeBand;
  // Legacy field. Tree pricing difficulty must come from explicit customer response.
  dificultad_alta: boolean;
  nivel_analisis?: 1 | 2 | 3;
  observaciones?: string[] | null;
}

/**
 * Cotización individual para un árbol.
 */
export interface PerTreeQuote {
  zoneId: string;
  pruningType: PruningServiceType;
  sizeBand: TreeSizeBand;
  // Legacy field kept for UI compatibility while migrating consumers.
  altura_m?: number;
  basePrice: number;
  finalPrice: number;
  estimatedHours: number;
  appliedDifficultyIncrease: boolean;
  warnings: string[];
}

/**
 * Cotización completa para todos los árboles.
 */
export interface TreePruningQuote {
  totalPrice: number;
  totalEstimatedHours: number;
  perTreeQuotes: PerTreeQuote[];
  isProfessionalSuitable: boolean; // false si algún árbol excede capacidades
  overallWarnings: string[];
}
