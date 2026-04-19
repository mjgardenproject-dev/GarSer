import { describe, it, expect } from 'vitest';
import { calculatePhytosanitaryQuote } from './serviceValidation';
import { PhytosanitaryPricingConfig, PhytosanitaryDetailedPricing } from '../types';

const MOCK_DETAILED_PRICING: PhytosanitaryDetailedPricing = {
  cesped: { minimo: 0, preventivo: 1, curativo: 2 },
  setos: { minimo: 0, bajos_preventivo: 2, bajos_curativo: 3, altos_preventivo: 4, altos_curativo: 5 },
  palmeras: {
    minimo: 0,
    pequenas_preventivo: 10,
    pequenas_curativo: 15,
    pequenas_cirugia: 50,
    medianas_preventivo: 20,
    medianas_curativo: 25,
    medianas_cirugia: 75,
    altas_preventivo: 30,
    altas_curativo: 35,
    altas_cirugia: 100
  },
  arboles: {
    minimo: 0,
    pequenos_preventivo: 10,
    pequenos_curativo: 15,
    medianos_preventivo: 20,
    medianos_curativo: 25,
    grandes_preventivo: 30,
    grandes_curativo: 35
  },
  plantas: {
    minimo: 0,
    pequenas_preventivo: 5,
    pequenas_curativo: 7,
    medianas_preventivo: 10,
    medianas_curativo: 12,
    grandes_preventivo: 15,
    grandes_curativo: 17
  }
};

const MOCK_CONFIG: PhytosanitaryPricingConfig = {
  version: 'phytosanitary_v2',
  importe_minimo: 50,
  minimum_price: 50,
  minimum_fee: 50,
  pricing_modifiers: {
    eco: { percentage: 20 },
    combo: { two_treatments_percentage: 10, three_plus_treatments_percentage: 15 }
  },
  detailed_pricing: MOCK_DETAILED_PRICING,
  tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia']
};

describe('Phytosanitary Pricing Calculator', () => {
  it('should calculate lawn (cesped) preventive correctly', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Césped',
        intent: 'preventive',
        area: 100,
        analysisMetrics: { cesped_m2: 100 } as any
      }]
    });
    
    // 100m2 * 1 (preventivo) = 100. Minimum fee is 50. Total = 100.
    expect(result.totalBeforeMinimum).toBe(100);
    expect(result.final_price).toBe(100);
    expect(result.minimumFeeApplied).toBe(false);
  });

  it('should calculate lawn (cesped) curative correctly', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Césped',
        intent: 'curative',
        area: 100,
        analysisMetrics: { cesped_m2: 100 } as any
      }]
    });
    
    // 100m2 * 2 (curativo) = 200. Total = 200.
    expect(result.totalBeforeMinimum).toBe(200);
    expect(result.final_price).toBe(200);
  });

  it('should apply minimum fee if subtotal is lower', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Césped',
        intent: 'preventive',
        area: 10,
        analysisMetrics: { cesped_m2: 10 } as any
      }]
    });
    
    // 10m2 * 1 = 10. Minimum is 50. Total = 50.
    expect(result.totalBeforeMinimum).toBe(10);
    expect(result.final_price).toBe(50);
    expect(result.minimumFeeApplied).toBe(true);
  });

  it('should calculate plant sizes (pequenas, medianas, grandes)', () => {
    // Pequenas Preventivo (5€/m2)
    const resultPequenas = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Plantas bajas', intent: 'preventive', area: 10,
        analysisMetrics: { plantas_superficie_calculada_m2: 10, plantas_tamano_dominante: 'pequenas' } as any
      }]
    });
    expect(resultPequenas.totalBeforeMinimum).toBe(50); // 10 * 5 = 50

    // Medianas Curativo (12€/m2)
    const resultMedianas = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Plantas bajas', intent: 'curative', area: 10,
        analysisMetrics: { plantas_superficie_calculada_m2: 10, plantas_tamano_dominante: 'medianas' } as any
      }]
    });
    expect(resultMedianas.totalBeforeMinimum).toBe(120); // 10 * 12 = 120

    // Grandes Curativo (17€/m2)
    const resultGrandes = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Plantas bajas', intent: 'curative', area: 10,
        analysisMetrics: { plantas_superficie_calculada_m2: 10, plantas_tamano_dominante: 'grandes' } as any
      }]
    });
    expect(resultGrandes.totalBeforeMinimum).toBe(170); // 10 * 17 = 170
  });

  it('should apply combo modifier correctly (2 treatments)', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Césped',
        intent: 'curative',
        area: 100,
        curativeTarget: 'both', // Both implies insecticida + fungicida (2 treatments)
        analysisMetrics: { cesped_m2: 100 } as any
      }]
    });
    
    // 100m2 * 2 (curativo) = 200. Combo (2) = +10%. Total = 220.
    console.log(result.breakdown[0]);
    expect(result.totalBeforeMinimum).toBeCloseTo(220);
    expect(result.final_price).toBeCloseTo(220);
  });

  it('should apply eco modifier correctly', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [{
        affectedType: 'Césped',
        intent: 'preventive',
        productPreference: 'ecological', // Eco implies +20%
        area: 100,
        analysisMetrics: { cesped_m2: 100 } as any
      }]
    });
    
    // 100m2 * 1 (preventivo) = 100. Eco = +20%. Total = 120.
    expect(result.totalBeforeMinimum).toBe(120);
    expect(result.final_price).toBe(120);
  });

  it('should calculate multiple zones and aggregate them', () => {
    const result = calculatePhytosanitaryQuote({
      config: MOCK_CONFIG,
      globalWaste: false,
      zones: [
        {
          affectedType: 'Césped', intent: 'preventive', area: 10,
          analysisMetrics: { cesped_m2: 10 } as any // 10 * 1 = 10
        },
        {
          affectedType: 'Setos', intent: 'curative', area: 10,
          analysisMetrics: { seto_alto_ml: 10 } as any // 10 * 5 = 50
        }
      ]
    });
    
    // 10 + 50 = 60. > minimum 50. Total = 60.
    expect(result.totalBeforeMinimum).toBe(60);
    expect(result.final_price).toBe(60);
  });
});