import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, MapPin, MessageCircle, Star, Euro } from 'lucide-react';
import { Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import ChatWindow from '../chat/ChatWindow';

interface BookingWithDetails extends Booking {
  services?: {
    name: string;
    icon?: string;
  } | null;
  gardener_profile?: {
    user_id: string;
    full_name: string;
    phone?: string;
  } | null;
}

const BookingsList = () => {
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<{
    bookingId: string;
    gardenerName: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled'>('all');

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    fetchBookings();
  }, [user?.id, authLoading]);

  const fetchBookings = async () => {
    try {
      // Primero obtenemos las reservas básicas
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          services(name, icon)
        `)
        .eq('client_id', user?.id)
        .order('date', { ascending: false });

      if (bookingsError) throw bookingsError;

      // Luego obtenemos los perfiles de los jardineros
      if (bookingsData && bookingsData.length > 0) {
        const gardenerIds = [...new Set(bookingsData.map(booking => booking.gardener_id))];
        
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', gardenerIds);

        if (profilesError) throw profilesError;

        // Combinar los datos
        const bookingsWithProfiles = bookingsData.map(booking => ({
          ...booking,
          gardener_profile: profilesData?.find(profile => profile.user_id === booking.gardener_id) || null
        }));

        setBookings(bookingsWithProfiles);
      } else {
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'confirmed':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendiente';
      case 'confirmed':
        return 'Confirmado';
      case 'in_progress':
        return 'Confirmado';
      case 'completed':
        return 'Completado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return status;
    }
  };

  const openChat = (bookingId: string, gardenerName: string) => {
    setSelectedChat({ bookingId, gardenerName });
  };

  const filteredBookings = statusFilter === 'all' ? bookings : bookings.filter(b => b.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 sm:mb-8">Mis Reservas</h1>
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-gray-600">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="confirmed">Confirmado</option>
            <option value="completed">Completado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>

        {bookings.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">No tienes reservas aún</p>
            <p className="text-gray-500">¡Explora nuestros servicios y haz tu primera reserva!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredBookings.map((booking) => (
              <div key={booking.id} className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">
                        {booking.services?.name}
                      </h3>
                      <p className="text-gray-600">
                        Jardinero: {booking.gardener_profile?.full_name}
                      </p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(booking.status)}`}>
                    {getStatusText(booking.status)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="flex items-center text-gray-600">
                    <Calendar className="w-4 h-4 mr-2" />
                    {format(parseISO(booking.date), 'EEEE, d MMMM yyyy', { locale: es })}
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Clock className="w-4 h-4 mr-2" />
                    {booking.start_time} ({booking.duration_hours}h)
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Euro className="w-4 h-4 mr-2" />
                    €{booking.total_price}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-start text-gray-600">
                    <MapPin className="w-4 h-4 mr-2 mt-0.5" />
                    <span className="text-sm">{booking.client_address}</span>
                  </div>
                </div>

                {booking.notes && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Notas:</strong> {booking.notes}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                  <div className="text-sm text-gray-500">
                    Reservado el {format(parseISO(booking.created_at), 'd MMM yyyy', { locale: es })}
                  </div>
                  <div className="flex space-x-2">
                    {booking.status === 'confirmed' && (
                      <button
                        onClick={() => openChat(booking.id, booking.gardener_profile?.full_name || 'Jardinero')}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Chat
                      </button>
                    )}
                    {booking.status === 'completed' && (
                      <button className="flex items-center px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors">
                        <Star className="w-4 h-4 mr-2" />
                        Valorar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Window */}
      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.bookingId}
          isOpen={!!selectedChat}
          onClose={() => setSelectedChat(null)}
          otherUserName={selectedChat.gardenerName}
        />
      )}
    </div>
  );
};

export default BookingsList;