// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildBookingResumeRedirectParam,
  claimBookingResumeForUser,
  clearLegacyCheckoutArtifacts,
  clearBookingResumeStorage,
  collectNonSerializablePaths,
  hasWizardResume,
  migrateLegacyBookingResume,
  readAnyBookingResume,
  readBookingResumeState,
  parseBookingResumeRedirectParam,
  sanitizeBookingPayload,
  writeBookingResume,
  writeBookingResumeResult,
} from './bookingResumeStorage';

describe('bookingResumeStorage', () => {
  const buildBookingData = (overrides: Record<string, unknown> = {}) => ({
    address: 'Calle Sol 2',
    serviceIds: ['svc-1'],
    photos: [],
    description: '',
    preferredDate: '',
    timeSlot: '',
    providerId: '',
    estimatedHours: 0,
    totalPrice: 0,
    uploadedPhotoUrls: [],
    servicesData: {},
    ...overrides,
  });

  const buildConfirmationData = (overrides: Record<string, unknown> = {}) =>
    buildBookingData({
      providerId: 'gardener-1',
      serviceIds: ['svc-1'],
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
        currency: 'EUR',
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
      authoritativeQuoteSnapshot: {
        totalPrice: 120,
        estimatedHours: 2,
        breakdown: [{ desc: 'Servicio base', price: 120 }],
        warnings: [],
        metadata: {
          pricingContext: {
            serviceType: 'standard',
            allowsPriceChange: true,
            palmGroups: [],
          },
        },
        availability: {
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
        economics: {
          currency: 'EUR',
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
        signature: 'sig-1',
        expiresAt: '2026-05-20T10:00:00Z',
        pricingVersion: 'v1',
        providerConfigVersion: 'cfg-1',
      },
      quoteId: 'quote-1',
      quoteSignature: 'sig-1',
      quoteExpiresAt: '2026-05-20T10:00:00Z',
      quotePricingVersion: 'v1',
      quoteProviderConfigVersion: 'cfg-1',
      ...overrides,
    });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitiza File[] y conserva datos serializables del draft', () => {
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    const payload = sanitizeBookingPayload({
      address: 'Calle Mayor 10',
      photos: [file],
      uploadedPhotoUrls: ['blob:http://localhost/foto-1', 'https://example.com/foto.jpg'],
      bookingPhotoContract: {
        schemaVersion: 'booking_photo_v1',
        items: [
          { id: 'url:blob:http://localhost/foto-1', url: 'blob:http://localhost/foto-1' },
          { id: 'url:https://example.com/foto.jpg', url: 'https://example.com/foto.jpg' },
        ],
      },
      servicesData: {
        lawn: {
          files: [file],
          uploadedPhotoUrls: ['blob:http://localhost/foto-2', 'https://example.com/foto.jpg'],
          photoUrls: ['blob:http://localhost/foto-3', 'https://example.com/foto.jpg'],
        },
      },
    }) as any;

    expect(payload.photos).toEqual([]);
    expect(payload.uploadedPhotoUrls).toEqual(['https://example.com/foto.jpg']);
    expect(payload.servicesData.lawn.files).toEqual([]);
    expect(payload.servicesData.lawn.uploadedPhotoUrls).toEqual(['https://example.com/foto.jpg']);
    expect(payload.servicesData.lawn.photoUrls).toEqual(['https://example.com/foto.jpg']);
    expect(payload.bookingPhotoContract.schemaVersion).toBe('booking_photo_v1');
    expect(payload.bookingPhotoContract.items).toHaveLength(1);
  });

  it('detecta rutas no serializables del draft para informar al reanudar', () => {
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    const paths = collectNonSerializablePaths({
      photos: [file],
      uploadedPhotoUrls: ['blob:http://localhost/foto-1'],
      servicesData: {
        lawn: {
          files: [file],
          photoUrls: ['blob:http://localhost/foto-2'],
        },
      },
    });

    expect(paths).toEqual([
      'photos[]',
      'uploadedPhotoUrls[]',
      'servicesData.lawn.files[]',
      'servicesData.lawn.photoUrls[]',
    ]);
  });

  it('escribe y lee el resume canónico del wizard', () => {
    writeBookingResume('draft', 'wizard', {
      bookingData: buildBookingData(),
      currentStep: 2,
    }, { userId: 'user-1' });

    const record = readAnyBookingResume<any>({ userId: 'user-1', flow: 'wizard' });
    expect(record?.flow).toBe('wizard');
    expect(record?.payload.currentStep).toBe(2);
    expect(record?.nonSerializablePaths).toEqual([]);
    expect(hasWizardResume({ userId: 'user-1' })).toBe(true);
  });

  it('migra bookingProgress legacy cuando no existe clave canónica', () => {
    localStorage.setItem(
      'bookingProgress',
      JSON.stringify({
        bookingData: buildBookingData({ address: 'Calle Luna 8' }),
        currentStep: 3,
      })
    );

    const record = readAnyBookingResume<any>({ flow: 'wizard', allowAnonFallback: true });
    expect(record?.flow).toBe('wizard');
    expect(record?.stage).toBe('draft');
    expect(record?.payload.bookingData.address).toBe('Calle Luna 8');
  });

  it('aísla el resume por usuario y permite fallback desde anon al autenticarse', () => {
    writeBookingResume('draft', 'wizard', { bookingData: buildBookingData({ address: 'Draft anónimo' }), currentStep: 1 });
    writeBookingResume(
      'draft',
      'wizard',
      { bookingData: buildBookingData({ address: 'Draft privado' }), currentStep: 3 },
      { userId: 'user-2' },
    );

    const privateRecord = readAnyBookingResume<any>({ userId: 'user-2', flow: 'wizard', allowAnonFallback: true });
    const otherUserRecord = readAnyBookingResume<any>({ userId: 'user-3', flow: 'wizard', allowAnonFallback: false });
    const fallbackState = readBookingResumeState<any>({ userId: 'user-3', flow: 'wizard', allowAnonFallback: true });
    const fallbackRecord = fallbackState.record;

    expect(privateRecord?.payload.bookingData.address).toBe('Draft privado');
    expect(otherUserRecord).toBeNull();
    expect(fallbackRecord?.payload.bookingData.address).toBe('Draft anónimo');
    expect(fallbackState.fromAnonFallback).toBe(true);

    const claimed = claimBookingResumeForUser({
      userId: 'user-3',
      record: fallbackRecord!,
      sourceKey: fallbackState.sourceKey,
    });

    expect(claimed?.ownerUserId).toBe('user-3');
    expect(readAnyBookingResume<any>({ userId: 'user-3', flow: 'wizard', allowAnonFallback: false })?.payload.bookingData.address).toBe('Draft anónimo');
  });

  it('rechaza resumes corruptos o con esquema inválido antes de rehidratar', () => {
    localStorage.setItem(
      'booking_resume_v2:user:user-1:wizard',
      JSON.stringify({
        version: 2,
        schema: 'garser.booking_resume_record.v2',
        payloadSchema: 'booking_wizard_progress_v1',
        stage: 'draft',
        flow: 'wizard',
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ownerScope: 'user',
        ownerUserId: 'user-1',
        nonSerializablePaths: [],
        payload: { bookingData: { address: 123 }, currentStep: 2 },
      }),
    );

    const result = readBookingResumeState({ userId: 'user-1', flow: 'wizard' });

    expect(result.record).toBeNull();
    expect(result.error).toBe('invalid_schema');
    expect(localStorage.getItem('booking_resume_v2:user:user-1:wizard')).toBeNull();
  });

  it('degrada a sessionStorage cuando localStorage falla por cuota', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    const result = writeBookingResumeResult(
      'draft',
      'wizard',
      { bookingData: buildBookingData(), currentStep: 1 },
      { userId: 'user-1' },
    );

    expect(result.error).toBeNull();
    expect(result.storage).toBe('sessionStorage');
    expect(setItemSpy).toHaveBeenCalled();
    expect(sessionStorage.getItem('booking_resume_v2:user:user-1:wizard')).not.toBeNull();
  });

  it('serializa y valida el envelope de retorno para login o Stripe', () => {
    const encoded = buildBookingResumeRedirectParam(
      'confirmation',
      'wizard',
      buildConfirmationData(),
      { userId: 'user-1' },
    );

    const parsed = parseBookingResumeRedirectParam<any>(encoded);

    expect(parsed.error).toBeNull();
    expect(parsed.record?.stage).toBe('confirmation');
    expect(parsed.record?.ownerUserId).toBe('user-1');
    expect(parsed.record?.payload.quoteId).toBe('quote-1');
  });

  it('rechaza persistir confirmation sin contrato autoritativo completo', () => {
    const result = writeBookingResumeResult(
      'confirmation',
      'wizard',
      buildBookingData({
        providerId: 'gardener-1',
        serviceIds: ['svc-1'],
        quoteEconomics: { payableNow: 15 },
      }),
      { userId: 'user-1' },
    );

    expect(result.record).toBeNull();
    expect(result.error).toBe('invalid_schema');
    expect(localStorage.getItem('booking_resume_v2:user:user-1:wizard')).toBeNull();
  });

  it('migra resumeBooking legacy compatible a confirmation y purga el origen', () => {
    localStorage.setItem(
      'resumeBooking',
      JSON.stringify({
        ...buildConfirmationData(),
      }),
    );

    const record = migrateLegacyBookingResume() as any;

    expect(record?.version).toBe(2);
    expect(record?.stage).toBe('confirmation');
    expect(record?.payload.quoteId).toBe('quote-1');
    expect(localStorage.getItem('resumeBooking')).toBeNull();
    expect(localStorage.getItem('booking_resume_v2:anon:wizard')).not.toBeNull();
  });

  it('purga pending_checkout legacy al leer resumes aunque no exista migración', () => {
    localStorage.setItem(
      'pending_checkout',
      JSON.stringify({
        selectedAddress: 42,
        selectedServiceIds: [123],
        description: false,
      }),
    );

    const record = readAnyBookingResume({ flow: 'wizard', allowAnonFallback: true });

    expect(record).toBeNull();
    expect(localStorage.getItem('pending_checkout')).toBeNull();
  });

  it('no migra pending_checkout compatible al wizard y lo descarta por integridad', () => {
    localStorage.setItem(
      'pending_checkout',
      JSON.stringify({
        address: '  Calle Sol 4  ',
        selectedServiceId: 'svc-1',
        gardenerId: 'gardener-1',
        description: '  Podar seto  ',
      }),
    );

    const record = readAnyBookingResume({ flow: 'wizard', allowAnonFallback: true });

    expect(record).toBeNull();
    expect(localStorage.getItem('pending_checkout')).toBeNull();
  });

  it('limpia de forma dirigida el storage canónico legacy-checkout y pending_checkout', () => {
    writeBookingResume('checkout', 'legacy-checkout', { selectedAddress: 'Calle Sol 4' }, { userId: 'user-1' });
    writeBookingResume('checkout', 'legacy-checkout', { selectedAddress: 'Calle Luna 8' });
    localStorage.setItem('pending_checkout', '{}');
    sessionStorage.setItem('pending_checkout', '{}');

    clearLegacyCheckoutArtifacts({ userId: 'user-1', includeAnonFallback: true });

    expect(localStorage.getItem('booking_resume_v2:user:user-1:legacy-checkout')).toBeNull();
    expect(localStorage.getItem('booking_resume_v2:anon:legacy-checkout')).toBeNull();
    expect(localStorage.getItem('pending_checkout')).toBeNull();
    expect(sessionStorage.getItem('pending_checkout')).toBeNull();
  });

  it('limpia claves canónicas y legacy', () => {
    writeBookingResume('checkout', 'legacy-checkout', { selectedAddress: 'Calle Sol 4' }, { userId: 'user-1' });
    localStorage.setItem('bookingProgress', '{}');
    localStorage.setItem('resumeBooking', '{}');
    localStorage.setItem('pending_checkout', '{}');
    localStorage.setItem('bookingDraft', '{}');
    sessionStorage.setItem('pending_checkout', '{}');

    clearBookingResumeStorage();

    expect(Object.keys(localStorage).filter((key) => key.startsWith('booking_resume_v2')).length).toBe(0);
    expect(localStorage.getItem('bookingProgress')).toBeNull();
    expect(localStorage.getItem('resumeBooking')).toBeNull();
    expect(localStorage.getItem('pending_checkout')).toBeNull();
    expect(localStorage.getItem('bookingDraft')).toBeNull();
    expect(sessionStorage.getItem('pending_checkout')).toBeNull();
  });
});
