/**
 * SSOT de bandas de altura de setos.
 *
 * Las claves de `pricing_matrix` y `yield_ml_per_hour` del jardinero usan
 * exactamente estos literales (ver HedgePricingConfigurator y
 * garser-pricing-rules §6.2). Cualquier mapeo altura→banda del flujo de
 * reserva (fotos o manual) debe pasar por aquí: tener dos implementaciones
 * divergentes provocó que los setos ≤2m analizados con fotos usaran bandas
 * inexistentes ('0-1m'/'1-2m') y excluyeran a todos los jardineros.
 */
export const HEDGE_HEIGHT_BANDS = ['0-2m', '2-4m', '4-6m'] as const;

export type HedgeHeightBand = (typeof HEDGE_HEIGHT_BANDS)[number];

/** Altura máxima plausible (m) para post-validación anti-alucinación. */
export const HEDGE_MAX_PLAUSIBLE_HEIGHT_M = 8;

/** Longitud máxima plausible (m) de un seto residencial. */
export const HEDGE_MAX_PLAUSIBLE_LENGTH_M = 200;

/**
 * Mapea una altura bruta en metros a la banda de precio del motor.
 * Alturas >6m se clasifican en '4-6m' (la banda superior); la revisión de
 * seguridad para alturas implausibles se señala aparte vía observaciones.
 */
export const mapHedgeHeightToBand = (heightM: number): HedgeHeightBand => {
  if (!Number.isFinite(heightM) || heightM <= 2) return '0-2m';
  if (heightM <= 4) return '2-4m';
  return '4-6m';
};

/** Etiquetas para selects/chips de la UI de reserva. */
export const HEDGE_BAND_LABELS: Record<HedgeHeightBand, string> = {
  '0-2m': 'Bajo (hasta 2 m)',
  '2-4m': 'Medio (2-4 m)',
  '4-6m': 'Alto (4-6 m)',
};

export type HedgeState = 'normal' | 'media' | 'alta';

/**
 * Normaliza el estado del seto a los valores del motor.
 * El motor mapea: media → condition_surcharges.media, alta → condition_surcharges.alta
 * (también acepta los alias descuidado/muy_descuidado de otros servicios).
 */
export const normalizeHedgeState = (value: unknown): HedgeState => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('alta') || normalized.includes('muy')) return 'alta';
  if (normalized.includes('media') || normalized.includes('descuidad')) return 'media';
  return 'normal';
};

/** Etiquetas de estado orientadas al cliente (media/alta son jerga interna). */
export const HEDGE_STATE_LABELS: Record<HedgeState, string> = {
  normal: 'Normal',
  media: 'Descuidado',
  alta: 'Muy descuidado',
};
