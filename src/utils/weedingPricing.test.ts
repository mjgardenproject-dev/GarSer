import { describe, expect, it } from 'vitest';
import { calculateWeedingQuote, normalizeWeedingState } from './weedingPricing';

const baseConfig = {
  version: 'weeding_v1' as const,
  importe_minimo: 50,
  precio_desbroce_m2: 2,
  precio_herbicida_m2: 1,
  suplementos: {
    dificultad_media: 20,
    dificultad_alta: 50,
    retirada_restos: 10
  }
};

describe('weedingPricing', () => {
  it('normaliza estados inválidos a normal', () => {
    expect(normalizeWeedingState(undefined)).toBe('normal');
    expect(normalizeWeedingState('dificultad_media')).toBe('dificultad_media');
    expect(normalizeWeedingState('DIFICULTAD_ALTA')).toBe('dificultad_alta');
    expect(normalizeWeedingState('foo')).toBe('normal');
  });

  it('calcula base + herbicida en tiempo real', () => {
    const withoutHerbicide = calculateWeedingQuote({
      zones: [{ id: 'z1', area: 10, state: 'normal', applyHerbicide: false }],
      config: baseConfig,
      globalWaste: false
    });
    const withHerbicide = calculateWeedingQuote({
      zones: [{ id: 'z1', area: 10, state: 'normal', applyHerbicide: true }],
      config: baseConfig,
      globalWaste: false
    });

    expect(withoutHerbicide.totalBeforeMinimum).toBe(20);
    expect(withHerbicide.totalBeforeMinimum).toBe(30);
  });

  it('aplica suplemento por dificultad y retirada de restos', () => {
    const result = calculateWeedingQuote({
      zones: [{ id: 'z1', area: 10, state: 'dificultad_media', applyHerbicide: true }],
      config: baseConfig,
      globalWaste: true
    });

    // Base 30 * 1.2 * 1.1 = 39.6
    expect(result.totalBeforeMinimum).toBeCloseTo(39.6, 4);
    expect(result.finalPrice).toBe(50); // Minimum fee applies
    expect(result.minimumApplied).toBe(true);
  });

  it('aplica mínimo solo cuando corresponde', () => {
    const result = calculateWeedingQuote({
      zones: [{ id: 'z1', area: 100, state: 'dificultad_alta', applyHerbicide: true }],
      config: baseConfig,
      globalWaste: false
    });

    // (200 + 100) * 1.5 = 450
    expect(result.totalBeforeMinimum).toBe(450);
    expect(result.finalPrice).toBe(450);
    expect(result.minimumApplied).toBe(false);
  });
});
