import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import ReviewList from '../reviews/ReviewList';
import {
  fetchGardenerReviews,
  respondToReview,
  canEditResponse,
  type PublicReview,
} from '../../utils/reviewService';

/**
 * Reseñas del profesional, con respuesta.
 *
 * Antes de esta pantalla el jardinero no tenía NINGUNA forma de ver lo que sus clientes
 * escribían sobre él: la reseña se guardaba y se quedaba ahí.
 */
const GardenerReviews = () => {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setReviews(await fetchGardenerReviews(user.id));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const publish = async (reviewId: string) => {
    setSaving(true);
    try {
      await respondToReview(reviewId, draft);
      toast.success('Respuesta publicada. El cliente la verá en el chat de la reserva.');
      setEditing(null);
      setDraft('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo publicar la respuesta.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-500">Cargando tus reseñas…</div>;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Tus reseñas</h2>
      <p className="text-sm text-gray-500 mb-5">
        Responder con educación a una crítica transmite más confianza que no tener ninguna.
      </p>

      <ReviewList
        gardenerId={user?.id || ''}
        ownerView
        reviews={reviews}
        renderActions={(review) => {
          // La penalización automática no se responde: no la escribió un cliente.
          if (review.is_system_penalty) return null;

          const editable = canEditResponse(review);
          if (!review.gardener_response && !editable) return null;

          if (editing === review.id) return null;

          return (
            <button
              type="button"
              onClick={() => { setEditing(review.id); setDraft(review.gardener_response || ''); }}
              disabled={!editable}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              title={editable ? undefined : 'El plazo de 48 h para editar la respuesta ha terminado'}
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              {review.gardener_response ? 'Editar respuesta' : 'Responder'}
            </button>
          );
        }}
      />

      {editing && (
        <div className="mt-4 p-4 rounded-xl border border-gray-200 bg-gray-50">
          <label htmlFor="respuesta" className="block text-sm font-medium text-gray-700 mb-2">
            Tu respuesta pública
          </label>
          <textarea
            id="respuesta"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
            rows={4}
            className="w-full rounded-lg border border-gray-300 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            placeholder="Gracias por tu valoración…"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-500">{draft.length}/1000 · podrás editarla durante 48 h</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setEditing(null); setDraft(''); }}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void publish(editing)}
                disabled={saving || !draft.trim()}
                className="px-4 py-1.5 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Publicando…' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GardenerReviews;
