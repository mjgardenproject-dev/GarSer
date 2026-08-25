import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, PlayCircle, ListChecks, Plus, ChevronDown } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useAuth } from '../../contexts/AuthContext';
import { clearBookingResumeStorage, hasWizardResume, writeBookingResume } from '../../utils/bookingResumeStorage';
import { fetchRebookPayload } from '../../utils/rebookService';
import { cancelBooking } from '../../utils/bookingLifecycleService';
import {
  fetchClientBookingsOverview,
  type ClientBookingsOverview,
  type OverviewBooking,
} from '../../utils/clientBookingsOverview';
import ClientBookingCard from '../booking/ClientBookingCard';
import ReviewModal from '../booking/ReviewModal';
import ChatWindow from '../chat/ChatWindow';
import { useConfirmDialog } from '../common/ConfirmDialog';
import { formatEuro } from '../../shared/bookingAmounts';

const ClientBookingLauncher = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const [overview, setOverview] = useState<ClientBookingsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // El chat y la valoración se abren AQUÍ, no navegando a otra lista: el cliente ya eligió la
  // reserva, hacerle buscarla otra vez era el fallo que arreglamos.
  const [chatTarget, setChatTarget] = useState<{ bookingId: string; gardenerName: string } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<OverviewBooking | null>(null);

  const canResume = hasWizardResume({ userId: user?.id, allowAnonFallback: true });
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0];

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setOverview(await fetchClientBookingsOverview(user.id));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const startNewBooking = () => {
    clearBookingResumeStorage({ userId: user?.id, flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  /**
   * Repetir un servicio: precarga las características del anterior y deja al cliente en la
   * pantalla de resumen para revisarlas. No se arrastra ningún precio — lo calcula la pantalla
   * de jardineros con las tarifas vigentes.
   */
  const handleRebook = async (booking: OverviewBooking) => {
    if (!user?.id) return;
    setBusyId(booking.id);
    try {
      const { payload, partial } = await fetchRebookPayload(booking.id);
      clearBookingResumeStorage({ userId: user.id, flow: 'wizard', includeAnonFallback: true });
      writeBookingResume(
        'draft',
        'wizard',
        // `rebookReviewPending` hace que el funnel muestre primero el resumen en vez de soltar
        // al cliente en la pantalla de detalles con toda la interfaz de análisis.
        { bookingData: { ...payload, rebookReviewPending: true }, currentStep: 2 },
        { userId: user.id },
      );
      if (partial) {
        toast('Solo hemos podido recuperar la dirección y el servicio. Revisa el resto.', { icon: 'ℹ️' });
      }
      navigate('/reservar');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo repetir la reserva.');
      setBusyId(null);
    }
  };

  const handleCancel = (booking: OverviewBooking) => {
    const fee = formatEuro(booking.management_fee);
    openConfirm({
      title: '¿Cancelar esta reserva?',
      message: `Se liberará el hueco del profesional. Los ${fee} de gastos de gestión que ya abonaste no se devuelven.`,
      confirmLabel: 'Sí, cancelar',
      cancelLabel: 'No, mantenerla',
      tone: 'danger',
      onConfirm: async () => {
        setBusyId(booking.id);
        try {
          const result = await cancelBooking(booking.id);
          // Si el movimiento de dinero falla, el cliente tiene que saberlo: dar por buena la
          // cancelación cuando el cobro se quedó a medias es como se generan reclamaciones.
          if ((result as { moneyStatus?: string })?.moneyStatus === 'failed') {
            toast.error('La reserva se canceló, pero hubo un problema con el cobro. Escríbenos y lo revisamos.');
          } else {
            toast.success('Reserva cancelada.');
          }
          await load();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la reserva.');
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const cardHandlers = {
    onOpenChat: (booking: OverviewBooking) =>
      setChatTarget({ bookingId: booking.id, gardenerName: booking.gardener_name }),
    onCancel: handleCancel,
    onReview: (booking: OverviewBooking) => setReviewTarget(booking),
    onRebook: (booking: OverviewBooking) => void handleRebook(booking),
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
        {firstName ? `Hola de nuevo, ${firstName}` : 'Hola de nuevo'}
      </h1>

      {/* Primaria a ancho completo y las dos secundarias en fila: apiladas empujaban las
          reservas fuera de la primera pantalla en móvil, que es justo lo que el cliente
          viene a ver. */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={startNewBooking}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 text-sm font-semibold text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Empezar una reserva
        </button>
        {/* Texto visible corto para que las dos acciones quepan en una fila en móvil; el
            nombre accesible (`aria-label`) mantiene la frase entera. */}
        <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => navigate('/reservar')}
          disabled={!canResume}
          title={canResume ? undefined : 'No tienes ninguna reserva a medias'}
          aria-label="Continuar una reserva"
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
        >
          <PlayCircle className="w-4 h-4" aria-hidden="true" />
          Continuar
        </button>
        <button
          type="button"
          onClick={() => navigate('/bookings')}
          aria-label="Ver mis reservas"
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
        >
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          Ver todas
        </button>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Mis reservas</h2>

        {loading && <p className="text-sm text-gray-500 py-6 text-center">Cargando tus reservas…</p>}

        {!loading && overview?.isEmpty && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-10 text-center">
            <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-700">Todavía no tienes ninguna reserva</p>
            <button
              type="button"
              onClick={startNewBooking}
              className="mt-4 text-sm font-semibold text-green-700 underline hover:text-green-800"
            >
              Empezar la primera
            </button>
          </div>
        )}

        {!loading && overview && !overview.isEmpty && (
          <div className="space-y-6">
            {/* 1. Lo que está por venir: tiene preferencia siempre. */}
            {overview.upcoming.length > 0 && (
              <div className="space-y-3">
                {overview.upcoming.map((booking) => (
                  <ClientBookingCard
                    key={booking.id}
                    booking={booking}
                    compact
                    accent="upcoming"
                    eyebrow={booking.status === 'confirmed' ? 'Próxima reserva' : undefined}
                    busy={busyId === booking.id}
                    {...cardHandlers}
                  />
                ))}
              </div>
            )}

            {/* 2. Lo que reclama una acción del cliente. */}
            {overview.toReview.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Pendientes de valorar
                </h3>
                <div className="space-y-3">
                  {overview.toReview.map((booking) => (
                    <ClientBookingCard
                      key={booking.id}
                      booking={booking}
                      compact
                      accent="attention"
                      busy={busyId === booking.id}
                      {...cardHandlers}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 3. El histórico, desde donde se repite. */}
            {overview.reviewed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Servicios anteriores
                </h3>
                <div className="space-y-3">
                  {overview.reviewed.map((booking) => (
                    <ClientBookingCard
                      key={booking.id}
                      booking={booking}
                      compact
                      busy={busyId === booking.id}
                      {...cardHandlers}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 4. Lo que terminó sin servicio, plegado: el cliente puede consultarlo sin que
                   alargue la pantalla ni compita con lo accionable. */}
            {overview.closed.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowClosed((value) => !value)}
                  aria-expanded={showClosed}
                  className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
                >
                  <span>Otras reservas ({overview.closed.length})</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showClosed ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {showClosed && (
                  <div className="mt-3 space-y-3">
                    {overview.closed.map((booking) => (
                      <ClientBookingCard
                        key={booking.id}
                        booking={booking}
                        compact
                        busy={busyId === booking.id}
                        {...cardHandlers}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {chatTarget && (
        <ChatWindow
          bookingId={chatTarget.bookingId}
          isOpen
          onClose={() => setChatTarget(null)}
          otherUserName={chatTarget.gardenerName}
        />
      )}

      {reviewTarget && (
        <ReviewModal
          bookingId={reviewTarget.id}
          gardenerId={reviewTarget.gardener_id}
          gardenerName={reviewTarget.gardener_name}
          onClose={() => setReviewTarget(null)}
          onSaved={() => { setReviewTarget(null); void load(); }}
        />
      )}

      {confirmDialog}
    </div>
  );
};

export default ClientBookingLauncher;
