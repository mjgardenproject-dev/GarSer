import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Calendar, ArrowLeft, User, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import ChatWindow from './ChatWindow';
import { fetchChatOverview } from '../../utils/chatService';

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

const getStatusColor = (status: string) => {
  switch (status) {
    case 'confirmed': return 'text-blue-600 bg-blue-100';
    case 'in_progress': return 'text-yellow-600 bg-yellow-100';
    case 'completed': return 'text-green-600 bg-green-100';
    default: return 'text-gray-600 bg-gray-100';
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'pending': return 'Pendiente';
    case 'confirmed': return 'Confirmado';
    case 'in_progress': return 'En progreso';
    case 'completed': return 'Completado';
    default: return status;
  }
};

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
          .in('status', ['pending', 'confirmed', 'in_progress', 'completed'])
          .order('date', { ascending: false }) as unknown as Promise<{ data: BookingWithProfiles[] | null; error: unknown }>,
        fetchChatOverview(),
      ]);

      if (bookingsError) throw bookingsError;
      const rows = bookings || [];
      knownBookingIdsRef.current = new Set(rows.map((b) => b.id));

      const uniqueUserIds = Array.from(new Set(rows.flatMap(b => [b.client_id, b.gardener_id]).filter(Boolean)));
      let namesMap: Record<string, string> = {};
      if (uniqueUserIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', uniqueUserIds as string[]);
        namesMap = (profilesData || []).reduce((acc: Record<string, string>, p: any) => {
          if (p?.id) acc[p.id] = p.full_name || '';
          return acc;
        }, {});
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

      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Mis Chats</h1>

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
                    <span className={`ml-auto shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(chat.status)}`}>
                      {getStatusText(chat.status)}
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
