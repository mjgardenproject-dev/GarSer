/**
 * Append-only audit trail of declared vs corrected booking variables.
 * Enables discrepancy-pattern analysis per client / per gardener (requisito C).
 */
import { supabase } from '../lib/supabase';

export interface RecordVariableRevisionParams {
  bookingId: string;
  authorRole: 'client' | 'gardener';
  reason?: string;
  originalTotalPrice?: number | null;
  proposedTotalPrice?: number | null;
  originalVariables?: Record<string, unknown> | null;
  correctedVariables?: Record<string, unknown> | null;
}

/** Best-effort fetch of the variables the client originally declared for a booking. */
export async function fetchDeclaredVariables(bookingId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('booking_manual_declarations')
    .select('declared_variables')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { declared_variables?: Record<string, unknown> }).declared_variables || null;
}

export async function recordVariableRevision(params: RecordVariableRevisionParams): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const authorId = userData?.user?.id;
  if (!authorId) return;

  const { error } = await (supabase.from('booking_variable_revisions') as any).insert({
    booking_id: params.bookingId,
    author_id: authorId,
    author_role: params.authorRole,
    reason: params.reason || null,
    original_total_price: params.originalTotalPrice ?? null,
    proposed_total_price: params.proposedTotalPrice ?? null,
    original_variables: params.originalVariables ?? null,
    corrected_variables: params.correctedVariables ?? null,
  });
  // Auditing must never block the operational flow; surface only in logs.
  if (error) console.warn('[booking-variable-revision] insert failed', error.message);
}
