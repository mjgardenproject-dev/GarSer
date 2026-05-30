import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareBookingMediaForPersistence: vi.fn(),
  persistBookingMedia: vi.fn(),
  createAtomicBooking: vi.fn(),
  createBroadcastBookingRequests: vi.fn(),
  reportBookingEvent: vi.fn(),
}));

vi.mock('./bookingMediaService', () => ({
  prepareBookingMediaForPersistence: mocks.prepareBookingMediaForPersistence,
  persistBookingMedia: mocks.persistBookingMedia,
}));

vi.mock('./bookingAtomicService', () => ({
  createAtomicBooking: mocks.createAtomicBooking,
}));

vi.mock('./bookingRequestService', () => ({
  createBroadcastBookingRequests: mocks.createBroadcastBookingRequests,
}));

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}));

import { broadcastBookingRequest } from './bookingBroadcastService';

describe('bookingBroadcastService', () => {
  beforeEach(() => {
    mocks.prepareBookingMediaForPersistence.mockReset();
    mocks.persistBookingMedia.mockReset();
    mocks.createAtomicBooking.mockReset();
    mocks.createBroadcastBookingRequests.mockReset();
    mocks.reportBookingEvent.mockReset();
  });

  it('propaga el mismo operationId al flujo broadcast y persiste media en cada booking devuelto', async () => {
    const mediaItems = [{ storageBucket: 'booking-photos', storagePath: 'bookings/tmp/photo-1.jpg' }];
    mocks.prepareBookingMediaForPersistence.mockResolvedValueOnce(mediaItems);
    mocks.createBroadcastBookingRequests.mockResolvedValueOnce({
      status: 'pending',
      booking_ids: ['booking-1', 'booking-2'],
    });

    await broadcastBookingRequest({
      clientId: 'client-1',
      gardenerIds: ['gardener-1', 'gardener-2'],
      primaryServiceId: 'service-1',
      date: '2026-05-20',
      startHour: 9,
      durationHours: 2,
      clientAddress: 'Calle Mayor 1',
      totalPrice: 125,
      hourlyRate: 25,
      notes: 'Portero automatico',
      operationId: '11111111-1111-1111-1111-111111111111',
      photoFiles: [new File(['img'], 'foto.jpg', { type: 'image/jpeg' })],
    });

    expect(mocks.createAtomicBooking).not.toHaveBeenCalled();
    expect(mocks.createBroadcastBookingRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        gardenerIds: ['gardener-1', 'gardener-2'],
        operationId: '11111111-1111-1111-1111-111111111111',
      })
    );
    expect(mocks.persistBookingMedia).toHaveBeenCalledTimes(2);
    expect(mocks.persistBookingMedia).toHaveBeenNthCalledWith(1, {
      bookingId: 'booking-1',
      uploaderId: 'client-1',
      mediaItems,
    });
    expect(mocks.persistBookingMedia).toHaveBeenNthCalledWith(2, {
      bookingId: 'booking-2',
      uploaderId: 'client-1',
      mediaItems,
    });
  });

  it('usa createAtomicBooking en single-provider y reutiliza el operationId compartido', async () => {
    const mediaItems = [{ storageBucket: 'booking-photos', storagePath: 'bookings/final/photo-1.jpg' }];
    mocks.prepareBookingMediaForPersistence.mockResolvedValueOnce(mediaItems);
    mocks.createAtomicBooking.mockResolvedValueOnce({
      booking_id: 'booking-single',
      status: 'pending',
      date: '2026-05-20',
      start_time: '09:00:00',
      duration_hours: 2,
    });

    await broadcastBookingRequest({
      clientId: 'client-1',
      gardenerIds: ['gardener-1'],
      primaryServiceId: 'service-1',
      date: '2026-05-20',
      startHour: 9,
      durationHours: 2,
      clientAddress: 'Calle Mayor 1',
      totalPrice: 125,
      operationId: '22222222-2222-2222-2222-222222222222',
      photoFiles: [new File(['img'], 'foto.jpg', { type: 'image/jpeg' })],
    });

    expect(mocks.createBroadcastBookingRequests).not.toHaveBeenCalled();
    expect(mocks.createAtomicBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'gardener-1',
        operationId: '22222222-2222-2222-2222-222222222222',
      })
    );
    expect(mocks.persistBookingMedia).toHaveBeenCalledWith({
      bookingId: 'booking-single',
      uploaderId: 'client-1',
      mediaItems,
    });
  });
});
