// src/domain/pricing/treePruningPricing.ts

import {
  TreePruningServiceConfig,
  TreePruningZone,
  AITreeAnalysisResult,
  TreePruningQuote,
  PerTreeQuote,
  PruningServiceType,
  TreeSizeBand
} from '../../types/treePruning';

export type TreePruningAnalyzedTree = {
  id: string;
  pruningType: PruningServiceType;
  sizeBand: TreeSizeBand;
  // Must come from explicit customer response per tree, never from IA inference.
  dificultad_alta: boolean;
  nivel_analisis?: 1 | 2 | 3;
};

function normalizeSizeBand(value?: string | null): TreeSizeBand | null {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'small' || v === 'medium' || v === 'large' || v === 'over_9') return v;
  return null;
}

function resolveTreeSizeBand(tree: TreePruningAnalyzedTree): TreeSizeBand | null {
  return normalizeSizeBand(tree.sizeBand);
}

function getBandPrice(
  config: TreePruningServiceConfig,
  pruningType: PruningServiceType,
  band: TreeSizeBand
): number | null {
  const pricing = pruningType === 'estructural' ? config.estructural : config.formacion;
  if (band === 'small') return pricing.small;
  if (band === 'medium') return pricing.medium;
  // Si es over_9 se cobra el precio de large
  return pricing.large ?? null;
}

function getBandYield(
  config: TreePruningServiceConfig,
  pruningType: PruningServiceType,
  band: TreeSizeBand
): number | null {
  const yields = pruningType === 'estructural' ? config.yield_units_per_hour.estructural : config.yield_units_per_hour.formacion;
  if (band === 'small') return yields.small;
  if (band === 'medium') return yields.medium;
  // Si es over_9 se usa el rendimiento de large
  return yields.large ?? null;
}

function canHandleTree(config: TreePruningServiceConfig, pruningType: PruningServiceType, band: TreeSizeBand): boolean {
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
    const band = resolveTreeSizeBand(tree);
    if (!band) continue;
    if (!canHandleTree(config, tree.pruningType, band)) {
      return { totalPrice: 0, totalEstimatedHours: 0, perTreeQuotes: [], isProfessionalSuitable: false, overallWarnings: [] };
    }
  }

  for (const tree of trees) {
    if (tree.nivel_analisis === 3) continue;

    const band = resolveTreeSizeBand(tree);
    if (!band) continue;
    const basePrice = getBandPrice(config, tree.pruningType, band);
    if (basePrice === null) continue;

    const baseYield = getBandYield(config, tree.pruningType, band);
    const unitHours = baseYield && baseYield > 0 ? 1 / baseYield : 0;

    let subtotal = basePrice;
    let estimatedHours = unitHours;
    let appliedDifficultyIncrease = false;
    const warnings: string[] = [];

    // Incremento por dificultad por árbol según respuesta explícita del cliente.
    if (tree.dificultad_alta) {
      const difficultyMultiplier = Number(config.difficultyIncrease || 0) / 100;
      subtotal += basePrice * difficultyMultiplier;
      estimatedHours += unitHours * difficultyMultiplier;
      appliedDifficultyIncrease = difficultyMultiplier > 0;
    }

    // Incremento por retirada de restos
    if (wasteRemoval) {
      const wasteMultiplier = Number(config.wasteRemovalMultiplier || 0) / 100;
      subtotal += subtotal * wasteMultiplier;
      estimatedHours += estimatedHours * wasteMultiplier;
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
      sizeBand: band,
      basePrice,
      finalPrice: subtotal,
      estimatedHours,
      appliedDifficultyIncrease,
      warnings
    });
  }

  const calculatedTotalPrice = perTreeQuotes.reduce((sum, quote) => sum + quote.finalPrice, 0);
  const totalEstimatedHours = perTreeQuotes.reduce((sum, quote) => sum + quote.estimatedHours, 0);

  // Aplicar el precio mínimo global del servicio
  const minimumPrice = Number(config.minimumPrice || 0);
  const totalPrice = Math.max(calculatedTotalPrice, minimumPrice);

  return {
    totalPrice,
    totalEstimatedHours,
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
 * - Precio base: Según rango de tamaño (size_band)
 * - Dificultad: +incremento porcentual si dificultad_alta=true (respuesta cliente por árbol)
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
      sizeBand: aiResult.size_band as TreeSizeBand,
      // Legacy wrapper: pricing difficulty must come from explicit client response.
      // In this IA-based wrapper we force false to avoid business decisions from IA.
      dificultad_alta: false
    };
    if (!tree.sizeBand || !normalizeSizeBand(tree.sizeBand)) return [];
    if (aiResult.nivel_analisis) tree.nivel_analisis = aiResult.nivel_analisis;
    return [tree];
  });

  return calculateTreePruningQuoteForTrees(config, trees, wasteRemoval);
}
