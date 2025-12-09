import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { MessageCircle, Calendar, Clock, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import ChatWindow from './ChatWindow';

interface ChatItem {
  booking_id: string;
  service_name: string;
  other_user_name: string;
  other_user_id: string;
  date: string;
  start_time: string;
  status: string;
  last_message?: string;
  last_message_time?: string;
  unread_count?: number;
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

const ChatList: React.FC = () => {
  const { user, profile } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    if (user) {
      fetchChats();
    }
  }, [user]);

  const fetchChats = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Obtener todas las reservas del usuario (como cliente o jardinero)
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          id,
          client_id,
          gardener_id,
          date,
          start_time,
          status,
          services(name)
        `)
        .or(`client_id.eq.${user.id},gardener_id.eq.${user.id}`)
        .in('status', ['confirmed', 'in_progress', 'completed'])
        .order('date', { ascending: false }) as { data: BookingWithProfiles[] | null; error: any };

      if (bookingsError) throw bookingsError;

      if (!bookings || bookings.length === 0) {
        setChats([]);
        return;
      }

      // Construir mapa de nombres de perfiles sin joins (no hay FK en schema)
      const uniqueUserIds = Array.from(new Set((bookings || []).flatMap(b => [b.client_id, b.gardener_id]).filter(Boolean)))
      let namesMap: Record<string, string> = {}
      if (uniqueUserIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', uniqueUserIds as string[])
        if (profilesError) throw profilesError
        namesMap = (profilesData || []).reduce<Record<string, string>>((acc, p: any) => {
          if (p?.id) acc[p.id] = p.full_name || ''
          return acc
        }, {})
      }

      // Para cada reserva, obtener el último mensaje
      const chatsWithMessages = await Promise.all(
        bookings.map(async (booking) => {
          // Determinar quién es el otro usuario
          const isClient = booking.client_id === user.id;
          const otherUserId = isClient ? booking.gardener_id : booking.client_id;
          const otherUserName = namesMap[otherUserId] || (isClient ? 'Jardinero' : 'Cliente');

          // Obtener el último mensaje
          const { data: lastMessage } = await supabase
            .from('chat_messages')
            .select('message, created_at, sender_id')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Contar mensajes no leídos (esto es una simplificación, en un sistema real necesitarías una tabla de lecturas)
          const { count: unreadCount } = await supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .neq('sender_id', user.id);

          return {
            booking_id: booking.id,
            service_name: booking.services?.name || 'Servicio',
            other_user_name: otherUserName,
            other_user_id: otherUserId,
            date: booking.date,
            start_time: booking.start_time,
            status: booking.status,
            last_message: lastMessage?.message || undefined,
            last_message_time: lastMessage?.created_at || undefined,
            unread_count: unreadCount || 0
          };
        })
      );

      setChats(chatsWithMessages);
    } catch (error) {
      console.error('Error fetching chats:', error);
    } finally {
      setLoading(false);
    }
  };

  const openChat = (chat: ChatItem) => {
    setSelectedChat(chat);
    setIsChatOpen(true);
  };

  const closeChat = () => {
    setIsChatOpen(false);
    setSelectedChat(null);
    // Refrescar la lista para actualizar contadores
    fetchChats();
  };

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
      case 'confirmed': return 'Confirmado';
      case 'in_progress': return 'En progreso';
      case 'completed': return 'Completado';
      default: return status;
    }
  };

  if (loading) {
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
    <div className="p-4 sm:p-8 overflow-x-hidden">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Mis Chats</h1>
        
        {chats.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes chats activos</h3>
            <p className="text-gray-600">
              Los chats aparecerán aquí cuando tengas reservas confirmadas.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {chats.map((chat) => (
              <div
                key={chat.booking_id}
                onClick={() => openChat(chat)}
                className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center mb-2">
                      <User className="w-5 h-5 text-gray-400 mr-2" />
                      <h3 className="font-semibold text-gray-900">{chat.other_user_name}</h3>
                      {chat.unread_count > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-1">
                          {chat.unread_count}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center text-sm text-gray-600 mb-2">
                      <span className="font-medium">{chat.service_name}</span>
                      <span className="mx-2">•</span>
                      <Calendar className="w-4 h-4 mr-1" />
                      <span>{format(parseISO(chat.date), 'dd/MM/yyyy', { locale: es })}</span>
                      <span className="mx-2">•</span>
                      <Clock className="w-4 h-4 mr-1" />
                      <span>{chat.start_time}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(chat.status)}`}>
                        {getStatusText(chat.status)}
                      </span>
                      
                      {chat.last_message && (
                        <div className="flex items-center text-sm text-gray-500 min-w-0 gap-2">
                          <span className="font-medium shrink-0">Último mensaje:</span>
                          <span className="truncate">
                            {chat.last_message}
                          </span>
                          {chat.last_message_time && (
                            <span className="shrink-0">
                              {format(parseISO(chat.last_message_time), 'dd/MM HH:mm', { locale: es })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <MessageCircle className="w-6 h-6 text-green-600 ml-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Window */}
      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.booking_id}
          isOpen={isChatOpen}
          onClose={closeChat}
          otherUserName={selectedChat.other_user_name}
        />
      )}
    </div>
  );
};

export default ChatList;
