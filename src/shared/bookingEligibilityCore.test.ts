import { describe, expect, it } from 'vitest';

import {
  bookingRequiresPhytosanitaryLicense,
  evaluateOperationalEligibility,
  freeRun,
  getClientCoordinates,
  getProviderCoordinates,
  getValidStartHours,
  getValidStartHoursForPlan,
  getValidStartHoursForWorkers,
  isPhytosanitaryLicenseActive,
  planBookingShape,
  providerConfigVersionPayload,
} from './bookingEligibilityCore';
import type { SerializableBookingData } from './bookingQuoteCore';

const bookingInput: SerializableBookingData = {
  address: 'Calle Verde 1',
  addressCoordinates: { lat: 40.4168, lng: -3.7038 },
  serviceIds: ['svc-lawn'],
  lawnZones: [
    {
      quantity: 100,
      state: 'normal',
    },
  ],
};

const twoHourBookingInput: SerializableBookingData = {
  ...bookingInput,
  lawnZones: [
    {
      quantity: 200,
      state: 'normal',
    },
  ],
};

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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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

  it('trata coordenadas (0,0) — null island — como ausentes para permitir re-geocodificación', () => {
    expect(getProviderCoordinates({
      max_distance: 25,
      operational_latitude: 0,
      operational_longitude: 0,
      // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
      license_verification_status: 'approved',
      license_expires_at: '2099-01-01T00:00:00Z',
    })).toBeNull();
    expect(getClientCoordinates({
      addressCoordinates: { lat: 0, lng: 0 },
    } as never)).toBeNull();

    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: {
        max_distance: 25,
        operational_latitude: 0,
        operational_longitude: 0,
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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

  it('rechaza coordenadas fuera de rango pero acepta lat o lng 0 individuales', () => {
    const profile = (lat: number, lng: number) => ({
      max_distance: 25,
      operational_latitude: lat,
      operational_longitude: lng,
      // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
      license_verification_status: 'approved',
      license_expires_at: '2099-01-01T00:00:00Z',
    });
    expect(getProviderCoordinates(profile(95, -3.7))).toBeNull();
    expect(getProviderCoordinates(profile(40.4, 190))).toBeNull();
    expect(getProviderCoordinates(profile(0, -3.7))).toEqual({ lat: 0, lng: -3.7 });
    expect(getProviderCoordinates(profile(40.4, 0))).toEqual({ lat: 40.4, lng: 0 });
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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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
        // T1 (transversal): campos requeridos por ProviderProfileLike, sin relación con lo que prueba este caso.
        license_verification_status: 'approved',
        license_expires_at: '2099-01-01T00:00:00Z',
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
    expect(result.earliestSlot).toMatchObject({
      date: '2026-06-15',
      startHour: 9,
      startTime: '09:00:00',
      endTime: '11:00:00',
      durationHours: 2,
      // F7: la forma del trabajo viaja con la franja (una persona, un día).
      endDate: null,
      crew: 1,
      labourHours: 2,
    });
  });
});

describe('getValidStartHours (bordes del rango 7:00–20:00)', () => {
  it('permite empezar a las 7:00 (nuevo mínimo) con duración 1h', () => {
    expect(getValidStartHours([7, 8, 9], 1)).toEqual([7, 8, 9]);
  });

  it('ofrece el bloque 19:00 (19:00–20:00) para servicios de 1h', () => {
    expect(getValidStartHours([18, 19], 1)).toEqual([18, 19]);
  });

  it('NO ofrece start 19:00 con 2h porque el bloque 20:00 no existe (sin slots fantasma)', () => {
    // Solo 18 es válido: 18+19 caben; 19 necesitaría el bloque 20:00 inexistente.
    expect(getValidStartHours([18, 19], 2)).toEqual([18]);
  });

  it('respeta la contigüidad: un hueco rompe la franja reservable', () => {
    // 7 y 8 son contiguos (válidos para 2h). 10 está aislado, no cabe 2h.
    expect(getValidStartHours([7, 8, 10], 2)).toEqual([7]);
  });
});

describe('GarSer Empresas F4 — horas de un equipo (H-26)', () => {
  const companyProfile = {
    max_distance: 50,
    operational_latitude: 40.417,
    operational_longitude: -3.703,
    license_verification_status: null,
    license_expires_at: null,
  };

  it('una hora vale si ALGUNA persona puede hacer el trabajo entero desde ella', () => {
    const team = new Map([
      ['ana', new Map([['2026-06-15', [9, 10]]])],
      ['luis', new Map([['2026-06-15', [12, 13]]])],
    ]);
    expect(getValidStartHoursForWorkers(team, '2026-06-15', 2)).toEqual([9, 12]);
  });

  it('NO suma horas de personas distintas: Ana 9-10 y Luis 10-11 no hacen 2 h a las 9', () => {
    const team = new Map([
      ['ana', new Map([['2026-06-15', [9]]])],
      ['luis', new Map([['2026-06-15', [10]]])],
    ]);
    expect(getValidStartHoursForWorkers(team, '2026-06-15', 2)).toEqual([]);
    expect(getValidStartHoursForWorkers(team, '2026-06-15', 1)).toEqual([9, 10]);
  });

  it('con una sola persona da lo mismo que las horas del autónomo', () => {
    const solo = new Map([['yo', new Map([['2026-06-15', [7, 8, 10]]])]]);
    expect(getValidStartHoursForWorkers(solo, '2026-06-15', 2)).toEqual(getValidStartHours([7, 8, 10], 2));
  });

  it('la empresa es elegible con las horas de su equipo y el primer hueco es el de cualquiera', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: companyProfile,
      providerDates: new Map(),
      workerDates: new Map([
        ['ana', new Map([['2026-06-16', [9, 10]]])],
        ['luis', new Map([['2026-06-15', [9]], ['2026-06-17', [8, 9]]])],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-20',
    });
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.validHoursForRequestedDate).toEqual([]);
    expect(result.earliestSlot?.date).toBe('2026-06-16');
    expect(result.earliestSlot?.startHour).toBe(9);
  });

  it('F6 (D10): con trabajos partidos, Ana 9 + Luis 10 sí cubren 2 h a las 9 (por turnos); sin ellos, no', () => {
    const base = {
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: companyProfile,
      providerDates: new Map<string, number[]>(),
      workerDates: new Map([
        ['ana', new Map([['2026-06-15', [9]]])],
        ['luis', new Map([['2026-06-15', [10]]])],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
    };
    const whole = evaluateOperationalEligibility(base);
    expect(whole.eligible).toBe(false);
    const byTurns = evaluateOperationalEligibility({ ...base, allowSplitAcrossWorkers: true });
    expect(byTurns.eligible).toBe(true);
    if (byTurns.eligible) expect(byTurns.validHoursForRequestedDate).toEqual([9]);
  });

  it('trabajo con carnet: la empresa no se descarta por su ficha si el carnet se comprueba por persona', () => {
    const phytoInput = { ...twoHourBookingInput, phytosanitaryZones: [{ area: 20, productPreference: 'chemical' as const }] };
    const base = {
      bookingInput: phytoInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile: companyProfile,
      providerDates: new Map<string, number[]>(),
      workerDates: new Map([['ana', new Map([['2026-06-15', [9, 10]]])]]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
    };
    const withoutFlag = evaluateOperationalEligibility(base);
    expect(withoutFlag.eligible).toBe(false);
    if (!withoutFlag.eligible) expect(withoutFlag.exclusion.code).toBe('missing_phytosanitary_license');
    // Con el carnet comprobado por persona, la puerta de la ficha no actúa (lo que decida
    // después el presupuesto, con esta configuración de césped, no es lo que se prueba aquí).
    const withFlag = evaluateOperationalEligibility({ ...base, licenseCheckedPerWorker: true });
    if (!withFlag.eligible) expect(withFlag.exclusion.code).not.toBe('missing_phytosanitary_license');
  });
});

describe('T1 (transversal) — puerta de licencia fitosanitaria', () => {
  describe('bookingRequiresPhytosanitaryLicense', () => {
    it('no requiere licencia sin zonas fitosanitarias ni de desbroce', () => {
      expect(bookingRequiresPhytosanitaryLicense(bookingInput)).toBe(false);
    });

    it('requiere licencia si hay una zona fitosanitaria con producto químico', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          phytosanitaryZones: [{ area: 20, productPreference: 'chemical' }],
        }),
      ).toBe(true);
    });

    it('NO requiere licencia si todas las zonas fitosanitarias son ecológicas', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          phytosanitaryZones: [
            { area: 20, productPreference: 'ecological' },
            { area: 10, productPreference: 'ecological' },
          ],
        }),
      ).toBe(false);
    });

    it('requiere licencia si CUALQUIER zona fitosanitaria es química, aunque otra sea eco', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          phytosanitaryZones: [
            { area: 20, productPreference: 'ecological' },
            { area: 10, productPreference: 'chemical' },
          ],
        }),
      ).toBe(true);
    });

    it('sin productPreference cuenta como químico (dato ausente no blanquea el filtro)', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          phytosanitaryZones: [{ area: 20 }],
        }),
      ).toBe(true);
    });

    it('requiere licencia si desbroce pide herbicida', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          weedingZones: [{ area: 100, applyHerbicide: true }],
        }),
      ).toBe(true);
    });

    it('NO requiere licencia en desbroce sin herbicida', () => {
      expect(
        bookingRequiresPhytosanitaryLicense({
          ...bookingInput,
          weedingZones: [{ area: 100, applyHerbicide: false }],
        }),
      ).toBe(false);
    });
  });

  describe('isPhytosanitaryLicenseActive', () => {
    it('activa: aprobada y con caducidad futura', () => {
      expect(
        isPhytosanitaryLicenseActive({
          license_verification_status: 'approved',
          license_expires_at: '2099-01-01T00:00:00Z',
        }),
      ).toBe(true);
    });

    it('inactiva: aprobada pero ya caducada (D1 — la fecha manda, no solo el estado)', () => {
      expect(
        isPhytosanitaryLicenseActive({
          license_verification_status: 'approved',
          license_expires_at: '2020-01-01T00:00:00Z',
        }),
      ).toBe(false);
    });

    it('inactiva: aprobada pero sin fecha de caducidad registrada', () => {
      expect(
        isPhytosanitaryLicenseActive({
          license_verification_status: 'approved',
          license_expires_at: null,
        }),
      ).toBe(false);
    });

    it('inactiva: pending, rejected o expired, aunque la fecha sea futura', () => {
      for (const status of ['pending', 'rejected', 'expired']) {
        expect(
          isPhytosanitaryLicenseActive({
            license_verification_status: status,
            license_expires_at: '2099-01-01T00:00:00Z',
          }),
        ).toBe(false);
      }
    });

    it('inactiva: sin perfil', () => {
      expect(isPhytosanitaryLicenseActive(null)).toBe(false);
      expect(isPhytosanitaryLicenseActive(undefined)).toBe(false);
    });
  });

  describe('evaluateOperationalEligibility — filtra por licencia de verdad (no solo texto)', () => {
    const inCoverageProfile = {
      max_distance: 50,
      operational_latitude: 40.417,
      operational_longitude: -3.703,
    };
    const chemicalBookingInput: SerializableBookingData = {
      ...bookingInput,
      phytosanitaryZones: [{ area: 20, productPreference: 'chemical' }],
    };

    it('excluye con missing_phytosanitary_license al jardinero sin licencia vigente', () => {
      const result = evaluateOperationalEligibility({
        bookingInput: chemicalBookingInput,
        providerConfig, // el contenido no importa: la puerta de licencia corta antes de cotizar
        providerConfigVersion: 'cfg-1',
        profile: {
          ...inCoverageProfile,
          license_verification_status: 'rejected',
          license_expires_at: null,
        },
        providerDates: new Map([['2026-06-15', [9, 10]]]),
        requestedDate: '2026-06-15',
        windowEndDate: '2026-06-15',
      });

      expect(result).toEqual({
        eligible: false,
        exclusion: {
          code: 'missing_phytosanitary_license',
          message: 'El profesional no tiene una licencia fitosanitaria vigente para este tratamiento.',
        },
      });
    });

    it('excluye igual si la licencia aprobada ya caducó', () => {
      const result = evaluateOperationalEligibility({
        bookingInput: chemicalBookingInput,
        providerConfig,
        providerConfigVersion: 'cfg-1',
        profile: {
          ...inCoverageProfile,
          license_verification_status: 'approved',
          license_expires_at: '2020-01-01T00:00:00Z',
        },
        providerDates: new Map([['2026-06-15', [9, 10]]]),
        requestedDate: '2026-06-15',
        windowEndDate: '2026-06-15',
      });

      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.exclusion.code).toBe('missing_phytosanitary_license');
      }
    });

    it('NO excluye por licencia cuando el tratamiento es ecológico', () => {
      const result = evaluateOperationalEligibility({
        bookingInput: {
          ...bookingInput,
          phytosanitaryZones: [{ area: 20, productPreference: 'ecological' }],
        },
        providerConfig,
        providerConfigVersion: 'cfg-1',
        profile: {
          ...inCoverageProfile,
          license_verification_status: 'rejected',
          license_expires_at: null,
        },
        providerDates: new Map([['2026-06-15', [9, 10]]]),
        requestedDate: '2026-06-15',
        windowEndDate: '2026-06-15',
      });

      // No es la puerta de licencia la que decide aquí (providerConfig no sabe cotizar
      // fitosanitarios): lo único que importa a este test es que NO sea
      // missing_phytosanitary_license.
      if (!result.eligible) {
        expect(result.exclusion.code).not.toBe('missing_phytosanitary_license');
      }
    });

    it('no llega a comprobar licencia si ya está fuera de cobertura (el orden de exclusión manda)', () => {
      const result = evaluateOperationalEligibility({
        bookingInput: chemicalBookingInput,
        providerConfig,
        providerConfigVersion: 'cfg-1',
        profile: {
          max_distance: 5,
          operational_latitude: 41.3851,
          operational_longitude: 2.1686, // Barcelona — lejos del cliente (Madrid)
          license_verification_status: 'rejected',
          license_expires_at: null,
        },
        providerDates: new Map([['2026-06-15', [9, 10]]]),
        requestedDate: '2026-06-15',
        windowEndDate: '2026-06-15',
      });

      expect(result).toEqual({
        eligible: false,
        exclusion: {
          code: 'outside_coverage',
          message: 'La dirección del cliente queda fuera del radio operativo del profesional.',
        },
      });
    });
  });
});

