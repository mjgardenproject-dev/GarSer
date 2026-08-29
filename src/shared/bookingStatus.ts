/**
 * Estado de una reserva: texto y color, en un único sitio.
 *
 * Estaba duplicado en cuatro pantallas con mapeos que ya habían divergido: `completed` salía
 * gris en "Mis reservas" y verde en el chat, y el panel del jardinero solo cubría cuatro de los
 * ocho estados —el resto se pintaba con el identificador crudo (`no_show_client`) delante del
 * usuario—.
 *
 * El público IMPORTA: el mismo estado no se cuenta igual a las dos partes. `no_show_client` es
 * "No se pudo realizar" para quien contrató y "Cliente ausente" para quien fue a trabajar.
 * Por eso el texto se pide con audiencia y el color no.
 */

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'no_show_client'
  | 'no_show_gardener'
  | 'disputed';

export type BookingStatusAudience = 'client' | 'gardener';

/** Clases del chip. Se conserva la paleta de "Mis reservas", que era la única completa. */
const TONE_BY_STATUS: Record<BookingStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-600',
  no_show_client: 'bg-orange-100 text-orange-800',
  no_show_gardener: 'bg-orange-100 text-orange-800',
  disputed: 'bg-purple-100 text-purple-800',
};

// Femenino en todos: el sujeto es "la reserva". Antes convivían "Confirmado" y "Confirmada"
// en pantallas distintas para el mismo dato.
const LABEL_BY_STATUS: Record<BookingStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  expired: 'Caducada',
  no_show_client: 'No se pudo realizar',
  no_show_gardener: 'El profesional no acudió',
  disputed: 'En revisión',
};

/** Solo donde el jardinero necesita otra lectura; el resto hereda la de arriba. */
const GARDENER_OVERRIDES: Partial<Record<BookingStatus, string>> = {
  no_show_client: 'Cliente ausente',
  no_show_gardener: 'No acudiste',
};

const isKnownStatus = (value: string): value is BookingStatus =>
  Object.prototype.hasOwnProperty.call(LABEL_BY_STATUS, value);

export function getBookingStatusLabel(
  status: string | null | undefined,
  audience: BookingStatusAudience = 'client',
): string {
  const normalized = String(status || '').trim();
  if (!isKnownStatus(normalized)) {
    // Nunca se enseña el identificador crudo: un "no_show_client" delante del cliente parece
    // una web rota. Ante un estado desconocido, el texto neutro es preferible.
    return 'Estado desconocido';
  }
  if (audience === 'gardener' && GARDENER_OVERRIDES[normalized]) {
    return GARDENER_OVERRIDES[normalized] as string;
  }
  return LABEL_BY_STATUS[normalized];
}

export function getBookingStatusTone(status: string | null | undefined): string {
  const normalized = String(status || '').trim();
  return isKnownStatus(normalized) ? TONE_BY_STATUS[normalized] : 'bg-gray-100 text-gray-800';
}

/** Estados en los que la reserva sigue viva y el cliente puede cancelarla. */
export function isCancellableStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim();
  return normalized === 'pending' || normalized === 'confirmed';
}

/** Estados cerrados que no esperan ninguna acción: van al bloque "Otras reservas". */
export function isClosedWithoutService(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim();
  return (
    normalized === 'cancelled' ||
    normalized === 'expired' ||
    normalized === 'no_show_client' ||
    normalized === 'no_show_gardener' ||
    normalized === 'disputed'
  );
}

/**
 * Fin real del servicio, en milisegundos. Duplica el cálculo de `getBookingServiceEnd`
 * (`src/utils/bookingLifecycleService.ts`) a propósito: ese módulo importa el cliente de
 * Supabase, y este fichero se usa en sitios de puro display -incluidas pruebas- donde no
 * conviene arrastrar esa dependencia por dos líneas de aritmética de fechas.
 */
function serviceEndMs(booking: { date?: string | null; start_time?: string | null; duration_hours?: number | null }): number | null {
  if (!booking?.date || !booking?.start_time) return null;
  const end = new Date(`${booking.date}T${String(booking.start_time).slice(0, 8)}`);
  if (Number.isNaN(end.getTime())) return null;
  end.setHours(end.getHours() + Math.max(Number(booking.duration_hours) || 1, 1));
  return end.getTime();
}

/**
 * ¿Tiene el cliente algo que confirmar? El servicio ya terminó y la reserva sigue `confirmed`:
 * nadie la ha cerrado todavía. Es el hueco que antes se resolvía en silencio -la reserva vivía
 * en "Confirmada" indefinidamente hasta que el reloj la cerraba a las 24 h sin preguntar nada-.
 */
export function needsClientConfirmation(
  booking: { status?: string | null; date?: string | null; start_time?: string | null; duration_hours?: number | null },
  now: number = Date.now(),
): boolean {
  if (booking.status !== 'confirmed') return false;
  const end = serviceEndMs(booking);
  return end !== null && now >= end;
}

/**
 * ¿Puede el cliente abrir una incidencia sobre esta reserva? La puerta de entrada es solo
 * temporal -que el servicio ya haya ocurrido-: la RPC `report_booking_incident` es quien decide
 * de verdad qué tipos de incidencia admite cada estado y hasta cuándo, así que aquí basta con
 * no ofrecer el botón para un servicio que todavía no ha pasado.
 */
export function canReportIncident(
  booking: { date?: string | null; start_time?: string | null; duration_hours?: number | null },
  now: number = Date.now(),
): boolean {
  const end = serviceEndMs(booking);
  return end !== null && now >= end;
}
