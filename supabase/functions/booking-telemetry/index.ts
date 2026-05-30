import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface TelemetryPayload {
  level: 'info' | 'warn' | 'error';
  event: string;
  context?: Record<string, unknown>;
  timestamp?: string;
  source?: string;
  path?: string;
  phase?: string;
  status?: string;
  errorType?: string;
  correlationId?: string;
  bookingId?: string;
  operationId?: string;
  serviceId?: string;
  userId?: string;
  scope?: string;
  taxonomyVersion?: string;
  taxonomyValid?: boolean;
  missingContext?: string[];
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeTelemetryPayload(payload: unknown): TelemetryPayload | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate = payload as Record<string, unknown>;
  const level = String(candidate.level || '').trim();
  const event = String(candidate.event || '').trim();

  if (!['info', 'warn', 'error'].includes(level) || !event) {
    return null;
  }

  return {
    level: level as TelemetryPayload['level'],
    event,
    context: {
      ...(candidate.context && typeof candidate.context === 'object'
        ? candidate.context as Record<string, unknown>
        : {}),
      ...(typeof candidate.phase === 'string' ? { phase: candidate.phase } : {}),
      ...(typeof candidate.status === 'string' ? { status: candidate.status } : {}),
      ...(typeof candidate.errorType === 'string' ? { errorType: candidate.errorType } : {}),
      ...(typeof candidate.correlationId === 'string' ? { correlationId: candidate.correlationId } : {}),
      ...(typeof candidate.bookingId === 'string' ? { bookingId: candidate.bookingId } : {}),
      ...(typeof candidate.operationId === 'string' ? { operationId: candidate.operationId } : {}),
      ...(typeof candidate.serviceId === 'string' ? { serviceId: candidate.serviceId } : {}),
      ...(typeof candidate.userId === 'string' ? { userId: candidate.userId } : {}),
      ...(typeof candidate.scope === 'string' ? { scope: candidate.scope } : {}),
      ...(typeof candidate.taxonomyVersion === 'string' ? { taxonomyVersion: candidate.taxonomyVersion } : {}),
      ...(typeof candidate.taxonomyValid === 'boolean' ? { taxonomyValid: candidate.taxonomyValid } : {}),
      ...(Array.isArray(candidate.missingContext) ? { missingContext: candidate.missingContext } : {}),
    },
    timestamp: typeof candidate.timestamp === 'string' ? candidate.timestamp : undefined,
    source: typeof candidate.source === 'string' ? candidate.source : undefined,
    path: typeof candidate.path === 'string' ? candidate.path : undefined,
  };
}

function resolveServiceRoleKey() {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // Fall back to legacy key below.
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

function resolveAllowedClientApiKeys() {
  const keys = new Set<string>();
  const modernPublishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');

  if (modernPublishableKeys) {
    try {
      const parsed = JSON.parse(modernPublishableKeys) as Record<string, string>;
      Object.values(parsed)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((value) => keys.add(value));
    } catch {
      // Fall back to legacy anon key below.
    }
  }

  const legacyAnonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  if (legacyAnonKey) {
    keys.add(legacyAnonKey);
  }

  return Array.from(keys);
}

function hasAllowedClientApiKey(req: Request, allowedApiKeys: string[]) {
  const apiKey = String(req.headers.get('apikey') || '').trim();
  return apiKey !== '' && allowedApiKeys.includes(apiKey);
}

async function resolveOptionalUserId(admin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error) return null;
    return data?.user?.id || null;
  } catch (error) {
    console.error('[booking-telemetry] auth lookup failed', error);
    return null;
  }
}

async function persistTelemetry(
  admin: ReturnType<typeof createClient>,
  payload: TelemetryPayload,
  userId: string | null,
) {
  return await admin.from('booking_funnel_events').insert({
    user_id: userId,
    level: payload.level,
    event: payload.event,
    source: payload.source || 'web-client',
    path: payload.path || null,
    context: payload.context || {},
    created_at: payload.timestamp || new Date().toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = normalizeTelemetryPayload(await req.json());
    if (!payload) {
      return jsonResponse({
        success: false,
        accepted: false,
        error: 'Payload de telemetría inválido.',
      }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    const allowedApiKeys = resolveAllowedClientApiKeys();
    if (!supabaseUrl || !serviceRoleKey || allowedApiKeys.length === 0) {
      console.error('[booking-telemetry] missing Supabase secrets');
      return jsonResponse({
        success: false,
        accepted: false,
        error: 'Telemetry sink unavailable.',
      }, 202);
    }

    if (!hasAllowedClientApiKey(req, allowedApiKeys)) {
      return jsonResponse({
        success: false,
        accepted: false,
        error: 'apikey no autorizada.',
      }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });

    const userId = await resolveOptionalUserId(admin, req);

    const { error } = await persistTelemetry(admin, payload, userId);

    if (error) {
      console.error('[booking-telemetry] persist failed', {
        event: payload.event,
        level: payload.level,
        message: error.message,
      });
      return jsonResponse({
        success: false,
        accepted: false,
        event: payload.event,
      }, 202);
    }

    return jsonResponse({ success: true, accepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno en booking-telemetry.';
    console.error('[booking-telemetry] unexpected failure', message);
    return jsonResponse({
      success: false,
      accepted: false,
      error: 'Telemetry sink unavailable.',
    }, 202);
  }
});
