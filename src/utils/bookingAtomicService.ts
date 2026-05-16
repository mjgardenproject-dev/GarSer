import { supabase } from '../lib/supabase';

export interface CreateAtomicBookingParams {
  bookingId?: string;
  providerId: string;
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
  quoteId?: string;
}

export interface AtomicBookingResult {
  booking_id: string;
  status: string;
  date: string;
  start_time: string;
  duration_hours: number;
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `booking-op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createAtomicBooking(params: CreateAtomicBookingParams): Promise<AtomicBookingResult> {
  const operationId = params.operationId || randomId();

  const { data, error } = await supabase.rpc('create_atomic_booking', {
    p_booking_id: params.bookingId ?? null,
    p_gardener_id: params.providerId,
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
    p_quote_id: params.quoteId ?? null,
  });

  if (error) {
    throw error;
  }

  return data as AtomicBookingResult;
}
