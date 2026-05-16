import { describe, expect, it } from 'vitest';
import { buildBookingQuote } from './bookingQuote';

describe('bookingQuote', () => {
  it('calcula horas y precio por hora desde una fuente compartida', () => {
    const result = buildBookingQuote({
      bookingData: {
        address: 'Calle Sol 3',
        serviceIds: ['lawn-service'],
        photos: [],
        description: '',
        preferredDate: '',
        timeSlot: '',
        providerId: '',
        estimatedHours: 0,
        totalPrice: 0,
        lawnZones: [
          {
            id: 'zone-1',
            species: 'Cesped',
            state: 'normal',
            quantity: 200,
            wasteRemoval: true,
            photoUrls: [],
            imageIndices: [],
          },
        ],
      } as any,
      providerConfig: {
        pricing_method: 'per_hour',
        hourly_rate: 30,
        yield_m2_per_hour: 100,
      },
      globalMinPrice: 40,
    });

    expect(result.estimatedHours).toBe(2);
    expect(result.totalPrice).toBe(60);
    expect(result.breakdown).toEqual([]);
  });

  it('genera desglose coherente para arbustos con minimo global', () => {
    const result = buildBookingQuote({
      bookingData: {
        address: 'Calle Luna 8',
        serviceIds: ['shrubs-service'],
        photos: [],
        description: '',
        preferredDate: '',
        timeSlot: '',
        providerId: '',
        estimatedHours: 0,
        totalPrice: 0,
        wasteRemoval: true,
        shrubGroups: [
          {
            id: 'group-1',
            size: 'medianas',
            area: 2,
            type: 'arbusto',
            state: 'descuidado',
          },
        ],
      } as any,
      providerConfig: {
        prices_per_m2: { pequeñas: 10, medianas: 20, grandes: 30 },
        condition_surcharges: { media: 20, alta: 50 },
        waste_removal: { percentage: 10 },
        yield_m2_per_hour: { pequeñas: 40, medianas: 20, grandes: 10 },
        minimum_price: 80,
      },
      globalMinPrice: 50,
    });

    expect(result.totalPrice).toBe(80);
    expect(result.breakdown).toEqual([
      { desc: '2 m2 de arbustos (medianas, descuidado)', price: 53 },
      { desc: 'Ajuste por importe mínimo global (80€)', price: 27 },
    ]);
  });
});
