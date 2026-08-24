import { useCallback, useEffect, useState } from 'react';
import { EyeOff, Eye, Star } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

/**
 * Moderación de reseñas.
 *
 * Ocultar y NO borrar: una reseña con datos de un tercero o con una acusación difamatoria tiene
 * que dejar de publicarse y de contar para la nota, pero conservarse — si el cliente reclama o
 * hay que responder legalmente, borrar la evidencia es lo peor que se puede haber hecho.
 */
interface ModeratedReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  is_system_penalty: boolean;
  gardener_id: string;
}

const ReviewModeration = () => {
  const [reviews, setReviews] = useState<ModeratedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Se lee la TABLA y no la vista pública: aquí hacen falta también las ya ocultas, que la
    // vista filtra por definición.
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, hidden_at, hidden_reason, is_system_penalty, gardener_id')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error('No se pudieron cargar las reseñas.');
    setReviews((data || []) as ModeratedReview[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleHidden = async (review: ModeratedReview) => {
    const hide = !review.hidden_at;
    let reason: string | null = null;
    if (hide) {
      reason = window.prompt('Motivo por el que se oculta (queda registrado):');
      if (reason === null) return;
      if (!reason.trim()) {
        toast.error('El motivo es obligatorio para ocultar una reseña.');
        return;
      }
    }

    setBusy(review.id);
    const { error } = await supabase.rpc('set_review_hidden', {
      p_review_id: review.id,
      p_hidden: hide,
      p_reason: reason,
    });
    setBusy(null);

    if (error) {
      toast.error(error.message || 'No se pudo actualizar la reseña.');
      return;
    }
    toast.success(hide ? 'Reseña oculta. Deja de contar para la nota.' : 'Reseña restaurada.');
    await load();
  };

  if (loading) return <div className="py-8 text-center text-sm text-gray-500">Cargando reseñas…</div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Moderación de reseñas</h2>
      <p className="text-sm text-gray-500 mb-5">
        Ocultar una reseña la retira de la web y de la nota media, pero no la borra.
      </p>

      {reviews.length === 0 && <p className="text-sm text-gray-500 py-4">Todavía no hay reseñas.</p>}

      <ul className="divide-y divide-gray-100">
        {reviews.map((review) => (
          <li key={review.id} className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-900">
                  <Star className="w-3.5 h-3.5 text-yellow-400 fill-current" aria-hidden="true" />
                  {Number(review.rating).toFixed(1).replace('.', ',')}
                </span>
                {review.is_system_penalty && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    Penalización del sistema
                  </span>
                )}
                {review.hidden_at && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                    Oculta{review.hidden_reason ? ` · ${review.hidden_reason}` : ''}
                  </span>
                )}
              </div>
              {review.comment && (
                <p className="mt-1 text-sm text-gray-600 break-words line-clamp-3">{review.comment}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void toggleHidden(review)}
              disabled={busy === review.id}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              {review.hidden_at ? (
                <><Eye className="w-3.5 h-3.5" aria-hidden="true" />Restaurar</>
              ) : (
                <><EyeOff className="w-3.5 h-3.5" aria-hidden="true" />Ocultar</>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ReviewModeration;
