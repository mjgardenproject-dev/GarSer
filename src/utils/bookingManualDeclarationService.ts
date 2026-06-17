/**
 * Client service for persisting the auditable manual-entry consent record.
 * Calls the authenticated `booking-manual-declaration` edge function, which
 * re-validates the variables server-side and stores who/when/which-text/which-vars.
 */
import { supabase } from '../lib/supabase';
import {
  MANUAL_ENTRY_LEGAL_VERSION,
  MANUAL_ENTRY_CONSENT_HASH,
} from '../shared/manualEntry/legalCopy';

export interface RecordManualDeclarationParams {
  serviceId?: string;
  serviceName?: string;
  /** Compact snapshot of declared variables (from the builder result). */
  declaredVariables: Record<string, unknown>;
  /** Built collections to re-validate server-side (SerializableBookingData subset). */
  bookingInput: Record<string, unknown>;
}

export interface RecordManualDeclarationResult {
  declarationId: string;
  idempotent?: boolean;
}

export class ManualDeclarationError extends Error {
  readonly validationErrors?: Array<{ field: string; code: string; message: string }>;
  constructor(message: string, validationErrors?: Array<{ field: string; code: string; message: string }>) {
    super(message);
    this.name = 'ManualDeclarationError';
    this.validationErrors = validationErrors;
  }
}

export async function recordManualDeclaration(
  params: RecordManualDeclarationParams,
): Promise<RecordManualDeclarationResult> {
  const declarationId = crypto.randomUUID();

  const { data, error } = await supabase.functions.invoke('booking-manual-declaration', {
    body: {
      declarationId,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      legalVersion: MANUAL_ENTRY_LEGAL_VERSION,
      legalHash: MANUAL_ENTRY_CONSENT_HASH,
      declaredVariables: params.declaredVariables,
      bookingInput: params.bookingInput,
    },
  });

  if (error) {
    // Supabase wraps non-2xx in a FunctionsHttpError whose body we try to read.
    let validationErrors;
    let message = 'No se pudo registrar la confirmación. Inténtalo de nuevo.';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const body = await ctx.clone().json();
        if (body?.error) message = body.error;
        if (Array.isArray(body?.validationErrors)) validationErrors = body.validationErrors;
      }
    } catch {
      // keep default message
    }
    throw new ManualDeclarationError(message, validationErrors);
  }

  const result = data as { success?: boolean; declarationId?: string; idempotent?: boolean; error?: string };
  if (!result?.success || !result.declarationId) {
    throw new ManualDeclarationError(result?.error || 'No se pudo registrar la confirmación.');
  }

  return { declarationId: result.declarationId, idempotent: result.idempotent };
}

/** After the booking row exists, link the declaration to it for the audit trail. */
export async function attachManualDeclarationToBooking(params: {
  declarationId: string;
  bookingId: string;
}): Promise<void> {
  const { error } = await (supabase.rpc as any)('attach_manual_declaration_to_booking', {
    p_declaration_id: params.declarationId,
    p_booking_id: params.bookingId,
  });
  if (error) throw error;
}
