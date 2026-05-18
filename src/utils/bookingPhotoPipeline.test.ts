import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const createSignedUrl = vi.fn();
  const getUser = vi.fn();
  const from = vi.fn(() => ({
    upload,
    createSignedUrl,
  }));

  return {
    upload,
    createSignedUrl,
    getUser,
    from,
    compressImage: vi.fn(async (file: File) => file),
    validateImageLocal: vi.fn(async () => ({ isValid: true })),
    reportBookingEvent: vi.fn(),
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mocks.getUser,
    },
    storage: {
      from: mocks.from,
    },
  },
}));

vi.mock('./imageCompressor', () => ({
  compressImage: mocks.compressImage,
}));

vi.mock('./imageValidator', () => ({
  validateImageLocal: mocks.validateImageLocal,
}));

vi.mock('./bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}));

import {
  buildBookingMediaPhotoUploadAdapter,
  buildDraftBookingPhotoUploadAdapter,
  resolveAnalysisPhotoSources,
  uploadBookingPhotoBatch,
  uploadCurrentUserDraftBookingPhotos,
  validateBookingPhotoSelection,
} from './bookingPhotoPipeline';

describe('bookingPhotoPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      upload: mocks.upload,
      createSignedUrl: mocks.createSignedUrl,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'client-123' } },
      error: null,
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example.com/photo.jpg' }, error: null });
    mocks.validateImageLocal.mockResolvedValue({ isValid: true });
  });

  it('valida seleccion de fotos y rechaza tipos no soportados o exceso de limite', async () => {
    const files = [
      new File(['a'], 'uno.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'dos.txt', { type: 'text/plain' }),
      new File(['c'], 'tres.jpg', { type: 'image/jpeg' }),
    ];

    const result = await validateBookingPhotoSelection({
      files,
      existingCount: 4,
      maxTotalPhotos: 5,
    });

    expect(result.acceptedFiles).toHaveLength(1);
    expect(result.rejectedFiles.map((item) => item.code)).toEqual(['UNSUPPORTED_TYPE', 'LIMIT_EXCEEDED']);
  });

  it('reintenta la subida y devuelve signed url para borradores', async () => {
    mocks.upload
      .mockResolvedValueOnce({ error: new Error('transient') })
      .mockResolvedValueOnce({ error: null });

    const [result] = await uploadBookingPhotoBatch({
      files: [new File(['img'], 'foto.jpg', { type: 'image/jpeg' })],
      adapter: buildDraftBookingPhotoUploadAdapter({ clientId: 'client-123' }),
      telemetryContext: { scope: 'test' },
    });

    expect(result.ok).toBe(true);
    expect(result.uploadSucceeded).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.url).toBe('https://signed.example.com/photo.jpg');
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.photo_upload_retry',
        context: expect.objectContaining({
          phase: 'upload',
          status: 'retry',
          scope: 'test',
        }),
      })
    );
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({
        event: 'booking.photo_upload_succeeded',
        context: expect.objectContaining({
          phase: 'upload',
          status: 'succeeded',
          scope: 'test',
        }),
      })
    );
  });

  it('genera rutas finales deterministas cuando recibe bookingId u operationId', () => {
    const file = new File(['img'], 'Foto Final.jpg', { type: 'image/jpeg' });

    const bookingAdapter = buildBookingMediaPhotoUploadAdapter({
      clientId: 'client-123',
      date: '2026-05-16',
      startHour: 9,
      bookingId: 'booking-1',
    });

    const operationAdapter = buildBookingMediaPhotoUploadAdapter({
      clientId: 'client-123',
      date: '2026-05-16',
      startHour: 9,
      operationId: 'operation-1',
    });

    expect(
      bookingAdapter.buildPath({
        file,
        index: 0,
        now: 123456789,
        safeName: 'foto_final.jpg',
      })
    ).toBe('bookings/client-123/booking-1/2026-05-16_9_0_foto_final.jpg');

    expect(
      operationAdapter.buildPath({
        file,
        index: 1,
        now: 987654321,
        safeName: 'foto_final.jpg',
      })
    ).toBe('bookings/client-123/operations/operation-1/2026-05-16_9_1_foto_final.jpg');
  });

  it('falla de forma explícita cuando no hay usuario autenticado y el fallback anónimo está desactivado', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const [result] = await uploadCurrentUserDraftBookingPhotos({
      files: [new File(['img'], 'foto.jpg', { type: 'image/jpeg' })],
      startIndex: 3,
      telemetryContext: { scope: 'test-no-user' },
    });

    expect(result.ok).toBe(false);
    expect(result.uploadSucceeded).toBe(false);
    expect(result.index).toBe(3);
    expect(result.errorMessage).toContain('No hay un usuario autenticado');
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.photo_upload_skipped_missing_user',
      })
    );
  });

  it('emite telemetría cuando la validación previa impide subir una foto', async () => {
    mocks.validateImageLocal.mockResolvedValue({
      isValid: false,
      reason: 'TOO_DARK',
      details: 'too dark',
    });

    const [result] = await uploadBookingPhotoBatch({
      files: [new File(['img'], 'oscura.jpg', { type: 'image/jpeg' })],
      adapter: buildDraftBookingPhotoUploadAdapter({ clientId: 'client-123' }),
      validateBeforeUpload: true,
    });

    expect(result.ok).toBe(false);
    expect(result.uploadSucceeded).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.photo_upload_validation_failed',
        context: expect.objectContaining({
          phase: 'upload',
          status: 'failed',
          errorType: 'photo_upload_error',
          reason: 'TOO_DARK',
        }),
      })
    );
  });

  it('resuelve fuentes de análisis y traza faltantes o conversiones fallidas', async () => {
    const readerError = new Error('FILE_READER_FAILED');
    const file = new File(['img'], 'local.jpg', { type: 'image/jpeg' });
    const realFileReader = globalThis.FileReader;

    class BrokenFileReader {
      result: string | null = null;
      error = readerError;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      readAsDataURL() {
        this.onerror?.();
      }
    }

    vi.stubGlobal('FileReader', BrokenFileReader as unknown as typeof FileReader);

    const sources = await resolveAnalysisPhotoSources({
      photoUrls: ['https://cdn.example.com/1.jpg', 'blob:http://localhost/temp', ''],
      selectedIndices: [0, 1, 2],
      files: [undefined as unknown as File, file, undefined as unknown as File],
    });

    expect(sources).toEqual(['https://cdn.example.com/1.jpg']);
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.photo_analysis_source_failed',
        context: expect.objectContaining({
          phase: 'analysis_source',
          status: 'failed',
          index: 1,
        }),
      })
    );
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({
        event: 'booking.photo_analysis_source_missing',
        context: expect.objectContaining({
          phase: 'analysis_source',
          status: 'missing',
          index: 2,
        }),
      })
    );
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith(
      'info',
      expect.objectContaining({
        event: 'booking.photo_analysis_source_resolved',
        context: expect.objectContaining({
          phase: 'analysis_source',
          status: 'resolved',
          requestedCount: 3,
          resolvedCount: 1,
          remoteSourceCount: 1,
          fileSourceCount: 0,
          missingSourceCount: 1,
        }),
      })
    );

    vi.stubGlobal('FileReader', realFileReader);
  });
});
