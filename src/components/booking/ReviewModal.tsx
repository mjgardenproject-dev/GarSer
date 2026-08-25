import { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Formulario de valoración de un servicio.
 *
 * Vivía dentro de "Mis reservas", así que desde cualquier otro sitio solo se podía *navegar a
 * la lista* y esperar que el cliente volviera a encontrar su reserva y pulsara "Valorar". Al
 * extraerlo, cada pantalla abre el formulario directamente sobre la reserva que el cliente ya
 * había elegido.
 *
 * Admite medias estrellas porque el esquema las admite (`reviews_rating_half_step`).
 */

interface Props {
  bookingId: string;
  gardenerId?: string | null;
  gardenerName?: string | null;
  onClose: () => void;
  /** Se llama tras guardar, para que la pantalla anfitriona refresque su lista. */
  onSaved?: () => void;
}

const ReviewModal = ({ bookingId, gardenerId, gardenerName, onClose, onSaved }: Props) => {
  const { user } = useAuth();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('reviews')
        .select('id, rating, comment')
        .eq('booking_id', bookingId)
        .limit(1);
      if (!alive) return;
      const existing = (data || [])[0] as { id: string; rating: number; comment?: string } | undefined;
      if (existing) {
        setExistingId(existing.id);
        setRating(Number(existing.rating));
        setComment(existing.comment || '');
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [bookingId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const submit = async () => {
    if (!user?.id || existingId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('reviews').insert({
        booking_id: bookingId,
        client_id: user.id,
        gardener_id: gardenerId,
        rating,
        comment: comment.trim() || null,
      } as never);
      if (error) throw error;
      // Los agregados los recalcula un trigger SECURITY DEFINER sobre `reviews`.
      toast.success('¡Gracias! Tu valoración ya está publicada.');
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la valoración.');
    } finally {
      setSaving(false);
    }
  };

  const isReadOnly = Boolean(existingId);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[1000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
    >
      {/* Hoja inferior en móvil, diálogo centrado en pantallas grandes. */}
      <div className="bg-white w-full sm:w-[480px] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 shadow-xl max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 id="review-modal-title" className="text-lg font-semibold text-gray-900">
            {isReadOnly ? 'Tu valoración' : 'Valorar servicio'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {gardenerName && (
          <p className="mb-4 text-sm text-gray-600">
            Servicio realizado por <span className="font-medium text-gray-900">{gardenerName}</span>
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-500">Cargando…</p>
        ) : (
          <>
            <div className="mb-4">
              <span className="block text-sm font-medium text-gray-700 mb-2">Puntuación</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((position) => {
                  const filled = Math.max(Math.min(rating - (position - 1), 1), 0);
                  return (
                    <div key={position} className="relative w-9 h-9">
                      <Star className="absolute inset-0 w-9 h-9 text-gray-300" aria-hidden="true" />
                      <div className="absolute inset-0 overflow-hidden" style={{ width: `${filled * 100}%` }}>
                        <Star className="w-9 h-9 text-yellow-500 fill-current" aria-hidden="true" />
                      </div>
                      {/* Dos mitades por estrella: medio punto es la precisión que admite el esquema. */}
                      <button
                        type="button"
                        onClick={() => !isReadOnly && setRating(position - 0.5)}
                        disabled={isReadOnly}
                        className="absolute left-0 top-0 h-full w-1/2 disabled:cursor-default"
                        aria-label={`${position - 0.5} estrellas`}
                      />
                      <button
                        type="button"
                        onClick={() => !isReadOnly && setRating(position)}
                        disabled={isReadOnly}
                        className="absolute right-0 top-0 h-full w-1/2 disabled:cursor-default"
                        aria-label={`${position} estrellas`}
                      />
                    </div>
                  );
                })}
                <span className="ml-2 text-sm text-gray-600 tabular-nums">
                  {rating.toFixed(1).replace('.', ',')} / 5
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="review-comment" className="block text-sm font-medium text-gray-700 mb-2">
                Comentario {isReadOnly ? '' : '(opcional)'}
              </label>
              <textarea
                id="review-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 1000))}
                disabled={isReadOnly}
                rows={4}
                /* `text-base` en móvil: por debajo de 16px iOS hace zoom al enfocar el campo. */
                className="w-full p-3 border border-gray-300 rounded-lg text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:bg-gray-50"
                placeholder="¿Qué tal fue? Tu opinión ayuda a otros clientes a elegir."
              />
              {!isReadOnly && (
                <p className="mt-1 text-xs text-gray-500">{comment.length}/1000 · podrás editarla durante 48 h</p>
              )}
            </div>

            {isReadOnly ? (
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Cerrar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 transition-colors"
              >
                {saving ? 'Enviando…' : 'Enviar valoración'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReviewModal;
