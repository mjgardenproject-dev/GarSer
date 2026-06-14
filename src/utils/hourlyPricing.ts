export interface HourlyPricingLike {
  precioPorHora?: number | string | null;
  hourly_rate?: number | string | null;
}

export interface PricingMethodLike extends HourlyPricingLike {
  pricing_method?: string | null;
  use_yield_calculation?: boolean | null;
}

export type PricingMethod = 'per_quantity' | 'per_hour';

export const getPrecioPorHora = (config?: HourlyPricingLike | null): number => {
  const raw = config?.precioPorHora ?? config?.hourly_rate ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getPricingMethod = (
  config?: PricingMethodLike | null,
  options?: { allowLegacyYieldCalculation?: boolean }
): PricingMethod => {
  if (config?.pricing_method === 'per_hour') return 'per_hour';
  if (config?.pricing_method === 'per_quantity') return 'per_quantity';

  if (options?.allowLegacyYieldCalculation && config?.use_yield_calculation && getPrecioPorHora(config) > 0) {
    return 'per_hour';
  }

  return 'per_quantity';
};

export const isPerHourPricing = (
  config?: PricingMethodLike | null,
  options?: { allowLegacyYieldCalculation?: boolean }
): boolean => getPricingMethod(config, options) === 'per_hour';

export const normalizePrecioPorHora = <T extends HourlyPricingLike>(config: T): T & { precioPorHora?: number } => {
  const precioPorHora = getPrecioPorHora(config);
  if (precioPorHora > 0) {
    return {
      ...config,
      precioPorHora,
    };
  }

  return {
    ...config,
    precioPorHora: config?.precioPorHora as any,
  };
};
