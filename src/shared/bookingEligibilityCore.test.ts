import { describe, expect, it } from 'vitest';

import {
  bookingRequiresPhytosanitaryLicense,
  evaluateOperationalEligibility,
  getClientCoordinates,
  getProviderCoordinates,
  getValidStartHours,
  getValidStartHoursForWorkers,
  isPhytosanitaryLicenseActive,
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
    expect(result.earliestSlot).toEqual({
      date: '2026-06-15',
      startHour: 9,
      startTime: '09:00:00',
      endTime: '11:00:00',
      durationHours: 2,
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

describe('T7 (transversal, D4-a) — trabajo que no cabe en un día', () => {
  // 1500 m² / 100 m²/h = 15 h → >8h, así que el motor aplica el descuento ×0.9 (T2) = 13.5h →
  // 14h redondeadas al bloque — por encima de MAX_SINGLE_DAY_DURATION_HOURS (12, el mismo
  // tope que ya exige el CHECK de `duration_hours` en BD).
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

  it('avisa de que el trabajo no cabe en un día cuando estimatedHours supera el tope de 12h — sin ni mirar la agenda del profesional', () => {
    const result = evaluateOperationalEligibility({
      bookingInput: bigJobInput,
      providerConfig,
      providerConfigVersion: 'cfg-1',
      profile,
      // Agenda deliberadamente amplísima (un día entero libre) para demostrar que el aviso no
      // depende de lo ocupado que esté el profesional: ni con el día entero libre cabría.
      providerDates: new Map([
        ['2026-06-15', Array.from({ length: 16 }, (_, i) => 6 + i)], // 6h-22h, 16h seguidas
      ]),
      requestedDate: '2026-06-15',
      windowEndDate: '2026-06-15',
    });

    expect(result).toEqual({
      eligible: false,
      exclusion: {
        code: 'service_exceeds_single_day',
        message: 'Este trabajo necesita 14 horas seguidas y ningún servicio se puede reservar por más de 12 horas en un solo día. Prueba a reducir el alcance del trabajo — de momento no ofrecemos reservas repartidas en varios días.',
      },
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
