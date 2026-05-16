import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, MapPin, User, Check, X, AlertCircle, ArrowLeft } from 'lucide-react';
import { BookingResponse } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'react-hot-toast';
import { fetchBookingMediaMap } from '../../utils/bookingMediaService';
import { proposeBookingPriceChange } from '../../utils/bookingPriceChangeService';
import { expireStaleBookingRequests, respondBookingRequest } from '../../utils/bookingRequestService';
import { reportBookingEvent } from '../../utils/bookingTelemetry';

interface BookingRequestWithDetails {
  id: string;
  client_id: string;
  service_id: string;
  date: string;
  start_hour: number;
  duration_hours: number;
  client_address: string;
  notes?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'accepted' | 'rejected';
  total_price?: number;
  price_change_status?: 'none' | 'pending_client_acceptance' | 'accepted' | 'rejected' | 'expired';
  pricing_context?: {
    service_type?: string;
    allows_price_change?: boolean;
    palm_groups?: Array<{
      is_terminal_open_range?: boolean;
      quantity?: number;
    }>;
  } | null;
  created_at: string;
  expires_at?: string;
  client_profile?: {
    full_name: string;
    phone: string;
  };
  services?: {
    name: string;
    hourly_rate: number;
  };
  booking_blocks?: Array<{
    start_time: string;
    end_time: string;
  }>;
  media_urls?: string[];
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
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { amount: string; reason: string; loading?: boolean }>>({});

  useEffect(() => {
    if (!user?.id) return;
    fetchBookingRequests();
  }, [user?.id]);

