/**
 * Pricing Engine
 * SSOT (Single Source of Truth) para la lógica matemática de presupuestos de GarSer.
 * Isomórfico: Puede ser usado en frontend (UI) y backend (Edge Functions/Deno).
 */

import {
  canApplyTrunkPeeling,
  getLowestRangeThresholdForSpecies,
  resolveSpeciesBusinessRule,
  supportsPhytosanitaryForSpecies
} from './speciesBusinessRules.ts';

import { getPrecioPorHora, getPricingMethod } from '../utils/hourlyPricing.ts';

// Generic safe price applier
export const applyMinimumPrice = (calculatedPrice: number, minimumPrice: number): number => {
  if (calculatedPrice <= 0) return 0;
  return Math.max(calculatedPrice, minimumPrice);
};

// Yield-based calculation helper
export const calculatePriceFromYield = (
  quantity: number,
  yieldPerHour: number,
  hourlyRate: number,
  difficultyMultiplier: number = 1.0
): number => {
  if (!yieldPerHour || yieldPerHour <= 0 || !hourlyRate || hourlyRate <= 0) return 0;
  const estimatedHours = (quantity / yieldPerHour) * difficultyMultiplier;
  return estimatedHours * hourlyRate;
};

// --- PALM PRICING LOGIC ---
const PALM_CONSTANTS = {
  PRICING: {
    "0-5": { normal: 0.5, descuidado: 1.0, "muy descuidado": 1.5 },
    "5-12": { normal: 1.0, descuidado: 1.5, "muy descuidado": 2.5 },
    "12-20": { normal: 1.5, descuidado: 2.5, "muy descuidado": 3.5 },
    "20+": { normal: 2.5, descuidado: 3.5, "muy descuidado": 5.0 }
  }
};

function normalizeStr(s: string) {
  return (s || '').toLowerCase().trim();
}

export interface PalmPricingResult {
  tiempoPreparacion: number;
  tiempoPodaBruto: number;
  factorEficiencia: number;
  tiempoTotalEstimado: number;
}

export function calculatePalmHoursEngine(palms: any[]): PalmPricingResult {
  let tiempoPodaBruto = 0;
  let maxSetupTier = 0;

  palms.forEach((p) => {
    if (p.nivel_analisis === 3 || p.especie === 'No detectada') return;

    let species = normalizeStr(p.especie);
    if (species.endsWith(' o similar')) {
        species = species.replace(' o similar', '').trim();
    }
    const height = p.altura;
    const rawState = normalizeStr(p.estado || 'normal');
    const state = rawState.replace('_', ' '); // Support 'muy_descuidado' -> 'muy descuidado'

    let hours = 0;
    const groupPrices = PALM_CONSTANTS.PRICING as any;

    if (groupPrices[height]) {
      if (groupPrices[height][state] !== undefined) {
        hours = groupPrices[height][state];
      } else if (groupPrices[height][state.replace('descuidada', 'descuidado')] !== undefined) {
        hours = groupPrices[height][state.replace('descuidada', 'descuidado')];
      } else {
        hours = groupPrices[height]['normal'] || 0;
      }
    } else {
      hours = PALM_CONSTANTS.PRICING['5-12'].normal;
    }

    tiempoPodaBruto += hours;

    let tier = 1;
    if (height === '12-20' || height === '20+') tier = 3;
    else if (height === '5-12') tier = 2;
    else tier = 1;

    if (tier > maxSetupTier) maxSetupTier = tier;
  });
  
  let tiempoPreparacion = 0;
  const validPalmsCount = palms.filter(p => p.nivel_analisis !== 3 && p.especie !== 'No detectada' && p.species !== 'No detectada').length;
  
  if (validPalmsCount > 0) {
      tiempoPreparacion = 0.5;
  }
  
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

export interface PalmPricingGroup {
  species: string;
  height: string;
  quantity: number;
  state?: string;
  hasPhytosanitary?: boolean;
  hasTrunkPeeling?: boolean;
  lowestRangeThreshold?: string;
  highestOpenRangeThreshold?: string;
  isTerminalOpenRange?: boolean;
  allowsPriceChange?: boolean;
  // Backward-compat fields
  needsPhytosanitary?: boolean;
  needsTrunkFinish?: boolean;
  hasAccessDifficulty?: boolean;
}

const normalizeHeightRange = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/m/g, '')
    .replace(/\s+/g, '')
    .trim();
};

