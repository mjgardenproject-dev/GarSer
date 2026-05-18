import { describe, expect, it } from 'vitest';

import {
  BOOKING_PHOTO_CONTRACT_VERSION,
  buildBookingPhotoContract,
  extractBookingPhotoUrls,
  extractPreferredBookingPhotoUrls,
  serializeBookingPhotoContract,
  syncBookingPhotoContractWithLegacy,
} from './bookingPhotoContract';

describe('bookingPhotoContract', () => {
  it('construye el contrato canónico desde campos legacy y elimina duplicados', () => {
    const contract = buildBookingPhotoContract({
      uploadedPhotoUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg'],
      lawnZones: [{ photoUrls: ['https://cdn.example.com/b.jpg', 'blob:http://localhost/temp'] }],
      palmGroups: [{ photoUrl: 'https://cdn.example.com/c.jpg' }],
    });

    expect(contract.schemaVersion).toBe(BOOKING_PHOTO_CONTRACT_VERSION);
    expect(contract.items.map((item) => item.url)).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      'https://cdn.example.com/c.jpg',
    ]);
  });

  it('serializa referencias storage-first sin perder compatibilidad de urls', () => {
    const serialized = serializeBookingPhotoContract({
      schemaVersion: BOOKING_PHOTO_CONTRACT_VERSION,
      items: [
        {
          id: 'storage:booking-photos:path/to/file.jpg',
          storageBucket: 'booking-photos',
          storagePath: 'path/to/file.jpg',
        },
        {
          id: 'url:https://cdn.example.com/shared.jpg',
          url: 'https://cdn.example.com/shared.jpg',
        },
      ],
    });

    expect(serialized).toEqual([
      { storageBucket: 'booking-photos', storagePath: 'path/to/file.jpg', url: undefined },
      { url: 'https://cdn.example.com/shared.jpg', storageBucket: undefined, storagePath: undefined },
    ]);
  });

  it('rehidrata uploadedPhotoUrls legacy desde el contrato cuando faltan', () => {
    const normalized = syncBookingPhotoContractWithLegacy({
      bookingPhotoContract: {
        schemaVersion: BOOKING_PHOTO_CONTRACT_VERSION,
        items: [
          {
            id: 'url:https://cdn.example.com/a.jpg',
            url: 'https://cdn.example.com/a.jpg',
          },
        ],
      },
    });

    expect(normalized.uploadedPhotoUrls).toEqual(['https://cdn.example.com/a.jpg']);
    expect(extractBookingPhotoUrls(normalized.bookingPhotoContract)).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('prioriza el contrato canónico y solo conserva previews transitorias del array legacy', () => {
    const urls = extractPreferredBookingPhotoUrls(
      {
        bookingPhotoContract: {
          schemaVersion: BOOKING_PHOTO_CONTRACT_VERSION,
          items: [
            {
              id: 'storage:booking-photos:bookings/client-1/booking-1/a.jpg',
              url: 'https://cdn.example.com/a.jpg',
              storageBucket: 'booking-photos',
              storagePath: 'bookings/client-1/booking-1/a.jpg',
            },
          ],
        },
      },
      [
        'https://legacy.example.com/stale.jpg',
        'blob:http://localhost/local-preview',
        'data:image/jpeg;base64,abc123',
      ],
    );

    expect(urls).toEqual([
      'https://cdn.example.com/a.jpg',
      'blob:http://localhost/local-preview',
      'data:image/jpeg;base64,abc123',
    ]);
  });
});
