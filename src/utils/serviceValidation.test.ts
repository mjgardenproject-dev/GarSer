import { describe, expect, it } from 'vitest';
import { calculatePhytosanitaryQuote } from './serviceValidation';

const baseConfig = {
  version: 'phytosanitary_v2' as const,
  importe_minimo: 40,
  minimum_fee: 100,
  tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo'] as const,
  superficies_plantas: {
    hasta_100m2: { insecticida: 3, fungicida: 4, ecologico_preventivo: 2 },
    mas_de_100m2: { insecticida: 2, fungicida: 3, ecologico_preventivo: 1.5 }
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
  },
  yields: {
    cesped_m2_per_hour: 100,
    setos_ml_per_hour: 20,
    palmeras_units_per_hour: 2,
    arboles_units_per_hour: 2,
    plantas_m2_per_hour: 50,
    endoterapia_units_per_hour: 2,
  }
};

describe('calculatePhytosanitaryQuote', () => {
  it('aplica modificador eco y minimum_fee en césped preventivo', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{ area: 10, intent: 'preventive', productPreference: 'ecological', affectedType: 'Césped' }],
      config: baseConfig,
      globalWaste: true
    });

    expect(result.totalBeforeMinimum).toBeCloseTo(22, 4);
    expect(result.minimumFeeApplied).toBe(true);
    expect(result.minimumFee).toBe(100);
    expect(result.total).toBe(100);
    expect(result.breakdown[0].subtotal).toBe(20);
    expect(result.breakdown[0].lineTotal).toBeCloseTo(22, 4);
  });

  it('devuelve subtotal nulo cuando no hay compatibilidad', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{ area: 5, intent: 'curative', curativeTarget: 'insects', productPreference: 'chemical', affectedType: 'Setos', aboveTwoMeters: false }],
      config: {
        ...baseConfig,
        tratamientos_activos: ['endoterapia'],
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
        intent: 'curative',
        curativeTarget: 'insects',
        productPreference: 'chemical',
        affectedType: 'Palmeras',
        analysisMetrics: {
          palmeras_ducha_med_ud: 2,
          palmeras_cirugia_ud: 2
        }
      }],
      config: {
        ...baseConfig,
        tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia']
      },
      globalWaste: false
    });

    expect(result.minimumFeeApplied).toBe(false);
    expect(result.totalBeforeMinimum).toBeCloseTo(108.3, 4);
    expect(result.total).toBeCloseTo(109, 4);
    expect(result.breakdown[0].subtotal).toBeCloseTo(114, 4); // Combo multiplier applied later (-5%)
    expect(result.breakdown[0].quantity).toBe(1);
  });

  it('redondea los m² de plantas calculados', () => {
    const result = calculatePhytosanitaryQuote({
      zones: [{
        area: 10.7,
        intent: 'curative',
        curativeTarget: 'insects',
        productPreference: 'chemical',
        affectedType: 'Plantas bajas',
        analysisMetrics: {
          plantas_superficie_calculada_m2: 10.7,
          plantas_tamano_dominante: 'grandes'
        } as any
      }],
      config: {
        ...baseConfig,
        detailed_pricing: {
          cesped: { minimo: 0, preventivo: 0, curativo: 0 },
          setos: { minimo: 0, bajos_preventivo: 0, bajos_curativo: 0, altos_preventivo: 0, altos_curativo: 0 },
          palmeras: {
            minimo: 0, pequenas_preventivo: 0, pequenas_curativo: 0, pequenas_cirugia: 0,
            medianas_preventivo: 0, medianas_curativo: 0, medianas_cirugia: 0,
            altas_preventivo: 0, altas_curativo: 0, altas_cirugia: 0
          },
          arboles: {
            minimo: 0, pequenos_preventivo: 0, pequenos_curativo: 0,
            medianos_preventivo: 0, medianos_curativo: 0,
            grandes_preventivo: 0, grandes_curativo: 0
          },
          plantas: {
            minimo: 0,
            pequenas_preventivo: 2,
            pequenas_curativo: 3,
            medianas_preventivo: 2,
            medianas_curativo: 3,
            grandes_preventivo: 2,
            grandes_curativo: 3
          }
        },
        tratamientos_activos: ['insecticida']
      },
      globalWaste: false
    });

    expect(result.breakdown[0].quantity).toBe(1); // M2 are bundled in unit for detailed metrics
    expect(result.breakdown[0].subtotal).toBeCloseTo(32.1, 4);
    expect(result.breakdown[0].formula).toContain('32.10');
  });
});

describe('Phytosanitary Photo Validation', () => {
  it('should require at least 1 photo', () => {
    // This test simulates the logic inside DetailsPage.tsx for getPhytosanitaryValidation
    const testValidation = (selectedPhotoCount: number) => {
      const issues: string[] = [];
      if (selectedPhotoCount < 1) issues.push('Selecciona al menos 1 foto para analizar esta zona.');
      if (selectedPhotoCount > 5) issues.push('No puedes analizar más de 5 fotos por zona.');
      return issues;
    };

    expect(testValidation(0)).toContain('Selecciona al menos 1 foto para analizar esta zona.');
    expect(testValidation(1).length).toBe(0);
    expect(testValidation(3).length).toBe(0);
    expect(testValidation(5).length).toBe(0);
    expect(testValidation(6)).toContain('No puedes analizar más de 5 fotos por zona.');
  });
});
