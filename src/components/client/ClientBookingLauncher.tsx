import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin, Clock, MessageCircle, Star, PlayCircle, ListChecks, Plus, RotateCcw } from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';
import {
  fetchClientBookingsOverview,
  type ClientBookingsOverview,
  type OverviewBooking,
} from '../../utils/clientBookingsOverview';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T00:00:00`));

const formatTime = (time: string | null) => (time ? time.slice(0, 5) : null);

const Stars = ({ value }: { value: number }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrellas`}>
    {[0, 1, 2, 3, 4].map((index) => {
      const filled = Math.max(Math.min(value - index, 1), 0);
      return (
        <span key={index} className="relative w-3.5 h-3.5">
          <Star className="w-3.5 h-3.5 absolute inset-0 text-gray-300" aria-hidden="true" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${filled * 100}%` }}>
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-current" aria-hidden="true" />
          </span>
        </span>
      );
    })}
  </span>
);

const ClientBookingLauncher = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [overview, setOverview] = useState<ClientBookingsOverview | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
      {/* Saludo y nada más: ocupaba media pantalla con texto que nadie lee dos veces. */}
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
        {firstName ? `Hola de nuevo, ${firstName}` : 'Hola de nuevo'}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={startNewBooking}
          className="flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 text-sm font-semibold text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Empezar una reserva
        </button>
        <button
          type="button"
          onClick={() => navigate('/reservar')}
          disabled={!canResume}
          title={canResume ? undefined : 'No tienes ninguna reserva a medias'}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
        >
          <PlayCircle className="w-4 h-4" aria-hidden="true" />
          Continuar una reserva
        </button>
        <button
          type="button"
          onClick={() => navigate('/bookings')}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
        >
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          Ver mis reservas
        </button>
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
                  <UpcomingCard key={booking.id} booking={booking} onChat={() => navigate('/chat')} />
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
                    <ToReviewCard key={booking.id} booking={booking} onReview={() => navigate('/bookings')} />
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
                    <ReviewedCard key={booking.id} booking={booking} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

const CardShell = ({ children, accent }: { children: React.ReactNode; accent?: string }) => (
  <article className={`rounded-2xl border bg-white p-4 shadow-sm ${accent || 'border-gray-200'}`}>{children}</article>
);

const UpcomingCard = ({ booking, onChat }: { booking: OverviewBooking; onChat: () => void }) => (
  <CardShell accent="border-green-200 ring-1 ring-green-100">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="inline-block text-[11px] font-semibold uppercase tracking-wide text-green-700 mb-1">
          {booking.status === 'pending' ? 'Pendiente de aceptar' : 'Próxima reserva'}
        </span>
        <h4 className="font-semibold text-gray-900 truncate">{booking.service_name}</h4>
        <p className="text-sm text-gray-600">con {booking.gardener_name}</p>
      </div>
    </div>

    <dl className="mt-3 space-y-1.5 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
        <span className="first-letter:uppercase">{formatDate(booking.date)}</span>
      </div>
      {formatTime(booking.start_time) && (
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
          <span>
            {formatTime(booking.start_time)}
            {booking.duration_hours ? ` · ${booking.duration_hours} h` : ''}
          </span>
        </div>
      )}
      {booking.client_address && (
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="break-words">{booking.client_address}</span>
        </div>
      )}
    </dl>

    <button
      type="button"
      onClick={onChat}
      className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
    >
      <MessageCircle className="w-4 h-4" aria-hidden="true" />
      Hablar con {booking.gardener_name.split(' ')[0]}
    </button>
  </CardShell>
);

const ToReviewCard = ({ booking, onReview }: { booking: OverviewBooking; onReview: () => void }) => (
  <CardShell accent="border-amber-200 bg-amber-50/40">
    <h4 className="font-semibold text-gray-900 truncate">{booking.service_name}</h4>
    <p className="text-sm text-gray-600">
      con {booking.gardener_name} · <span className="first-letter:uppercase">{formatDate(booking.date)}</span>
    </p>
    {/* Petición explícita y visible: sin ella el cliente no sabía que se esperaba algo de él. */}
    <p className="mt-2 text-sm text-amber-900">
      ¿Qué tal fue? Tu valoración ayuda a otros clientes a elegir bien.
    </p>
    <button
      type="button"
      onClick={onReview}
      className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
    >
      <Star className="w-4 h-4" aria-hidden="true" />
      Dejar mi valoración
    </button>
  </CardShell>
);

const ReviewedCard = ({ booking }: { booking: OverviewBooking }) => (
  <CardShell>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="font-semibold text-gray-900 truncate">{booking.service_name}</h4>
        <p className="text-sm text-gray-600">
          con {booking.gardener_name} · <span className="first-letter:uppercase">{formatDate(booking.date)}</span>
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <Stars value={booking.review_rating ?? 0} />
      </div>
    </div>
    {/* El "volver a reservar" real llega en la fase 5: repetir tiene que recalcular el precio
        contra la configuración vigente, no copiar el importe antiguo. */}
    <button
      type="button"
      disabled
      title="Disponible muy pronto"
      className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-500 opacity-60 cursor-not-allowed"
    >
      <RotateCcw className="w-4 h-4" aria-hidden="true" />
      Volver a reservar este servicio
    </button>
  </CardShell>
);

export default ClientBookingLauncher;
