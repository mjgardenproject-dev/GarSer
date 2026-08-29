// Supabase Edge Function: endpoint publico del enlace de un clic.
//
// El correo de confirmacion lleva un enlace a la SPA (`/confirmar-servicio?t=<token>`), NO a
// esta funcion directamente. La pagina hace un POST aqui al montarse, en vez de que el propio
// enlace del correo sea un GET que muta estado: los escaneres de enlaces de correo (Outlook
// Safe Links, antivirus corporativos) hacen GET a TODO lo que ven en un email antes de que el
// humano lo abra, y un GET que confirma la reserva se consumiria solo, sin que nadie lo pulsara.
// La pagina es HTML inerte para el escaner; el POST solo lo dispara React, y los escaneres no
// ejecutan JavaScript. Sigue siendo un clic humano.
//
// Sin sesion a proposito: el enlace tiene que funcionar aunque el cliente no tenga la app
// abierta. Es defendible porque confirmar NO mueve dinero -los gastos de gestion ya se
// capturaron al aceptar el jardinero- y la respuesta solo devuelve la PII minima necesaria
// para que la pagina explique que ha pasado (servicio, fecha, nombre de pila del profesional).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveServiceRoleKey } from '../_shared/functionAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_OUTCOMES = new Set([
  'confirmed', 'already_used', 'already_completed', 'incident_open', 'not_confirmable', 'expired', 'invalid',
]);

function clientIp(req: Request): string | null {
  // Kong/el proxy antepone la IP real; sin el, el gateway local no la manda.
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ outcome: 'invalid' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const respond = (outcome: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ outcome, ...extra }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || '').trim();
    // Un token vacio o con forma rara no distingue nada al que lo mira: mismo desenlace que un
    // hash desconocido, ni un error de validacion aparte que pudiera filtrar informacion.
    if (!token || token.length < 16 || token.length > 512) {
      return respond('invalid');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = resolveServiceRoleKey();
    if (!supabaseUrl || !serviceKey) {
      return respond('invalid');
    }

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hashHex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc('redeem_booking_confirmation_token', {
      p_token_hash: `\\x${hashHex}`,
      p_ip: clientIp(req),
      p_user_agent: req.headers.get('user-agent')?.slice(0, 500) || null,
    });

    if (error) {
      // La RPC esta escrita para no lanzar nunca; si aun asi llega un error de infraestructura,
      // se responde igual que un hash desconocido, sin exponer el motivo real.
      console.error('[booking-confirm-service] redeem_booking_confirmation_token:', error.message);
      return respond('invalid');
    }

    const outcome = String(data?.outcome || 'invalid');
    if (!VALID_OUTCOMES.has(outcome)) {
      return respond('invalid');
    }

    return respond(outcome, {
      bookingId: data?.bookingId ?? null,
      serviceName: data?.serviceName ?? null,
      gardenerFirstName: data?.gardenerFirstName ?? null,
      date: data?.date ?? null,
      autoCompleted: data?.autoCompleted === true,
    });
  } catch (error) {
    console.error('[booking-confirm-service] fallo inesperado:', error);
    return respond('invalid');
  }
});