describe('T7 → F7 (D12) — trabajos de más de 12 h', () => {
  // 1500 m² / 100 m²/h = 15 h → >8h, así que el motor aplica el descuento ×0.9 (T2) = 13.5h →
  // 14h redondeadas al bloque. Antes (T7) se rechazaba siempre por no caber en un día; desde F7
  // se reparte en varios días (también para un autónomo).
  const bigJobInput: SerializableBookingData = {
    ...bookingInput,
    lawnZones: [{ quantity: 1500, state: 'normal' }],
  };

  const profile = {
    max_distance: 50,
    operational_latitude: 40.417,
    operational_longitude: -3.703,
    license_verification_status: 'approved',
    license_expires_at: '2099-01-01T00:00:00Z',
  };

  it('con un solo día libre no hay hueco (ni con el día entero): 12 h por jornada como mucho', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: bigJobInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile,
      providerDates: new Map([
        ['2026-06-15', Array.from({ length: 14 }, (_, i) => 6 + i)], // 6h-20h
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
    });

    expect(result).toMatchObject({ eligible: false, exclusion: { code: 'no_reservable_availability' } });
  });

  it('con el día siguiente libre se ofrece en dos días: 12 h el primero y 2 h el segundo', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: bigJobInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile,
      providerDates: new Map([
        ['2026-06-15', Array.from({ length: 14 }, (_, i) => 6 + i)],
        ['2026-06-16', [9, 10, 11]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
      restrictToRequestedDate: true,
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    // De 6 a 8: 12 h el primer día. A las 9: 11 h + las 3 del día siguiente = 14. A las 10 ya
    // no llega (10 + 3).
    expect(result.validHoursForRequestedDate).toEqual([6, 7, 8, 9]);
    expect(result.earliestSlot).toMatchObject({
      startHour: 6, durationHours: 12, endDate: '2026-06-16', crew: 1, labourHours: 14,
      planDays: [{ date: '2026-06-15', people: 1, hours: 12 }, { date: '2026-06-16', people: 1, hours: 2 }],
    });
  });

  it('un trabajo normal (2h, muy por debajo del tope) sin hueco real sigue devolviendo no_reservable_availability, no service_exceeds_single_day', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: twoHourBookingInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile,
      providerDates: new Map([
        ['2026-06-15', [9]],
        ['2026-06-16', [14]],
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-16',
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'no_reservable_availability',
        message: 'El profesional no tiene un hueco reservable válido para la duración estimada.',
      },
    });
  });
});

