// src/domain/pricing/treePruningPricing.test.ts

import { describe, it, expect } from 'vitest';
import { calculateTreePruningQuote } from './treePruningPricing';
import { TreePruningServiceConfig, TreePruningZone, AITreeAnalysisResult } from '../../types/treePruning';

describe('calculateTreePruningQuote', () => {
  const mockConfig: TreePruningServiceConfig = {
    minimumPrice: 30,
    estructural: {
      small: 50,
      medium: 100,
      large: 200
    },
    formacion: {
      small: 45,
      medium: 90,
      large: 180
    },
    difficultyIncrease: 25,
    wasteRemovalMultiplier: 10,
  };

  const mockZones: TreePruningZone[] = [
    {
      id: 'tree-1',
      pruningType: 'estructural',
      photos: [new File([], 'test.jpg')],
    },
  ];

  it('should calculate price for small tree (≤3m)', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 2.5, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.isProfessionalSuitable).toBe(true);
    expect(result.totalPrice).toBe(50);
    expect(result.perTreeQuotes[0].basePrice).toBe(50);
    expect(result.perTreeQuotes[0].finalPrice).toBe(50);
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(false);
  });

  it('should calculate price for medium tree (≤5m)', () => {
    const zones: TreePruningZone[] = [
      {
        id: 'tree-1',
        pruningType: 'formacion',
        photos: [new File([], 'test.jpg')],
      },
    ];
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 4.2, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, zones, aiResults);

    expect(result.totalPrice).toBe(90);
    expect(result.perTreeQuotes[0].basePrice).toBe(90);
  });

  it('should calculate price for large tree (≤9m)', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 7.8, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(200);
    expect(result.perTreeQuotes[0].basePrice).toBe(200);
  });

  it('should apply difficulty increase for trees >3m with high difficulty', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 4.2, dificultad_alta: true },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(125); // 100 + 25%
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(true);
  });

  it('should NOT apply difficulty increase for small trees (≤3m)', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 2.8, dificultad_alta: true },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(50);
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(false);
  });

  it('should handle tree >9m with warning', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 10.5, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(200);
    expect(result.perTreeQuotes[0].warnings).toContain(
      "El profesional tendrá que verificar el pago porque es un servicio muy complejo."
    );
  });

  it('should exclude professional if tree exceeds their max range', () => {
    const configWithoutLarge: TreePruningServiceConfig = {
      ...mockConfig,
      estructural: {
        small: 50,
        medium: 100
      },
    };

    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 7.8, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(configWithoutLarge, mockZones, aiResults);

    expect(result.isProfessionalSuitable).toBe(false);
    expect(result.totalPrice).toBe(0);
    expect(result.perTreeQuotes).toHaveLength(0);
  });

  it('should calculate total for multiple trees', () => {
    const multipleZones: TreePruningZone[] = [
      { id: 'tree-1', pruningType: 'estructural', photos: [new File([], 'test1.jpg')] },
      { id: 'tree-2', pruningType: 'formacion', photos: [new File([], 'test2.jpg')] },
    ];

    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 2.5, dificultad_alta: false },
      { zoneId: 'tree-2', altura_m: 4.2, dificultad_alta: true },
    ];

    const result = calculateTreePruningQuote(mockConfig, multipleZones, aiResults);

    expect(result.totalPrice).toBe(162.5); // 50 + (90 + 22.5)
    expect(result.perTreeQuotes).toHaveLength(2);
  });

  it('should handle missing AI results gracefully', () => {
    const aiResults: AITreeAnalysisResult[] = []; // Sin resultados

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.isProfessionalSuitable).toBe(true);
    expect(result.perTreeQuotes).toHaveLength(0); // No se calculan precios sin IA
  });
});
