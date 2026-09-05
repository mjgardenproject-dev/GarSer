import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, ArrowLeft, ChevronDown } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useAuth } from '../../contexts/AuthContext';
import { Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { reportBookingEvent } from '../../utils/bookingTelemetry';
import { fetchBookingMediaMap } from '../../utils/bookingMediaService';
import { fetchProfileNames } from '../../utils/profileNames';
import { fetchRebookPayload } from '../../utils/rebookService';
import { cancelBooking } from '../../utils/bookingLifecycleService';
import { confirmBookingService } from '../../utils/bookingIncidentService';
import { clearBookingResumeStorage, writeBookingResume } from '../../utils/bookingResumeStorage';
import { formatEuro } from '../../shared/bookingAmounts';
import ChatWindow from '../chat/ChatWindow';
import ClientBookingCard from '../booking/ClientBookingCard';
import ReviewModal from '../booking/ReviewModal';
import { useConfirmDialog } from '../common/ConfirmDialog';

interface BookingWithDetails extends Omit<Booking, 'services' | 'gardener_profile'> {
  services?: { name: string; icon?: string } | null;
  gardener_profile?: { user_id?: string; full_name: string; phone?: string } | null;
  media_urls?: string[];
  review_rating?: number | null;
}

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled';

const BookingsList = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<{ bookingId: string; gardenerName: string } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<BookingWithDetails | null>(null);

  const fetchBookings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data: bookingsData, error } = await supabase
        .from('bookings')
        .select('*, services(name, icon)')
        .eq('client_id', user.id)
        .order('date', { ascending: false });
      if (error) throw error;

      const rows = (bookingsData || []) as BookingWithDetails[];
      if (rows.length === 0) {
        setBookings([]);
        return;
      }

      const [names, mediaMap, reviewsResult] = await Promise.all([
        fetchProfileNames(rows.map((row) => row.gardener_id)),
        // `statusByBooking` evita mostrar fotos legacy en reservas ya completadas, cuyos
        // archivos se borran de Storage al cerrarlas.
        fetchBookingMediaMap(
          rows.map((row) => row.id),
          Object.fromEntries(rows.map((row) => [row.id, row.notes])),
          { statusByBooking: Object.fromEntries(rows.map((row) => [row.id, row.status])) },
        ),
        supabase.from('reviews').select('booking_id, rating').eq('client_id', user.id),
      ]);

      const ratingByBooking = new Map<string, number>();
      (reviewsResult.data || []).forEach((review: { booking_id: string | null; rating: number }) => {
        if (review.booking_id) ratingByBooking.set(review.booking_id, Number(review.rating));
      });

      setBookings(
        rows.map((row) => ({
          ...row,
          gardener_profile: names[row.gardener_id]
            ? { full_name: names[row.gardener_id].full_name || '', phone: names[row.gardener_id].phone || undefined }
            : null,
          media_urls: mediaMap[row.id] || [],
          review_rating: ratingByBooking.get(row.id) ?? null,
        })),
      );
    } catch (error) {
      console.error('Error cargando reservas:', error);
      toast.error('No se pudieron cargar tus reservas.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    void fetchBookings();
  }, [authLoading, fetchBookings]);

  /**
   * Enlace profundo `?review=<bookingId>`: el CTA del email de valoración abre el formulario
   * directamente sobre esa reserva, en vez de dejar al cliente en la lista buscándola.
   */
  useEffect(() => {
    const target = searchParams.get('review');
    if (!target || bookings.length === 0) return;
    const booking = bookings.find((item) => item.id === target);
    if (booking) setReviewTarget(booking);
    // Se limpia el parámetro para que volver atrás no reabra el formulario.
    const next = new URLSearchParams(searchParams);
    next.delete('review');
    setSearchParams(next, { replace: true });
  }, [bookings, searchParams, setSearchParams]);

  const respondToPriceChange = async (booking: BookingWithDetails, accept: boolean) => {
    setBusyId(booking.id);
    try {
      const { respondBookingPriceChange } = await import('../../utils/bookingPriceChangeService');
      await respondBookingPriceChange({ bookingId: booking.id, accept, operationId: crypto.randomUUID() });
      reportBookingEvent('info', {
        event: 'booking.price_discrepancy_resolved',
        context: { bookingId: booking.id, resolution: accept ? 'accepted' : 'rejected' },
      });
      toast.success(accept ? 'Nuevo precio aceptado.' : 'Propuesta rechazada.');
      await fetchBookings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo responder a la propuesta.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = (booking: BookingWithDetails) => {
    openConfirm({
      title: '¿Cancelar esta reserva?',
      message: `Se liberará el hueco del profesional. Los ${formatEuro(booking.management_fee)} de gastos de gestión que ya abonaste no se devuelven.`,
      confirmLabel: 'Sí, cancelar',
      cancelLabel: 'No, mantenerla',
      tone: 'danger',
      onConfirm: async () => {
        setBusyId(booking.id);
        try {
          const result = await cancelBooking(booking.id);
          // Un fallo de dinero no puede pasar en silencio: el cliente creería que todo fue bien.
          if ((result as { moneyStatus?: string })?.moneyStatus === 'failed') {
            toast.error('La reserva se canceló, pero hubo un problema con el cobro. Escríbenos y lo revisamos.');
          } else {
            toast.success('Reserva cancelada.');
          }
          await fetchBookings();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la reserva.');
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  /**
   * Confirmar no mueve dinero -los gastos de gestión ya se capturaron al aceptar el jardinero-,
   * así que solo cierra la reserva. Se encadena directo con la valoración: el cliente ya está
   * aquí y ya ha dicho que sí.
   */
  const handleConfirmService = async (booking: BookingWithDetails) => {
    setBusyId(booking.id);
    try {
      await confirmBookingService(booking.id);
      toast.success('¡Gracias! Servicio confirmado.');
      await fetchBookings();
      setReviewTarget(booking);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo confirmar el servicio.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRebook = async (booking: BookingWithDetails) => {
    if (!user?.id) return;
    setBusyId(booking.id);
    try {
      const { payload, partial } = await fetchRebookPayload(booking.id);
      clearBookingResumeStorage({ userId: user.id, flow: 'wizard', includeAnonFallback: true });
      writeBookingResume(
        'draft',
        'wizard',
        // Ver ClientBookingLauncher: `rebookReviewPending` antepone el resumen y los
        // `rebookSource*` son los datos con los que se encabeza.
        {
          bookingData: {
            ...payload,
            rebookReviewPending: true,
            rebookSourceDate: booking.date,
            rebookSourceService: booking.services?.name,
            rebookSourceGardener: booking.gardener_profile?.full_name,
          },
          currentStep: 2,
        },
        { userId: user.id },
      );
      if (partial) toast('Solo hemos podido recuperar la dirección y el servicio. Revisa el resto.', { icon: 'ℹ️' });
      navigate('/reservar');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo repetir la reserva.');
      setBusyId(null);
    }
  };

  const filteredBookings =
    statusFilter === 'all' ? bookings : bookings.filter((booking) => booking.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" aria-label="Cargando" />
      </div>
    );
  }

  return (
    <div className="max-w-full sm:max-w-3xl mx-auto px-4 py-4 sm:p-6">
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Volver al inicio
      </button>

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Mis reservas</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-gray-600">Estado</label>
          <div className="relative">
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="appearance-none border border-gray-300 rounded-lg pl-3 pr-10 py-2.5 sm:py-2 text-base sm:text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 cursor-pointer"
            >
              <option value="all">Todas</option>
              <option value="pending">Pendientes</option>
              <option value="confirmed">Confirmadas</option>
              <option value="completed">Completadas</option>
              <option value="cancelled">Canceladas</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" aria-hidden="true" />
          <p className="text-gray-700 font-medium">Todavía no tienes ninguna reserva</p>
          <button
            type="button"
            onClick={() => navigate('/reservar?start=1')}
            className="mt-4 text-sm font-semibold text-green-700 underline hover:text-green-800"
          >
            Empezar la primera
          </button>
        </div>
      ) : filteredBookings.length === 0 ? (
        /* Antes se comprobaba `bookings.length` pero se pintaba `filteredBookings`: al filtrar
           por un estado sin resultados salía una lista vacía sin ningún mensaje, y parecía que
           la app había fallado. */
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-700 font-medium">No tienes reservas con este estado</p>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className="mt-3 text-sm font-semibold text-green-700 underline hover:text-green-800"
          >
            Ver todas
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((booking) => (
            <ClientBookingCard
              key={booking.id}
              booking={booking}
              busy={busyId === booking.id}
              onOpenChat={() =>
                setSelectedChat({
                  bookingId: booking.id,
                  gardenerName: booking.gardener_profile?.full_name || 'Jardinero',
                })
              }
              onCancel={() => handleCancel(booking)}
              onReview={() => setReviewTarget(booking)}
              onRebook={() => void handleRebook(booking)}
              onAcceptPriceChange={() => void respondToPriceChange(booking, true)}
              onRejectPriceChange={() => void respondToPriceChange(booking, false)}
              onConfirmService={() => void handleConfirmService(booking)}
              onReportIncident={() => navigate(`/incidencias/${booking.id}`)}
            />
          ))}
        </div>
      )}

      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.bookingId}
          isOpen
          onClose={() => setSelectedChat(null)}
          otherUserName={selectedChat.gardenerName}
        />
      )}

      {reviewTarget && (
        <ReviewModal
          bookingId={reviewTarget.id}
          gardenerId={reviewTarget.gardener_id}
          gardenerName={reviewTarget.gardener_profile?.full_name}
          onClose={() => setReviewTarget(null)}
          /* Refrescar tras guardar: antes la lista no se recargaba y el cliente seguía viendo
             "Dejar mi valoración", creyendo que no se había guardado. */
          onSaved={() => { setReviewTarget(null); void fetchBookings(); }}
        />
      )}

      {confirmDialog}
    </div>
  );
};

export default BookingsList;
