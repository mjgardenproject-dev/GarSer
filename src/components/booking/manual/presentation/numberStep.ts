/**
 * Botones «+ / −» de un stepper: llevan al siguiente múltiplo del paso, dentro del rango.
 *
 * Antes sumaban el paso al valor que hubiera: la altura del seto empezaba en su mínimo (0,3 m) y
 * con paso 0,5 daba 0,8 · 1,3 · 1,8 · 2,3 — nunca 2,0, que es justo el límite entre los tramos de
 * tarifa «hasta 2 m» y «2–4 m» (P-03). Ahora: 0,3 → 0,5 → 1,0 → 1,5 → 2,0 → 2,5… Escribir en la
 * casilla sigue admitiendo cualquier valor del rango; esto solo afecta a los botones.
 */
export function stepValue(
  current: number | undefined,
  direction: 1 | -1,
  { min, max, step }: { min?: number; max?: number; step: number },
): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : (min ?? 0);
  const units = base / step;
  const EPSILON = 1e-9;
  const nextUnits = direction > 0 ? Math.floor(units + EPSILON) + 1 : Math.ceil(units - EPSILON) - 1;
  let next = Math.round(nextUnits * step * 1e6) / 1e6;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}
