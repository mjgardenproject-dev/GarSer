import { describe, expect, it } from 'vitest';
import { calculatePhytosanitaryQuote } from './serviceValidation';

const baseConfig = {
  version: 'phytosanitary_v2' as const,
  importe_minimo: 40,
  minimum_fee: 100,
  tratamientos_activos: ['insecticida', 'fungicida', 'herbicida', 'ecologico_preventivo'] as const,
  superficies_plantas: {
    hasta_100m2: { insecticida: 3, fungicida: 4, herbicida: 2, ecologico_preventivo: 2 },
    mas_de_100m2: { insecticida: 2, fungicida: 3, herbicida: 1, ecologico_preventivo: 1.5 }
  },
  setos: {
    hasta_2m: { insecticida: 7, fungicida: 8, ecologico_preventivo: 6 },
    mas_de_2m: { insecticida: 9, fungicida: 10, ecologico_preventivo: 8 }
  },
  arboles: {
    hasta_3m: { insecticida: 12, fungicida: 13, ecologico_preventivo: 11 },
    mas_de_3m: { insecticida: 15, fungicida: 16, ecologico_preventivo: 14 }
  },
  palmeras: {
    tradicional: { hasta_3m: 18, mas_de_3m: 22 },
    endoterapia: { precio_unico: 35 }
  },
  recargo_retirada: { percentage: 20 },
  pricing_modifiers: {
    eco: { percentage: 10 },
    combo: { two_treatments_percentage: -5, three_plus_treatments_percentage: -12 }
  }
};

describe('calculatePhytosanitaryQuote', () => {
  it('aplica fórmula eco/combo y minimum_fee', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{ area: 10, type: 'ecologico_preventivo+insecticida', affectedType: 'Césped' }],
      config: baseConfig,
      globalWaste: true
    });

    expect(result.totalBeforeMinimum).toBeCloseTo(62.7, 4);
    expect(result.minimumFeeApplied).toBe(true);
    expect(result.minimumFee).toBe(100);
    expect(result.total).toBe(100);
    expect(result.breakdown[0].subtotal).toBe(50);
    expect(result.breakdown[0].lineTotal).toBeCloseTo(62.7, 4);
  });

  it('devuelve subtotal nulo cuando no hay compatibilidad', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{ area: 5, type: 'herbicida', affectedType: 'Setos', aboveTwoMeters: false }],
      config: {
        ...baseConfig,
        tratamientos_activos: ['herbicida']
      },
      globalWaste: true
    });

    expect(result.total).toBe(0);
    expect(result.breakdown[0].subtotal).toBeNull();
    expect(result.breakdown[0].reason).toContain('compatibles');
  });

  it('usa métricas detalladas de palmeras y suma cirugía detectada por IA', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{
        area: 2,
        type: 'insecticida',
        affectedType: 'Palmeras',
        analysisMetrics: {
          palmeras_ducha_med_ud: 2,
          palmeras_cirugia_ud: 2
        }
      }],
      config: {
        ...baseConfig,
        tratamientos_activos: ['insecticida', 'fungicida', 'herbicida', 'ecologico_preventivo', 'endoterapia']
      },
      globalWaste: false
    });

    expect(result.minimumFeeApplied).toBe(false);
    expect(result.totalBeforeMinimum).toBeCloseTo(114, 4);
    expect(result.total).toBeCloseTo(114, 4);
    expect(result.breakdown[0].subtotal).toBeCloseTo(114, 4);
    expect(result.breakdown[0].quantity).toBe(1);
  });
});
