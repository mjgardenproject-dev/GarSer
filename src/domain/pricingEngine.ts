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

/**
 * Resuelve la clave de banda de altura dentro de un mapa `{ banda: valor }` del jardinero.
 *
 * La banda llega en formatos distintos según el origen: el configurador del jardinero guarda
 * `'0-4'`/`'>10'`, el análisis IA emite lo mismo, pero el formulario manual (y reservas ya
 * guardadas) usan `'0-4m'`/`'>10m'`. La comparación literal solo casaba con el primero, así
 * que un cliente que declaraba su palmera A MANO no encontraba NINGÚN jardinero mientras que
 * con la misma palmera por fotos sí: el precio existía, pero la clave no coincidía.
 *
 * Orden de resolución: literal → normalizada (sin 'm', sin espacios) → numérica (una altura
 * o un rango en metros contra los rangos configurados, entendiendo tanto '12+' como '>12').
 */
const resolvePalmHeightKey = (rangeMap: Record<string, unknown> | undefined, height: string): string | null => {
  if (!rangeMap) return null;
  const keys = Object.keys(rangeMap);
  if (keys.length === 0) return null;

  if (Object.prototype.hasOwnProperty.call(rangeMap, height)) return height;

  const normalizedTarget = normalizeHeightRange(height);
  const normalizedMatch = keys.find((key) => normalizeHeightRange(key) === normalizedTarget);
  if (normalizedMatch) return normalizedMatch;

  const matches = String(height || '').match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  const heightNum = matches.length === 1
    ? parseFloat(matches[0])
    : (parseFloat(matches[0]) + parseFloat(matches[1])) / 2;

  let openRangeMatch: string | null = null;
  for (const range of keys) {
    const normalized = normalizeHeightRange(range);
    if (normalized.includes('+') || normalized.includes('>')) {
      const min = parseFloat(normalized.replace('+', '').replace('>', ''));
      if (Number.isFinite(min) && heightNum >= min) openRangeMatch = range;
    } else if (normalized.includes('-')) {
      const [min, max] = normalized.split('-').map(Number);
      if (heightNum >= min && heightNum < max) return range;
    }
  }
  return openRangeMatch;
};

/** Resuelve la clave de especie dentro de un mapa `{ especie: ... }` del jardinero. */
const resolvePalmSpeciesKey = (speciesMap: Record<string, unknown> | undefined, species: string): string | null => {
  if (!speciesMap) return null;
  if (Object.prototype.hasOwnProperty.call(speciesMap, species)) return species;

  const canonical = resolveSpeciesBusinessRule(species)?.canonicalName;
  if (canonical && Object.prototype.hasOwnProperty.call(speciesMap, canonical)) return canonical;

  const speciesLower = species.toLowerCase();
  return Object.keys(speciesMap).find(
    (key) => key.toLowerCase().includes(speciesLower) || speciesLower.includes(key.toLowerCase()),
  ) || null;
};

/**
 * Rendimiento (unidades/hora) configurado para una especie y banda, con la misma
 * tolerancia de formatos que el precio. Antes este acceso era literal
 * (`yield_units_per_hour[species][height]`) en tres sitios distintos: con una banda 'm'
 * el rendimiento salía 0 y el jardinero por horas quedaba inelegible o con horas erróneas.
 */
export const findPalmYield = (config: any, species: string, height: string): number => {
  const yields = config?.yield_units_per_hour;
  const speciesKey = resolvePalmSpeciesKey(yields, species);
  if (!speciesKey) return 0;
  const heightKey = resolvePalmHeightKey(yields[speciesKey], height);
  if (!heightKey) return 0;
  return Number(yields[speciesKey][heightKey]) || 0;
};

export const findPalmPrice = (config: any, species: string, height: string): number => {
    const speciesPriceFallback = (key: string): number => {
        const value = config?.species_prices?.[key];
        return typeof value === 'number' ? value : 0;
    };

    if (!config || !config.height_prices) {
        return speciesPriceFallback(species);
    }

    const speciesKey = resolvePalmSpeciesKey(config.height_prices, species);
    if (!speciesKey) {
        const priceKey = resolvePalmSpeciesKey(config.species_prices, species);
        return priceKey ? speciesPriceFallback(priceKey) : 0;
    }

    const heightKey = resolvePalmHeightKey(config.height_prices[speciesKey], height);
    if (heightKey) {
        return Number(config.height_prices[speciesKey][heightKey]) || 0;
    }

    return speciesPriceFallback(speciesKey);
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
    groups.some((group) => findPalmYield(config, group.species, group.height) > 0);

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

    const yieldForSpecies = findPalmYield(config, group.species, group.height);
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
      const yieldForSpecies = findPalmYield(config, group.species, group.height);
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
