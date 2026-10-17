import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  classifyProviderLinkBlock,
  describeProviderLinkBlock,
  reconcileProviderLink,
  resolveProviderLinkEntry,
  splitServicesByOffer,
  type ProviderLinkBlockReason,
} from './providerLink';

const draft = (overrides: Record<string, unknown> = {}) => ({
  address: 'Calle Verde 1, Marbella',
  serviceIds: ['svc-lawn'],
  restrictedGardenerId: undefined as string | undefined,
  maintenanceVisitId: undefined as string | undefined,
  ...overrides,
});

describe('resolveProviderLinkEntry (enlace de un profesional)', () => {
  it('un borrador ligado a OTRO profesional pasa al del enlace (antes ganaba el anterior)', () => {
    const entry = resolveProviderLinkEntry({
      bookingData: draft({ restrictedGardenerId: 'gardener-A' }),
      currentStep: 2,
      gardenerId: 'gardener-B',
      offeredServiceIds: ['svc-lawn'],
    });
    expect(entry.kind).toBe('rebound');
    if (entry.kind !== 'rebound') return;
    expect(entry.updates.restrictedGardenerId).toBe('gardener-B');
    // Se queda en «Detalles»: la dirección y el servicio describen el trabajo, no al profesional.
    expect(entry.step).toBe(2);
    expect(entry.updates).not.toHaveProperty('address');
    expect(entry.updates).not.toHaveProperty('serviceIds');
  });

  it('en la confirmación con otro profesional elegido vuelve a «Profesionales» y quita hora y presupuesto', () => {
    const entry = resolveProviderLinkEntry({
      bookingData: draft(),
      currentStep: 4,
      gardenerId: 'gardener-B',
      offeredServiceIds: ['svc-lawn'],
    });
    expect(entry.kind).toBe('rebound');
    if (entry.kind !== 'rebound') return;
    expect(entry.step).toBe(3);
    expect(entry.updates).toMatchObject({
      restrictedGardenerId: 'gardener-B',
      providerId: '',
      timeSlot: '',
      preferredDate: '',
      authoritativeQuoteSnapshot: undefined,
      quoteId: undefined,
      quoteSignature: undefined,
      quoteEconomics: undefined,
    });
  });

  it('si el profesional no hace alguno de los servicios elegidos, vuelve a «Servicios»', () => {
    const entry = resolveProviderLinkEntry({
      bookingData: draft({ serviceIds: ['svc-lawn', 'svc-palm'] }),
      currentStep: 3,
      gardenerId: 'gardener-B',
      offeredServiceIds: ['svc-lawn'],
    });
    expect(entry).toMatchObject({ kind: 'rebound', step: 1, missingServiceIds: ['svc-palm'] });
  });

  it('nunca adelanta al cliente: si estaba en «Dirección», sigue ahí', () => {
    const entry = resolveProviderLinkEntry({
      bookingData: draft({ serviceIds: [] }),
      currentStep: 0,
      gardenerId: 'gardener-B',
      offeredServiceIds: [],
    });
    expect(entry).toMatchObject({ kind: 'rebound', step: 0 });
  });

  it('sin saber qué servicios ofrece no se le manda a «Servicios» a ciegas', () => {
    const entry = resolveProviderLinkEntry({
      bookingData: draft({ serviceIds: ['svc-palm'] }),
      currentStep: 4,
      gardenerId: 'gardener-B',
      offeredServiceIds: null,
    });
    expect(entry).toMatchObject({ kind: 'rebound', step: 3, missingServiceIds: [] });
  });

  it('el mismo enlace otra vez: se sigue donde estaba, sin tocar nada', () => {
    expect(
      resolveProviderLinkEntry({
        bookingData: draft({ restrictedGardenerId: 'gardener-B' }),
        currentStep: 4,
        gardenerId: 'gardener-B',
        offeredServiceIds: ['svc-lawn'],
      }),
    ).toEqual({ kind: 'unchanged' });
  });

  it('sin dirección ni servicios no hay nada que conservar: reserva nueva', () => {
    expect(
      resolveProviderLinkEntry({
        bookingData: draft({ address: '  ', serviceIds: [] }),
        currentStep: 0,
        gardenerId: 'gardener-B',
        offeredServiceIds: ['svc-lawn'],
      }),
    ).toEqual({ kind: 'fresh' });
  });

  it('la visita de un plan de mantenimiento no se pasa a otro profesional: reserva nueva', () => {
    expect(
      resolveProviderLinkEntry({
        bookingData: draft({ maintenanceVisitId: 'visit-1' }),
        currentStep: 4,
        gardenerId: 'gardener-B',
        offeredServiceIds: ['svc-lawn'],
      }),
    ).toEqual({ kind: 'fresh' });
  });
});

