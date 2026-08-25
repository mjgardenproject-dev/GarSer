import { supabase } from '../lib/supabase';
import { fetchProfileNames } from './profileNames';

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

/** Una reseña escrita por el cliente que la mira, con el contexto de a quién y a qué servicio. */
export interface MyReview {
  id: string;
  booking_id: string | null;
  gardener_id: string;
  gardener_name: string;
  service_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  gardener_response: string | null;
  gardener_response_at: string | null;
}

/**
 * Las reseñas que ha escrito un cliente.
 *
 * Aquí sí se lee la tabla y no la vista pública: el cliente es el autor, así que no hay PII
 * ajena que enmascarar, y necesita ver también las que un administrador haya ocultado —de lo
 * contrario su reseña se desvanecería sin explicación. El nombre del profesional y el del
 * servicio se resuelven aparte, por las mismas razones de privacidad de siempre.
 */
export async function fetchMyReviews(clientId: string): Promise<MyReview[]> {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('reviews')
    .select('id, booking_id, gardener_id, rating, comment, created_at, gardener_response, gardener_response_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('No se pudieron cargar tus valoraciones:', error.message);
    return [];
  }

  const rows = (data || []) as Array<Omit<MyReview, 'gardener_name' | 'service_name'>>;
  if (rows.length === 0) return [];

  const bookingIds = rows.map((row) => row.booking_id).filter((id): id is string => Boolean(id));
  const [names, bookingsResult] = await Promise.all([
    fetchProfileNames(rows.map((row) => row.gardener_id)),
    bookingIds.length
      ? supabase.from('bookings').select('id, services(name)').in('id', bookingIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const serviceByBooking = new Map<string, string>();
  ((bookingsResult.data || []) as Array<{ id: string; services?: { name?: string } | null }>).forEach((row) => {
    if (row.services?.name) serviceByBooking.set(row.id, row.services.name);
  });

  return rows.map((row) => ({
    ...row,
    rating: Number(row.rating),
    gardener_name: names[row.gardener_id]?.full_name?.trim() || 'Tu profesional',
    service_name: row.booking_id ? serviceByBooking.get(row.booking_id) ?? null : null,
  }));
}

/** Plazo de edición de la reseña por su autor: 48 h, el mismo que aplica la RPC. */
export function canEditReview(review: Pick<MyReview, 'created_at'>): boolean {
  const written = new Date(review.created_at).getTime();
  return Number.isFinite(written) && Date.now() - written < 48 * 60 * 60 * 1000;
}

/**
 * Edición de la reseña dentro del plazo. Por RPC, igual que la respuesta del profesional: un
 * UPDATE directo exigiría abrir permisos de escritura sobre la tabla.
 */
export async function updateOwnReview(reviewId: string, rating: number, comment: string): Promise<void> {
  const { error } = await supabase.rpc('update_own_review', {
    p_review_id: reviewId,
    p_rating: rating,
    p_comment: comment,
  });
  if (error) throw new Error(error.message || 'No se pudo actualizar tu valoración.');
}
