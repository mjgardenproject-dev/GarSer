import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Star, MapPin, Clock, Settings, User, Briefcase, MessageCircle, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GardenerProfile, Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import AvailabilityManager from './AvailabilityManager';
import ProfileSettings from './ProfileSettings';
import ChatWindow from '../chat/ChatWindow';
import BookingRequestsManager from './BookingRequestsManager';

interface GardenerDashboardProps {
  pending?: boolean;
}

const GardenerDashboard: React.FC<GardenerDashboardProps> = ({ pending = false }) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Evitar bloquear toda la UI: estado de carga sólo para reservas
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const isFetchingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'availability' | 'profile'>('dashboard');
  const [selectedChat, setSelectedChat] = useState<{
    bookingId: string;
    clientName: string;
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    console.log('📥 GardenerDashboard: fetching bookings for gardener_id=', user.id);
    fetchBookings();
  }, [user?.id, authLoading]);

  // El perfil de jardinero se gestiona dentro de ProfileSettings de forma perezosa.

  const fetchBookings = async () => {
    if (isFetchingRef.current) {
      console.log('⏳ fetchBookings: ya en curso, evitando paralelo');
      return;
    }
    isFetchingRef.current = true;
    setBookingsLoading(true);
    console.log('🔎 fetchBookings: start');
    try {
      // Verificar sesión antes de consultar
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.error('❌ fetchBookings: error obteniendo sesión', sessionError);
      }
      // En ocasiones tras F5 el token tarda unos milisegundos en estar disponible.
      // Esperar brevemente y reintentar obtenerlo, pero NO abortar la carga.
      let accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        console.warn('⚠️ fetchBookings: token de sesión no listo aún, esperando...');
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 200));
          const { data: retry } = await supabase.auth.getSession();
          accessToken = retry?.session?.access_token;
          if (accessToken) {
            console.log('✅ fetchBookings: token disponible tras espera breve');
            break;
          }
        }
        if (!accessToken) {
          console.warn('⚠️ fetchBookings: token aún no disponible, continuando igualmente');
        }
      }

      // Helper para timeout de seguridad
      const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout en petición de reservas')), ms))
        ]) as Promise<T>;
      };

      // Primero obtenemos las reservas básicas
      const { data: bookingsData, error: bookingsError } = await withTimeout(
        supabase
        .from('bookings')
        .select(`
          *,
          services(name)
        `)
        .eq('gardener_id', user?.id)
        .order('date', { ascending: true })
        , 10000);

      if (bookingsError) {
        console.error('❌ fetchBookings error:', bookingsError);
        throw bookingsError;
      }

      // Luego obtenemos los perfiles de los clientes
      if (bookingsData && bookingsData.length > 0) {
        const clientIds = [...new Set(bookingsData.map(booking => booking.client_id))];
        
        const { data: profilesData, error: profilesError } = await withTimeout(
          supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', clientIds)
          , 10000);

        if (profilesError) {
          console.error('❌ fetchBookings profiles error:', profilesError);
          throw profilesError;
        }

        // Combinar los datos
        const bookingsWithProfiles = bookingsData.map(booking => ({
          ...booking,
          client_profile: profilesData?.find(profile => profile.user_id === booking.client_id) || null
        }));

        console.log('✅ fetchBookings: bookings count', bookingsWithProfiles.length);
        setBookings(bookingsWithProfiles);
      } else {
        console.log('ℹ️ fetchBookings: no bookings');
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      console.log('🔚 fetchBookings: end');
      setBookingsLoading(false);
      isFetchingRef.current = false;
    }
  };

  const updateBookingStatus = async (bookingId: string, status: string) => {
    try {
      // Obtener información de la reserva antes de actualizarla
      const booking = bookings.find(b => b.id === bookingId);
      if (!booking) return;

      const { error } = await supabase
        .from('bookings')
        .update({ status })
        .eq('id', bookingId);

      if (error) throw error;

      // Enviar mensaje automático según el estado
      let message = '';
      if (status === 'confirmed') {
        message = `¡Excelente! He confirmado tu reserva para el ${format(parseISO(booking.date), 'dd/MM/yyyy', { locale: es })} a las ${booking.start_time}. Estaré allí puntualmente. ¡Nos vemos pronto!`;
      } else if (status === 'cancelled') {
        message = `Lamento informarte que no podré realizar el servicio solicitado para el ${format(parseISO(booking.date), 'dd/MM/yyyy', { locale: es })}. Disculpa las molestias.`;
      }

      if (message) {
        await supabase
          .from('chat_messages')
          .insert([
            {
              booking_id: bookingId,
              sender_id: user?.id,
              message: message
            }
          ]);
      }
      
      // Refresh bookings
      fetchBookings();
    } catch (error) {
      console.error('Error updating booking status:', error);
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

  const openChat = (bookingId: string, clientName: string) => {
    setSelectedChat({ bookingId, clientName });
  };

  // Barra de pestañas eliminada: mantenemos la lógica de activeTab y los botones del panel

  return (
    <div className="max-w-full sm:max-w-7xl mx-auto p-3 sm:p-6">
      {/* Barra de pestañas superior eliminada. La navegación se realiza con los botones del panel. */}

      {/* Tab Content */}
      {activeTab === 'dashboard' && (
        <>
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                  Panel de Jardinero
                </h1>
                <p className="text-gray-600">Gestiona tus servicios y reservas</p>
              </div>
            </div>

            {pending && (
              <div className="mt-4 p-4 border border-yellow-200 bg-yellow-50 rounded-xl text-yellow-800">
                <div className="flex items-center gap-3">
                  <Clock className="w-6 h-6" />
                  <div>
                    <div className="font-semibold">Tu solicitud de jardinero está en revisión</div>
                    <div className="text-sm">Has solicitado ser jardinero. Revisaremos tus datos y activaremos tu cuenta profesional en breve. Mientras tanto, este panel está bloqueado.</div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-4">
              <button
                onClick={pending ? undefined : () => setActiveTab('requests')}
                className={`flex items-center justify-center gap-2 p-4 sm:p-5 rounded-xl border-2 border-gray-200 bg-white ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 hover:shadow'} transition-colors`}
                aria-label="Ir a Solicitudes"
                disabled={pending}
              >
                <Bell className="w-7 h-7 text-green-600 shrink-0" strokeWidth={2.25} />
                <span className="text-sm sm:text-base font-semibold text-gray-800 whitespace-nowrap">Solicitudes</span>
              </button>
              <button
                onClick={pending ? undefined : () => setActiveTab('availability')}
                className={`flex items-center justify-center gap-2 p-4 sm:p-5 rounded-xl border-2 border-gray-200 bg-white ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 hover:shadow'} transition-colors`}
                aria-label="Ir a Disponibilidad"
                disabled={pending}
              >
                <Clock className="w-7 h-7 text-green-600 shrink-0" strokeWidth={2.25} />
                <span className="text-sm sm:text-base font-semibold text-gray-800 whitespace-nowrap">Disponibilidad</span>
              </button>
              <button
                onClick={pending ? undefined : () => setActiveTab('profile')}
                className={`flex items-center justify-center gap-2 p-4 sm:p-5 rounded-xl border-2 border-gray-200 bg-white ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 hover:shadow'} transition-colors`}
                aria-label="Ir a Mi Perfil"
                disabled={pending}
              >
                <User className="w-7 h-7 text-green-600 shrink-0" strokeWidth={2.25} />
                <span className="text-sm sm:text-base font-semibold text-gray-800 whitespace-nowrap">Mi Perfil</span>
              </button>
              <button
                onClick={pending ? undefined : () => navigate('/bookings')}
                className={`flex items-center justify-center gap-2 p-4 sm:p-5 rounded-xl border-2 border-gray-200 bg-white ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 hover:shadow'} transition-colors`}
                aria-label="Ir a Reservas"
                disabled={pending}
              >
                <Calendar className="w-7 h-7 text-green-600 shrink-0" strokeWidth={2.25} />
                <span className="text-sm sm:text-base font-semibold text-gray-800 whitespace-nowrap">Reservas</span>
              </button>
            </div>
          </div>

          {/* Reservas */}
          <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">Mis Reservas</h2>
            {bookingsLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" aria-label="Cargando reservas"></div>
              </div>
            )}
            
            {!bookingsLoading && bookings.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No tienes reservas aún</p>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {bookings.map((booking) => (
                  <div key={booking.id} className="border border-gray-200 rounded-lg p-4 sm:p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {booking.services?.name}
                          </h3>
                          <p className="text-gray-600">
                            Cliente: {booking.client_profile?.full_name}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(booking.status)}`}>
                        {getStatusText(booking.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center text-gray-600">
                        <Calendar className="w-4 h-4 mr-2" />
                        {format(parseISO(booking.date), 'EEEE, d MMMM yyyy', { locale: es })}
                      </div>
                      <div className="flex items-center text-gray-600">
                        <Clock className="w-4 h-4 mr-2" />
                        {booking.start_time} ({booking.duration_hours}h)
                      </div>
                      <div className="flex items-center text-gray-600">
                        <MapPin className="w-4 h-4 mr-2" />
                        {booking.client_address}
                      </div>
                      <div className="flex items-center justify-end md:justify-start text-gray-600">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 font-semibold">
                          €{booking.total_price}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {booking.status === 'pending' && (
                        <div className="space-x-2">
                          <button
                            onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                          >
                            Rechazar
                          </button>
                        </div>
                      )}
                      
                      {booking.status === 'confirmed' && (
                        <button
                          onClick={() => updateBookingStatus(booking.id, 'completed')}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                        >
                          Servicio Completado
                        </button>
                      )}
                      
                      {booking.status === 'confirmed' && (
                        <button
                          onClick={() => openChat(booking.id, booking.client_profile?.full_name || 'Cliente')}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors ml-2"
                        >
                          <MessageCircle className="w-4 h-4 mr-2 inline" />
                          Chat
                        </button>
                      )}
                    </div>

                    {booking.notes && (
                      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600">
                          <strong>Notas:</strong> {booking.notes}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!pending && activeTab === 'requests' && (
        <BookingRequestsManager onBack={() => setActiveTab('dashboard')} />
      )}
      {!pending && activeTab === 'availability' && (
        <AvailabilityManager onBack={() => setActiveTab('dashboard')} />
      )}
      {!pending && activeTab === 'profile' && (
        <ProfileSettings onBack={() => setActiveTab('dashboard')} />
      )}
      
      {/* Chat Window */}
      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.bookingId}
          isOpen={!!selectedChat}
          onClose={() => setSelectedChat(null)}
          otherUserName={selectedChat.clientName}
        />
      )}
    </div>
  );
};

export default GardenerDashboard;