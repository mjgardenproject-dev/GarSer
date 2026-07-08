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
  highestOpenRangeThreshold: string;
}

export const speciesBusinessRules: Record<PalmCanonicalSpecies, SpeciesBusinessRule> = {
  'Phoenix canariensis': {
    canonicalName: 'Phoenix canariensis',
    aliases: ['phoenix canariensis', 'canariensis'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-4m',
    highestOpenRangeThreshold: '>10m'
  },
  'Phoenix dactylifera': {
    canonicalName: 'Phoenix dactylifera',
    aliases: ['phoenix dactylifera', 'dactylifera'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-5m',
    highestOpenRangeThreshold: '>15m'
  },
  'Washingtonia robusta/filifera': {
    canonicalName: 'Washingtonia robusta/filifera',
    aliases: ['washingtonia robusta/filifera', 'washingtonia', 'robusta', 'filifera'],
    hasPhytosanitary: true,
    hasTrunkPeeling: true,
    lowestRangeThreshold: '0-4m',
    highestOpenRangeThreshold: '>20m'
  },
  'Syagrus romanzoffiana': {
    canonicalName: 'Syagrus romanzoffiana',
    aliases: ['syagrus romanzoffiana', 'syagrus', 'romanzoffiana'],
    hasPhytosanitary: false,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-5m',
    highestOpenRangeThreshold: '>10m'
  },
  'Trachycarpus fortunei': {
    canonicalName: 'Trachycarpus fortunei',
    aliases: ['trachycarpus fortunei', 'trachycarpus', 'fortunei'],
    hasPhytosanitary: true,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-3m',
    highestOpenRangeThreshold: '>6m'
  },
  'Roystonea regia': {
    canonicalName: 'Roystonea regia',
    aliases: ['roystonea regia', 'roystonea', 'regia'],
    hasPhytosanitary: false,
    hasTrunkPeeling: false,
    lowestRangeThreshold: '0-6m',
    highestOpenRangeThreshold: '>6m'
  }
};

/**
 * Bandas de altura de tronco (en metros, sin sufijo "m") por especie.
 * SSOT compartido por el configurador del jardinero, el edge de análisis IA
 * y la UI de reserva. Las claves de `height_prices` y `yield_units_per_hour`
 * del jardinero usan exactamente estos literales.
 */
export const PALM_SPECIES_HEIGHT_BANDS: Record<PalmCanonicalSpecies, readonly string[]> = {
  'Phoenix canariensis': ['0-4', '4-10', '>10'],
  'Phoenix dactylifera': ['0-5', '5-10', '10-15', '>15'],
  'Washingtonia robusta/filifera': ['0-4', '4-12', '12-20', '>20'],
  'Syagrus romanzoffiana': ['0-5', '5-10', '>10'],
  'Trachycarpus fortunei': ['0-3', '3-6', '>6'],
  'Roystonea regia': ['0-6', '>6']
};

/**
 * Altura de tronco máxima plausible (m) por especie, para post-validación
 * anti-alucinación del análisis IA. Un valor por encima no se rechaza: se
 * degrada el nivel de análisis y se pide confirmación al cliente.
 */
export const PALM_SPECIES_MAX_PLAUSIBLE_HEIGHT_M: Record<PalmCanonicalSpecies, number> = {
  'Phoenix canariensis': 20,
  'Phoenix dactylifera': 25,
  'Washingtonia robusta/filifera': 30,
  'Syagrus romanzoffiana': 20,
  'Trachycarpus fortunei': 12,
  'Roystonea regia': 25
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

export const getHighestOpenRangeThresholdForSpecies = (species: string): string | null => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return null;
  return rule.highestOpenRangeThreshold;
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

export const isHighestOpenRangeForSpecies = (species: string, heightRange: string): boolean => {
  const threshold = getHighestOpenRangeThresholdForSpecies(species);
  if (!threshold) return false;
  return normalizeHeightRange(heightRange) === normalizeHeightRange(threshold);
};

export const getPalmHeightBandsForSpecies = (species: string): readonly string[] => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return [];
  return PALM_SPECIES_HEIGHT_BANDS[rule.canonicalName];
};

/**
 * Mapea una altura de tronco en metros a la banda de precio de la especie.
 * Devuelve null si la especie no es canónica o la altura no es válida.
 */
export const mapPalmHeightToBand = (species: string, heightM: number): string | null => {
  const bands = getPalmHeightBandsForSpecies(species);
  if (bands.length === 0 || !Number.isFinite(heightM) || heightM < 0) return null;

  for (const band of bands) {
    if (band.startsWith('>')) {
      if (heightM >= parseFloat(band.slice(1))) return band;
    } else {
      const [min, max] = band.split('-').map(Number);
      if (heightM >= min && heightM < max) return band;
    }
  }
  return bands[0];
};

export const getMaxPlausiblePalmHeightM = (species: string): number | null => {
  const rule = resolveSpeciesBusinessRule(species);
  if (!rule) return null;
  return PALM_SPECIES_MAX_PLAUSIBLE_HEIGHT_M[rule.canonicalName];
};

export const canApplyTrunkFinish = (species: string, requested: boolean | undefined): boolean => {
  return Boolean(requested) && supportsTrunkPeelingForSpecies(species);
};

export const canApplyTrunkPeeling = (species: string, requested: boolean | undefined): boolean => {
  return Boolean(requested) && supportsTrunkPeelingForSpecies(species);
};
