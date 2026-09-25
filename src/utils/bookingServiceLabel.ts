// GarSer Empresas (F8): el nombre de lo que se ha reservado. Una reserva puede llevar varios
// servicios (booking_items): «Corte de césped + Poda de setos». Con uno (o en reservas anteriores,
// sin filas), el nombre del servicio de siempre.

/** Lo que hay que pedir a Supabase junto a la reserva para poder nombrarla. */
export const BOOKING_ITEMS_SELECT = 'booking_items(position, services(name))';

interface LabelRow {
  services?: { name?: string | null } | null;
  booking_items?: Array<{ position?: number | null; services?: { name?: string | null } | null }> | null;
}

export function bookingServiceNames(row: LabelRow | null | undefined): string[] {
  const items = Array.isArray(row?.booking_items) ? [...(row?.booking_items || [])] : [];
  if (items.length > 1) {
    return items
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      .map((item) => String(item.services?.name || '').trim())
      .filter(Boolean);
  }
  const single = String(row?.services?.name || items[0]?.services?.name || '').trim();
  return single ? [single] : [];
}

export function bookingServiceLabel(row: LabelRow | null | undefined): string | null {
  const names = bookingServiceNames(row);
  return names.length ? names.join(' + ') : null;
}

/** ¿La reserva lleva más de un servicio? (entonces no se corrige con el motor de un servicio). */
export const isMultiServiceBooking = (row: LabelRow | null | undefined) =>
  Array.isArray(row?.booking_items) && (row?.booking_items || []).length > 1;
