import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Calendar, ArrowLeft, User, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import ChatWindow from './ChatWindow';
import { fetchChatOverview } from '../../utils/chatService';
import { fetchProfileNames } from '../../utils/profileNames';
import { fetchCurrentUserProfileRole } from '../../lib/adminAccess';
import { getBookingStatusLabel, getBookingStatusTone } from '../../shared/bookingStatus';
import { Star } from 'lucide-react';

interface ChatItem {
  booking_id: string;
  service_name: string;
  other_user_name: string;
  other_user_id: string;
  date: string;
  start_time: string;
  status: string;
  last_message?: string;
  last_message_is_system?: boolean;
  last_message_has_image?: boolean;
  last_message_time?: string;
  unread_count: number;
}

interface BookingWithProfiles {
  id: string;
  client_id: string;
  gardener_id: string;
  date: string;
  start_time: string;
  status: string;
  services?: {
    name: string;
  } | null;
}


// Hora si es de hoy; fecha corta si no
const lastMessageTimeLabel = (iso?: string) => {
  if (!iso) return '';
  const d = parseISO(iso);
  return isToday(d) ? format(d, 'HH:mm', { locale: es }) : format(d, 'dd/MM', { locale: es });
};

const ChatList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  /** Rol del usuario: decide a dónde lleva el acceso a reseñas desde el chat. */
  const [isGardener, setIsGardener] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    fetchCurrentUserProfileRole(user.id)
      .then((role) => { if (alive) setIsGardener(role === 'gardener'); })
      .catch(() => { /* sin rol: se trata como cliente, que es el caso mayoritario */ });
    return () => { alive = false; };
  }, [user?.id]);
  const knownBookingIdsRef = useRef<Set<string>>(new Set());

  const fetchChats = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!user) return;

    try {
      if (!opts.silent) setInitialLoading(true);

      // 3 queries totales para toda la lista: reservas + perfiles + overview (RPC)
      const [{ data: bookings, error: bookingsError }, overview] = await Promise.all([
        supabase
          .from('bookings')
          .select(`id, client_id, gardener_id, date, start_time, status, services(name)`)
          .or(`client_id.eq.${user.id},gardener_id.eq.${user.id}`)
          .in('status', ['pending', 'confirmed', 'completed'])
          .order('date', { ascending: false }) as unknown as Promise<{ data: BookingWithProfiles[] | null; error: unknown }>,
        fetchChatOverview(),
      ]);

      if (bookingsError) throw bookingsError;
      const rows = bookings || [];
      knownBookingIdsRef.current = new Set(rows.map((b) => b.id));

      const uniqueUserIds = Array.from(new Set(rows.flatMap(b => [b.client_id, b.gardener_id]).filter(Boolean)));
      let namesMap: Record<string, string> = {};
      if (uniqueUserIds.length > 0) {
        // Ver la nota de fetchProfileNames: por `id` no resolvia ninguno, asi que el chat
        // mostraba siempre el generico en vez del nombre de la otra parte.
        const profilesMap = await fetchProfileNames(uniqueUserIds as string[]);
        namesMap = Object.fromEntries(
          Object.entries(profilesMap).map(([id, profile]) => [id, profile.full_name || ''])
        );
      }

      const items: ChatItem[] = rows.map((booking) => {
        const isClient = booking.client_id === user.id;
        const otherUserId = isClient ? booking.gardener_id : booking.client_id;
        const info = overview[booking.id];
        return {
          booking_id: booking.id,
          service_name: booking.services?.name || 'Servicio',
          other_user_name: namesMap[otherUserId] || (isClient ? 'Jardinero' : 'Cliente'),
          other_user_id: otherUserId,
          date: booking.date,
          start_time: booking.start_time,
          status: booking.status,
          last_message: info?.last_message || undefined,
          last_message_is_system: info?.last_message_type === 'system',
          last_message_has_image: !!info?.last_message_has_image,
          last_message_time: info?.last_message_at || undefined,
          unread_count: info?.unread_count || 0,
        };
      });

      // Solo hilos con conversación (con los mensajes de sistema, toda reserva real la tiene)
      const activeChats = items
        .filter(chat => chat.status !== 'pending' || chat.last_message !== undefined)
        .sort((a, b) => (b.last_message_time || '').localeCompare(a.last_message_time || ''));

      setChats(activeChats);
    } catch (error) {
      console.error('Error fetching chats:', error);
    } finally {
      setInitialLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchChats();
  }, [user, fetchChats]);

  // Mensajes nuevos en cualquiera de mis hilos → refrescar la lista en sitio (sin spinner)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat_list_${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload: { new?: { booking_id?: string } }) => {
          const bookingId = payload?.new?.booking_id;
          if (bookingId && knownBookingIdsRef.current.has(bookingId)) {
            fetchChats({ silent: true });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchChats]);

  const closeChat = () => {
    setSelectedChat(null);
    // Contadores al día tras leer el hilo, sin parpadeo de página
    fetchChats({ silent: true });
  };

  if (initialLoading) {
    return (
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Mis Chats</h1>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Cargando chats...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6">
      <button
        onClick={() => navigate('/dashboard')}
        className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
        aria-label="Volver al Panel"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al Panel
      </button>

      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Mis Chats</h1>
        {/* Acceso a reseñas desde el chat, que es donde ambas partes siguen la conversación de
            un servicio: el cliente va a valorar, el profesional a leer y responder. */}
        <button
          type="button"
          onClick={() => {
            if (isGardener) {
              // El panel del jardinero recuerda la pestaña activa en localStorage.
              try { localStorage.setItem('gardener_active_tab', 'reviews'); } catch { /* sin persistencia, se abre el panel igualmente */ }
              navigate('/dashboard');
            } else {
              navigate('/bookings');
            }
          }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <Star className="w-4 h-4 text-yellow-500" aria-hidden="true" />
          Reseñas
        </button>
      </div>

      {chats.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes chats activos</h3>
          <p className="text-gray-600">
            Los chats aparecerán aquí cuando tengas reservas.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {chats.map((chat) => (
            <button
              key={chat.booking_id}
              onClick={() => setSelectedChat(chat)}
              className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0">
                  <User className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={`truncate ${chat.unread_count > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                      {chat.other_user_name}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-400">{lastMessageTimeLabel(chat.last_message_time)}</span>
                      {chat.unread_count > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 bg-green-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                          {chat.unread_count > 99 ? '99+' : chat.unread_count}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5 min-w-0">
                    <span className="truncate font-medium">{chat.service_name}</span>
                    <span aria-hidden>·</span>
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span className="shrink-0">{format(parseISO(chat.date), 'dd/MM', { locale: es })} {chat.start_time?.slice(0, 5)}</span>
                    <span className={`ml-auto shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getBookingStatusTone(chat.status)}`}>
                      {getBookingStatusLabel(chat.status, isGardener ? 'gardener' : 'client')}
                    </span>
                  </div>

                  {chat.last_message && (
                    <p className={`mt-1 text-sm truncate flex items-center gap-1 ${chat.unread_count > 0 ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                      {chat.last_message_has_image && <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
                      {chat.last_message_is_system ? <span className="italic">{chat.last_message}</span> : chat.last_message}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.booking_id}
          isOpen={!!selectedChat}
          onClose={closeChat}
          otherUserName={selectedChat.other_user_name}
        />
      )}
    </div>
  );
};

export default ChatList;
