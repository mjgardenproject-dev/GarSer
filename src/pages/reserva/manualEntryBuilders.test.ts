import { describe, it, expect } from 'vitest';
import { buildManualBookingPatch } from './manualEntryBuilders';
import { buildAuthoritativeBookingQuote } from '../../shared/bookingQuoteCore';
import { validateManualBookingInput } from '../../shared/manualEntry/manualEntryValidation';
import type { ManualServiceKey } from '../../shared/manualEntry/manualEntrySchema';

/* Minimal but complete provider configs per service (only the keys the engine reads). */
const CONFIGS: Record<ManualServiceKey, any> = {
  lawn: {
    pricing_method: 'per_quantity',
    price_per_m2: 2,
    yield_m2_per_hour: 150,
    condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
    waste_removal: { percentage: 10 },
    minimum_price: 0,
  },
  hedge: {
    pricing_method: 'per_quantity',
    pricing_matrix: { '0-2m': 3, '2-4m': 5, '4-6m': 8 },
    yield_ml_per_hour: { '0-2m': 40, '2-4m': 30, '4-6m': 20 },
    condition_surcharges: { media: 20, alta: 50 },
    waste_removal: { percentage: 10 },
    minimum_price: 0,
  },
  tree: {
    minimumPrice: 0,
    estructural: { small: 30, medium: 50, large: 90 },
    formacion: { small: 20, medium: 35, large: 60 },
    difficultyIncrease: 25,
    wasteRemovalMultiplier: 10,
    yield_units_per_hour: {
      estructural: { small: 1, medium: 0.7, large: 0.4 },
      formacion: { small: 1.2, medium: 0.9, large: 0.5 },
    },
  },
  palm: {
    pricing_method: 'per_quantity',
    height_prices: { 'Phoenix canariensis': { '0-4m': 40, '4-10m': 70, '>10m': 110 } },
    condition_surcharges: { normal: 0, descuidado: 20, muy_descuidado: 50 },
    access_difficulty: 15,
    phytosanitary: 10,
    trunk_finish: 10,
    waste_removal: { option: 'extra_percentage', percentage: 10 },
    minimum_price: 0,
    yield_units_per_hour: { 'Phoenix canariensis': { '0-4m': 1, '4-10m': 0.6, '>10m': 0.4 } },
  },
  shrub: {
    pricing_method: 'per_quantity',
    prices_per_m2: { 'pequeñas': 4, 'medianas': 6, 'grandes': 9 },
    yield_m2_per_hour: { 'pequeñas': 20, 'medianas': 15, 'grandes': 10 },
    condition_surcharges: { media: 20, alta: 50 },
    waste_removal: { percentage: 10 },
    minimum_price: 0,
  },
  phytosanitary: {
    tratamientos_activos: ['insecticida', 'fungicida', 'ecologico_preventivo'],
    superficies_plantas: {
      hasta_100m2: { insecticida: 1, fungicida: 1, ecologico_preventivo: 1.5 },
      mas_de_100m2: { insecticida: 0.8, fungicida: 0.8, ecologico_preventivo: 1.2 },
    },
    setos: {
      hasta_2m: { insecticida: 2, fungicida: 2, ecologico_preventivo: 3 },
      mas_de_2m: { insecticida: 3, fungicida: 3, ecologico_preventivo: 4 },
    },
    arboles: {
      hasta_3m: { insecticida: 10, fungicida: 10, ecologico_preventivo: 12 },
      mas_de_3m: { insecticida: 15, fungicida: 15, ecologico_preventivo: 18 },
    },
    palmeras: { tradicional: { hasta_3m: 10, mas_de_3m: 15 }, endoterapia: { precio_unico: 40 } },
    yields: {
      cesped_m2_per_hour: 200,
      setos_ml_per_hour: 50,
      palmeras_units_per_hour: 3,
      arboles_units_per_hour: 2,
      plantas_m2_per_hour: 100,
      endoterapia_units_per_hour: 5,
    },
    importe_minimo: 0,
    pricing_modifiers: { eco: { percentage: 10 }, combo: { two_treatments_percentage: 10, three_plus_treatments_percentage: 15 } },
  },
  weeding: {
    precio_desbroce_m2: 0.5,
    precio_herbicida_m2: 0.3,
    yield_m2_per_hour: 300,
    importe_minimo: 0,
    suplementos: { dificultad_media: 20, dificultad_alta: 50, retirada_restos: 10 },
  },
};

