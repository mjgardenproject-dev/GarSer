// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBookingResumeStorage,
  collectNonSerializablePaths,
  hasWizardResume,
  readAnyBookingResume,
  sanitizeBookingPayload,
  writeBookingResume,
} from './bookingResumeStorage';

describe('bookingResumeStorage', () => {
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
      bookingData: { address: 'Calle Sol 2' },
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
        bookingData: { address: 'Calle Luna 8' },
        currentStep: 3,
      })
    );

    const record = readAnyBookingResume<any>({ flow: 'wizard', allowAnonFallback: true });
    expect(record?.flow).toBe('wizard');
    expect(record?.stage).toBe('draft');
    expect(record?.payload.bookingData.address).toBe('Calle Luna 8');
  });

  it('aísla el resume por usuario y permite fallback desde anon al autenticarse', () => {
    writeBookingResume('draft', 'wizard', { bookingData: { address: 'Draft anónimo' }, currentStep: 1 });
    writeBookingResume('draft', 'wizard', { bookingData: { address: 'Draft privado' }, currentStep: 3 }, { userId: 'user-2' });

    const privateRecord = readAnyBookingResume<any>({ userId: 'user-2', flow: 'wizard', allowAnonFallback: true });
    const otherUserRecord = readAnyBookingResume<any>({ userId: 'user-3', flow: 'wizard', allowAnonFallback: false });
    const fallbackRecord = readAnyBookingResume<any>({ userId: 'user-3', flow: 'wizard', allowAnonFallback: true });

    expect(privateRecord?.payload.bookingData.address).toBe('Draft privado');
    expect(otherUserRecord).toBeNull();
    expect(fallbackRecord?.payload.bookingData.address).toBe('Draft anónimo');
  });

  it('limpia claves canónicas y legacy', () => {
    writeBookingResume('checkout', 'legacy-checkout', { totalPrice: 100 }, { userId: 'user-1' });
    localStorage.setItem('bookingProgress', '{}');
    localStorage.setItem('resumeBooking', '{}');
    localStorage.setItem('pending_checkout', '{}');
    localStorage.setItem('bookingDraft', '{}');
    sessionStorage.setItem('pending_checkout', '{}');

    clearBookingResumeStorage();

    expect(Object.keys(localStorage).filter((key) => key.startsWith('booking_resume_v1')).length).toBe(0);
    expect(localStorage.getItem('bookingProgress')).toBeNull();
    expect(localStorage.getItem('resumeBooking')).toBeNull();
    expect(localStorage.getItem('pending_checkout')).toBeNull();
    expect(localStorage.getItem('bookingDraft')).toBeNull();
    expect(sessionStorage.getItem('pending_checkout')).toBeNull();
  });
});
