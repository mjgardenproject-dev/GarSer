import { supabase } from '../lib/supabase';
import { fetchProfileNames } from './profileNames';
import { fetchBookingMediaMap } from './bookingMediaService';
import { needsClientConfirmation } from '../shared/bookingStatus';

/**
 * Reservas del cliente agrupadas para la pantalla de inicio.
 *
 * El orden de prioridad lo fijó el usuario y responde a qué necesita el cliente en cada momento:
 * primero lo que está por venir (necesita la fecha y el chat), después lo que reclama una acción
 * suya (valorar), y al final el histórico (desde donde repite).
 */
export interface OverviewBooking {
  id: string;
  status: string;
  date: string;
  start_time: string | null;
  duration_hours: number | null;
  client_address: string | null;
  gardener_id: string;
  service_id: string | null;
  service_name: string;
  gardener_name: string;
  total_price: number | null;
  management_fee: number | null;
  client_total_price: number | null;
  /**
   * Necesario para los importes: sin él, `getBookingAmounts` da `feeIsKnown = false` y la
   * tarjeta diría "Precio del servicio" en vez de "Total de la reserva".
   */
  management_fee_source: string | null;
  notes: string | null;
  media_urls: string[];
  price_change_status: string | null;
  proposed_total_price: number | null;
  proposed_price_reason: string | null;
  /** Solo en las completadas: la nota que dejó el cliente, si la dejó. */
  review_rating: number | null;
  /** Cuándo se da por completada sola si el cliente no confirma nada. */
  confirmation_deadline_at: string | null;
}

export interface ClientBookingsOverview {
  /**
   * El servicio ya terminó y sigue `confirmed`: nadie la ha cerrado. Va PRIMERO porque es la
   * acción más importante que tiene el cliente -antes vivía escondida dentro de "upcoming"
   * durante 24 h y luego desaparecía sin más, que es justo el hueco que dejaba cobrar un
   * servicio sin que nadie preguntara nada-.
   */
  toConfirm: OverviewBooking[];
  upcoming: OverviewBooking[];
  toReview: OverviewBooking[];
  reviewed: OverviewBooking[];
  /** Con una incidencia abierta: ni se cierra ni se cobra sola mientras se revisa. */
  inReview: OverviewBooking[];
  /**
   * Todo lo que no encaja arriba: canceladas, caducadas y cualquier estado desconocido. Es un
   * cajón de sastre A PROPÓSITO, calculado por descarte: antes esas reservas no aparecían en
   * ningún grupo y desde el inicio se evaporaban sin decir qué había pasado con ellas.
   */
  closed: OverviewBooking[];
  isEmpty: boolean;
}

const EMPTY: ClientBookingsOverview = {
  toConfirm: [], upcoming: [], toReview: [], reviewed: [], inReview: [], closed: [], isEmpty: true,
};