const areSameHeightRanges = (a: string, b: string): boolean => {
  return normalizeHeightRange(a) === normalizeHeightRange(b);
};

export const findPalmPrice = (config: any, species: string, height: string): number => {
    if (!config || !config.height_prices) {
        if (config?.species_prices?.[species] && typeof config.species_prices[species] === 'number') {
            return config.species_prices[species];
        }
        return 0;
    }

    if (config.height_prices[species]?.[height]) {
        return config.height_prices[species][height];
    }

    const speciesLower = species.toLowerCase();
    let speciesKey = resolveSpeciesBusinessRule(species)?.canonicalName || species;
    let found = speciesKey !== species;

    if (!found && !config.height_prices[speciesKey]) {
        const configKeys = Object.keys(config.height_prices);
        const match = configKeys.find(k => k.toLowerCase().includes(speciesLower) || speciesLower.includes(k.toLowerCase()));
        if (match) {
            speciesKey = match;
            found = true;
        }
    }

    if (!config.height_prices[speciesKey]) {
        if (config.species_prices?.[speciesKey] && typeof config.species_prices[speciesKey] === 'number') {
            return config.species_prices[speciesKey];
        }
        return 0;
    }

    if (config.height_prices[speciesKey][height]) {
        return config.height_prices[speciesKey][height];
    }

    const matches = height.match(/(\d+(?:\.\d+)?)/g);
    let heightNum = 0;
    if (matches && matches.length > 0) {
        if (matches.length === 1) {
             heightNum = parseFloat(matches[0]);
        } else {
             const v1 = parseFloat(matches[0]);
             const v2 = parseFloat(matches[1]);
             heightNum = (v1 + v2) / 2;
        }
    } else {
         if (config.species_prices?.[speciesKey]) return config.species_prices[speciesKey];
         return 0; 
    }

    const ranges = Object.keys(config.height_prices[speciesKey]);
    let bestRange = '';

    for (const range of ranges) {
        if (range.includes('+')) {
            const min = parseFloat(range.replace('+', ''));
            if (heightNum >= min) {
                bestRange = range;
            }
        } else if (range.includes('-')) {
            const [min, max] = range.split('-').map(Number);
            if (heightNum >= min && heightNum < max) {
                bestRange = range;
                break;
            }
        }
    }
    
    if (bestRange) {
        return config.height_prices[speciesKey][bestRange] || 0;
    }

    if (config.species_prices?.[speciesKey]) {
        return config.species_prices[speciesKey];
    }

    return 0;
};

const getPalmStatePercent = (config: any, state: string): number => {
  const surcharges = config.condition_surcharges || { normal: 0, descuidada: 20, muy_descuidada: 50 };
  const isVeryNeglected = state.includes('muy') && (state.includes('descuidado') || state.includes('descuidada'));
  const isNeglected = state.includes('descuidado') || state.includes('descuidada') || state.includes('mal estado');

  if (isVeryNeglected) {
    return surcharges.muy_descuidado ?? surcharges.muy_descuidada ?? surcharges.overgrown ?? 0;
  }
  if (isNeglected) {
    return surcharges.descuidado ?? surcharges.descuidada ?? surcharges.neglected ?? 0;
  }

  return surcharges.normal ?? 0;
};

