import { describe, it, expect } from 'vitest';
import { findPalmPrice, findPalmYield } from './pricingEngine';
import { buildAuthoritativeBookingQuote } from '../shared/bookingQuoteCore';

/**
 * Paridad manual/IA en palmeras (fallo real de producción, prueba 3.1 del 2026-08-22).
 *
 * El configurador del jardinero y el análisis IA usan bandas sin sufijo ('0-4', '>10'),
 * pero el formulario manual y las reservas ya guardadas usan '0-4m'/'>10m'. El lookup
 * literal solo casaba con el primero: la misma palmera encontraba jardinero por fotos
 * y NINGUNO declarada a mano.
 */

const CONFIG = {
  pricing_method: 'per_quantity',
  height_prices: { 'Phoenix canariensis': { '0-4': 45, '4-10': 90, '>10': 150 } },
  yield_units_per_hour: { 'Phoenix canariensis': { '0-4': 1.5, '4-10': 0.8, '>10': 0.5 } },
  precioPorHora: 35,
  condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 15 },
  phytosanitary: 18,
  trunk_finish: 20,
  access_difficulty: 25,
  minimum_price: 60,
};

const quoteFor = (height: string, extra: Record<string, unknown> = {}) =>
  buildAuthoritativeBookingQuote({
    bookingData: {
      palmGroups: [{ id: 'g1', species: 'Phoenix canariensis', height, quantity: 1, state: 'normal', ...extra }],
      wasteRemoval: false,
    } as any,
    providerConfig: CONFIG,
  });

describe('findPalmPrice — tolerancia de formatos de banda', () => {
  it('banda exacta del configurador (sin m)', () => {
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '4-10')).toBe(90);
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '>10')).toBe(150);
  });

  it('banda del formulario manual (con m), incluida la terminal abierta', () => {
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '4-10m')).toBe(90);
    // El caso que dejaba al cliente sin jardineros: '>10m' contra la clave '>10'.
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '>10m')).toBe(150);
  });

  it('altura numérica suelta cae en su rango, también en el abierto', () => {
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '6')).toBe(90);
    expect(findPalmPrice(CONFIG, 'Phoenix canariensis', '14')).toBe(150);
  });

  it('banda no cubierta por la config → 0 (inelegible, no un precio inventado)', () => {
    const partial = { height_prices: { 'Phoenix canariensis': { '0-4': 45 } } };
    expect(findPalmPrice(partial, 'Phoenix canariensis', '25')).toBe(0);
  });
});

describe('findPalmYield — misma tolerancia para rendimientos', () => {
  it('resuelve con y sin sufijo m', () => {
    expect(findPalmYield(CONFIG, 'Phoenix canariensis', '4-10')).toBe(0.8);
    expect(findPalmYield(CONFIG, 'Phoenix canariensis', '4-10m')).toBe(0.8);
    expect(findPalmYield(CONFIG, 'Phoenix canariensis', '>10m')).toBe(0.5);
  });

  it('sin configuración devuelve 0', () => {
    expect(findPalmYield({}, 'Phoenix canariensis', '4-10')).toBe(0);
  });
});

describe('paridad manual vs IA en el presupuesto autoritativo', () => {
  it('la misma palmera cuesta LO MISMO declarada a mano que por fotos', () => {
    const ia = quoteFor('>10');
    const manual = quoteFor('>10m');
    expect(ia.totalPrice).toBe(150);
    expect(manual.totalPrice).toBe(ia.totalPrice);
    expect(manual.eligibility.isEligible).toBe(true);
  });

  it('jardinero POR HORAS: la banda con m tampoco lo hace desaparecer', () => {
    const hourly = { ...CONFIG, pricing_method: 'per_hour' };
    const ia = buildAuthoritativeBookingQuote({
      bookingData: { palmGroups: [{ id: 'g1', species: 'Phoenix canariensis', height: '4-10', quantity: 1, state: 'normal' }], wasteRemoval: false } as any,
      providerConfig: hourly,
    });
    const manual = buildAuthoritativeBookingQuote({
      bookingData: { palmGroups: [{ id: 'g1', species: 'Phoenix canariensis', height: '4-10m', quantity: 1, state: 'normal' }], wasteRemoval: false } as any,
      providerConfig: hourly,
    });
    expect(ia.eligibility.isEligible).toBe(true);
    expect(manual.eligibility.isEligible).toBe(true);
    expect(manual.totalPrice).toBe(ia.totalPrice);
  });

  it('el extra de fitosanitario solo se cobra si el cliente lo pide', () => {
    expect(quoteFor('4-10').totalPrice).toBe(90);
    expect(quoteFor('4-10', { hasPhytosanitary: true }).totalPrice).toBe(108);
  });
});
