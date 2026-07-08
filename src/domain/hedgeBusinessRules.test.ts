import { describe, expect, it } from 'vitest';

import {
  HEDGE_HEIGHT_BANDS,
  mapHedgeHeightToBand,
  normalizeHedgeState,
} from './hedgeBusinessRules';

describe('hedgeBusinessRules', () => {
  it('mapea alturas a las bandas EXACTAS de la config del jardinero (0-2m/2-4m/4-6m)', () => {
    // Regresión del bug: la UI generaba '0-1m'/'1-2m' (bandas inexistentes en
    // pricing_matrix) y todos los jardineros quedaban excluidos para setos ≤2m.
    expect(mapHedgeHeightToBand(0.8)).toBe('0-2m');
    expect(mapHedgeHeightToBand(1.9)).toBe('0-2m');
    expect(mapHedgeHeightToBand(2)).toBe('0-2m');
    expect(mapHedgeHeightToBand(2.5)).toBe('2-4m');
    expect(mapHedgeHeightToBand(4)).toBe('2-4m');
    expect(mapHedgeHeightToBand(5.5)).toBe('4-6m');
    // Alturas por encima de 6m se cotizan con la banda superior; la revisión va por observaciones.
    expect(mapHedgeHeightToBand(7)).toBe('4-6m');

    for (const height of [0.5, 1.99, 2.01, 3.9, 4.5, 6]) {
      expect(HEDGE_HEIGHT_BANDS).toContain(mapHedgeHeightToBand(height));
    }
  });

  it('normaliza el estado a los valores que el motor mapea a condition_surcharges', () => {
    expect(normalizeHedgeState('media')).toBe('media');
    expect(normalizeHedgeState('alta')).toBe('alta');
    expect(normalizeHedgeState('descuidado')).toBe('media');
    expect(normalizeHedgeState('muy descuidado')).toBe('alta');
    expect(normalizeHedgeState('muy_descuidado')).toBe('alta');
    expect(normalizeHedgeState('normal')).toBe('normal');
    expect(normalizeHedgeState(undefined)).toBe('normal');
    expect(normalizeHedgeState('')).toBe('normal');
  });
});
