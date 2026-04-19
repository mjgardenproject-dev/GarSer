import type { WeedingPricingConfig, WeedingState } from './serviceValidation';

export interface WeedingZoneInput {
  id?: string;
  area: number;
  state?: string;
  applyHerbicide?: boolean;
}

export interface WeedingQuoteBreakdownItem {
  zoneId: string;
  area: number;
  state: WeedingState;
  applyHerbicide: boolean;
  baseDesbroce: number;
  herbicideAddon: number;
  statePercent: number;
  wastePercent: number;
  subtotalBeforeModifiers: number;
  lineTotal: number;
}

export interface WeedingQuoteResult {
  totalBeforeMinimum: number;
  finalPrice: number;
  minimumApplied: boolean;
  minimumPrice: number;
  breakdown: WeedingQuoteBreakdownItem[];
}

export const normalizeWeedingState = (value?: string): WeedingState => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('alta')) return 'dificultad_alta';
  if (normalized.includes('media')) return 'dificultad_media';
  return 'normal';
};

const toSafeNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
};

const getStatePercent = (state: WeedingState, config: WeedingPricingConfig): number => {
  if (state === 'dificultad_alta') return toSafeNumber(config.suplementos?.dificultad_alta);
  if (state === 'dificultad_media') return toSafeNumber(config.suplementos?.dificultad_media);
  return 0;
};

export const calculateWeedingZonePrice = (params: {
  zone: WeedingZoneInput;
  config: WeedingPricingConfig;
  globalWaste: boolean;
  zoneIdFallback?: string;
}): WeedingQuoteBreakdownItem => {
  const zone = params.zone;
  const config = params.config;
  const area = toSafeNumber(zone.area);
  const state = normalizeWeedingState(zone.state);
  const applyHerbicide = Boolean(zone.applyHerbicide);

  const baseDesbroce = toSafeNumber(config.precio_desbroce_m2) * area;
  const herbicideAddon = applyHerbicide ? toSafeNumber(config.precio_herbicida_m2) * area : 0;
  const statePercent = getStatePercent(state, config);
  const wastePercent = params.globalWaste ? toSafeNumber(config.suplementos?.retirada_restos) : 0;

  const subtotalBeforeModifiers = baseDesbroce + herbicideAddon;
  const stateMultiplier = 1 + (statePercent / 100);
  const wasteMultiplier = 1 + (wastePercent / 100);
  const lineTotal = subtotalBeforeModifiers * stateMultiplier * wasteMultiplier;

  return {
    zoneId: zone.id || params.zoneIdFallback || 'zone-unknown',
    area,
    state,
    applyHerbicide,
    baseDesbroce,
    herbicideAddon,
    statePercent,
    wastePercent,
    subtotalBeforeModifiers,
    lineTotal
  };
};

export const calculateWeedingQuote = (params: {
  zones: WeedingZoneInput[];
  config: WeedingPricingConfig;
  globalWaste: boolean;
}): WeedingQuoteResult => {
  const zones = Array.isArray(params.zones) ? params.zones : [];
  const config = params.config;
  const breakdown = zones.map((zone, idx) =>
    calculateWeedingZonePrice({
      zone,
      config,
      globalWaste: params.globalWaste,
      zoneIdFallback: `zone-${idx + 1}`
    })
  );

  const totalBeforeMinimum = breakdown.reduce((acc, item) => acc + item.lineTotal, 0);
  const minimumPrice = toSafeNumber(config.importe_minimo);
  const minimumApplied = minimumPrice > 0 && totalBeforeMinimum > 0 && totalBeforeMinimum < minimumPrice;
  const finalPriceRaw = minimumApplied ? minimumPrice : totalBeforeMinimum;

  return {
    totalBeforeMinimum,
    finalPrice: Math.ceil(finalPriceRaw),
    minimumApplied,
    minimumPrice: Math.ceil(minimumPrice),
    breakdown
  };
};
