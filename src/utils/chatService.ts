// Capa de servicio del chat de reservas.
//
// Separa el acceso a datos de la UI: paginación de mensajes, participantes con nombres
// precargados (nada de un query por mensaje), envío con imagen comprimida, cursores de
// lectura por usuario (tabla chat_thread_reads) y suscripciones Realtime.

import { supabase } from '../lib/supabase';
import { compressImage } from './imageCompression';

export type ChatMessageType = 'user' | 'system';

export interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string | null;
  message: string;
  message_type?: ChatMessageType | null;
  image_url?: string | null;
  created_at: string;
  /** Solo client-side: mensaje optimista aún sin confirmar por el servidor. */
  pending?: boolean;
}

export interface ChatParticipants {
  clientId: string;
  gardenerId: string;
  names: Record<string, string>;
}

export const CHAT_PAGE_SIZE = 50;

/** Página de mensajes más recientes anteriores a `before` (o el final del hilo). */
export async function fetchMessagesPage(
  bookingId: string,
  before?: string
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  let query = supabase
    .from('chat_messages')
    .select('id, booking_id, sender_id, message, message_type, image_url, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE + 1);
  if (before) {
    query = query.lt('created_at', before);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as ChatMessage[];
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows;
  return { messages: page.reverse(), hasMore };
}

/** Participantes del hilo con sus nombres, en 2 queries totales (no por mensaje). */
export async function fetchParticipants(bookingId: string): Promise<ChatParticipants | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('client_id, gardener_id')
    .eq('id', bookingId)
    .single();
  if (error || !booking) return null;

  const ids = [booking.client_id, booking.gardener_id].filter(Boolean) as string[];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    (profiles || []).forEach((p: { id: string; full_name: string | null }) => {
      if (p.id) names[p.id] = p.full_name || 'Usuario';
    });
  }
  return { clientId: booking.client_id, gardenerId: booking.gardener_id, names };
}

/** Sube la imagen (comprimida) al bucket de chat y devuelve su URL pública. */
async function uploadChatImage(bookingId: string, userId: string, file: File): Promise<string> {
  const bucket = (import.meta.env.VITE_CHAT_MEDIA_BUCKET as string | undefined) || 'booking-photos';
  const compressed = await compressImage(file);
  const safeName = (compressed.name || 'chat_image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `chat/${bookingId}/${userId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, compressed, { upsert: true, contentType: compressed.type || 'image/jpeg' });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('No se pudo obtener la URL de la imagen');
  return data.publicUrl;
}

/** Inserta un mensaje (con imagen opcional) y devuelve la fila creada. */
export async function sendChatMessage(params: {
  bookingId: string;
  senderId: string;
  text: string;
  imageFile?: File | null;
}): Promise<ChatMessage> {
  const { bookingId, senderId, text, imageFile } = params;
  let imageUrl: string | null = null;
  if (imageFile) {
    imageUrl = await uploadChatImage(bookingId, senderId, imageFile);
  }
  const content = text.trim() || (imageUrl ? 'Imagen' : '');
  const { data, error } = await supabase
    .from('chat_messages')
    .insert([{ booking_id: bookingId, sender_id: senderId, message: content, image_url: imageUrl }])
    .select('id, booking_id, sender_id, message, message_type, image_url, created_at')
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

/** Actualiza MI cursor de lectura del hilo a ahora (upsert). */
export async function markThreadRead(bookingId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_thread_reads')
    .upsert(
      { booking_id: bookingId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'booking_id,user_id' }
    );
  if (error) {
    // No romper el chat por un fallo de recibo de lectura
    console.warn('No se pudo actualizar el cursor de lectura:', error.message);
  }
}

/** Cursor de lectura del OTRO participante (para el recibo "Leído"). */
export async function fetchPeerReadCursor(bookingId: string, peerId: string): Promise<string | null> {
  const { data } = await supabase
    .from('chat_thread_reads')
    .select('last_read_at')
    .eq('booking_id', bookingId)
    .eq('user_id', peerId)
    .maybeSingle();
  return data?.last_read_at || null;
}

export interface ChatOverviewRow {
  booking_id: string;
  last_message: string | null;
  last_message_type: ChatMessageType | null;
  last_message_has_image: boolean | null;
  last_message_at: string | null;
  unread_count: number;
}

/** Último mensaje + nº de no leídos de todos los hilos del usuario en UNA llamada. */
export async function fetchChatOverview(): Promise<Record<string, ChatOverviewRow>> {
  const { data, error } = await supabase.rpc('chat_overview');
  if (error) {
    console.warn('chat_overview RPC no disponible:', error.message);
    return {};
  }
  const map: Record<string, ChatOverviewRow> = {};
  ((data || []) as ChatOverviewRow[]).forEach((row) => {
    map[row.booking_id] = { ...row, unread_count: Number(row.unread_count || 0) };
  });
  return map;
}

/** Suscripción Realtime de un hilo (mensajes nuevos + cursores de lectura). */
export function subscribeToThread(
  bookingId: string,
  handlers: {
    onMessage: (message: ChatMessage) => void;
    onReadCursorChange?: () => void;
    onStatusChange?: (connected: boolean) => void;
  }
): () => void {
  const channel = supabase
    .channel(`chat_${bookingId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `booking_id=eq.${bookingId}` },
      (payload: { new: ChatMessage }) => handlers.onMessage(payload.new)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_thread_reads', filter: `booking_id=eq.${bookingId}` },
      () => handlers.onReadCursorChange?.()
    )
    .subscribe((status) => {
      handlers.onStatusChange?.(status === 'SUBSCRIBED');
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
