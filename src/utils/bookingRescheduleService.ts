import { supabase } from '../lib/supabase';

// Respuesta del cliente a una propuesta de otra fecha (GarSer Empresas F6.3, D9). El servidor
// decide todo (y comprueba otra vez que alguien pueda hacerlo); después se avisa a la empresa y,
// si acepta, a quien va. Devuelve un texto para el aviso en pantalla.

export type RescheduleOutcome = 'accepted' | 'rejected' | 'expired' | 'no_longer_available';

export const RESCHEDULE_MESSAGES: Record<RescheduleOutcome, string> = {
  accepted: 'Hecho: tu servicio ya está en la nueva fecha.',
  rejected: 'Mantienes la fecha que tenías.',
  expired: 'La propuesta ha caducado: tu servicio sigue en su fecha.',
  no_longer_available: 'Esa franja ya no está libre: tu servicio sigue en su fecha. La empresa puede proponerte otra.',
};

export async function respondBookingReschedule(bookingId: string, accept: boolean): Promise<RescheduleOutcome> {
  const { data, error } = await supabase.rpc('respond_booking_reschedule', { p_booking_id: bookingId, p_accept: accept });
  if (error) throw new Error(error.message || 'No se ha podido responder a la propuesta.');
  // El aviso a la empresa (y a quien va) lo apunta el servidor al cambiar reschedule_status.
  return ((data || {}) as { outcome?: RescheduleOutcome }).outcome || 'expired';
}
