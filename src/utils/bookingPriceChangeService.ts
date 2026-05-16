import { supabase } from '../lib/supabase';

export type PriceChangeStatus = 'none' | 'pending_client_acceptance' | 'accepted' | 'rejected' | 'expired';

type PriceChangeRpcResponse = {
  status: PriceChangeStatus | 'idempotent_replayed';
  booking_id?: string;
  proposed_total_price?: number;
  final_total_price?: number;
  expires_at?: string;
};

export async function proposeBookingPriceChange(params: {
  bookingId: string;
  proposedTotalPrice: number;
  reason?: string;
  expiresInMinutes?: number;
  operationId?: string;
}) {
  const payload: Record<string, any> = {
    p_booking_id: params.bookingId,
    p_proposed_total_price: params.proposedTotalPrice,
    p_reason: params.reason || null,
  };
  if (typeof params.expiresInMinutes === 'number') payload.p_expires_in_minutes = params.expiresInMinutes;
  if (params.operationId) payload.p_operation_id = params.operationId;

  const { data, error } = await supabase.rpc('propose_booking_price_change', payload);
  if (error) throw error;
  return (data || null) as PriceChangeRpcResponse | null;
}

export async function respondBookingPriceChange(params: {
  bookingId: string;
  accept: boolean;
  operationId?: string;
}) {
  const payload: Record<string, any> = {
    p_booking_id: params.bookingId,
    p_accept: params.accept,
  };
  if (params.operationId) payload.p_operation_id = params.operationId;
  const { data, error } = await supabase.rpc('respond_booking_price_change', payload);
  if (error) throw error;
  return (data || null) as PriceChangeRpcResponse | null;
}
