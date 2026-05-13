// src/domain/pricing/treePruningPricing.test.ts

import { describe, it, expect } from 'vitest';
import { calculateTreePruningQuote, calculateTreePruningQuoteForTrees } from './treePruningPricing';
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
    yield_units_per_hour: {
      estructural: {
        small: 2,
        medium: 1,
        large: 0.5
      },
      formacion: {
        small: 4,
        medium: 2,
        large: 1
      }
    }
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
      { zoneId: 'tree-1', size_band: 'small', dificultad_alta: false },
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
      { zoneId: 'tree-1', size_band: 'medium', dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, zones, aiResults);

    expect(result.totalPrice).toBe(90);
    expect(result.perTreeQuotes[0].basePrice).toBe(90);
  });

  it('should calculate price for large tree (≤9m)', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', size_band: 'large', dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(200);
    expect(result.perTreeQuotes[0].basePrice).toBe(200);
  });

  it('should not apply IA difficulty to business pricing', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', size_band: 'medium', dificultad_alta: true },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(100);
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(false);
  });

  it('should handle tree >9m with warning', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', size_band: 'over_9', dificultad_alta: false },
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
      { zoneId: 'tree-1', size_band: 'large', dificultad_alta: false },
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
      { zoneId: 'tree-1', size_band: 'small', dificultad_alta: false },
      { zoneId: 'tree-2', size_band: 'medium', dificultad_alta: true },
    ];

    const result = calculateTreePruningQuote(mockConfig, multipleZones, aiResults);

    expect(result.totalPrice).toBe(140);
    expect(result.perTreeQuotes).toHaveLength(2);
  });

  it('should handle missing AI results gracefully', () => {
    const aiResults: AITreeAnalysisResult[] = []; // Sin resultados

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.isProfessionalSuitable).toBe(true);
    expect(result.perTreeQuotes).toHaveLength(0); // No se calculan precios sin IA
  });

  it('should require size_band in IA wrapper (no altura fallback)', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', altura_m: 9, dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    expect(result.totalPrice).toBe(30);
    expect(result.perTreeQuotes).toHaveLength(0);
  });

  it('should apply difficulty increase only when customer marks access as difficult', () => {
    const result = calculateTreePruningQuoteForTrees(
      mockConfig,
      [{ id: 'tree-1', pruningType: 'estructural', sizeBand: 'medium', dificultad_alta: true }],
      false
    );

    expect(result.totalPrice).toBe(125);
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(true);
  });

  it('should apply difficulty increase for small trees when customer marks difficult access', () => {
    const result = calculateTreePruningQuoteForTrees(
      mockConfig,
      [{ id: 'tree-1', pruningType: 'estructural', sizeBand: 'small', dificultad_alta: true }],
      false
    );

    expect(result.totalPrice).toBe(62.5);
    expect(result.perTreeQuotes[0].appliedDifficultyIncrease).toBe(true);
  });

  it('should calculate estimated hours correctly', () => {
    const aiResults: AITreeAnalysisResult[] = [
      { zoneId: 'tree-1', size_band: 'medium', dificultad_alta: false },
    ];

    const result = calculateTreePruningQuote(mockConfig, mockZones, aiResults);

    // Yield for medium estructural is 1 unit/hour
    expect(result.totalEstimatedHours).toBe(1);
    expect(result.perTreeQuotes[0].estimatedHours).toBe(1);
  });

  it('should apply difficulty and waste removal to estimated hours', () => {
    const result = calculateTreePruningQuoteForTrees(
      mockConfig,
      [{ id: 'tree-1', pruningType: 'estructural', sizeBand: 'medium', dificultad_alta: true }],
      true
    );

    // Base yield 1 unit/hour -> 1 hour
    // Difficulty +25% -> 1.25 hours
    // Waste Removal +10% -> 1.25 * 1.1 = 1.375 hours
    expect(result.totalEstimatedHours).toBe(1.375);
    expect(result.perTreeQuotes[0].estimatedHours).toBe(1.375);
  });
});
