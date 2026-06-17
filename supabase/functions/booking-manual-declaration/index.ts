// Supabase Edge Function: persist the auditable consent + declared variables
// for a manual-entry booking (alternativa a fotos).
//
// Security (requisito E):
//  - Requires the same authenticated session as the photo flow (Bearer JWT).
//  - Re-validates the declared variables server-side (range/enum) before storing.
//  - Verifies the accepted legal text version/hash against the server constant.
//  - Stores client_id from the verified token, never from the payload.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateManualSerializableInput } from '../../../src/shared/manualEntry/manualEntryValidation.ts';
import { resolveManualServiceKey } from '../../../src/shared/manualEntry/manualEntrySchema.ts';
import {
  MANUAL_ENTRY_LEGAL_VERSION,
  MANUAL_ENTRY_CONSENT_HASH,
} from '../../../src/shared/manualEntry/legalCopy.ts';

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeclarationPayload {
  declarationId?: string;
  serviceId?: string;
  serviceName?: string;
  legalVersion?: string;
  legalHash?: string;
  declaredVariables?: Record<string, unknown>;
  /** Built collections (SerializableBookingData subset) to re-validate. */
  bookingInput?: Record<string, unknown>;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function resolveServiceRoleKey() {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // fall through
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[booking-manual-declaration] missing Supabase secrets');
      return jsonResponse({ success: false, error: 'Servicio no disponible.' }, 503);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    if (!token) {
      return jsonResponse({ success: false, error: 'Autenticación requerida.' }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      return jsonResponse({ success: false, error: 'Sesión no válida.' }, 401);
    }
    const clientId = userData.user.id;

    const payload = (await req.json()) as DeclarationPayload;

    // Legal text integrity: must match the server's published version/hash.
    if (payload.legalVersion !== MANUAL_ENTRY_LEGAL_VERSION || payload.legalHash !== MANUAL_ENTRY_CONSENT_HASH) {
      return jsonResponse(
        { success: false, error: 'La versión del texto legal no coincide. Recarga la página e inténtalo de nuevo.' },
        409,
      );
    }

    const serviceKey = resolveManualServiceKey(payload.serviceName);
    if (!serviceKey) {
      return jsonResponse({ success: false, error: 'Servicio no soportado para entrada manual.' }, 400);
    }

    // Authoritative server-side validation of the declared variables.
    const validation = validateManualSerializableInput({
      serviceName: payload.serviceName,
      dataInputMode: 'manual',
      bookingInput: (payload.bookingInput || {}) as any,
    });
    if (!validation.ok) {
      return jsonResponse(
        {
          success: false,
          error: 'Algunos datos están fuera de los valores permitidos.',
          validationErrors: validation.errors,
        },
        422,
      );
    }

    const declarationId = isUuid(payload.declarationId) ? payload.declarationId : crypto.randomUUID();

    const { error: insertError } = await admin
      .from('booking_manual_declarations')
      .insert({
        declaration_id: declarationId,
        client_id: clientId,
        service_id: isUuid(payload.serviceId) ? payload.serviceId : null,
        service_name: typeof payload.serviceName === 'string' ? payload.serviceName.slice(0, 200) : null,
        input_source: 'manual',
        legal_text_version: MANUAL_ENTRY_LEGAL_VERSION,
        legal_text_hash: MANUAL_ENTRY_CONSENT_HASH,
        declared_variables: payload.declaredVariables || {},
        accepted_at: new Date().toISOString(),
      });

    if (insertError) {
      // Idempotent replay: the same (client_id, declaration_id) already stored.
      if (String(insertError.code) === '23505') {
        return jsonResponse({ success: true, declarationId, idempotent: true });
      }
      console.error('[booking-manual-declaration] insert failed', insertError.message);
      return jsonResponse({ success: false, error: 'No se pudo registrar la declaración.' }, 500);
    }

    return jsonResponse({ success: true, declarationId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno.';
    console.error('[booking-manual-declaration] unexpected failure', message);
    return jsonResponse({ success: false, error: 'Error interno.' }, 500);
  }
});
