import { useEffect, useMemo, useState } from 'react';
import { Star, ShieldAlert, CornerDownRight } from 'lucide-react';
import {
  fetchGardenerReviews,
  summarizeReviews,
  type PublicReview,
  type ReviewSummary,
} from '../../utils/reviewService';

interface Props {
  gardenerId: string;
  /** Nombre del profesional, para encabezar la respuesta. */
  gardenerName?: string;
  /** Render alternativo por reseña (lo usa el panel del jardinero para añadir "responder"). */
  renderActions?: (review: PublicReview) => React.ReactNode;
  /** Reseñas ya cargadas; si no llegan, el componente las pide. */
  reviews?: PublicReview[];
  compact?: boolean;
  /** El jardinero mirando SUS propias reseñas: la respuesta se rotula "Tu respuesta". */
  ownerView?: boolean;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Estrellas con soporte de media estrella, que es la precisión que admite el esquema. */
const Stars = ({ value, size = 'w-4 h-4' }: { value: number; size?: string }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrellas`}>
    {[0, 1, 2, 3, 4].map((index) => {
      const filled = Math.max(Math.min(value - index, 1), 0);
      return (
        <span key={index} className={`relative ${size}`}>
          <Star className={`${size} absolute inset-0 text-gray-300`} aria-hidden="true" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${filled * 100}%` }}>
            <Star className={`${size} text-yellow-400 fill-current`} aria-hidden="true" />
          </span>
        </span>
      );
    })}
  </span>
);

const Distribution = ({ summary }: { summary: ReviewSummary }) => (
  <div className="space-y-1 w-full max-w-[220px]">
    {([5, 4, 3, 2, 1] as const).map((score) => {
      const count = summary.distribution[score];
      const pct = summary.total > 0 ? (count / summary.total) * 100 : 0;
      return (
        <div key={score} className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-3 tabular-nums">{score}</span>
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-6 text-right tabular-nums text-gray-500">{count}</span>
        </div>
      );
    })}
  </div>
);

const ReviewList = ({ gardenerId, gardenerName, renderActions, reviews: provided, compact, ownerView }: Props) => {
  const [reviews, setReviews] = useState<PublicReview[]>(provided ?? []);
  const [loading, setLoading] = useState(!provided);

  useEffect(() => {
    if (provided) {
      setReviews(provided);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchGardenerReviews(gardenerId)
      .then((rows) => { if (alive) setReviews(rows); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [gardenerId, provided]);

  const summary = useMemo(() => summarizeReviews(reviews), [reviews]);

  if (loading) {
    return <div className="py-6 text-center text-sm text-gray-500">Cargando reseñas…</div>;
  }

  if (reviews.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-gray-700">Todavía no tiene reseñas</p>
        <p className="text-xs text-gray-500 mt-1">Será uno de los primeros clientes en valorarlo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Cabecera con la nota real desde la primera reseña, como Google. */}
      {!compact && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-gray-100">
          <div className="text-center sm:text-left sm:pr-6 sm:border-r sm:border-gray-100">
            <div className="text-3xl font-bold text-gray-900 tabular-nums">
              {summary.average?.toFixed(1).replace('.', ',')}
            </div>
            <Stars value={summary.average ?? 0} />
            <div className="text-xs text-gray-500 mt-1">
              {summary.total} {summary.total === 1 ? 'reseña' : 'reseñas'}
            </div>
          </div>
          <Distribution summary={summary} />
        </div>
      )}

      <ul className="space-y-4">
        {reviews.map((review) => (
          <li key={review.id} className="pb-4 border-b border-gray-100 last:border-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{review.author_display_name}</span>
                  {/* La penalización automática se distingue: nadie recibió ese servicio, así
                      que presentarla como la opinión de un cliente sería falso. */}
                  {review.is_system_penalty && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                      <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                      Servicio no completado
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Stars value={Number(review.rating)} size="w-3.5 h-3.5" />
                  <span className="text-xs text-gray-500">{formatDate(review.created_at)}</span>
                  {review.service_name && (
                    <span className="text-xs text-gray-400">· {review.service_name}</span>
                  )}
                </div>
              </div>
              {renderActions?.(review)}
            </div>

            {review.comment && (
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-line break-words">{review.comment}</p>
            )}

            {review.gardener_response && (
              <div className="mt-3 ml-1 pl-3 border-l-2 border-green-200 bg-green-50/40 rounded-r-lg py-2 pr-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-green-800">
                  <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                  {ownerView ? 'Tu respuesta' : `Respuesta de ${gardenerName || 'el profesional'}`}
                  {review.gardener_response_at && (
                    <span className="font-normal text-green-700/70">· {formatDate(review.gardener_response_at)}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-700 whitespace-pre-line break-words">
                  {review.gardener_response}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ReviewList;
