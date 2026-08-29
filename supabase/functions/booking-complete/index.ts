// Supabase Edge Function: compatibilidad retroactiva de "completar" una reserva.
//
// ESTA FUNCION YA NO COMPLETA NADA. Antes cerraba la reserva directamente en cuanto el
// jardinero pulsaba un botón -sin que el cliente confirmara nada- y limpiaba sus fotos. Eso es
// justo lo que este sistema (confirmación del cliente + incidencias) viene a corregir: quien
// cierra la reserva es el cliente, o el reloj a las 24 h si no responde.
//
// Se mantiene como una CAPA DE COMPATIBILIDAD y no se borra: si algún cliente con la build
// anterior en caché (o cualquier llamada perdida) sigue invocando este endpoint, tiene que
// desembocar en el comportamiento SEGURO -avisar, no cerrar- y no en el peligroso de antes.
// El camino nuevo (`markGardenerFinished` en `src/utils/bookingIncidentService.ts`) llama
// directamente a la RPC sin pasar por aquí; esta función delega a la MISMA RPC para que ambos
// caminos hagan exactamente lo mismo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveServiceRoleKey } from '../_shared/functionAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    const publicKey = String(
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '',
    ).trim();
    if (!supabaseUrl || !serviceRoleKey || !publicKey) {
      throw new Error('Faltan secretos de Supabase para booking-complete.');
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || '').trim();
    if (!bookingId) {
      return new Response(JSON.stringify({ error: 'Falta bookingId.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Con la identidad del usuario, no con la de servicio: la RPC valida por su cuenta que
    // quien llama es el jardinero de ESTA reserva (auth.uid()), igual que en booking-payment.
    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });

    const { data, error } = await userClient.rpc('mark_gardener_finished', { p_booking_id: bookingId });
    if (error) {
      return new Response(JSON.stringify({ error: error.message || 'No se pudo procesar la reserva.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = (data || {}) as { outcome?: string; idempotent?: boolean };

    // Mismo aviso inmediato que dispara el camino nuevo: no hay que esperar al reloj de cada
    // 15 minutos para que el cliente reciba el correo de confirmación.
    if (!result.idempotent) {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      try {
        const { error: mailError } = await admin.functions.invoke('send-email-notification', {
          body: { type: 'booking_client_confirmation_request', bookingId },
        });
        if (mailError) throw mailError;
      } catch (mailException) {
        console.error('[booking-complete] no se pudo avisar al cliente:', mailException);
      }
    }

    return new Response(JSON.stringify({ success: true, bookingId, outcome: result.outcome || 'finished' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[booking-complete] error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Error inesperado.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
