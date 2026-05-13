import { supabase } from '../lib/supabase';

const URL_REGEX = /https?:\/\/[^\s,\n]+/g;

export function extractLegacyPhotoUrlsFromNotes(notes?: string | null): string[] {
  if (!notes) return [];
  const matches = notes.match(URL_REGEX) || [];
  return Array.from(new Set(matches.map((x) => x.trim()).filter(Boolean)));
}

export async function persistBookingMedia(params: {
  bookingId: string;
  uploaderId?: string | null;
  mediaUrls: string[];
}) {
  const uniqueUrls = Array.from(new Set((params.mediaUrls || []).map((u) => String(u || '').trim()).filter(Boolean)));
  if (uniqueUrls.length === 0) return;

  const rows = uniqueUrls.map((url) => ({
    booking_id: params.bookingId,
    uploader_id: params.uploaderId || null,
    media_url: url,
    media_type: 'image' as const,
  }));

  const { error } = await supabase.from('booking_media').insert(rows);
  if (error) throw error;
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
    .select('booking_id, media_url, created_at')
    .in('booking_id', validIds)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('No se pudo leer booking_media, usando fallback legacy de notas:', error.message || error);
  }

  if (!error && data) {
    data.forEach((row: any) => {
      const bookingId = String(row.booking_id || '');
      const mediaUrl = String(row.media_url || '').trim();
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
