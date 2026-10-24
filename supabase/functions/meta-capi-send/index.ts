// Conversions API de Meta, Fase 2 (2026-10-24). Complementa al píxel (metaPixel.ts): el mismo
// evento se manda por las dos vías con el mismo event_id para que Meta las deduplique. Sin esto,
// el píxel por sí solo pierde entre el 30 % y el 40 % de las conversiones (bloqueadores de
// anuncios, ITP de Safari) — ver la pestaña "Meta Ads" del documento del plan de marketing.
//
// Best-effort como booking-telemetry: si Meta está caído o falta el token, no debe romper el
// flujo de la persona que se está dando de alta. Un solo intento, sin reintentos — a diferencia
// de booking-telemetry, perder un evento de vez en cuando no es grave aquí.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Mismo identificador público que VITE_META_PIXEL_ID en el cliente (no es secreto: ya viaja en
// el código de cada página). Si cambia, se cambia aquí también.
const META_DATASET_ID = '2034090553963036';
const META_GRAPH_VERSION = 'v21.0';

interface CapiPayload {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  user_data?: { email?: string; phone?: string };
  custom_data?: Record<string, unknown>;
}

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function normalizePayload(payload: unknown): CapiPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  const eventName = String(candidate.event_name || '').trim();
  const eventId = String(candidate.event_id || '').trim();
  if (!eventName || !eventId) return null;

  const userDataRaw = candidate.user_data && typeof candidate.user_data === 'object'
    ? candidate.user_data as Record<string, unknown>
    : {};

  return {
    event_name: eventName,
    event_id: eventId,
    event_source_url: typeof candidate.event_source_url === 'string' ? candidate.event_source_url : undefined,
    user_data: {
      email: typeof userDataRaw.email === 'string' ? userDataRaw.email : undefined,
      phone: typeof userDataRaw.phone === 'string' ? userDataRaw.phone : undefined,
    },
    custom_data: candidate.custom_data && typeof candidate.custom_data === 'object'
      ? candidate.custom_data as Record<string, unknown>
      : undefined,
  };
}

export function resolveAllowedClientApiKeys(): string[] {
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
      // Cae al legacy de abajo.
    }
  }
  const legacyAnonKey = String(Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  if (legacyAnonKey) keys.add(legacyAnonKey);
  return Array.from(keys);
}

export function hasAllowedClientApiKey(req: Request, allowedApiKeys: string[]): boolean {
  const apiKey = String(req.headers.get('apikey') || '').trim();
  return apiKey !== '' && allowedApiKeys.includes(apiKey);
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildMetaUserData(payload: CapiPayload, req: Request): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {};
  if (payload.user_data?.email) userData.em = [await sha256Hex(payload.user_data.email)];
  if (payload.user_data?.phone) userData.ph = [await sha256Hex(payload.user_data.phone.replace(/\D/g, ''))];

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (clientIp) userData.client_ip_address = clientIp;
  const userAgent = req.headers.get('user-agent');
  if (userAgent) userData.client_user_agent = userAgent;

  return userData;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = normalizePayload(await req.json());
    if (!payload) {
      return jsonResponse({ success: false, error: 'Payload inválido.' }, 400);
    }

    const allowedApiKeys = resolveAllowedClientApiKeys();
    if (allowedApiKeys.length === 0 || !hasAllowedClientApiKey(req, allowedApiKeys)) {
      return jsonResponse({ success: false, error: 'apikey no autorizada.' }, 401);
    }

    const accessToken = Deno.env.get('META_CAPI_ACCESS_TOKEN');
    if (!accessToken) {
      console.error('[meta-capi-send] falta META_CAPI_ACCESS_TOKEN');
      return jsonResponse({ success: false, accepted: false, error: 'CAPI no configurado.' }, 202);
    }

    const event = {
      event_name: payload.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: payload.event_id,
      event_source_url: payload.event_source_url,
      action_source: 'website',
      user_data: await buildMetaUserData(payload, req),
      custom_data: payload.custom_data,
    };

    const graphUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}/events?access_token=${accessToken}`;
    const metaResponse = await fetch(graphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
    });

    if (!metaResponse.ok) {
      const errorBody = await metaResponse.text();
      console.error('[meta-capi-send] Meta rechazó el evento', { status: metaResponse.status, errorBody });
      return jsonResponse({ success: false, accepted: false }, 202);
    }

    return jsonResponse({ success: true, accepted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno en meta-capi-send.';
    console.error('[meta-capi-send] unexpected failure', message);
    return jsonResponse({ success: false, accepted: false, error: 'CAPI sink unavailable.' }, 202);
  }
});