/** Fin del servicio, para decidir si una reserva confirmada sigue siendo "próxima". */
const serviceStart = (booking: { date: string; start_time: string | null }): number => {
  const time = booking.start_time || '00:00:00';
  const parsed = new Date(`${booking.date}T${time}`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
};

export async function fetchClientBookingsOverview(clientId: string): Promise<ClientBookingsOverview> {
  if (!clientId) return EMPTY;

  const { data, error } = await supabase
    .from('bookings')
    .select('id, status, date, start_time, duration_hours, client_address, gardener_id, service_id, notes, total_price, management_fee, management_fee_source, client_total_price, price_change_status, proposed_total_price, proposed_price_reason, confirmation_deadline_at, services(name, icon)')
    .eq('client_id', clientId)
    .order('date', { ascending: false });

  if (error) {
    console.warn('No se pudieron cargar las reservas del cliente:', error.message);
    return EMPTY;
  }

  const rows = data || [];
  if (rows.length === 0) return EMPTY;

  // Las reseñas propias se leen de `reviews` (el cliente ve las suyas por RLS) y no de la vista
  // pública: aquí hace falta saber si ESTE cliente ya valoró, no lo que se publica.
  const [names, reviewsResult, mediaMap] = await Promise.all([
    fetchProfileNames(rows.map((row: { gardener_id: string }) => row.gardener_id)),
    supabase.from('reviews').select('booking_id, rating').eq('client_id', clientId),
    // `statusByBooking` importa: sin él se muestran fotos legacy en reservas ya completadas,
    // cuyos archivos se borran de Storage al cerrarlas.
    fetchBookingMediaMap(
      rows.map((row: { id: string }) => row.id),
      Object.fromEntries(rows.map((row: { id: string; notes?: string | null }) => [row.id, row.notes ?? null])),
      { statusByBooking: Object.fromEntries(rows.map((row: { id: string; status: string }) => [row.id, row.status])) },
    ),
  ]);

  const ratingByBooking = new Map<string, number>();
  (reviewsResult.data || []).forEach((review: { booking_id: string | null; rating: number }) => {
    if (review.booking_id) ratingByBooking.set(review.booking_id, Number(review.rating));
  });

  const mapped: OverviewBooking[] = rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    status: String(row.status || ''),
    date: String(row.date || ''),
    start_time: (row.start_time as string) ?? null,
    duration_hours: (row.duration_hours as number) ?? null,
    client_address: (row.client_address as string) ?? null,
    gardener_id: String(row.gardener_id || ''),
    service_id: (row.service_id as string) ?? null,
    service_name: ((row.services as { name?: string } | null)?.name) || 'Servicio',
    gardener_name: names[String(row.gardener_id)]?.full_name?.trim() || 'Tu profesional',
    total_price: (row.total_price as number) ?? null,
    management_fee: (row.management_fee as number) ?? null,
    client_total_price: (row.client_total_price as number) ?? null,
    management_fee_source: (row.management_fee_source as string) ?? null,
    notes: (row.notes as string) ?? null,
    media_urls: mediaMap[String(row.id)] || [],
    price_change_status: (row.price_change_status as string) ?? null,
    proposed_total_price: (row.proposed_total_price as number) ?? null,
    proposed_price_reason: (row.proposed_price_reason as string) ?? null,
    review_rating: ratingByBooking.get(String(row.id)) ?? null,
    confirmation_deadline_at: (row.confirmation_deadline_at as string) ?? null,
  }));

  return groupClientBookings(mapped, Date.now());
}

/**
 * Reparte las reservas en los cuatro grupos del inicio del cliente. Separada de la consulta
 * para poder comprobarla sin base de datos, que es donde están las decisiones delicadas.
 */
export function groupClientBookings(mapped: OverviewBooking[], now: number): ClientBookingsOverview {
  // Se decide ANTES que "próxima": una confirmada cuyo servicio ya terminó no es algo que está
  // por venir, es algo que espera una respuesta. Da igual desde cuándo -si el reloj no la ha
  // cerrado todavía por lo que sea, sigue necesitando confirmación, no esconderse en "cerradas"-.
  const toConfirm = mapped
    .filter((b) => needsClientConfirmation(b, now))
    .sort((a, b) => serviceStart(a) - serviceStart(b));
  const toConfirmIds = new Set(toConfirm.map((b) => b.id));

  // "Próxima" incluye las pendientes de aceptar: para el cliente también es algo que está por
  // venir y sobre lo que espera noticias. El margen de 24 h evita que un servicio de esta
  // mañana desaparezca de la vista antes de que el profesional lo cierre.
  const upcoming = mapped
    .filter(
      (b) =>
        !toConfirmIds.has(b.id) &&
        ['pending', 'confirmed'].includes(b.status) &&
        serviceStart(b) >= now - 24 * 60 * 60 * 1000,
    )
    .sort((a, b) => serviceStart(a) - serviceStart(b));

  const completed = mapped.filter((b) => b.status === 'completed');
  const toReview = completed.filter((b) => b.review_rating === null);
  const reviewed = completed.filter((b) => b.review_rating !== null);

  const inReview = mapped.filter((b) => b.status === 'disputed');

  // Por descarte, no por lista de estados: si mañana aparece un estado nuevo, cae aquí en vez
  // de desaparecer de la pantalla sin que nadie se entere.
  const placed = new Set([...toConfirm, ...upcoming, ...toReview, ...reviewed, ...inReview].map((b) => b.id));
  const closed = mapped.filter((b) => !placed.has(b.id));

  return { toConfirm, upcoming, toReview, reviewed, inReview, closed, isEmpty: mapped.length === 0 };
}