export const calculatePalmHoursFromConfig = (
  groups: PalmPricingGroup[],
  config: any,
  globalWasteRemoval: boolean
): number => {
  // Los rendimientos son SIEMPRE obligatorios y el tiempo se calcula con los del
  // jardinero concreto (garser-pricing-rules §2), también en per_quantity: antes el
  // gate exigía per_hour + tarifa horaria y los jardineros per_quantity caían a la
  // tabla genérica interna → slots bloqueados con un tiempo que no era el suyo.
  const hasConfiguredYields =
    config?.yield_units_per_hour &&
    groups.some((group) => Number(config.yield_units_per_hour?.[group.species]?.[group.height] || 0) > 0);

  if (!hasConfiguredYields) {
    return calculatePalmHoursEngine(
      groups.flatMap((group) =>
        Array.from({ length: Math.max(0, Math.trunc(Number(group.quantity || 0))) }, () => ({
          especie: group.species,
          altura: group.height,
          estado: group.state,
          nivel_analisis: 2,
        }))
      )
    ).tiempoTotalEstimado;
  }

  let totalHours = 0;

  for (const group of groups) {
    const quantity = Math.max(0, Number(group.quantity || 0));
    if (quantity <= 0) continue;

    const yieldForSpecies = Number(config.yield_units_per_hour?.[group.species]?.[group.height] || 0);
    if (!(yieldForSpecies > 0)) continue;

    const state = (group.state || 'normal').toLowerCase();
    const stateMult = 1 + (getPalmStatePercent(config, state) / 100);

    const wastePercent = globalWasteRemoval
      ? (config.wasteRemovalModifier !== undefined ? config.wasteRemovalModifier : (config.waste_removal?.percentage || 0))
      : 0;
    const wasteMult = 1 + (Number(wastePercent || 0) / 100);

    const lowestRangeThreshold = getLowestRangeThresholdForSpecies(group.species);
    const canApplyAccessDifficulty = !areSameHeightRanges(group.height, lowestRangeThreshold);
    const accessMult =
      canApplyAccessDifficulty && group.hasAccessDifficulty && config.access_difficulty
        ? 1 + (Number(config.access_difficulty || 0) / 100)
        : 1;

    totalHours += (quantity / yieldForSpecies) * stateMult * wasteMult * accessMult;
  }

  return Math.round(totalHours * 100) / 100;
};

export function calculatePalmPriceEngine(
  groups: PalmPricingGroup[],
  config: any,
  globalWasteRemoval: boolean
): number {
  if (!config) return 0;
  
  let total = 0;
  const precioPorHora = getPrecioPorHora(config);
  const useYield =
    getPricingMethod(config, { allowLegacyYieldCalculation: true }) === 'per_hour' &&
    config.yield_units_per_hour &&
    precioPorHora > 0;

  for (const group of groups) {
    let basePrice = 0;
    if (useYield) {
      const yieldForSpecies = config.yield_units_per_hour[group.species]?.[group.height] || 0;
      basePrice = calculatePriceFromYield(1, yieldForSpecies, precioPorHora);
    } else {
      basePrice = findPalmPrice(config, group.species, group.height);
    }

    if (basePrice <= 0) continue;

    // Condition Surcharge
    const state = (group.state || 'normal').toLowerCase();
    const statePercent = getPalmStatePercent(config, state);
    const stateMult = 1 + (statePercent / 100);

    // Waste Removal
    let wastePercent = 0;
    if (globalWasteRemoval) {
        wastePercent = config.wasteRemovalModifier !== undefined 
            ? config.wasteRemovalModifier 
            : (config.waste_removal?.percentage || 0);
    }
    const wasteMult = 1 + (wastePercent / 100);

    // Additional boolean flags (flat additions or multipliers)
    let unitExtra = 0;
    const hasPhytosanitary = group.hasPhytosanitary ?? group.needsPhytosanitary;
    const hasTrunkPeeling = group.hasTrunkPeeling ?? group.needsTrunkFinish;
    const lowestRangeThreshold = getLowestRangeThresholdForSpecies(group.species);
    const canApplyAccessDifficulty = !areSameHeightRanges(group.height, lowestRangeThreshold);

    if (hasPhytosanitary && supportsPhytosanitaryForSpecies(group.species) && config.phytosanitary) {
        unitExtra += config.phytosanitary;
    }
    if (canApplyTrunkPeeling(group.species, hasTrunkPeeling) && config.trunk_finish) {
        const currentValue = basePrice * stateMult * wasteMult;
        unitExtra += currentValue * (config.trunk_finish / 100);
    }
    
    let accessMult = 1;
    if (canApplyAccessDifficulty && group.hasAccessDifficulty && config.access_difficulty) {
        accessMult = 1 + (config.access_difficulty / 100);
    }

    // Calculation: ((BasePrice * StateMult * WasteMult) + unitExtra) * AccessMult * Quantity
    const lineTotal = ((basePrice * stateMult * wasteMult) + unitExtra) * accessMult * (group.quantity || 1);
    total += lineTotal;
  }
  
  return applyMinimumPrice(total, config.minimum_price || 0);
}
