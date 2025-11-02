import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Star, MapPin, Clock, Settings, User, Briefcase, MessageCircle, Bell } from 'lucide-react';
import { GardenerProfile, Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import AvailabilityManager from './AvailabilityManager';
import ProfileSettings from './ProfileSettings';
import ChatWindow from '../chat/ChatWindow';
import BookingRequestsManager from './BookingRequestsManager';

const GardenerDashboard = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<GardenerProfile | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'availability' | 'profile'>('dashboard');
  const [selectedChat, setSelectedChat] = useState<{
    bookingId: string;
    clientName: string;
  } | null>(null);

  useEffect(() => {
    if (user) {
      fetchGardenerProfile();
      fetchBookings();
    }
  }, [user]);

  const fetchGardenerProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('gardener_profiles')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) throw error;
      
      if (!data) {
        // No existe perfil de jardinero, crear uno automáticamente
        console.log('No gardener profile found, creating one...');
        await createGardenerProfile();
        return;
      }

      setProfile(data);
    } catch (error) {
      console.error('Error fetching gardener profile:', error);
    }
  };

  const createGardenerProfile = async () => {
    try {
      // Obtener información del perfil básico
      const { data: basicProfile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, phone, address')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching basic profile:', profileError);
        return;
      }

      // Crear perfil de jardinero con valores por defecto
      const { data, error } = await supabase
        .from('gardener_profiles')
        .insert([
          {
            user_id: user?.id,
            full_name: basicProfile?.full_name || '',
            phone: basicProfile?.phone || '',
            address: basicProfile?.address || '',
            description: '',
            services: [],
            max_distance: 25,
            rating: 5.0,
            total_reviews: 0,
            is_available: true
          }
        ])
        .select()
        .single();

      if (error) throw error;
      
      console.log('Gardener profile created successfully:', data);
      setProfile(data);
    } catch (error) {
      console.error('Error creating gardener profile:', error);
    }
  };

  const fetchBookings = async () => {
    try {
      // Primero obtenemos las reservas básicas
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          services(name)
        `)
        .eq('gardener_id', user?.id)
        .order('date', { ascending: true });

      if (bookingsError) throw bookingsError;

      // Luego obtenemos los perfiles de los clientes
      if (bookingsData && bookingsData.length > 0) {
        const clientIds = [...new Set(bookingsData.map(booking => booking.client_id))];
        
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', clientIds);

        if (profilesError) throw profilesError;

        // Combinar los datos
        const bookingsWithProfiles = bookingsData.map(booking => ({
          ...booking,
          client_profile: profilesData?.find(profile => profile.user_id === booking.client_id) || null
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
      case 'in_progress':
        return 'bg-green-100 text-green-800';
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
        return 'En Progreso';
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

  const tabs = [
    { id: 'dashboard', label: 'Panel Principal', icon: Calendar },
    { id: 'requests', label: 'Solicitudes', icon: Bell },
    { id: 'availability', label: 'Disponibilidad', icon: Clock },
    { id: 'profile', label: 'Mi Perfil', icon: User }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
      <div className="max-w-7xl mx-auto p-6">
      {/* Navigation Tabs */}
      <div className="bg-white rounded-2xl shadow-lg mb-8">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-4 sm:space-x-6 md:space-x-8 px-4 md:px-8 overflow-x-auto whitespace-nowrap">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-green-500 text-green-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-2" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && (
        <>
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  Panel de Jardinero
                </h1>
                <p className="text-gray-600">Gestiona tus servicios y reservas</p>
              </div>
            </div>

            {profile && (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-6">
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <Star className="w-8 h-8 text-yellow-500 mr-3" />
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{profile.rating.toFixed(1)}</p>
                      <p className="text-sm text-gray-600">Calificación</p>
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <Calendar className="w-8 h-8 text-blue-500 mr-3" />
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{bookings.length}</p>
                      <p className="text-sm text-gray-600">Reservas Totales</p>
                    </div>
                  </div>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <Clock className="w-8 h-8 text-yellow-600 mr-3" />
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{bookings.filter(b => b.status === 'pending').length}</p>
                      <p className="text-sm text-gray-600">Pendientes</p>
                    </div>
                  </div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <MapPin className="w-8 h-8 text-purple-500 mr-3" />
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{profile.max_distance}km</p>
                      <p className="text-sm text-gray-600">Radio de Trabajo</p>
                    </div>
                  </div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="flex items-center">
                    <Clock className="w-8 h-8 text-orange-500 mr-3" />
                    <div>
                      <p className="text-2xl font-bold text-gray-900">
                        {profile.is_available ? 'Disponible' : 'No Disponible'}
                      </p>
                      <p className="text-sm text-gray-600">Estado</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Reservas */}
          <div className="bg-white rounded-2xl shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Mis Reservas</h2>
            
            {bookings.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No tienes reservas aún</p>
              </div>
            ) : (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  <div key={booking.id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
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
                        <MapPin className="w-4 h-4 mr-2" />
                        {booking.client_address}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-lg font-bold text-green-600">
                        €{booking.total_price}
                      </div>
                      
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
                          onClick={() => updateBookingStatus(booking.id, 'in_progress')}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Iniciar Trabajo
                        </button>
                      )}
                      
                      {booking.status === 'in_progress' && (
                        <button
                          onClick={() => updateBookingStatus(booking.id, 'completed')}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                        >
                          Completar
                        </button>
                      )}
                      
                      {(booking.status === 'confirmed' || booking.status === 'in_progress') && (
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

      {activeTab === 'requests' && <BookingRequestsManager />}
      {activeTab === 'availability' && <AvailabilityManager />}
      {activeTab === 'profile' && <ProfileSettings />}
      
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