  const fetchBookingRequests = async () => {
    try {
      setLoading(true);
      await expireStaleBookingRequests();

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

      // Obtener datos de clientes y servicios por separado
      const clientIds = [...new Set(bookings.map((b: any) => b.client_id))];
      const serviceIds = [...new Set(bookings.map((b: any) => b.service_id))];

      const clientIdsFiltered = clientIds.filter(Boolean);
      const serviceIdsFiltered = serviceIds.filter(Boolean);

      // Fetch clients data
      let clientsResult: { data: any[] | null; error: any } = { data: [], error: null };
      if (clientIdsFiltered.length === 1) {
        const singleId = clientIdsFiltered[0] as string;
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, phone')
          .eq('id', singleId);
        clientsResult = { data, error } as any;
      } else if (clientIdsFiltered.length > 1) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, phone')
          .in('id', clientIdsFiltered as string[]);
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

      if (servicesResult.data) {
        servicesResult.data = servicesResult.data.map(s => {
          if (s.name.toLowerCase().includes('fumigación') || s.name.toLowerCase().includes('fumigacion') || s.name.toLowerCase().includes('tratamientos fitosanitarios')) {
            return { ...s, name: 'Servicios fitosanitarios' };
          }
          return s;
        });
      }

      if (clientsResult.error) {
        console.warn('Error fetching client profiles for requests:', clientsResult.error);
      }
      if (servicesResult.error) {
        console.warn('Error fetching services for requests:', servicesResult.error);
      }

      const clientsMap = new Map(clientsResult.data?.map(c => [c.id, c]) || []);
      const servicesMap = new Map((servicesResult.data || []).map(s => [s.id, { ...s, hourly_rate: 0 }]) || []);

      // Transformar los datos para que coincidan con la interfaz esperada
      const transformedRequests = bookings.map((booking: any) => ({
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
        price_change_status: booking.price_change_status,
        pricing_context: booking.pricing_context,
        created_at: booking.created_at,
        expires_at: booking.created_at, // Usar created_at como referencia
        client_profile: clientsMap.get(booking.client_id) || { full_name: 'Cliente desconocido', phone: '' },
        services: servicesMap.get(booking.service_id) || { name: 'Servicio desconocido', hourly_rate: 0 },
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

      const mediaMap = await fetchBookingMediaMap(
        transformedRequests.map((r: BookingRequestWithDetails) => r.id),
        Object.fromEntries(transformedRequests.map((r: BookingRequestWithDetails) => [r.id, r.notes]))
      );

      const enrichedRequests = transformedRequests.map((request: BookingRequestWithDetails) => ({
        ...request,
        media_urls: mediaMap[request.id] || [],
      }));

      setRequests(enrichedRequests);
    } catch (error) {
      console.error('Error fetching booking requests:', error);
      reportBookingEvent('error', {
        event: 'booking.requests_fetch_failed',
        context: {
          gardenerId: user?.id,
          message: error instanceof Error ? error.message : 'unknown',
        },
      });
      toast.error('Error al cargar las solicitudes de reserva');
    } finally {
      setLoading(false);
    }
  };

  const respondToRequest = async (requestId: string, responseType: 'accept' | 'reject') => {
    try {
      setResponding(requestId);

      if (responseType === 'accept') {
        const { data: booking, error: bookingError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', requestId)
          .single();
        if (bookingError || !booking) throw bookingError || new Error('Reserva no encontrada');
        if (booking.price_change_status === 'pending_client_acceptance') {
          toast.error('No puedes confirmar la reserva: el cliente aún no ha aceptado el nuevo precio en el chat.');
          return;
        }
        await respondBookingRequest({
          bookingId: requestId,
          response: 'accept',
        });

        toast.success('¡Solicitud aceptada! La reserva ha sido confirmada y tu agenda actualizada.');
      } else {
        await respondBookingRequest({
          bookingId: requestId,
          response: 'reject',
        });

        toast.success('Solicitud rechazada.');
      }

      // Recargar solicitudes
      fetchBookingRequests();
    } catch (error) {
      console.error('Error responding to request:', error);
      reportBookingEvent('error', {
        event: 'booking.request_response_failed',
        context: {
          bookingId: requestId,
          responseType,
          gardenerId: user?.id,
          message: error instanceof Error ? error.message : 'unknown',
        },
      });
      toast.error('Error al responder a la solicitud');
    } finally {
      setResponding(null);
    }
  };

  const submitPriceProposal = async (request: BookingRequestWithDetails) => {
    const isPalmBooking = request.pricing_context?.service_type === 'palm_pruning';
    const allowsPriceChange = !isPalmBooking || request.pricing_context?.allows_price_change === true;
    if (!allowsPriceChange) {
      toast.error('Solo se permite proponer cambio de precio en palmeras del último rango abierto.');
      return;
    }
    const draft = priceDrafts[request.id] || { amount: '', reason: '' };
    const value = Number(draft.amount);
    if (!(value > 0)) {
      toast.error('Introduce un precio válido para proponer el cambio.');
      return;
    }
    setPriceDrafts((prev) => ({ ...prev, [request.id]: { ...draft, loading: true } }));
    try {
      await proposeBookingPriceChange({
        bookingId: request.id,
        proposedTotalPrice: value,
        reason: draft.reason,
        operationId: crypto.randomUUID(),
      });
      toast.success('Propuesta de precio enviada al cliente.');
      await fetchBookingRequests();
    } catch (error: any) {
      console.error('Error proposing new booking price:', error);
      reportBookingEvent('error', {
        event: 'booking.price_proposal_failed',
        context: {
          bookingId: request.id,
          gardenerId: user?.id,
          message: error?.message || 'unknown',
        },
      });
      toast.error(error?.message || 'No se pudo proponer el nuevo precio.');
    } finally {
      setPriceDrafts((prev) => ({ ...prev, [request.id]: { ...draft, loading: false } }));
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
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
          aria-label="Volver al Panel"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>
      )}

      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Solicitudes de Reserva</h1>
          <p className="text-gray-600 mt-2">Gestiona las solicitudes de tus clientes</p>
        </div>
        <div className="bg-green-100 px-4 py-2 rounded-lg self-start sm:self-auto">
          <span className="text-green-800 font-semibold">{requests.length} solicitudes pendientes</span>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No tienes solicitudes pendientes</p>
          <p className="text-gray-500">Las nuevas solicitudes aparecerán aquí automáticamente</p>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {requests.map((request) => (
            <div key={request.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
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
                    {request.price_change_status === 'pending_client_acceptance' && (
                      <div className="text-xs text-amber-700 mt-1">Cambio de precio pendiente de cliente</div>
                    )}
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
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      <strong>Notas del cliente:</strong> {request.notes.replace(/Fotos:\n(https?:\/\/[^\s]+[\n]?)+/g, '').trim()}
                    </p>
                  </div>
                )}

                {request.media_urls && request.media_urls.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Fotos de la reserva</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {request.media_urls.slice(0, 8).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
                        >
                          <img src={url} alt="Foto reserva" className="w-full h-20 object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {request.status === 'pending' && request.price_change_status !== 'pending_client_acceptance' && (
                  <div className="mb-4 p-3 rounded-lg border border-blue-200 bg-blue-50">
                    <p className="text-sm font-medium text-blue-900 mb-2">Modificar precio y enviar propuesta al cliente</p>
                    {request.pricing_context?.service_type === 'palm_pruning' && request.pricing_context?.allows_price_change !== true && (
                      <p className="text-xs text-amber-700 mb-2">
                        Cambio de precio no permitido: esta reserva de palmeras no está en el último rango abierto de especie.
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceDrafts[request.id]?.amount || ''}
                        onChange={(e) =>
                          setPriceDrafts((prev) => ({
                            ...prev,
                            [request.id]: { ...(prev[request.id] || { amount: '', reason: '' }), amount: e.target.value }
                          }))
                        }
                        placeholder={`Nuevo precio (€), actual: ${Number(request.total_price || 0).toFixed(2)}`}
                        className="flex-1 px-3 py-2 border border-blue-200 rounded-md text-sm"
                      />
                      <input
                        type="text"
                        value={priceDrafts[request.id]?.reason || ''}
                        onChange={(e) =>
                          setPriceDrafts((prev) => ({
                            ...prev,
                            [request.id]: { ...(prev[request.id] || { amount: '', reason: '' }), reason: e.target.value }
                          }))
                        }
                        placeholder="Motivo (opcional)"
                        className="flex-1 px-3 py-2 border border-blue-200 rounded-md text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => submitPriceProposal(request)}
                        disabled={priceDrafts[request.id]?.loading || (request.pricing_context?.service_type === 'palm_pruning' && request.pricing_context?.allows_price_change !== true)}
                        className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-60"
                      >
                        Proponer
                      </button>
                    </div>
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
                      {request.price_change_status !== 'pending_client_acceptance' && (
                        <button
                          onClick={() => respondToRequest(request.id, 'accept')}
                          disabled={responding === request.id}
                          className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center flex-1 sm:flex-none h-10"
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Aceptar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
};

export default BookingRequestsManager;
