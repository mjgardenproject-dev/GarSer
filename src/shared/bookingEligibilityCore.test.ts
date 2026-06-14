import { describe, expect, it } from 'vitest';

import { evaluateOperationalEligibility } from './bookingEligibilityCore';

const bookingInput = {
  address: 'Calle Verde 1',
  addressCoordinates: { lat: 40.4168, lng: -3.7038 },
  serviceIds: ['svc-lawn'],
  lawnZones: [
    {
      quantity: 100,
      state: 'normal',
    },
  ],
} as const;

const twoHourBookingInput = {
  ...bookingInput,
  lawnZones: [
    {
      quantity: 200,
      state: 'normal',
    },
  ],
} as const;

const providerConfig = {
  pricing_method: 'per_hour',
  precioPorHora: 30,
  yield_m2_per_hour: 100,
  minimum_price: 0,
};

describe('bookingEligibilityCore', () => {
  it('excluye providers con servicio desactivado o sin configuración operativa', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig: null,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 50,
        operational_latitude: 40.417,
        operational_longitude: -3.703,
      },
      providerDates: new Map([
        ['2026-06-15', [9, 10]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'inactive_service',
        message: 'El profesional no tiene una oferta activa y operativa para este servicio.',
      },
    });
  });

  it('excluye providers fuera del radio operativo', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 5,
        operational_latitude: 41.3874,
        operational_longitude: 2.1686,
      },
      providerDates: new Map([
        ['2026-06-15', [9, 10]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'outside_coverage',
        message: 'La dirección del cliente queda fuera del radio operativo del profesional.',
      },
    });
  });

  it('excluye providers cuando faltan coordenadas operativas del jardinero', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 50,
        operational_latitude: null,
        operational_longitude: null,
      },
      providerDates: new Map([
        ['2026-06-15', [9, 10]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'missing_coordinates',
        message: 'No se han podido resolver las coordenadas operativas para validar la cobertura.',
      },
    });
  });

  it('excluye providers sin hueco reservable real para la duración estimada', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 50,
        operational_latitude: 40.417,
        operational_longitude: -3.703,
      },
      providerDates: new Map([
        ['2026-06-15', [9]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'no_reservable_availability',
        message: 'El profesional no tiene un hueco reservable válido para la duración estimada.',
      },
    });
  });

  it('propaga el motivo tipado cuando la configuracion operativa del servicio esta incompleta', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig: {
        pricing_method: 'per_hour',
        yield_m2_per_hour: 100,
      },
      providerConfigVersion: 'cfg-incomplete',
      profile: {
        max_distance: 50,
        operational_latitude: 40.417,
        operational_longitude: -3.703,
      },
      providerDates: new Map([
        ['2026-06-15', [9, 10]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'missing_pricing_config',
        message: 'El servicio de césped por horas requiere una tarifa horaria válida.',
      },
    });
  });

  it('devuelve huecos válidos y earliestSlot cuando el provider sigue siendo elegible', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 50,
        operational_latitude: 40.417,
        operational_longitude: -3.703,
      },
      providerDates: new Map([
        ['2026-06-15', [9, 10, 12]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;

    expect(result.quote.totalPrice).toBe(60);
    expect(result.validHoursForRequestedDate).toEqual([9]);
    expect(result.earliestSlot).toEqual({
      date: '2026-06-15',
      startHour: 9,
      startTime: '09:00:00',
      endTime: '11:00:00',
      durationHours: 2,
    });
  });
});