describe('F7 — planBookingShape (la misma regla que plan_booking_cells en SQL)', () => {
  const D1 = '2026-06-15';
  const D2 = '2026-06-16';
  const D3 = '2026-06-17';
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  const team = (people: Record<string, Record<string, number[]>>) =>
    new Map(Object.entries(people).map(([id, days]) => [id, new Map(Object.entries(days))]));

  it('freeRun: horas seguidas, como mucho 12 y hasta las 20:00', () => {
    expect(freeRun([8, 9, 10, 12], 8)).toBe(3);
    expect(freeRun(range(0, 24), 5)).toBe(12);
    expect(freeRun(range(0, 24), 15)).toBe(5);
    expect(freeRun([8], 20)).toBe(0);
    expect(freeRun([8], Number.NaN)).toBe(0);
  });

  it('8 h de trabajo: con una persona de 4 h libres no cabe; con un equipo de 2, 4 h de reloj', () => {
    const workerDates = team({ ana: { [D1]: range(8, 12) }, luis: { [D1]: range(8, 12) } });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 8, maxCrew: 1 })).toBeNull();
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 8, maxCrew: 2 })).toMatchObject({
      mode: 'crew', crew: 2, firstDayHours: 4, endDate: null, days: [{ date: D1, people: 2, hours: 8 }],
    });
  });

  it('elige el equipo más pequeño y reparte a partes iguales (7 h con 2: 4 + 3)', () => {
    const workerDates = team({ ana: { [D1]: range(8, 11) }, luis: { [D1]: range(8, 12) } });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 7, maxCrew: 3 })).toMatchObject({ crew: 2, firstDayHours: 4 });
    // Si nadie tiene 4 seguidas, no se puede con 2 aunque sumen 7.
    const short = team({ ana: { [D1]: range(8, 11) }, luis: { [D1]: range(8, 11) } });
    expect(planBookingShape({ workerDates: short, date: D1, startHour: 8, labourHours: 7, maxCrew: 2 })).toBeNull();
  });

  it('por turnos solo si la empresa lo acepta y son 12 h o menos', () => {
    const workerDates = team({ ana: { [D1]: [9] }, luis: { [D1]: [10] } });
    expect(planBookingShape({ workerDates, date: D1, startHour: 9, labourHours: 2, maxCrew: 2 })).toBeNull();
    expect(planBookingShape({ workerDates, date: D1, startHour: 9, labourHours: 2, maxCrew: 2, allowSplit: true })).toMatchObject({ mode: 'turns' });
  });

  it('12 h o menos nunca en varios días', () => {
    const workerDates = team({ ana: { [D1]: range(8, 12), [D2]: range(8, 20) } });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 10 })).toBeNull();
  });

  it('varios días: se salta el día sin nadie; los días siguientes cada persona desde su primera hora libre', () => {
    const workerDates = team({
      ana: { [D1]: range(8, 12), [D3]: range(15, 20) },
      luis: { [D1]: range(8, 12), [D3]: range(8, 12) },
    });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 15, maxCrew: 2 })).toMatchObject({
      mode: 'multi_day', crew: 2, firstDayHours: 4, endDate: D3,
      days: [{ date: D1, people: 2, hours: 8 }, { date: D3, people: 2, hours: 7 }],
    });
  });

  it('varios días: el primer día alguien tiene que poder empezar a la hora elegida', () => {
    const workerDates = team({ ana: { [D1]: range(10, 12), [D2]: range(8, 20) } });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 14 })).toBeNull();
    // A las 10: 2 h + 12 h el día siguiente = 14. A las 11 ya no llega (1 + 12).
    expect(getValidStartHoursForPlan({ workerDates, date: D1, labourHours: 14 })).toEqual([10]);
  });

  it('varios días con límite: cada día van como mucho N personas', () => {
    const workerDates = team({
      a: { [D1]: range(8, 12), [D2]: range(8, 12) },
      b: { [D1]: range(8, 12), [D2]: range(8, 12) },
      c: { [D1]: range(8, 12), [D2]: range(8, 12) },
    });
    // 16 h: con 3 a la vez no llega en un día (4 h cada una = 12); con 2 al día hace falta el 2.º.
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 16, maxCrew: 2 })).toMatchObject({
      endDate: D2, days: [{ people: 2, hours: 8 }, { people: 2, hours: 8 }],
    });
    expect(planBookingShape({ workerDates, date: D1, startHour: 8, labourHours: 16, maxCrew: 3 })).toMatchObject({
      endDate: D2, days: [{ people: 3, hours: 12 }, { people: 1, hours: 4 }],
    });
  });

  it('no pasa de 21 días', () => {
    const days = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, [8]]));
    const workerDates = team({ ana: days });
    expect(planBookingShape({ workerDates, date: '2026-07-01', startHour: 8, labourHours: 21 })?.endDate).toBe('2026-07-21');
    expect(planBookingShape({ workerDates, date: '2026-07-01', startHour: 8, labourHours: 22 })).toBeNull();
  });
});

