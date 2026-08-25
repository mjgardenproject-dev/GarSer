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
