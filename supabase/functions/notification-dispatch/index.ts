// Supabase Edge Function: envía los avisos apuntados en `notification_outbox` (prueba real, F3).
//
// Cada acción del servidor (proponer un precio, aceptar una solicitud, abrir una incidencia…)
// deja su aviso en la cola EN LA MISMA TRANSACCIÓN. Esta función los reclama, pide cada correo a
// `send-email-notification` (el único sitio que los redacta) como servicio interno y los cierra:
// `sent`, o de vuelta a la cola con espera creciente, o `failed` a los 5 intentos o si el fallo
// no tiene arreglo (4xx). Antes estos correos los pedía el navegador después de la acción y se
// perdían si la pestaña se cerraba o la sesión estaba revocada (R-06 c).
//
// La llamada HTTP es solo el timbre: la suena `pg_net` al apuntar un aviso y el reloj de cada
// minuto si queda algo atrasado. Perder el timbre no pierde el aviso.
//
// Autorización: el secreto del reloj (`x-lifecycle-secret`), como booking-lifecycle-tick, o la
// clave de servicio. Quien lo tenga solo puede hacer que se envíe lo que ya estaba en la cola.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isInternalServiceCaller, resolveServiceRoleKey } from '../_shared/functionAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-lifecycle-secret',
};

const BATCH_LIMIT = 25;
const MAX_ROUNDS = 4; // hasta 100 avisos por timbre; el resto, en el siguiente

function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(req: Request): boolean {
  const presented = String(req.headers.get('x-lifecycle-secret') || '').trim();
  const expected = String(Deno.env.get('LIFECYCLE_TICK_SECRET') || '').trim();
  if (expected && presented && secretsMatch(presented, expected)) return true;
  return isInternalServiceCaller(req);
}

type Claimed = { id: string; type: string; booking_id: string | null; payload: Record<string, unknown>; attempts: number };

/** El cuerpo que espera send-email-notification: el tipo y lo que el aviso guardó al apuntarse. */
export function emailBodyFor(row: Claimed): Record<string, unknown> {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return { ...payload, type: row.type, ...(row.booking_id && !payload.bookingId ? { bookingId: row.booking_id } : {}) };
}

async function requestEmail(supabaseUrl: string, serviceKey: string, body: Record<string, unknown>) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true, permanent: false, reason: '' };
    const text = (await response.text().catch(() => '')).slice(0, 300);
    // 4xx: la reserva ya no existe, el estado cambió, falta el destinatario… reintentar no lo
    // arregla. 5xx y red: sí puede ser pasajero.
    return { ok: false, permanent: response.status >= 400 && response.status < 500, reason: `HTTP ${response.status}: ${text || 'sin cuerpo'}` };
  } catch (error) {
    return { ok: false, permanent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = resolveServiceRoleKey() || '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Faltan secretos de Supabase.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await admin.rpc('claim_notification_outbox', { p_limit: BATCH_LIMIT });
    if (error) {
      console.error('[notification-dispatch] claim_notification_outbox:', error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const rows = (data || []) as Claimed[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const outcome = await requestEmail(supabaseUrl, serviceKey, emailBodyFor(row));
      const { data: status, error: completeError } = await admin.rpc('complete_notification_outbox', {
        p_id: row.id, p_ok: outcome.ok, p_error: outcome.ok ? null : outcome.reason, p_permanent: outcome.permanent,
      });
      if (completeError) console.error('[notification-dispatch] complete_notification_outbox:', completeError.message);
      if (outcome.ok) sent += 1;
      else if (status === 'failed') {
        failed += 1;
        console.error('[notification-dispatch] aviso fallido', { id: row.id, type: row.type, reason: outcome.reason });
      } else retried += 1;
    }
    if (rows.length < BATCH_LIMIT) break;
  }

  return new Response(JSON.stringify({ sent, retried, failed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
