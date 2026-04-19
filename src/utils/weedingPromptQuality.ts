export type WeedingState = 'normal' | 'dificultad_media' | 'dificultad_alta' | null;

export interface WeedingPromptRun {
  estado_malas_hierbas: WeedingState;
  nivel_analisis: 1 | 2 | 3;
  superficie_malas_hierbas_m2: number;
}

export interface WeedingRepeatabilityMetrics {
  sample_size: number;
  state_match_ratio: number;
  level_match_ratio: number;
  area_band_match_ratio: number;
  area_cv: number;
}

export const areaBand = (value: number): number => {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.round(safe / 5) * 5;
};

const modeRatio = (values: string[]): number => {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  values.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  let max = 0;
  counts.forEach((count) => {
    if (count > max) max = count;
  });
  return max / values.length;
};

export const computeWeedingRepeatabilityMetrics = (runs: WeedingPromptRun[]): WeedingRepeatabilityMetrics => {
  const sampleSize = runs.length;
  if (sampleSize === 0) {
    return {
      sample_size: 0,
      state_match_ratio: 0,
      level_match_ratio: 0,
      area_band_match_ratio: 0,
      area_cv: 0
    };
  }

  const states = runs.map((r) => String(r.estado_malas_hierbas ?? 'null'));
  const levels = runs.map((r) => String(r.nivel_analisis));
  const bands = runs.map((r) => String(areaBand(r.superficie_malas_hierbas_m2)));
  const areas = runs.map((r) => Math.max(0, Number(r.superficie_malas_hierbas_m2 || 0)));

  const mean = areas.reduce((acc, value) => acc + value, 0) / sampleSize;
  const variance = areas.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / sampleSize;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const areaCv = mean > 0 ? stdDev / mean : 0;

  return {
    sample_size: sampleSize,
    state_match_ratio: modeRatio(states),
    level_match_ratio: modeRatio(levels),
    area_band_match_ratio: modeRatio(bands),
    area_cv: Number(areaCv.toFixed(4))
  };
};
