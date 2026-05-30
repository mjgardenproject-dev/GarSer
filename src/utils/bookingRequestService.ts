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