describe('reconcileProviderLink (borradores de antes del arreglo)', () => {
  it('ligado a B con A elegido: quita la elección y vuelve a la lista', () => {
    const fix = reconcileProviderLink({ restrictedGardenerId: 'gardener-B', providerId: 'gardener-A' }, 4);
    expect(fix).toMatchObject({ step: 3, updates: { providerId: '', timeSlot: '', authoritativeQuoteSnapshot: undefined } });
  });

  it('no toca nada si el elegido es el del enlace, si no hay elegido o si no hay enlace', () => {
    expect(reconcileProviderLink({ restrictedGardenerId: 'gardener-B', providerId: 'gardener-B' }, 4)).toBeNull();
    expect(reconcileProviderLink({ restrictedGardenerId: 'gardener-B', providerId: '' }, 3)).toBeNull();
    expect(reconcileProviderLink({ restrictedGardenerId: undefined, providerId: 'gardener-A' }, 4)).toBeNull();
  });
});

describe('splitServicesByOffer', () => {
  it('separa los servicios elegidos que el profesional hace de los que no', () => {
    expect(splitServicesByOffer(['a', 'b', 'c'], ['c', 'a'])).toEqual({ kept: ['a', 'c'], removed: ['b'] });
  });
});

describe('classifyProviderLinkBlock', () => {
  const classify = (exclusionCode: string | null, extra: Partial<Parameters<typeof classifyProviderLinkBlock>[0]> = {}) =>
    classifyProviderLinkBlock({ offersService: true, exclusionCode, hasClientCoordinates: true, ...extra });

  it('sin tarifa para el servicio: no lo hace, diga lo que diga el servidor', () => {
    expect(classify(null, { offersService: false })).toBe('not_offered');
  });

  it.each<[string, ProviderLinkBlockReason]>([
    ['inactive_service', 'not_offered'],
    ['outside_coverage', 'outside_coverage'],
    ['no_reservable_availability', 'no_availability'],
    ['missing_phytosanitary_license', 'needs_license'],
    ['service_exceeds_single_day', 'job_too_big'],
    ['missing_provider_profile', 'unavailable'],
    ['missing_pricing_config', 'not_configured'],
    ['partial_palm_coverage', 'not_configured'],
    ['missing_service_payload', 'details'],
  ])('%s → %s', (code, reason) => {
    expect(classify(code)).toBe(reason);
  });

  it('coordenadas que faltan: si son las del cliente, es su dirección; si no, el perfil del profesional', () => {
    expect(classify('missing_coordinates', { hasClientCoordinates: false })).toBe('address_unlocated');
    expect(classify('missing_coordinates', { hasClientCoordinates: true })).toBe('unavailable');
  });
});

describe('describeProviderLinkBlock', () => {
  const context = {
    providerName: 'Ana Jardines',
    serviceName: 'Poda de palmeras',
    maxDistanceKm: 25,
    windowStart: '2026-10-17',
    windowEnd: '2026-11-16',
  };

  it('dice el motivo con el nombre del profesional, el servicio y su radio', () => {
    expect(describeProviderLinkBlock('not_offered', context)).toMatchObject({
      title: 'Ana Jardines no hace este servicio',
      detail: 'Ana Jardines no ofrece «Poda de palmeras». Puedes elegir otro de sus servicios.',
      primaryAction: 'change_services',
    });
    expect(describeProviderLinkBlock('outside_coverage', context)).toMatchObject({
      title: 'Ana Jardines no trabaja en tu zona',
      detail: expect.stringContaining('(25 km)'),
      primaryAction: 'change_address',
    });
  });

  it('sin huecos ofrece buscar más adelante, a partir del día siguiente al último mirado', () => {
    const copy = describeProviderLinkBlock('no_availability', context);
    expect(copy.title).toBe('Ana Jardines no tiene huecos para este trabajo');
    expect(copy.detail).toContain('entre el 17 de octubre y el 16 de noviembre');
    expect(copy.primaryAction).toBe('search_later');
    expect(copy.primaryLabel).toBe('Buscar a partir del 17 de noviembre');
  });

  // Decisión del dueño: «Ver otros profesionales» solo si este profesional no puede nunca.
  it.each<[ProviderLinkBlockReason, boolean]>([
    ['not_offered', true],
    ['not_configured', true],
    ['outside_coverage', true],
    ['needs_license', true],
    ['unavailable', true],
    ['no_availability', false],
    ['address_unlocated', false],
    ['job_too_big', false],
    ['details', false],
  ])('%s → ver otros profesionales: %s', (reason, offered) => {
    expect(describeProviderLinkBlock(reason, context).offerOtherProviders).toBe(offered);
  });

  it('con varios servicios no nombra uno que puede no ser el que falla', () => {
    expect(describeProviderLinkBlock('not_offered', { ...context, multiService: true }).detail).toBe(
      'Ana Jardines no ofrece alguno de los servicios que has elegido. Puedes elegir otro de sus servicios.',
    );
  });

  it('sin nombre conocido no deja un hueco en la frase', () => {
    expect(describeProviderLinkBlock('outside_coverage', { ...context, providerName: '' }).title).toBe(
      'Este profesional no trabaja en tu zona',
    );
  });
});

describe('addDaysIso', () => {
  it('suma días cruzando de mes y de año', () => {
    expect(addDaysIso('2026-10-17', 30)).toBe('2026-11-16');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});
