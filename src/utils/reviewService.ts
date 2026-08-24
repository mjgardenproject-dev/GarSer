import { supabase } from '../lib/supabase';

/**
 * Acceso a reseñas.
 *
 * Se lee de la vista `public_gardener_reviews` y NO de la tabla: desde el paso 1 `profiles` está
 * cerrada a visitantes sin sesión, así que resolver el nombre del autor desde el navegador
 * obligaría a reabrir esa fuga de PII. La vista devuelve el autor ya enmascarado ("Laura F.")
 * y solo las reseñas no ocultas.
 */
export interface PublicReview {
  id: string;
  gardener_id: string;
  booking_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  gardener_response: string | null;
  gardener_response_at: string | null;
  is_system_penalty: boolean;
  system_reason: string | null;
  author_display_name: string;
  service_name: string | null;
}

export interface ReviewSummary {
  average: number | null;
  total: number;
  /** Cuántas reseñas hay de cada nota, de 5 a 1, para la barra tipo Google. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

const EMPTY_DISTRIBUTION: ReviewSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

export function summarizeReviews(reviews: PublicReview[]): ReviewSummary {
  if (reviews.length === 0) {
    return { average: null, total: 0, distribution: { ...EMPTY_DISTRIBUTION } };
  }
  const distribution = { ...EMPTY_DISTRIBUTION };
  let sum = 0;
  reviews.forEach((review) => {
    const value = Number(review.rating) || 0;
    sum += value;
    // Las medias estrellas se agrupan hacia arriba, como hace Google: un 4,5 cuenta en la
    // barra de 5. La media sigue siendo la real, sin redondear.
    const bucket = Math.min(5, Math.max(1, Math.ceil(value))) as 1 | 2 | 3 | 4 | 5;
    distribution[bucket] += 1;
  });
  return {
    average: Math.round((sum / reviews.length) * 100) / 100,
    total: reviews.length,
    distribution,
  };
}

export async function fetchGardenerReviews(gardenerId: string): Promise<PublicReview[]> {
  if (!gardenerId) return [];
  const { data, error } = await supabase
    .from('public_gardener_reviews')
    .select('*')
    .eq('gardener_id', gardenerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('No se pudieron cargar las reseñas:', error.message);
    return [];
  }
  return (data || []) as PublicReview[];
}

/**
 * Respuesta del jardinero. Va por RPC y no por UPDATE directo: RLS decide sobre la FILA, no
 * sobre la columna, así que un permiso de escritura sobre las reseñas dirigidas a él le
 * permitiría cambiarse la propia nota.
 */
export async function respondToReview(reviewId: string, response: string): Promise<void> {
  const { error } = await supabase.rpc('respond_to_review', {
    p_review_id: reviewId,
    p_response: response,
  });
  if (error) throw new Error(error.message || 'No se pudo publicar la respuesta.');
}

/** Ventana de edición de la respuesta: 48 h desde la primera publicación. */
export function canEditResponse(review: Pick<PublicReview, 'gardener_response_at'>): boolean {
  if (!review.gardener_response_at) return true;
  const published = new Date(review.gardener_response_at).getTime();
  return Number.isFinite(published) && Date.now() - published < 48 * 60 * 60 * 1000;
}