describe('F8 — varios servicios en una visita (mismo motor, se suman)', () => {
  const profile = {
    max_distance: 50,
    operational_latitude: 40.417,
    operational_longitude: -3.703,
    license_verification_status: 'approved',
    license_expires_at: '2099-01-01T00:00:00Z',
  };
  const secondConfig = { ...providerConfig, precioPorHora: 50 };
  const base = {
    bookingInput: twoHourBookingInput,
    providerConfig,
    providerConfigVersion: 'cfg-1',
    profile,
    providerDates: new Map([['2026-06-15', [8, 9, 10, 11, 12]]]),
    requestedDate: '2026-06-15',
    windowEndDate: '2026-06-15',
    restrictToRequestedDate: true,
    mainService: { serviceId: 'svc-a', serviceName: 'Césped' },
  };

  it('suma precio y horas de cada servicio con su tarifa; los gastos de gestión, sobre el total', () => {
    const result = evaluateOperationalEligibility({
      ...base,
      extraServices: [{ serviceId: 'svc-b', serviceName: 'Otro', bookingInput, providerConfig: secondConfig }],
    });
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    // 2 h a 30 € + 1 h a 50 € = 110 €, 3 h. Gestión 12,5 % de 110.
    expect(result.quote.totalPrice).toBe(110);
    expect(result.quote.estimatedHours).toBe(3);
    expect(result.quote.economics.managementFee).toBe(13.75);
    expect(result.validHoursForRequestedDate).toEqual([8, 9, 10]);
    expect((result.quote as { items?: Array<{ serviceId: string; totalPrice: number }> }).items?.map((i) => `${i.serviceId}:${i.totalPrice}`))
      .toEqual(['svc-a:60', 'svc-b:50']);
    expect(result.quote.breakdown.every((line) => /^(Césped|Otro): /.test(line.desc))).toBe(true);
  });

  it('si el profesional no ofrece alguno de los servicios, no sale (D15)', () => {
    const result = evaluateOperationalEligibility({
      ...base,
      extraServices: [{ serviceId: 'svc-b', bookingInput, providerConfig: null }],
    });
    expect(result).toMatchObject({ eligible: false, exclusion: { code: 'inactive_service' } });
  });

  it('un solo servicio: exactamente lo de siempre', () => {
    const single = evaluateOperationalEligibility({ ...base });
    const legacy = evaluateOperationalEligibility({ ...base, mainService: undefined });
    expect(single).toEqual(legacy);
  });
});

describe('F8 — versión de la configuración firmada', () => {
  it('con un servicio es la de siempre; con varios, todas en orden', () => {
    const a = { updated_at: '2026-01-01', additional_config: { x: 1 } };
    const b = { created_at: '2026-02-02', additional_config: { y: 2 } };
    expect(providerConfigVersionPayload([a])).toBe(JSON.stringify({ updated_at: '2026-01-01', config: { x: 1 } }));
    expect(providerConfigVersionPayload([a, b])).toBe(JSON.stringify([{ updated_at: '2026-01-01', config: { x: 1 } }, { updated_at: '2026-02-02', config: { y: 2 } }]));
    expect(providerConfigVersionPayload([null])).toBe(JSON.stringify({ updated_at: '', config: null }));
  });
});
