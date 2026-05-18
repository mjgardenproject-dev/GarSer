import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upsert = vi.fn();
  const deleteRows = vi.fn();
  const from = vi.fn(() => ({
    upsert,
    delete: deleteRows,
  }));
  const createSignedUrl = vi.fn();
  const storageFrom = vi.fn(() => ({
    createSignedUrl,
  }));
  const uploadBookingPhotoBatch = vi.fn();
  const buildBookingMediaPhotoUploadAdapter = vi.fn((params: any) => ({
    bucket: params.bucket || 'booking-photos',
    buildPath: () => 'ignored',
  }));
  const reportBookingEvent = vi.fn();

  return {
    upsert,
    deleteRows,
    from,
    createSignedUrl,
    storageFrom,
    uploadBookingPhotoBatch,
    buildBookingMediaPhotoUploadAdapter,
    reportBookingEvent,
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    storage: {
      from: mocks.storageFrom,
    },
  },
}));

vi.mock('./bookingPhotoPipeline', () => ({
  buildBookingMediaPhotoUploadAdapter: mocks.buildBookingMediaPhotoUploadAdapter,
  uploadBookingPhotoBatch: mocks.uploadBookingPhotoBatch,
}));

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}));

import {
  extractDefinitiveBookingMediaReferences,
  fetchBookingMediaMap,
  prepareBookingMediaForPersistence,
  persistBookingMedia,
} from './bookingMediaService';

describe('bookingMediaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      upsert: mocks.upsert,
      delete: mocks.deleteRows,
    });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.deleteRows.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({
      createSignedUrl: mocks.createSignedUrl,
    });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example.com/foto.jpg' },
      error: null,
    });
    mocks.uploadBookingPhotoBatch.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('conserva solo referencias definitivas de storage y elimina duplicados o borradores', () => {
    const result = extractDefinitiveBookingMediaReferences([
      { storageBucket: 'booking-photos', storagePath: 'bookings/client/booking-1/0_foto.jpg' },
      { storageBucket: 'booking-photos', storagePath: 'bookings/client/booking-1/0_foto.jpg' },
      { storageBucket: 'booking-photos', storagePath: 'drafts/client/temp.jpg' },
      { url: 'https://project.supabase.co/storage/v1/object/sign/booking-photos/drafts/client/temp.jpg?token=abc' },
      { url: 'https://cdn.example.com/shared.jpg' },
    ]);

    expect(result).toEqual([
      { storageBucket: 'booking-photos', storagePath: 'bookings/client/booking-1/0_foto.jpg' },
    ]);
  });

  it('persiste booking_media con upsert idempotente y sin urls transitorias', async () => {
    await persistBookingMedia({
      bookingId: 'booking-1',
      uploaderId: 'user-1',
      mediaItems: [
        { storageBucket: 'booking-photos', storagePath: 'bookings/client/booking-1/0_foto.jpg' },
        { storageBucket: 'booking-photos', storagePath: 'bookings/client/booking-1/0_foto.jpg' },
        { storageBucket: 'booking-photos', storagePath: 'drafts/client/temp.jpg' },
        { url: 'blob:http://localhost/temp' },
        { url: 'https://project.supabase.co/storage/v1/object/sign/booking-photos/drafts/client/temp.jpg?token=abc' },
      ],
    });

    expect(mocks.from).toHaveBeenCalledWith('booking_media');
    expect(mocks.upsert).toHaveBeenCalledWith(
      [
        {
          booking_id: 'booking-1',
          uploader_id: 'user-1',
          media_url: null,
          storage_bucket: 'booking-photos',
          storage_path: 'bookings/client/booking-1/0_foto.jpg',
          media_type: 'image',
        },
      ],
      {
        onConflict: 'booking_id,storage_bucket,storage_path',
        ignoreDuplicates: true,
      }
    );
  });

  it('reutiliza referencias definitivas del contrato sin re-subir archivos locales', async () => {
    const result = await prepareBookingMediaForPersistence({
      clientId: 'client-1',
      date: '2026-05-16',
      startHour: 9,
      bookingId: 'booking-1',
      localFiles: [new File(['img'], 'local.jpg', { type: 'image/jpeg' })],
      contractLike: {
        bookingPhotoContract: {
          schemaVersion: 'booking_photo_v1',
          items: [
            {
              id: 'storage:booking-photos:bookings/client-1/booking-1/0_local.jpg',
              storageBucket: 'booking-photos',
              storagePath: 'bookings/client-1/booking-1/0_local.jpg',
            },
          ],
        },
      },
    });

    expect(result).toEqual([
      {
        storageBucket: 'booking-photos',
        storagePath: 'bookings/client-1/booking-1/0_local.jpg',
      },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.uploadBookingPhotoBatch).not.toHaveBeenCalled();
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({
        event: 'booking.media_prepare_reused_contract_refs',
      }),
    );
  });

  it('promociona referencias draft del contrato al storage definitivo', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['img'], { type: 'image/jpeg' }),
    } as Response);
    mocks.uploadBookingPhotoBatch.mockResolvedValue([
      {
        uploadSucceeded: true,
        storageBucket: 'booking-photos',
        storagePath: 'bookings/client-1/booking-1/2026-05-16_9_0_foto.jpg',
      },
    ]);

    const result = await prepareBookingMediaForPersistence({
      clientId: 'client-1',
      date: '2026-05-16',
      startHour: 9,
      bookingId: 'booking-1',
      contractLike: {
        bookingPhotoContract: {
          schemaVersion: 'booking_photo_v1',
          items: [
            {
              id: 'storage:booking-photos:drafts/anon/1_foto.jpg',
              url: 'https://project.supabase.co/storage/v1/object/sign/booking-photos/drafts/anon/1_foto.jpg?token=abc',
              storageBucket: 'booking-photos',
              storagePath: 'drafts/anon/1_foto.jpg',
            },
          ],
        },
      },
      telemetryContext: { scope: 'test' },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.uploadBookingPhotoBatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        storageBucket: 'booking-photos',
        storagePath: 'bookings/client-1/booking-1/2026-05-16_9_0_foto.jpg',
      },
    ]);
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({
        event: 'booking.media_prepare_promoting_contract_refs',
      }),
    );
  });

  it('falla de forma explícita cuando el contrato no tiene fuente recuperable', async () => {
    await expect(
      prepareBookingMediaForPersistence({
        clientId: 'client-1',
        date: '2026-05-16',
        startHour: 9,
        bookingId: 'booking-1',
        contractLike: {
          bookingPhotoContract: {
            schemaVersion: 'booking_photo_v1',
            items: [
              {
                id: 'storage:booking-photos:drafts/anon/1_foto.jpg',
                storageBucket: 'booking-photos',
                storagePath: 'drafts/anon/1_foto.jpg',
              },
            ],
          },
        },
      }),
    ).rejects.toThrow('Las fotos adjuntas ya no tienen una referencia definitiva.');

    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.media_prepare_missing_contract_source',
      }),
    );
  });

  it('no reutiliza fallback legacy de notas cuando la reserva ya está completada y booking_media fue limpiado', async () => {
    mocks.from.mockReturnValue({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    } as any);

    const result = await fetchBookingMediaMap(
      ['booking-1'],
      { 'booking-1': 'Fotos antiguas: https://legacy.example.com/foto.jpg' },
      { statusByBooking: { 'booking-1': 'completed' } },
    );

    expect(result).toEqual({})
  });
});
