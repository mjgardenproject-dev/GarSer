// Variables del trabajo de una reserva para las tarjetas del jardinero.
//
// Fuente: RPC get_booking_service_details (SECURITY DEFINER), que devuelve un
// subconjunto blanqueado del input_payload del quote (zonas/grupos por servicio)
// solo a los participantes de la reserva. Funciona tanto para reservas por fotos
// (análisis IA) como manuales, porque ambas rellenan las mismas estructuras.

import { supabase } from '../lib/supabase';

export interface BookingServiceInput {
  dataInputMode?: 'photos' | 'manual' | string;
  wasteRemoval?: boolean;
  lawnZones?: Array<Record<string, unknown>>;
  hedgeZones?: Array<Record<string, unknown>>;
  treeGroups?: Array<Record<string, unknown>>;
  shrubGroups?: Array<Record<string, unknown>>;
  palmGroups?: Array<Record<string, unknown>>;
  phytosanitaryZones?: Array<Record<string, unknown>>;
  weedingZones?: Array<Record<string, unknown>>;
}

export async function fetchBookingServiceDetails(bookingId: string): Promise<BookingServiceInput | null> {
  try {
    const { data, error } = await supabase.rpc('get_booking_service_details', {
      p_booking_id: bookingId,
    });
    if (error) {
      console.warn('get_booking_service_details no disponible:', error.message);
      return null;
    }
    return (data as BookingServiceInput | null) || null;
  } catch {
    return null;
  }
}
