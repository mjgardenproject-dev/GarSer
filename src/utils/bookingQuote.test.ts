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
    expect(result.economics).toMatchObject({
      currency: 'EUR',
      serviceGrossTotal: 60,
      managementFee: 7.5,
      payableNow: 7.5,
      payableLater: 60,
    });
    expect(result.economics.serviceNetSubtotal).toBeCloseTo(49.59, 2);
    expect(result.economics.serviceTaxAmount).toBeCloseTo(10.41, 2);
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
    expect(result.economics.managementFee).toBe(10);
    expect(result.economics.stripeLineItems).toEqual([
      {
        code: 'management_fee',
        label: 'Gastos de gestión',
        unitAmount: 10,
        quantity: 1,
      },
    ]);
  });

  it('usa metadatos autoritativos para cobertura parcial de palmeras y horas solo de grupos soportados', () => {
    const result = buildBookingQuote({
      bookingData: {
        address: 'Calle Palma 12',
        serviceIds: ['palm-service'],
        photos: [],
        description: '',
        preferredDate: '',
        timeSlot: '',
        providerId: '',
        estimatedHours: 0,
        totalPrice: 0,
        wasteRemoval: false,
        palmGroups: [
          {
            id: 'phoenix-1',
            species: 'Phoenix',
            height: '0-5',
            quantity: 2,
            state: 'normal',
            isTerminalOpenRange: true,
          },
          {
            id: 'wash-1',
            species: 'Phoenix',
            height: '5-12',
            quantity: 1,
            state: 'normal',
            isTerminalOpenRange: true,
          },
        ],
      } as any,
      providerConfig: {
        height_prices: {
          Phoenix: { '0-5': 50 },
        },
        condition_surcharges: { normal: 0, descuidada: 20, muy_descuidada: 50 },
        waste_removal: { percentage: 0 },
        minimum_price: 0,
      },
      globalMinPrice: 0,
    });

    expect(result.totalPrice).toBe(120);
    expect(result.estimatedHours).toBe(1.5);
    expect(result.warnings).toEqual([
      {
        code: 'palm_terminal_range',
        message: 'Precio aproximado: en el rango más alto de palmera el jardinero puede ajustar el importe y requerirá tu aceptación en el chat.',
      },
    ]);
    expect(result.metadata.palmCoverage).toEqual({
      isFull: false,
      coveredCount: 1,
      totalCount: 2,
      missingGroups: [
        {
          id: 'wash-1',
          species: 'Phoenix',
          height: '5-12',
          quantity: 1,
          isTerminalOpenRange: true,
          isPriced: false,
        },
      ],
    });
    expect(result.breakdown).toEqual([
      { desc: '2x Phoenix (0-5) · verificación final del profesional', price: 0 },
    ]);
  });

  it('calcula horas de poda de arboles desde el motor autoritativo compartido', () => {
    const result = buildBookingQuote({
      bookingData: {
        address: 'Calle Encina 5',
        serviceIds: ['tree-service'],
        photos: [],
        description: '',
        preferredDate: '',
        timeSlot: '',
        providerId: '',
        estimatedHours: 0,
        totalPrice: 0,
        wasteRemoval: true,
        treeGroups: [
          {
            id: 'tree-1',
            pruningType: 'structural',
            aiSizeBand: 'large',
            difficultyHigh: true,
            analysisLevel: 1,
            isFailed: false,
          },
        ],
      } as any,
      providerConfig: {
        minimumPrice: 0,
        estructural: { small: 50, medium: 100, large: 200 },
        formacion: { small: 45, medium: 90, large: 180 },
        difficultyIncrease: 10,
        wasteRemovalMultiplier: 10,
        yield_units_per_hour: {
          estructural: { small: 2, medium: 1, large: 0.5 },
          formacion: { small: 4, medium: 2, large: 1 },
        },
      },
      globalMinPrice: 0,
    });

    expect(result.totalPrice).toBe(242);
    expect(result.estimatedHours).toBe(2.5);
    expect(result.warnings).toEqual([]);
  });
});
