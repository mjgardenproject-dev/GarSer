// src/domain/pricing/treePruningPricing.ts

import {
  TreePruningServiceConfig,
  TreePruningZone,
  AITreeAnalysisResult,
  TreePruningQuote,
  PerTreeQuote,
  PruningServiceType
} from '../../types/treePruning';

export type TreePruningAnalyzedTree = {
  id: string;
  pruningType: PruningServiceType;
  altura_m: number;
  dificultad_alta: boolean;
  nivel_analisis?: 1 | 2 | 3;
};

export function getHeightBand(altura_m: number): 'small' | 'medium' | 'large' | 'over_9' {
  // Evaluando límites: >= limite_inferior y < limite_superior
  if (altura_m >= 0 && altura_m < 3) return 'small';
  if (altura_m >= 3 && altura_m < 5) return 'medium';
  if (altura_m >= 5 && altura_m < 9) return 'large';
  return 'over_9';
}

function getBandPrice(
  config: TreePruningServiceConfig,
  pruningType: PruningServiceType,
  band: 'small' | 'medium' | 'large' | 'over_9'
): number | null {
  const pricing = pruningType === 'estructural' ? config.estructural : config.formacion;
  if (band === 'small') return pricing.small;
  if (band === 'medium') return pricing.medium;
  // Si es over_9 se cobra el precio de large
  return pricing.large ?? null;
}

function canHandleTree(config: TreePruningServiceConfig, pruningType: PruningServiceType, altura_m: number): boolean {
  const band = getHeightBand(altura_m);
  if (band === 'small' || band === 'medium') return true;
  // Si el árbol es 'large' o 'over_9', el profesional debe tener configurado el rango 'large'
  const pricing = pruningType === 'estructural' ? config.estructural : config.formacion;
  return pricing.large !== undefined && pricing.large > 0;
}

export function calculateTreePruningQuoteForTrees(
  config: TreePruningServiceConfig,
  trees: TreePruningAnalyzedTree[],
  wasteRemoval: boolean = false
): TreePruningQuote {
  const perTreeQuotes: PerTreeQuote[] = [];
  const overallWarnings: string[] = [];

  for (const tree of trees) {
    if (tree.nivel_analisis === 3) continue;
    if (!canHandleTree(config, tree.pruningType, tree.altura_m)) {
      return { totalPrice: 0, perTreeQuotes: [], isProfessionalSuitable: false, overallWarnings: [] };
    }
  }

  for (const tree of trees) {
    if (tree.nivel_analisis === 3) continue;

    const band = getHeightBand(tree.altura_m);
    const basePrice = getBandPrice(config, tree.pruningType, band);
    if (basePrice === null) continue;

    let subtotal = basePrice;
    let appliedDifficultyIncrease = false;
    const warnings: string[] = [];

    // Incremento por dificultad (solo aplica a >= 3m, es decir, medium, large, over_9)
    if (tree.dificultad_alta && band !== 'small') {
      const difficultyMultiplier = Number(config.difficultyIncrease || 0) / 100;
      subtotal += basePrice * difficultyMultiplier;
      appliedDifficultyIncrease = difficultyMultiplier > 0;
    }

    // Incremento por retirada de restos
    if (wasteRemoval) {
      const wasteMultiplier = Number(config.wasteRemovalMultiplier || 0) / 100;
      subtotal += subtotal * wasteMultiplier;
    }

    if (band === 'over_9') {
      warnings.push('El profesional tendrá que verificar el pago porque es un servicio muy complejo.');
      if (!overallWarnings.includes('El profesional tendrá que verificar el pago porque es un servicio muy complejo.')) {
        overallWarnings.push('El profesional tendrá que verificar el pago porque es un servicio muy complejo.');
      }
    }

    perTreeQuotes.push({
      zoneId: tree.id,
      pruningType: tree.pruningType,
      altura_m: tree.altura_m,
      basePrice,
      finalPrice: subtotal,
      appliedDifficultyIncrease,
      warnings
    });
  }

  const calculatedTotalPrice = perTreeQuotes.reduce((sum, quote) => sum + quote.finalPrice, 0);

  // Aplicar el precio mínimo global del servicio
  const minimumPrice = Number(config.minimumPrice || 0);
  const totalPrice = Math.max(calculatedTotalPrice, minimumPrice);

  return {
    totalPrice,
    perTreeQuotes,
    isProfessionalSuitable: true,
    overallWarnings
  };
}

/**
 * Calcula la cotización para el servicio de poda de árboles.
 *
 * Reglas de negocio:
 * - Filtrado: Profesional excluido si algún árbol excede su rango máximo
 * - Precio base: Según rango de altura
 * - Dificultad: +incremento porcentual si dificultad_alta=true, excepto árboles <3m
 * - Retirada de restos: +incremento porcentual sobre el subtotal de cada árbol
 * - Caso especial >=9m: Usa precio 5-9m + warning específico
 * - Mínimo: Se asegura de cobrar al menos config.minimumPrice
 */
export function calculateTreePruningQuote(
  config: TreePruningServiceConfig,
  zones: TreePruningZone[],
  aiResults: AITreeAnalysisResult[],
  wasteRemoval: boolean = false
): TreePruningQuote {
  const trees: TreePruningAnalyzedTree[] = zones.flatMap((zone) => {
    const aiResult = aiResults.find((r) => r.zoneId === zone.id);
    if (!aiResult) return [];

    const tree: TreePruningAnalyzedTree = {
      id: zone.id,
      pruningType: zone.pruningType,
      altura_m: Number(aiResult.altura_m || 0),
      dificultad_alta: Boolean(aiResult.dificultad_alta)
    };
    if (aiResult.nivel_analisis) tree.nivel_analisis = aiResult.nivel_analisis;
    return [tree];
  });

  return calculateTreePruningQuoteForTrees(config, trees, wasteRemoval);
}
