import { supabase } from '../lib/supabase';
import { fetchProfileNames } from './profileNames';

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
  /** Solo en las completadas: la nota que dejó el cliente, si la dejó. */
  review_rating: number | null;
}

export interface ClientBookingsOverview {
  upcoming: OverviewBooking[];
  toReview: OverviewBooking[];
  reviewed: OverviewBooking[];
  isEmpty: boolean;
}

const EMPTY: ClientBookingsOverview = { upcoming: [], toReview: [], reviewed: [], isEmpty: true };

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
    .select('id, status, date, start_time, duration_hours, client_address, gardener_id, service_id, total_price, management_fee, client_total_price, services(name)')
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
  const [names, reviewsResult] = await Promise.all([
    fetchProfileNames(rows.map((row: { gardener_id: string }) => row.gardener_id)),
    supabase.from('reviews').select('booking_id, rating').eq('client_id', clientId),
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
    review_rating: ratingByBooking.get(String(row.id)) ?? null,
  }));

  const now = Date.now();
  // "Próxima" incluye las pendientes de aceptar: para el cliente también es algo que está por
  // venir y sobre lo que espera noticias.
  const upcoming = mapped
    .filter((b) => ['pending', 'confirmed'].includes(b.status) && serviceStart(b) >= now - 24 * 60 * 60 * 1000)
    .sort((a, b) => serviceStart(a) - serviceStart(b));

  const completed = mapped.filter((b) => b.status === 'completed');

  return {
    upcoming,
    toReview: completed.filter((b) => b.review_rating === null),
    reviewed: completed.filter((b) => b.review_rating !== null),
    isEmpty: mapped.length === 0,
  };
}
