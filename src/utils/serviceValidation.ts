import { LawnPricingConfig } from '../components/gardener/LawnPricingConfigurator';
import { PalmPricingConfig } from '../components/gardener/PalmPricingConfigurator';
import { HedgePricingConfig } from '../components/gardener/HedgePricingConfigurator';
import { TreePricingConfig } from '../components/gardener/TreePricingConfigurator';
import { ShrubPricingConfig } from '../components/gardener/ShrubPricingConfigurator';
import { ClearingPricingConfig } from '../components/gardener/ClearingPricingConfigurator';
import { FumigationPricingConfig } from '../components/gardener/FumigationPricingConfigurator';

// --- Lawn Validation ---
export const isLawnConfigValid = (config: LawnPricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_species || config.selected_species.length === 0) return false;

  for (const species of config.selected_species) {
    const prices = config.species_prices[species];
    if (!prices) return false;
    // Check all ranges: 0-50, 50-200, 200+
    if (!prices['0-50'] || prices['0-50'] <= 0) return false;
    if (!prices['50-200'] || prices['50-200'] <= 0) return false;
    if (!prices['200+'] || prices['200+'] <= 0) return false;
  }
  return true;
};

// --- Palm Validation ---
export const isPalmConfigValid = (config: PalmPricingConfig | undefined): boolean => {
  if (!config) return false;
  // If no species selected, we might consider it invalid if the service is active,
  // but the requirement says "cannot check the box if...".
  // If no species are selected, it's definitely not configured.
  if (!config.selected_species || config.selected_species.length === 0) return false;

  const SPECIES_LARGE = [
      'Phoenix (datilera o canaria)', 
      'Washingtonia', 
      'Roystonea regia (cubana)', 
      'Syagrus romanzoffiana (cocotera)',
      'Trachycarpus fortunei'
  ];
  const SPECIES_SMALL = [
      'Livistona', 
      'Kentia (palmito)', 
      'Phoenix roebelenii(pigmea)', 
      'cycas revoluta (falsa palmera)'
  ];

  for (const species of config.selected_species) {
      // Validate Height Prices
      const heightPrices = config.height_prices?.[species];
      if (!heightPrices) return false;

      if (SPECIES_LARGE.includes(species as any)) {
          const heights = ['0-5', '5-12', '12-20', '20+'];
          for (const h of heights) {
              // @ts-ignore
              if (!heightPrices[h] || heightPrices[h] <= 0) return false;
          }
      } else if (SPECIES_SMALL.includes(species as any)) {
          // Check 0-2
          // @ts-ignore
          if (!heightPrices['0-2'] || heightPrices['0-2'] <= 0) return false;
          
          // Check 2+ (except Cycas)
          if (species !== 'cycas revoluta (falsa palmera)') {
              // @ts-ignore
              if (!heightPrices['2+'] || heightPrices['2+'] <= 0) return false;
          }
      }
  }

  // Validate Surcharges
  if (!config.condition_surcharges) return false;
  if ((config.condition_surcharges.descuidada || 0) <= 0) return false;
  if ((config.condition_surcharges.muy_descuidada || 0) <= 0) return false;

  // Validate Waste Removal
  if (!config.waste_removal || (config.waste_removal.percentage || 0) <= 0) return false;

  return true;
};

// --- Hedge Validation ---
export const isHedgeConfigValid = (config: HedgePricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_types || config.selected_types.length === 0) return false;

  for (const type of config.selected_types) {
    const prices = config.species_prices[type];
    if (!prices) return false;
    // Ranges: <1m, 1-2m, >2m
    if (!prices['<1m'] || prices['<1m'] <= 0) return false;
    if (!prices['1-2m'] || prices['1-2m'] <= 0) return false;
    if (!prices['>2m'] || prices['>2m'] <= 0) return false;
  }
  return true;
};

// --- Tree Validation ---
export const isTreeConfigValid = (config: TreePricingConfig | undefined): boolean => {
  if (!config) return false;
  
  // Mandatory fields present
  if (config.structuralHourlyRate == null) return false;
  if (config.shapingHourlyRate == null) return false;
  if (config.ladderModifier == null) return false;
  if (config.climbingModifier == null) return false;
  if (config.wasteRemovalModifier == null) return false;

  // Values Validity
  if (config.structuralHourlyRate <= 0) return false;
  if (config.shapingHourlyRate <= 0) return false;

  // Modifiers >= 0
  if (config.ladderModifier < 0) return false;
  if (config.climbingModifier < 0) return false;
  if (config.wasteRemovalModifier < 0) return false;

  return true;
};

// --- Shrub Validation ---
export const isShrubConfigValid = (config: ShrubPricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_types || config.selected_types.length === 0) return false;

  for (const type of config.selected_types) {
    const prices = config.species_prices[type];
    if (!prices) return false;
    // Sizes: Pequeño (hasta 1m), Mediano (1-2.5m), Grande (>2.5m)
    if (!prices['Pequeño (hasta 1m)'] || prices['Pequeño (hasta 1m)'] <= 0) return false;
    if (!prices['Mediano (1-2.5m)'] || prices['Mediano (1-2.5m)'] <= 0) return false;
    if (!prices['Grande (>2.5m)'] || prices['Grande (>2.5m)'] <= 0) return false;
  }
  return true;
};

// --- Clearing Validation ---
export const isClearingConfigValid = (config: ClearingPricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_types || config.selected_types.length === 0) return false;

  for (const type of config.selected_types) {
    const prices = config.type_prices[type];
    if (!prices) return false;
    // Ranges: 0-50, 50-200, 200+
    if (!prices['0-50'] || prices['0-50'] <= 0) return false;
    if (!prices['50-200'] || prices['50-200'] <= 0) return false;
    if (!prices['200+'] || prices['200+'] <= 0) return false;
  }
  return true;
};

// --- Fumigation Validation ---
export const isFumigationConfigValid = (config: FumigationPricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_types || config.selected_types.length === 0) return false;

  for (const type of config.selected_types) {
    const prices = config.type_prices[type];
    if (!prices) return false;
    // Ranges: 0-50, 50-200, 200+
    if (!prices['0-50'] || prices['0-50'] <= 0) return false;
    if (!prices['50-200'] || prices['50-200'] <= 0) return false;
    if (!prices['200+'] || prices['200+'] <= 0) return false;
  }
  return true;
};
