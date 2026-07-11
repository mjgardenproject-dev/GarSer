import React, { useEffect, useState } from 'react';
import { Calendar, Clock, MapPin, ArrowLeft, MessageCircle, Check, ChevronDown, Phone, Navigation, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Booking } from '../../types';
import { useNavigate } from 'react-router-dom';
import ChatWindow from '../chat/ChatWindow';
import { fetchBookingMediaMap } from '../../utils/bookingMediaService';
import { completeBookingAndCleanupMedia } from '../../utils/bookingCompletionService';
import { fetchBookingServiceDetails, type BookingServiceInput } from '../../utils/bookingServiceDetails';
import ServiceDetailCard from './ServiceDetailCard';
import PhotoGallery from '../common/PhotoGallery';

interface GardenerBookingItem extends Booking {
  services?: { name: string } | null;
  client_profile?: { id: string; full_name: string | null; phone: string | null } | null;
  media_urls?: string[];
  service_input?: BookingServiceInput | null;
  data_input_mode?: string | null;
}

const GardenerBookings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<GardenerBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<{ bookingId: string; clientName: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'completed'>('all');
  // Confirmación antes de completar: en móvil un toque accidental era irreversible
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (user) {
      fetchBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchBookings = async () => {
    try {
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`*, services(name)`)
        .eq('gardener_id', user?.id)
        .in('status', ['confirmed', 'completed'])
        .order('date', { ascending: true });

      if (bookingsError) throw bookingsError;

      if (bookingsData && bookingsData.length > 0) {
        const clientIds = [...new Set(bookingsData.map((b: any) => b.client_id))];
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, phone')
          .in('id', clientIds);

        if (profilesError) throw profilesError;

        const bookingsWithProfiles = bookingsData.map((b: any) => ({
          ...b,
          client_profile: profilesData?.find((p: any) => p.id === b.client_id) || null
        }));

        const mediaMap = await fetchBookingMediaMap(
          bookingsWithProfiles.map((b: any) => b.id),
          Object.fromEntries(bookingsWithProfiles.map((b: any) => [b.id, b.notes])),
          {
            statusByBooking: Object.fromEntries(bookingsWithProfiles.map((b: any) => [b.id, b.status])),
          }
        );

        const enriched: GardenerBookingItem[] = await Promise.all(
          bookingsWithProfiles.map(async (booking: any) => {
            let service_input: BookingServiceInput | null = null;
            try {
              service_input = await fetchBookingServiceDetails(booking.id);
            } catch {
              service_input = null;
            }
            return {
              ...booking,
              media_urls: mediaMap[booking.id] || [],
              service_input,
            };
          })
        );
        setBookings(enriched);
      } else {
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching gardener bookings:', error);
      toast.error('No se pudieron cargar tus reservas');
    } finally {
      setLoading(false);
    }
  };

  const completeBooking = async (bookingId: string) => {
    setCompleting(true);
    try {
      const result = await completeBookingAndCleanupMedia(bookingId);
      if (result.cleanup?.status === 'failed') {
        console.warn('La reserva se completó, pero la limpieza de fotos requiere revisión:', result.cleanup.warning);
      }
      toast.success('Servicio marcado como completado');
      setConfirmCompleteId(null);
      await fetchBookings();
    } catch (e) {
      console.error('Error actualizando estado de la reserva:', e);
      toast.error('No se pudo completar la reserva. Inténtalo de nuevo.');
    } finally {
      setCompleting(false);
    }
  };

  const openChat = (bookingId: string, clientName: string) => {
    setSelectedChat({ bookingId, clientName });
  };

  const mapsUrl = (address: string) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

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
      case 'completed':
        return 'Completada';
      default:
        return status;
    }
  };

  return (
    <>
      <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
          aria-label="Volver al Panel"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Mis Reservas</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Estado</label>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="appearance-none border border-gray-300 rounded-md pl-3 pr-10 py-2.5 sm:py-2 text-base sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
              >
                <option value="all">Todos</option>
                <option value="confirmed">Confirmada</option>
                <option value="completed">Completada</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                <ChevronDown className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
            <span className="ml-3 text-gray-600">Cargando reservas...</span>
          </div>
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">No tienes reservas aceptadas aún</p>
            <p className="text-gray-500">Las reservas confirmadas aparecerán aquí</p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {(statusFilter === 'all' ? bookings : bookings.filter(b => b.status === statusFilter)).map((booking) => (
              <div key={booking.id} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">{booking.services?.name}</h3>
                    <p className="text-gray-600 truncate">Cliente: {booking.client_profile?.full_name}</p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(booking.status)}`}>
                    {getStatusText(booking.status)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
                  <div className="flex items-center text-gray-600">
                    <Calendar className="w-4 h-4 mr-2 shrink-0" />
                    {format(parseISO(booking.date), 'EEEE, d MMMM yyyy', { locale: es })}
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Clock className="w-4 h-4 mr-2 shrink-0" />
                    {booking.start_time} ({booking.duration_hours}h)
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-md bg-green-50 text-green-700 font-semibold">
                      €{booking.total_price}
                    </span>
                  </div>
                  <div className="flex items-start text-gray-600 sm:col-span-2">
                    <MapPin className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                    <span className="break-words">{booking.client_address}</span>
                  </div>
                </div>

                {/* Acciones de contacto y navegación: lo primero que necesita el jardinero en el móvil */}
                {booking.status === 'confirmed' && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {booking.client_profile?.phone && (
                      <a
                        href={`tel:${booking.client_profile.phone}`}
                        className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                        Llamar
                      </a>
                    )}
                    <a
                      href={mapsUrl(booking.client_address)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      <Navigation className="w-4 h-4" />
                      Cómo llegar
                    </a>
                    <button
                      onClick={() => openChat(booking.id, booking.client_profile?.full_name || 'Cliente')}
                      className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Chat
                    </button>
                  </div>
                )}

                <ServiceDetailCard
                  className="mb-4"
                  durationHours={booking.duration_hours}
                  dataInputMode={booking.data_input_mode}
                  serviceInput={booking.service_input}
                />

                {booking.price_change_status === 'pending_client_acceptance' && (
                  <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm">
                    Cambio de precio pendiente de respuesta del cliente.
                  </div>
                )}

                {booking.media_urls && booking.media_urls.length > 0 && (
                  <div className="mb-4">
                    <PhotoGallery urls={booking.media_urls} label="Fotos de la reserva" />
                  </div>
                )}

                {booking.status === 'confirmed' && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setConfirmCompleteId(booking.id)}
                      className="flex items-center px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Servicio Completado
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmación antes de marcar como completado (dispara limpieza de fotos, no reversible) */}
      {confirmCompleteId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">¿Marcar como completado?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Confirma que el trabajo está terminado. Esta acción cierra la reserva y no se puede deshacer.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => completeBooking(confirmCompleteId)}
                disabled={completing}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-xl font-bold hover:bg-purple-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {completing && <Loader2 className="w-4 h-4 animate-spin" />}
                {completing ? 'Completando…' : 'Sí, completar servicio'}
              </button>
              <button
                onClick={() => setConfirmCompleteId(null)}
                disabled={completing}
                className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.bookingId}
          isOpen={!!selectedChat}
          onClose={() => setSelectedChat(null)}
          otherUserName={selectedChat.clientName}
        />
      )}
    </>
  );
};

export default GardenerBookings;
