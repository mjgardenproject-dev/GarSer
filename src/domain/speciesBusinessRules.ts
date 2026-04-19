export const PALM_CANONICAL_SPECIES = [
  'Phoenix canariensis',
  'Phoenix dactylifera',
  'Washingtonia robusta/filifera',
  'Syagrus romanzoffiana',
  'Trachycarpus fortunei',
  'Roystonea regia'
] as const;

export type PalmCanonicalSpecies = (typeof PALM_CANONICAL_SPECIES)[number];

export interface SpeciesBusinessRule {
  canonicalName: PalmCanonicalSpecies;
  aliases: readonly string[];
  hasPhytosanitary: boolean;
  hasTrunkPeeling: boolean;
  lowestRangeThreshold: string;
}

export const speciesBusinessRules: Record<PalmCanonicalSpecies, SpeciesBusinessRule> = {
  'Phoenix canariensis': {
    canonicalName: 'Phoenix canariensis',
    aliases: ['phoenix canariensis', 'canariensis'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-4m'
  },
  'Phoenix dactylifera': {
    canonicalName: 'Phoenix dactylifera',
    aliases: ['phoenix dactylifera', 'dactylifera'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-5m'
  },
  'Washingtonia robusta/filifera': {
    canonicalName: 'Washingtonia robusta/filifera',
    aliases: ['washingtonia robusta/filifera', 'washingtonia', 'robusta', 'filifera'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-4m'
  },
  'Syagrus romanzoffiana': {
    canonicalName: 'Syagrus romanzoffiana',
    aliases: ['syagrus romanzoffiana', 'syagrus', 'romanzoffiana'],
    hasPhytosanitary: false,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-5m'
  },
  'Trachycarpus fortunei': {
    canonicalName: 'Trachycarpus fortunei',
    aliases: ['trachycarpus fortunei', 'trachycarpus', 'fortunei'],
    hasPhytosanitary: true,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-3m'
  },
  'Roystonea regia': {
    canonicalName: 'Roystonea regia',
    aliases: ['roystonea regia', 'roystonea', 'regia'],
    hasPhytosanitary: false,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-6m'
  }
};

const normalizeSpecies = (species: string): string => {
  return (species || '').toLowerCase().replace(/\s+o similar$/, '').trim();
};

export const resolveSpeciesBusinessRule = (species: string): SpeciesBusinessRule | null => {
  const normalized = normalizeSpecies(species);
  if (!normalized) return null;

  for (const canonical of PALM_CANONICAL_SPECIES) {
    const rule = speciesBusinessRules[canonical];
    if (rule.aliases.some(alias => normalized.includes(alias))) {
      return rule;
    }
  }

  return null;
};

export const supportsTrunkFinishForSpecies = (species: string): boolean => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return true;
  return rule.hasTrunkPeeling;
};

export const supportsTrunkPeelingForSpecies = (species: string): boolean => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return true;
  return rule.hasTrunkPeeling;
};

export const supportsPhytosanitaryForSpecies = (species: string): boolean => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return true;
  return rule.hasPhytosanitary;
};

export const getLowestRangeThresholdForSpecies = (species: string): string => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return '0-5m';
  return rule.lowestRangeThreshold;
};

const normalizeHeightRange = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/m/g, '')
    .replace(/\s+/g, '')
    .trim();
};

export const isLowestRangeThresholdForSpecies = (species: string, heightRange: string): boolean => {
  return normalizeHeightRange(heightRange) === normalizeHeightRange(getLowestRangeThresholdForSpecies(species));
};

export const canApplyTrunkFinish = (species: string, requested: boolean | undefined): boolean => {
  return Boolean(requested) && supportsTrunkPeelingForSpecies(species);
};

export const canApplyTrunkPeeling = (species: string, requested: boolean | undefined): boolean => {
  return Boolean(requested) && supportsTrunkPeelingForSpecies(species);
};
