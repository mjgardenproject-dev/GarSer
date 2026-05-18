import { supabase } from '../lib/supabase';
import {
  buildBookingPhotoContract,
  extractBookingPhotoUrls,
  serializeBookingPhotoContract,
} from './bookingPhotoContract';
import { reportBookingEvent } from './bookingTelemetry';
import {
  buildBookingMediaPhotoUploadAdapter,
  uploadBookingPhotoBatch,
} from './bookingPhotoPipeline';

const URL_REGEX = /https?:\/\/[^\s,\n]+/g;
const DEFAULT_BOOKING_MEDIA_BUCKET = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
const DRAFT_STORAGE_PREFIX = 'drafts/';

export interface BookingMediaReference {
  url?: string;
  storageBucket?: string;
  storagePath?: string;
}

interface PrepareBookingMediaForPersistenceParams {
  clientId: string;
  date: string;
  startHour: number;
  bucket?: string;
  bookingId?: string;
  operationId?: string;
  localFiles?: File[];
  contractLike?: unknown;
  telemetryContext?: Record<string, unknown>;
}

function normalizeText(value: unknown): string | undefined {
  const candidate = String(value || '').trim();
  return candidate ? candidate : undefined;
}

function isDefinitiveBookingStoragePath(storagePath?: string): storagePath is string {
  return Boolean(storagePath) && !String(storagePath).trim().toLowerCase().startsWith(DRAFT_STORAGE_PREFIX);
}

function getBookingMediaReferenceFileName(item: BookingMediaReference, index: number): string {
  const storagePath = normalizeText(item.storagePath);
  if (storagePath) {
    const candidate = storagePath.split('/').pop();
    if (candidate) return candidate;
  }

  const url = normalizeText(item.url);
  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const candidate = pathname.split('/').pop();
      if (candidate) return candidate;
    } catch {
      // Fall through to the default filename.
    }
  }

  return `booking_photo_${index}.jpg`;
}

