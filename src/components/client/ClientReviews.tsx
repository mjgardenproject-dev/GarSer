import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, CornerDownRight, Pencil } from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { fetchClientBookingsOverview, type OverviewBooking } from '../../utils/clientBookingsOverview';
import { canEditReview, fetchMyReviews, type MyReview } from '../../utils/reviewService';
import ClientBookingCard from '../booking/ClientBookingCard';
import ReviewModal from '../booking/ReviewModal';

/**
 * Las valoraciones del cliente, en un solo sitio.
 *
 * Antes no existía ninguna pantalla así, y por eso el botón "Reseñas" del chat acababa
 * llevando a la lista de reservas: no había ningún otro destino al que apuntar. Aquí arriba va
 * lo que el cliente aún puede hacer —valorar un servicio terminado— y debajo lo que ya
 * escribió, con la respuesta del profesional cuando la hay.
 */

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Estrellas con media estrella, la precisión que admite el esquema. */
const Stars = ({ value }: { value: number }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrellas`}>
    {[0, 1, 2, 3, 4].map((index) => {
      const filled = Math.max(Math.min(value - index, 1), 0);
      return (
        <span key={index} className="relative w-4 h-4">
          <Star className="w-4 h-4 absolute inset-0 text-gray-300" aria-hidden="true" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${filled * 100}%` }}>
            <Star className="w-4 h-4 text-yellow-400 fill-current" aria-hidden="true" />
          </span>
        </span>
      );
    })}
  </span>
);

const ClientReviews = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [pending, setPending] = useState<OverviewBooking[]>([]);
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<
    { bookingId: string; gardenerId: string | null; gardenerName: string | null } | null
  >(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [overview, mine] = await Promise.all([
      fetchClientBookingsOverview(user.id),
      fetchMyReviews(user.id),
    ]);
    setPending(overview.toReview);
    setReviews(mine);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Volver al inicio
      </button>

      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Mis valoraciones</h1>

      {loading && <p className="text-sm text-gray-500 py-8 text-center">Cargando…</p>}

      {!loading && (
        <div className="space-y-8">
          {/* Primero lo accionable: un servicio terminado sin valorar es la única tarea que el
              cliente tiene pendiente en esta pantalla. */}
          {pending.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Pendientes de valorar
              </h2>
              <div className="space-y-3">
                {pending.map((booking) => (
                  <ClientBookingCard
                    key={booking.id}
                    booking={booking}
                    compact
                    accent="attention"
                    onReview={() =>
                      setReviewTarget({
                        bookingId: booking.id,
                        gardenerId: booking.gardener_id,
                        gardenerName: booking.gardener_name,
                      })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Valoraciones escritas
            </h2>

            {reviews.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-10 text-center">
                <Star className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-700">Todavía no has valorado ningún servicio</p>
                <p className="mt-1 text-sm text-gray-500">
                  Cuando termine uno, podrás contarle a otros clientes qué tal fue.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reviews.map((review) => (
                  <article
                    key={review.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {/* Envuelve en vez de cortarse: en móvil el botón de editar le come
                            el ancho y "Desbroce de malas hierbas" quedaba en "Desbroce de…". */}
                        <p className="font-semibold text-gray-900 break-words">
                          {review.service_name || 'Servicio'}
                        </p>
                        <p className="text-sm text-gray-600 truncate">con {review.gardener_name}</p>
                      </div>
                      {canEditReview(review) && (
                        <button
                          type="button"
                          onClick={() =>
                            review.booking_id &&
                            setReviewTarget({
                              bookingId: review.booking_id,
                              gardenerId: review.gardener_id,
                              gardenerName: review.gardener_name,
                            })
                          }
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          Editar
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <Stars value={review.rating} />
                      <span className="text-xs text-gray-500">{formatDate(review.created_at)}</span>
                    </div>

                    {review.comment && (
                      <p className="mt-2 text-sm text-gray-700 whitespace-pre-line break-words">
                        {review.comment}
                      </p>
                    )}

                    {review.gardener_response && (
                      <div className="mt-3 rounded-lg bg-gray-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                          <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                          Respuesta de {review.gardener_name}
                        </p>
                        <p className="mt-1 text-sm text-gray-700 whitespace-pre-line break-words">
                          {review.gardener_response}
                        </p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {reviewTarget && (
        <ReviewModal
          bookingId={reviewTarget.bookingId}
          gardenerId={reviewTarget.gardenerId}
          gardenerName={reviewTarget.gardenerName}
          onClose={() => setReviewTarget(null)}
          onSaved={() => { setReviewTarget(null); void load(); }}
        />
      )}
    </div>
  );
};

export default ClientReviews;
