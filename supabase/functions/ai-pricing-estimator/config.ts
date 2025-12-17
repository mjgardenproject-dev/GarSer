export const DIFFICULTY_MULTIPLIER: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 1.3,
  3: 1.7,
};

export const PERFORMANCE_PRICING: Record<string, { performance: number; pricePerUnit: number }> = {
  'Corte de césped': { performance: 100, pricePerUnit: 0.30 },
  'Corte de setos': { performance: 25, pricePerUnit: 3.50 },
  'Fumigación': { performance: 40, pricePerUnit: 2.50 },
  'Poda de plantas': { performance: 8, pricePerUnit: 6.00 },
  'Poda de árboles': { performance: 0.8, pricePerUnit: 45.00 },
  'Labrar y quitar malas hierbas': { performance: 15, pricePerUnit: 10.00 },
};