async function materializeBookingMediaReferenceAsFile(
  item: BookingMediaReference,
  index: number,
): Promise<File> {
  const url = normalizeText(item.url);
  if (!url) {
    throw new Error('Las fotos adjuntas ya no tienen una URL utilizable para recuperarse.');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo recuperar una foto adjunta (${response.status}).`);
  }

  const blob = await response.blob();
  return new File([blob], getBookingMediaReferenceFileName(item, index), {
    type: blob.type || 'image/jpeg',
  });
}

export function extractDefinitiveBookingMediaReferences(
  mediaItems: BookingMediaReference[],
): Array<Required<Pick<BookingMediaReference, 'storageBucket' | 'storagePath'>>> {
  const uniqueItems = new Map<string, Required<Pick<BookingMediaReference, 'storageBucket' | 'storagePath'>>>();

  for (const item of mediaItems) {
    const storageBucket = normalizeText(item.storageBucket);
    const storagePath = normalizeText(item.storagePath);

    if (!storageBucket || !isDefinitiveBookingStoragePath(storagePath)) {
      continue;
    }

    uniqueItems.set(`storage:${storageBucket}:${storagePath}`, {
      storageBucket,
      storagePath,
    });
  }

  return Array.from(uniqueItems.values());
}

export function extractLegacyPhotoUrlsFromNotes(notes?: string | null): string[] {
  if (!notes) return [];
  const matches = notes.match(URL_REGEX) || [];
  return Array.from(new Set(matches.map((x) => x.trim()).filter(Boolean)));
}

export async function persistBookingMedia(params: {
  bookingId: string;
  uploaderId?: string | null;
  mediaUrls?: string[];
  mediaItems?: BookingMediaReference[];
}) {
  const definitiveMediaItems = extractDefinitiveBookingMediaReferences(
    serializeBookingPhotoContract(
    buildBookingPhotoContract(params.mediaItems || [], params.mediaUrls || [])
    )
  );

  if (definitiveMediaItems.length === 0) return;

  const rows = definitiveMediaItems.map((item) => ({
    booking_id: params.bookingId,
    uploader_id: params.uploaderId || null,
    media_url: null,
    storage_bucket: item.storageBucket,
    storage_path: item.storagePath,
    media_type: 'image' as const,
  }));

  const { error } = await supabase.from('booking_media').upsert(rows, {
    onConflict: 'booking_id,storage_bucket,storage_path',
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

export async function prepareBookingMediaForPersistence(
  params: PrepareBookingMediaForPersistenceParams,
): Promise<BookingMediaReference[]> {
  const contract = buildBookingPhotoContract(params.contractLike);
  const definitiveContractRefs = extractDefinitiveBookingMediaReferences(
    serializeBookingPhotoContract(contract),
  );

  if (contract.items.length > 0 && definitiveContractRefs.length === contract.items.length) {
    reportBookingEvent('info', {
      event: 'booking.media_prepare_reused_contract_refs',
      context: {
        count: definitiveContractRefs.length,
        ...params.telemetryContext,
      },
    });
    return definitiveContractRefs;
  }

  const contractRefsToPromote = contract.items.filter((item) => {
    const storageBucket = normalizeText(item.storageBucket);
    const storagePath = normalizeText(item.storagePath);
    return !(storageBucket && isDefinitiveBookingStoragePath(storagePath));
  });

  let filesToUpload: File[] = [];

  if (contractRefsToPromote.length > 0) {
    const missingSourceCount = contractRefsToPromote.filter((item) => !normalizeText(item.url)).length;
    if (missingSourceCount > 0) {
      reportBookingEvent('warn', {
        event: 'booking.media_prepare_missing_contract_source',
        context: {
          missingSourceCount,
          contractItemCount: contract.items.length,
          ...params.telemetryContext,
        },
      });
      throw new Error('Las fotos adjuntas ya no tienen una referencia definitiva. Vuelve al paso anterior y subelas otra vez antes de confirmar.');
    }

    try {
      filesToUpload = await Promise.all(
        contractRefsToPromote.map((item, index) => materializeBookingMediaReferenceAsFile(item, index)),
      );
    } catch (error) {
      reportBookingEvent('error', {
        event: 'booking.media_prepare_reference_fetch_failed',
        context: {
          contractItemCount: contract.items.length,
          message: error instanceof Error ? error.message : 'unknown',
          ...params.telemetryContext,
        },
      });
      throw error;
    }

    reportBookingEvent('info', {
      event: 'booking.media_prepare_promoting_contract_refs',
      context: {
        count: filesToUpload.length,
        ...params.telemetryContext,
      },
    });
  } else if ((params.localFiles || []).length > 0) {
    filesToUpload = params.localFiles || [];
    reportBookingEvent('info', {
      event: 'booking.media_prepare_uploading_local_files',
      context: {
        count: filesToUpload.length,
        ...params.telemetryContext,
      },
    });
  }

  const uploadedRefs =
    filesToUpload.length > 0
      ? await uploadBookingPhotos({
          clientId: params.clientId,
          date: params.date,
          startHour: params.startHour,
          files: filesToUpload,
          bucket: params.bucket,
          bookingId: params.bookingId,
          operationId: params.operationId,
        })
      : [];

  const definitiveRefs = extractDefinitiveBookingMediaReferences([
    ...definitiveContractRefs,
    ...uploadedRefs,
  ]);

  if (
    definitiveRefs.length === 0 &&
    (contract.items.length > 0 || (params.localFiles || []).length > 0)
  ) {
    reportBookingEvent('warn', {
      event: 'booking.media_prepare_empty_result',
      context: {
        contractItemCount: contract.items.length,
        localFileCount: params.localFiles?.length || 0,
        ...params.telemetryContext,
      },
    });
    throw new Error('Las fotos adjuntas ya no tienen una referencia definitiva. Vuelve al paso anterior y subelas otra vez antes de confirmar.');
  }

  return definitiveRefs;
}

export async function uploadBookingPhotos(params: {
  clientId: string;
  date: string;
  startHour: number;
  files: File[];
  bucket?: string;
  bookingId?: string;
  operationId?: string;
}): Promise<BookingMediaReference[]> {
  const results = await uploadBookingPhotoBatch({
    files: params.files || [],
    adapter: buildBookingMediaPhotoUploadAdapter({
      clientId: params.clientId,
      date: params.date,
      startHour: params.startHour,
      bucket: params.bucket || DEFAULT_BOOKING_MEDIA_BUCKET,
      bookingId: params.bookingId,
      operationId: params.operationId,
    }),
    telemetryContext: {
      scope: 'booking_media_service',
      clientId: params.clientId,
      date: params.date,
      startHour: params.startHour,
      bookingId: params.bookingId,
      operationId: params.operationId,
    },
  });

  return results.flatMap((result) =>
    result.uploadSucceeded && result.storageBucket && result.storagePath
      ? [
          {
            storageBucket: result.storageBucket,
            storagePath: result.storagePath,
          } satisfies BookingMediaReference,
        ]
      : []
  );
}

export async function fetchBookingMediaMap(
  bookingIds: string[],
  legacyNotesByBooking?: Record<string, string | undefined | null>,
  options?: {
    statusByBooking?: Record<string, string | undefined | null>
  }
): Promise<Record<string, string[]>> {
  const validIds = Array.from(new Set((bookingIds || []).filter(Boolean)));
  if (validIds.length === 0) return {};

  const map: Record<string, string[]> = {};
  const completedBookingIds = new Set(
    Object.entries(options?.statusByBooking || {})
      .filter(([, status]) => String(status || '').trim() === 'completed')
      .map(([bookingId]) => bookingId)
  );
  const { data, error } = await supabase
    .from('booking_media')
    .select('booking_id, media_url, storage_bucket, storage_path, created_at')
    .in('booking_id', validIds)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('No se pudo leer booking_media, usando fallback legacy de notas:', error.message || error);
  }

  if (!error && data) {
    const signedRefs = await Promise.allSettled(
      data.map(async (row: any) => {
        const storageBucket = String(row.storage_bucket || '').trim();
        const storagePath = String(row.storage_path || '').trim();
        if (!storageBucket || !storagePath) {
          return { bookingId: String(row.booking_id || ''), url: String(row.media_url || '').trim() };
        }

        const { data: signed, error: signedError } = await supabase.storage
          .from(storageBucket)
          .createSignedUrl(storagePath, 60 * 60);

        if (signedError || !signed?.signedUrl) {
          return { bookingId: String(row.booking_id || ''), url: String(row.media_url || '').trim() };
        }

        return { bookingId: String(row.booking_id || ''), url: signed.signedUrl };
      })
    );

    signedRefs.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const row = result.value;
      const bookingId = String(row.bookingId || '');
      const mediaUrl = String(row.url || '').trim();
      if (!bookingId || !mediaUrl) return;
      if (!map[bookingId]) map[bookingId] = [];
      if (!map[bookingId].includes(mediaUrl)) map[bookingId].push(mediaUrl);
    });
  }

  if (legacyNotesByBooking) {
    Object.entries(legacyNotesByBooking).forEach(([bookingId, notes]) => {
      if (completedBookingIds.has(bookingId)) return;
      const legacyUrls = extractLegacyPhotoUrlsFromNotes(notes);
      if (!map[bookingId]) map[bookingId] = [];
      legacyUrls.forEach((url) => {
        if (!map[bookingId].includes(url)) map[bookingId].push(url);
      });
    });
  }

  return Object.fromEntries(
    Object.entries(map).map(([bookingId, urls]) => [bookingId, extractBookingPhotoUrls(buildBookingPhotoContract(urls))])
  );
}
