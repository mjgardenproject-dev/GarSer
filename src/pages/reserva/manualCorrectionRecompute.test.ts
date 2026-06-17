import { describe, it, expect } from 'vitest';
import { buildManualBookingPatch } from './manualEntryBuilders';
import { buildAuthoritativeBookingQuote } from '../../shared/bookingQuoteCore';
import { validateManualSerializableInput } from '../../shared/manualEntry/manualEntryValidation';

/**
 * These tests back the server-side pieces of the manual flow:
 *  - the `booking-authority` validation gate (validateManualSerializableInput),
 *  - the `recalculate_correction` action (buildManualBookingPatch → engine recompute).
 */

const LAWN_CONFIG = {
  pricing_method: 'per_quantity',
  price_per_m2: 2,
  yield_m2_per_hour: 150,
  condition_surcharges: { descuidado: 20, muy_descuidado: 50 },
  waste_removal: { percentage: 10 },
  minimum_price: 0,
};

describe('server validation gate (validateManualSerializableInput)', () => {
  it('rejects out-of-range manual input exactly as the edge function would', () => {
    const { patch } = buildManualBookingPatch({
      serviceKey: 'lawn',
      items: [{ superficie_m2: 99999, estado_jardin: 'normal' }],
      wasteRemoval: true,
    });
    const result = validateManualSerializableInput({
      serviceName: 'Corte de césped',
      dataInputMode: 'manual',
      bookingInput: patch as Record<string, unknown>,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('out_of_range');
  });

  it('accepts valid manual input', () => {
    const { patch } = buildManualBookingPatch({
      serviceKey: 'lawn',
      items: [{ superficie_m2: 80, estado_jardin: 'normal' }],
      wasteRemoval: true,
    });
    const result = validateManualSerializableInput({
      serviceName: 'Corte de césped',
      dataInputMode: 'manual',
      bookingInput: patch as Record<string, unknown>,
    });
    expect(result.ok).toBe(true);
  });
});

describe('recalculate_correction core (corrected variables → engine recompute)', () => {
  it('recomputes a higher price when the gardener corrects the surface upward', () => {
    const original = buildManualBookingPatch({
      serviceKey: 'lawn',
      items: [{ superficie_m2: 80, estado_jardin: 'normal' }],
      wasteRemoval: true,
    });
    const corrected = buildManualBookingPatch({
      serviceKey: 'lawn',
      items: [{ superficie_m2: 160, estado_jardin: 'descuidado' }],
      wasteRemoval: true,
    });

    const originalQuote = buildAuthoritativeBookingQuote({ bookingData: original.patch as any, providerConfig: LAWN_CONFIG });
    const correctedQuote = buildAuthoritativeBookingQuote({ bookingData: corrected.patch as any, providerConfig: LAWN_CONFIG });

    expect(originalQuote.eligibility.isEligible).toBe(true);
    expect(correctedQuote.eligibility.isEligible).toBe(true);
    // Double surface + condition surcharge ⇒ strictly higher recomputed total.
    expect(correctedQuote.totalPrice).toBeGreaterThan(originalQuote.totalPrice);
  });
});
