import React, { useEffect, useState } from 'react';
import { Calendar, Clock, MapPin, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Booking } from '../../types';
import { useNavigate } from 'react-router-dom';

const GardenerBookings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchBookings();
    }
  }, [user]);

  const fetchBookings = async () => {
    try {
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`*, services(name)`) // nombre del servicio
        .eq('gardener_id', user?.id)
        .in('status', ['confirmed', 'in_progress', 'completed'])
        .order('date', { ascending: true });

      if (bookingsError) throw bookingsError;

      if (bookingsData && bookingsData.length > 0) {
        const clientIds = [...new Set(bookingsData.map(b => b.client_id))];
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', clientIds);

        if (profilesError) throw profilesError;

        const bookingsWithProfiles = bookingsData.map(b => ({
          ...b,
          client_profile: profilesData?.find(p => p.user_id === b.client_id) || null
        }));

        setBookings(bookingsWithProfiles as any);
      } else {
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching gardener bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-blue-100 text-blue-800';
      case 'in_progress':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'Confirmada';
      case 'in_progress':
        return 'En progreso';
      case 'completed':
        return 'Completada';
      default:
        return status;
    }
  };

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <button
          onClick={() => navigate('/dashboard')}
          className="mb-4 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          aria-label="Volver al Panel"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Mis Reservas</h1>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
            <span className="ml-3 text-gray-600">Cargando reservas...</span>
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">No tienes reservas aceptadas aún</p>
            <p className="text-gray-500">Las reservas confirmadas aparecerán aquí</p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((booking) => (
              <div key={booking.id} className="border border-gray-200 rounded-xl p-4 sm:p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{booking.services?.name}</h3>
                    <p className="text-gray-600">Cliente: {booking.client_profile?.full_name}</p>
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
                  <div className="text-lg font-bold text-green-600">€{booking.total_price}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GardenerBookings;