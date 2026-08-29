import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';
import { leerErrorDeFuncion } from './bookingLifecycleService';

// Confirmación del servicio e incidencias.
//
// El cliente confirma o abre una incidencia por RPC directa (`confirm_booking_service`,
// `report_booking_incident`): son operaciones que no mueven dinero, así que no necesitan pasar
// por una edge function. Resolver una incidencia SÍ mueve dinero (reembolso en Stripe), y por
// eso ese único camino pasa por `booking-payment`, igual que cancelar una reserva.

export type IncidentKind =
  | 'gardener_no_show'
  | 'service_not_done'
  | 'service_incomplete'
  | 'billing'
  | 'behaviour'
  | 'other';

/** Las tres primeras congelan la reserva y pueden acabar en devolución; el resto son soporte. */
export const BLOCKING_INCIDENT_KINDS: IncidentKind[] = ['gardener_no_show', 'service_not_done', 'service_incomplete'];

export interface IncidentKindOption {
  kind: IncidentKind;
  label: string;
  hint?: string;
}

export const INCIDENT_KIND_OPTIONS: IncidentKindOption[] = [
  { kind: 'gardener_no_show', label: 'El profesional no vino', hint: 'Si lo confirmamos, te devolvemos los gastos de gestión.' },
  { kind: 'service_not_done', label: 'Vino, pero no hizo el trabajo', hint: 'Si lo confirmamos, te devolvemos los gastos de gestión.' },
  { kind: 'service_incomplete', label: 'El trabajo quedó incompleto', hint: 'Si lo confirmamos, te devolvemos los gastos de gestión.' },
  { kind: 'billing', label: 'Un problema con el cobro' },
  { kind: 'behaviour', label: 'Un problema de trato' },
  { kind: 'other', label: 'Otro problema' },
];

type IncidentRpcName =
  | 'confirm_booking_service'
  | 'report_booking_incident'
  | 'respond_to_incident'
  | 'mark_gardener_finished';

async function callRpc<T>(name: IncidentRpcName, args: Record<string, unknown>): Promise<T> {
  // `supabase.rpc()` resuelve la forma de `args` a partir del literal de `name`, y no hay forma
  // razonable de expresarlo en un wrapper genérico para 4 RPCs sin repetir la firma de cada una.
  // El cast es seguro: cada llamada real (más abajo en este fichero) pasa exactamente las claves
  // que esa RPC espera, verificado en el navegador y contra la base de datos esta misma sesión.
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) {
    // Las RPC de este flujo lanzan con RAISE EXCEPTION y un mensaje pensado para leerse tal
    // cual ("Ya tienes una incidencia abierta sobre esta reserva"): a diferencia del camino de
    // `booking-payment`, aquí no hay envoltorio HTTP que oculte el cuerpo.
    throw new Error(error.message || 'No se pudo completar la operación.');
  }
  return data as T;
}

/** Confirma que el servicio se prestó. Idempotente: pulsarlo dos veces no es un error. */
export async function confirmBookingService(bookingId: string) {
  const result = await callRpc<{ outcome: string; idempotent: boolean }>('confirm_booking_service', {
    p_booking_id: bookingId,
  });
  reportBookingEvent('info', {
    event: 'booking.client_confirmed',
    context: { bookingId, outcome: result.outcome },
  });
  return result;
}

/** Abre un parte de incidencia. El cliente no resuelve nada: lo revisa un administrador. */
export async function reportBookingIncident(bookingId: string, kind: IncidentKind, description: string) {
  const result = await callRpc<{ incidentId: string; blocksCompletion: boolean }>('report_booking_incident', {
    p_booking_id: bookingId,
    p_kind: kind,
    p_description: description,
  });
  reportBookingEvent('info', {
    event: 'booking.incident_reported',
    context: { bookingId, kind, blocksCompletion: result.blocksCompletion },
  });

  // Best-effort: el cliente autenticado es participante de la reserva, así que puede disparar
  // este correo directamente. Si falla, la incidencia ya quedó registrada y visible en la app
  // -no se pierde nada salvo el aviso-, pero queda en telemetría en vez de en silencio.
  try {
    const { error } = await supabase.functions.invoke('send-email-notification', {
      body: { type: 'booking_incident_received', bookingId },
    });
    if (error) throw error;
  } catch (emailError) {
    reportBookingEvent('warn', {
      event: 'booking.incident_received_email_failed',
      context: { bookingId, message: emailError instanceof Error ? emailError.message : 'unknown' },
    });
  }

  return result;
}

/** La alegación del jardinero sobre una incidencia abierta contra su reserva. */
export async function respondToIncident(incidentId: string, response: string) {
  return callRpc<{ ok: boolean }>('respond_to_incident', { p_incident_id: incidentId, p_response: response });
}

/** "He terminado": avisa al cliente, no cierra la reserva. */
export async function markGardenerFinished(bookingId: string) {
  const result = await callRpc<{ outcome: string; idempotent: boolean }>('mark_gardener_finished', {
    p_booking_id: bookingId,
  });
  reportBookingEvent('info', { event: 'booking.gardener_finished', context: { bookingId, outcome: result.outcome } });
  return result;
}

export interface IncidentResolutionResult {
  incidentId: string;
  bookingId: string;
  status: string;
  moneyAction: 'refund' | 'none';
  moneyStatus: string;
}

/**
 * Resolución del administrador. Única acción de este flujo que mueve dinero, así que pasa por
 * `booking-payment` (el único componente que habla con Stripe), no por una RPC directa.
 */
export async function resolveBookingIncident(
  incidentId: string,
  outcome: 'refund' | 'no_action' | 'reject',
  note?: string,
): Promise<IncidentResolutionResult> {
  const { data, error } = await supabase.functions.invoke('booking-payment', {
    body: { action: 'resolve_incident', incidentId, outcome, note },
  });
  if (error) {
    const { mensaje } = await leerErrorDeFuncion(error);
    throw new Error(mensaje);
  }
  const result = (data || {}) as IncidentResolutionResult;
  reportBookingEvent(result.moneyStatus === 'failed' ? 'error' : 'info', {
    event: 'booking.incident_resolved',
    context: { incidentId, outcome, moneyAction: result.moneyAction, moneyStatus: result.moneyStatus },
  });
  return result;
}
