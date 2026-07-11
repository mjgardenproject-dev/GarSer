import { supabase } from '../lib/supabase';
import { reportBookingEvent } from './bookingTelemetry';

export interface RespondBookingRequestParams {
  bookingId: string;
  response: 'accept' | 'reject';
  operationId?: string;
}

export interface BroadcastBookingRequestParams {
  gardenerIds: string[];
  serviceId: string;
  date: string;
  startTime: string;
  durationHours: number;
  totalPrice: number;
  clientAddress: string;
  notes?: string;
  pricingContext?: Record<string, unknown>;
  travelFee?: number;
  hourlyRate?: number;
  operationId?: string;
}

const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export async function expireStaleBookingRequests(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('expire_stale_booking_requests', {
      p_gardener_id: null,
    });
    if (error) throw error;
    const expiredCount = Number(data || 0);
    reportBookingEvent('info', {
      event: 'booking.requests_expired',
      context: {
        expiredCount,
        scope: 'manual_or_dashboard',
      },
    });
    return expiredCount;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.requests_expire_failed',
      context: {
        scope: 'manual_or_dashboard',
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

// Email al cliente cuando el jardinero acepta/rechaza (fire-and-forget: el email
// jamás debe bloquear ni romper la respuesta a la solicitud).
async function notifyClientOfResponse(bookingId: string, response: 'accept' | 'reject'): Promise<void> {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('client_id, gardener_id, service_id, date, start_time, total_price')
      .eq('id', bookingId)
      .single();
    if (!booking?.client_id) return;

    const ids = [booking.client_id, booking.gardener_id].filter(Boolean) as string[];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    const nameOf = (id: string | null) =>
      profiles?.find((p: { id: string; full_name: string | null }) => p.id === id)?.full_name || '';

    let serviceName = '';
    if (booking.service_id) {
      const { data: service } = await supabase
        .from('services').select('name').eq('id', booking.service_id).single();
      serviceName = service?.name || '';
    }

    const dateText = booking.date
      ? `${booking.date}${booking.start_time ? ` a las ${String(booking.start_time).slice(0, 5)}` : ''}`
      : '';

    await supabase.functions.invoke('send-email-notification', {
      body: {
        user_id: booking.client_id,
        type: response === 'accept' ? 'booking_accepted' : 'booking_rejected',
        data: {
          name: nameOf(booking.client_id) || 'cliente',
          counterpartName: nameOf(booking.gardener_id),
          serviceName,
          dateText,
          priceText: booking.total_price != null ? `${Number(booking.total_price).toFixed(2)} €` : '',
        },
      },
    });
  } catch (error) {
    // Solo telemetría: el flujo principal ya terminó bien
    reportBookingEvent('warn', {
      event: 'booking.response_email_failed',
      context: {
        bookingId,
        response,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
  }
}

export async function respondBookingRequest(params: RespondBookingRequestParams) {
  const operationId = params.operationId || randomId();
  try {
    const { data, error } = await supabase.rpc('respond_booking_request', {
      p_booking_id: params.bookingId,
      p_response: params.response,
      p_operation_id: operationId,
    });

    if (error) throw error;
    const result = data as { booking_id: string; status: string; message?: string };
    reportBookingEvent('info', {
      event: 'booking.request_responded',
      context: {
        bookingId: params.bookingId,
        response: params.response,
        operationId,
        status: result.status,
      },
    });
    // No await: el email no bloquea la respuesta al jardinero
    void notifyClientOfResponse(params.bookingId, params.response);
    return result;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.request_response_failed',
      context: {
        bookingId: params.bookingId,
        response: params.response,
        operationId,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}

export async function createBroadcastBookingRequests(params: BroadcastBookingRequestParams) {
  const operationId = params.operationId || randomId();
  try {
    const { data, error } = await supabase.rpc('create_broadcast_booking_requests', {
      p_gardener_ids: params.gardenerIds,
      p_service_id: params.serviceId,
      p_date: params.date,
      p_start_time: params.startTime,
      p_duration_hours: params.durationHours,
      p_total_price: params.totalPrice,
      p_client_address: params.clientAddress,
      p_notes: params.notes ?? null,
      p_pricing_context: params.pricingContext ?? {},
      p_travel_fee: params.travelFee ?? 15,
      p_hourly_rate: params.hourlyRate ?? 25,
      p_operation_id: operationId,
    });

    if (error) throw error;
    const result = data as { status: string; booking_ids: string[] };
    reportBookingEvent('info', {
      event: 'booking.requests_broadcast_created',
      context: {
        operationId,
        serviceId: params.serviceId,
        gardenerCount: params.gardenerIds.length,
        bookingCount: result.booking_ids.length,
        status: result.status,
      },
    });
    return result;
  } catch (error) {
    reportBookingEvent('error', {
      event: 'booking.requests_broadcast_failed',
      context: {
        operationId,
        serviceId: params.serviceId,
        gardenerCount: params.gardenerIds.length,
        message: error instanceof Error ? error.message : 'unknown',
      },
    });
    throw error;
  }
}
