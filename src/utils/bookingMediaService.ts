import { supabase } from '../lib/supabase';

const URL_REGEX = /https?:\/\/[^\s,\n]+/g;
const DEFAULT_BOOKING_MEDIA_BUCKET = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';

export interface BookingMediaReference {
  url?: string;
  storageBucket?: string;
  storagePath?: string;
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
  const mediaItems = Array.from(
    new Map(
      ((params.mediaItems || []).concat((params.mediaUrls || []).map((url) => ({ url }))))
        .map((item) => {
          const normalized: BookingMediaReference = {
            url: item.url ? String(item.url).trim() : undefined,
            storageBucket: item.storageBucket ? String(item.storageBucket).trim() : undefined,
            storagePath: item.storagePath ? String(item.storagePath).trim() : undefined,
          };
          const dedupeKey = normalized.storageBucket && normalized.storagePath
            ? `${normalized.storageBucket}:${normalized.storagePath}`
            : normalized.url || '';
          return [dedupeKey, normalized] as const;
        })
        .filter(([key]) => Boolean(key))
    ).values()
  );

  if (mediaItems.length === 0) return;

  const rows = mediaItems.map((item) => ({
    booking_id: params.bookingId,
    uploader_id: params.uploaderId || null,
    media_url: item.url || '',
    storage_bucket: item.storageBucket || null,
    storage_path: item.storagePath || null,
    media_type: 'image' as const,
  }));

  const { error } = await supabase.from('booking_media').insert(rows);
  if (error) throw error;
}

export async function uploadBookingPhotos(params: {
  clientId: string;
  date: string;
  startHour: number;
  files: File[];
  bucket?: string;
}): Promise<BookingMediaReference[]> {
  const bucket = params.bucket || DEFAULT_BOOKING_MEDIA_BUCKET;
  const now = Date.now();
  const sanitizeFileName = (name: string) =>
    String(name || 'foto.jpg')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._-]/g, '_');

  const results = await Promise.allSettled(
    (params.files || []).map(async (file, index) => {
      const safeName = sanitizeFileName(file.name || `foto_${index}.jpg`);
      const path = `bookings/${params.clientId}/${params.date}_${params.startHour}_${now}_${index}_${safeName}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });

      if (error) {
        throw error;
      }

      return {
        storageBucket: bucket,
        storagePath: path,
      } satisfies BookingMediaReference;
    })
  );

  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

export async function fetchBookingMediaMap(
  bookingIds: string[],
  legacyNotesByBooking?: Record<string, string | undefined | null>
): Promise<Record<string, string[]>> {
  const validIds = Array.from(new Set((bookingIds || []).filter(Boolean)));
  if (validIds.length === 0) return {};

  const map: Record<string, string[]> = {};
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
      const legacyUrls = extractLegacyPhotoUrlsFromNotes(notes);
      if (!map[bookingId]) map[bookingId] = [];
      legacyUrls.forEach((url) => {
        if (!map[bookingId].includes(url)) map[bookingId].push(url);
      });
    });
  }

  return map;
}