const VALID_ITEMS: Record<ManualServiceKey, any[]> = {
  lawn: [{ superficie_m2: 80, estado_jardin: 'normal' }],
  hedge: [{ longitud_m: 20, altura_m: 2.5, caras: 2, estado_seto: 'normal' }],
  tree: [{ aiSizeBand: 'medium', pruningType: 'structural', difficultyHigh: false }],
  palm: [{ species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 3 }],
  shrub: [{ superficie_m2: 24, tamano_dominante: 'medianas' }],
  phytosanitary: [{ affectedType: 'Césped', area: 80, intent: 'preventive', productPreference: 'chemical' }],
  weeding: [{ area: 120, state: 'dificultad_media', applyHerbicide: false }],
};

const SERVICE_KEYS = Object.keys(CONFIGS) as ManualServiceKey[];

describe('manualEntryBuilders - engine parity per service (E2E pricing)', () => {
  SERVICE_KEYS.forEach((serviceKey) => {
    it(`produces an eligible, positively-priced quote for ${serviceKey}`, () => {
      const { patch, declaredVariables } = buildManualBookingPatch({
        serviceKey,
        items: VALID_ITEMS[serviceKey],
        wasteRemoval: true,
      });

      // provenance is preserved
      expect(patch.dataInputMode).toBe('manual');
      expect(declaredVariables.serviceKey).toBe(serviceKey);

      // built collections pass authoritative validation
      const validation = validateManualBookingInput(serviceKey, patch as any);
      expect(validation.ok).toBe(true);

      // the engine treats it as a normal booking and prices it
      const quote = buildAuthoritativeBookingQuote({
        bookingData: { ...patch, wasteRemoval: true } as any,
        providerConfig: CONFIGS[serviceKey],
      });
      expect(quote.eligibility.isEligible).toBe(true);
      expect(quote.totalPrice).toBeGreaterThan(0);
    });
  });
});

describe('manualEntryBuilders - origin independence (manual === AI for same numbers)', () => {
  it('lawn: manual-built zone prices identically to a hand-built AI zone', () => {
    const { patch } = buildManualBookingPatch({
      serviceKey: 'lawn',
      items: [{ superficie_m2: 80, estado_jardin: 'normal' }],
      wasteRemoval: true,
    });

    const manualQuote = buildAuthoritativeBookingQuote({
      bookingData: { ...patch, wasteRemoval: true } as any,
      providerConfig: CONFIGS.lawn,
    });

    const aiStyleQuote = buildAuthoritativeBookingQuote({
      bookingData: {
        wasteRemoval: true,
        dataInputMode: 'photos',
        lawnZones: [{ id: 'ai-1', species: 'Césped general', state: 'normal', quantity: 80, wasteRemoval: true, photoUrls: [], imageIndices: [] }],
      } as any,
      providerConfig: CONFIGS.lawn,
    });

    expect(manualQuote.totalPrice).toBe(aiStyleQuote.totalPrice);
    // 80 m2 * 2 €/m2 * 1.0 (normal) * 1.10 (waste) = 176
    expect(manualQuote.totalPrice).toBe(176);
  });

  it('weeding: manual herbicide toggle changes the price deterministically', () => {
    const base = buildManualBookingPatch({
      serviceKey: 'weeding',
      items: [{ area: 100, state: 'normal', applyHerbicide: false }],
      wasteRemoval: false,
    });
    const withHerbicide = buildManualBookingPatch({
      serviceKey: 'weeding',
      items: [{ area: 100, state: 'normal', applyHerbicide: true }],
      wasteRemoval: false,
    });

    const baseQuote = buildAuthoritativeBookingQuote({ bookingData: { ...base.patch } as any, providerConfig: CONFIGS.weeding });
    const herbicideQuote = buildAuthoritativeBookingQuote({ bookingData: { ...withHerbicide.patch } as any, providerConfig: CONFIGS.weeding });

    expect(herbicideQuote.totalPrice).toBeGreaterThan(baseQuote.totalPrice);
  });
});

describe('manualEntryBuilders - palm species rules', () => {
  it('strips phytosanitary/trunk options for unsupported species', () => {
    const { patch } = buildManualBookingPatch({
      serviceKey: 'palm',
      items: [{ species: 'Roystonea regia', height: '0-6m', state: 'normal', quantity: 1, hasPhytosanitary: true, hasTrunkPeeling: true }],
      wasteRemoval: true,
    });
    const group = (patch.palmGroups || [])[0] as any;
    expect(group.hasPhytosanitary).toBe(false);
    expect(group.hasTrunkPeeling).toBe(false);
  });

  it('flags terminal open range for price-change awareness', () => {
    const { patch } = buildManualBookingPatch({
      serviceKey: 'palm',
      items: [{ species: 'Phoenix canariensis', height: '>10m', state: 'normal', quantity: 1 }],
      wasteRemoval: true,
    });
    const group = (patch.palmGroups || [])[0] as any;
    expect(group.isTerminalOpenRange).toBe(true);
    expect(group.allowsPriceChange).toBe(true);
  });
});
