import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, MapPin, User, MessageSquare, Check, X, AlertCircle, ArrowLeft } from 'lucide-react';
import { BookingRequest, BookingResponse, TimeBlock } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'react-hot-toast';

interface BookingRequestWithDetails extends BookingRequest {
  client_profile?: {
    full_name: string;
    phone: string;
  };
  services?: {
    name: string;
    price_per_hour: number;
  };
  booking_blocks?: {
    start_time: string;
    end_time: string;
  }[];
  existing_response?: BookingResponse;
}

interface BookingRequestsManagerProps {
  onBack?: () => void;
}

const BookingRequestsManager: React.FC<BookingRequestsManagerProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<BookingRequestWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchBookingRequests();
  }, [user?.id]);

  const fetchBookingRequests = async () => {
    try {
      setLoading(true);

      // Obtener reservas pendientes para este jardinero desde la tabla bookings
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('gardener_id', user?.id)
        .eq('status', 'pending');

      if (bookingsError) throw bookingsError;

      if (!bookings || bookings.length === 0) {
        setRequests([]);
        // Importante: cerrar el estado de carga para evitar spinner infinito
        setLoading(false);
        return;
      }

      // Expirar automáticamente solicitudes con más de 24h
      const now = Date.now();
      const toExpire = (bookings || []).filter(b => {
        const expiresAt = b.expires_at ? Date.parse(b.expires_at) : (Date.parse(b.created_at) + 24*60*60*1000);
        return b.status === 'pending' && now > expiresAt;
      });
      if (toExpire.length > 0) {
        const ids = toExpire.map(b => b.id).filter((id: any) => typeof id === 'string' && id.length > 0);
        try {
          if (ids.length === 1) {
            await supabase
              .from('bookings')
              .update({ status: 'expired', updated_at: new Date().toISOString() })
              .eq('id', ids[0])
              .eq('gardener_id', user?.id);
          } else if (ids.length > 1) {
            await supabase
              .from('bookings')
              .update({ status: 'expired', updated_at: new Date().toISOString() })
              .in('id', ids as string[])
              .eq('gardener_id', user?.id);
          }
        } catch (e: any) {
          console.warn('Error expiring old pending bookings:', e?.message || e);
        }
      }

      // Obtener datos de clientes y servicios por separado
      const clientIds = [...new Set(bookings.map(b => b.client_id))];
      const serviceIds = [...new Set(bookings.map(b => b.service_id))];

      const clientIdsFiltered = clientIds.filter(Boolean);
      const serviceIdsFiltered = serviceIds.filter(Boolean);

      // Fetch clients data
      let clientsResult: { data: any[] | null; error: any } = { data: [], error: null };
      if (clientIdsFiltered.length === 1) {
        const singleId = clientIdsFiltered[0] as string;
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .eq('user_id', singleId);
        clientsResult = { data, error } as any;
      } else if (clientIdsFiltered.length > 1) {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', clientIdsFiltered as string[]);
        clientsResult = { data, error } as any;
      }

      // Fetch services data
      let servicesResult: { data: any[] | null; error: any } = { data: [], error: null };
      if (serviceIdsFiltered.length === 1) {
        const singleServiceId = serviceIdsFiltered[0] as string;
        const { data, error } = await supabase
          .from('services')
          .select('id, name')
          .eq('id', singleServiceId);
        servicesResult = { data, error } as any;
      } else if (serviceIdsFiltered.length > 1) {
        const { data, error } = await supabase
          .from('services')
          .select('id, name')
          .in('id', serviceIdsFiltered as string[]);
        servicesResult = { data, error } as any;
      }

      if (clientsResult.error) {
        console.warn('Error fetching client profiles for requests:', clientsResult.error);
      }
      if (servicesResult.error) {
        console.warn('Error fetching services for requests:', servicesResult.error);
      }

      const clientsMap = new Map(clientsResult.data?.map(c => [c.user_id, c]) || []);
      const servicesMap = new Map((servicesResult.data || []).map(s => [s.id, { ...s, price_per_hour: 0 }]) || []);

      // Transformar los datos para que coincidan con la interfaz esperada
      const transformedRequests = bookings.map((booking) => ({
        id: booking.id,
        client_id: booking.client_id,
        service_id: booking.service_id,
        date: booking.date,
        start_hour: booking.start_time ? parseInt(booking.start_time.split(':')[0]) : 9,
        duration_hours: booking.duration_hours || 1,
        client_address: booking.client_address || 'Dirección no especificada',
        notes: booking.notes,
        status: booking.status,
        total_price: booking.total_price,
        created_at: booking.created_at,
        expires_at: booking.created_at, // Usar created_at como referencia
        client_profile: clientsMap.get(booking.client_id) || { full_name: 'Cliente desconocido', phone: '' },
        services: servicesMap.get(booking.service_id) || { name: 'Servicio desconocido', price_per_hour: 0 },
        booking_blocks: [{
          start_time: booking.start_time || '09:00',
          end_time: (() => {
            if (booking.end_time) return booking.end_time;
            const startH = booking.start_time ? parseInt(booking.start_time.split(':')[0]) : 9;
            const dur = booking.duration_hours || 1;
            const endH = startH + dur;
            return `${String(endH).padStart(2,'0')}:00`;
          })()
        }],
        existing_response: null // No hay respuestas separadas en este modelo simplificado
      }));

      setRequests(transformedRequests);
    } catch (error) {
      console.error('Error fetching booking requests:', error);
      toast.error('Error al cargar las solicitudes de reserva');
    } finally {
      setLoading(false);
    }
  };

  const respondToRequest = async (requestId: string, responseType: 'accept' | 'reject', message?: string) => {
    try {
      setResponding(requestId);

      if (responseType === 'accept') {
        // Obtener la reserva para conocer fecha y duración
        const { data: booking, error: bookingError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', requestId)
          .single();
        if (bookingError || !booking) throw bookingError || new Error('Reserva no encontrada');

        // Confirmar esta reserva
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', requestId)
          .eq('gardener_id', user?.id);
        if (updateError) throw updateError;

        // Cancelar solicitudes pendientes del mismo trabajo (misma ventana y cliente/servicio)
        const { error: cancelError } = await supabase
          .from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('client_id', booking.client_id)
          .eq('service_id', booking.service_id)
          .eq('date', booking.date)
          .eq('start_time', booking.start_time)
          .eq('status', 'pending');
        if (cancelError) console.warn('Error cancelando reservas paralelas:', cancelError);

        // Bloquear horas de la agenda y añadir margen posterior (aproximado a 1h)
        try {
          const startHour = parseInt((booking.start_time || '09:00').split(':')[0]);
          const duration = booking.duration_hours || 1;
          const hourBlocks = Array.from({ length: duration }, (_, i) => startHour + i);
          // Bloque principal
          const availability = await import('../../utils/availabilityService');
          await availability.blockTimeSlots(user!.id, booking.date, hourBlocks);
          // Margen posterior: bloquear la siguiente hora
          await availability.blockTimeSlots(user!.id, booking.date, [startHour + duration]);
        } catch (e) {
          console.warn('No se pudo bloquear disponibilidad tras la aceptación:', e);
        }

        toast.success('¡Solicitud aceptada! La reserva ha sido confirmada y tu agenda actualizada.');
      } else {
        // Si rechaza, actualizar el estado de la reserva a rechazada
        const { error: updateError } = await supabase
          .from('bookings')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId)
          .eq('gardener_id', user?.id);

        if (updateError) throw updateError;

        toast.success('Solicitud rechazada.');
      }

      // Recargar solicitudes
      fetchBookingRequests();
    } catch (error) {
      console.error('Error responding to request:', error);
      toast.error('Error al responder a la solicitud');
    } finally {
      setResponding(null);
    }
  };

  const formatTimeBlocks = (blocks: { start_time: string; end_time: string }[]) => {
    if (!blocks || blocks.length === 0) return '';
    
    const sortedBlocks = blocks.sort((a, b) => a.start_time.localeCompare(b.start_time));
    const startTime = sortedBlocks[0].start_time;
    const endTime = sortedBlocks[sortedBlocks.length - 1].end_time;
    
    return `${startTime} - ${endTime}`;
  };

  const formatPrice = (amount?: number) => {
    try {
      const value = typeof amount === 'number' ? amount : 0;
      return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
    } catch {
      return `€${amount ?? 0}`;
    }
  };

  const getBookingStatus = (createdAt: string) => {
    const created = parseISO(createdAt);
    const now = new Date();
    const diffInHours = Math.ceil((now.getTime() - created.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Recién recibida';
    if (diffInHours === 1) return 'Hace 1 hora';
    if (diffInHours < 24) return `Hace ${diffInHours} horas`;
    const diffInDays = Math.ceil(diffInHours / 24);
    if (diffInDays === 1) return 'Hace 1 día';
    return `Hace ${diffInDays} días`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            aria-label="Volver al Panel"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al Panel
          </button>
        )}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Solicitudes de Reserva</h1>
            <p className="text-gray-600 mt-2">Gestiona las solicitudes de tus clientes</p>
          </div>
          <div className="bg-green-100 px-4 py-2 rounded-lg">
            <span className="text-green-800 font-semibold">{requests.length} solicitudes pendientes</span>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">No tienes solicitudes pendientes</p>
            <p className="text-gray-500">Las nuevas solicitudes aparecerán aquí automáticamente</p>
          </div>
        ) : (
          <div className="space-y-6">
            {requests.map((request) => (
              <div key={request.id} className="border border-gray-200 rounded-xl p-4 sm:p-6 hover:shadow-lg transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div className="flex items-center space-x-4 min-w-0">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-semibold text-gray-900">
                        {request.services?.name}
                      </h3>
                      <p className="text-gray-600 flex items-center">
                        <User className="w-4 h-4 mr-1" />
                        {request.client_profile?.full_name}
                      </p>
                    </div>
                  </div>
                  <div className="sm:text-right sm:shrink-0">
                    <div className="text-xl sm:text-2xl font-bold text-green-600 whitespace-nowrap">
                      {formatPrice(request.total_price)}
                    </div>
                    <div className="text-sm text-orange-600 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-1" />
                      {getBookingStatus(request.created_at)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="flex items-center text-gray-600">
                    <Calendar className="w-4 h-4 mr-2" />
                    {format(parseISO(request.date), 'EEEE, d MMMM yyyy', { locale: es })}
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Clock className="w-4 h-4 mr-2" />
                    {formatTimeBlocks(request.booking_blocks || [])} ({request.booking_blocks?.length || 0}h)
                  </div>
                  <div className="flex items-center text-gray-600">
                    <MapPin className="w-4 h-4 mr-2" />
                    {request.client_address}
                  </div>
                </div>

                {request.notes && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Notas del cliente:</strong> {request.notes}
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-xs sm:text-sm text-gray-500 min-w-0 whitespace-normal break-words">
                    Solicitud recibida: {format(parseISO(request.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                  </div>
                  
                  {request.status === 'confirmed' ? (
                    <div className="flex items-center space-x-2">
                      <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                        ✓ Aceptada
                      </span>
                    </div>
                  ) : (request.status === 'rejected' || request.status === 'cancelled') ? (
                    <div className="flex items-center space-x-2">
                      <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
                        ✗ Rechazada
                      </span>
                    </div>
                  ) : (
                    <div className="flex w-full sm:w-auto items-center gap-2 sm:justify-end">
                      <button
                        onClick={() => respondToRequest(request.id, 'reject')}
                        disabled={responding === request.id}
                        className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center flex-1 sm:flex-none h-10"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Rechazar
                      </button>
                      <button
                        onClick={() => respondToRequest(request.id, 'accept')}
                        disabled={responding === request.id}
                        className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center flex-1 sm:flex-none h-10"
                      >
                        <Check className="w-4 h-4 mr-2" />
                        Aceptar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingRequestsManager;