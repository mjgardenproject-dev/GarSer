import { describe, expect, it } from 'vitest';

import {
  hasAuthoritativeQuoteSnapshot,
  normalizeAuthoritativeQuoteState,
  readAuthoritativeQuoteSnapshot,
} from './bookingAuthoritativeSnapshot';

describe('bookingAuthoritativeSnapshot', () => {
  it('normaliza el snapshot canónico sobre los campos legacy del booking', () => {
    const state = normalizeAuthoritativeQuoteState({
      totalPrice: 0,
      estimatedHours: 0,
      priceBreakdown: [],
      quoteWarnings: [],
      quoteMetadata: {
        pricingContext: {
          serviceType: 'standard',
          allowsPriceChange: true,
          palmGroups: [],
        },
      },
      quoteAvailability: {
        requestedDate: '2026-05-20',
        validStartHours: [9],
        selectedSlot: {
          date: '2026-05-20',
          startHour: 9,
          startTime: '09:00:00',
          endTime: '11:00:00',
          durationHours: 2,
        },
      },
      quoteEconomics: {
        currency: 'EUR' as const,
        taxRate: 0.21,
        serviceGrossTotal: 120,
        serviceNetSubtotal: 99.17,
        serviceTaxAmount: 20.83,
        managementFee: 15,
        payableNow: 15,
        payableLater: 120,
        lines: [],
        stripeLineItems: [],
      },
      quoteId: 'quote-1',
      quoteSignature: 'sig-1',
      quoteExpiresAt: '2026-05-20T10:00:00Z',
      quotePricingVersion: 'v1',
      quoteProviderConfigVersion: 'cfg-1',
    });

    expect(hasAuthoritativeQuoteSnapshot(state)).toBe(true);
    expect(state.authoritativeQuoteSnapshot).toEqual(
      expect.objectContaining({
        totalPrice: 120,
        estimatedHours: 2,
        quoteId: 'quote-1',
      }),
    );
    expect(state.totalPrice).toBe(120);
    expect(state.estimatedHours).toBe(2);
  });

  it('descarta restos parciales para no renderizar importes ficticios', () => {
    const state = normalizeAuthoritativeQuoteState({
      quoteAvailability: {
        requestedDate: '2026-05-20',
        validStartHours: [9],
        selectedSlot: {
          date: '2026-05-20',
          startHour: 9,
          startTime: '09:00:00',
          endTime: '11:00:00',
          durationHours: 2,
        },
      },
      quoteEconomics: {
        currency: 'EUR' as const,
        taxRate: 0.21,
        serviceGrossTotal: 120,
        serviceNetSubtotal: 99.17,
        serviceTaxAmount: 20.83,
        managementFee: 15,
        payableNow: 15,
        payableLater: 120,
        lines: [],
        stripeLineItems: [],
      },
    });

    expect(readAuthoritativeQuoteSnapshot(state)).toBeNull();
    expect(state.authoritativeQuoteSnapshot).toBeUndefined();
    expect(state.quoteAvailability).toBeUndefined();
    expect(state.quoteEconomics).toBeUndefined();
  });
});
