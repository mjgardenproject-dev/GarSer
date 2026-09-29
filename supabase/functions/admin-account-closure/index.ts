// Supabase Edge Function: dar de baja una cuenta (prueba real, F6 · R-02, D23).
//
// La única vía para quitar una cuenta sin romper nada (antes era borrar en bruto desde el panel de
// Supabase). Solo la usa un administrador. El análisis lo hace la base de datos
// (`admin_account_closure_preview`, que el admin pide con su sesión) y la ejecución también
// (`perform_account_closure`, en una transacción y volviendo a comprobarlo todo):
//   · sin historial → se borra entera;
//   · con historial → se da de baja: datos personales fuera, proveedor suspendido, reservas e
//     importes intactos; y aquí, con la API de administración de Auth, se veta el acceso y se
//     cambia el correo por uno anónimo (el correo real queda libre).
// Si algo bloquea (reservas sin terminar, pagos, incidencias, planes), no se toca nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { presentedToken, resolveServiceRoleKey } from '../_shared/functionAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = resolveServiceRoleKey() || '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Faltan secretos de Supabase.' }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Quién llama: un usuario real con rol de administrador.
  const token = presentedToken(req);
  const { data: caller } = token ? await admin.auth.getUser(token) : { data: null };
  const callerId = caller?.user?.id || '';
  const { data: profile } = callerId
    ? await admin.from('profiles').select('role').eq('user_id', callerId).maybeSingle()
    : { data: null };
  if (!callerId || profile?.role !== 'admin') return json({ error: 'Unauthorized' }, 403);

  let payload: { userId?: string; expectedMode?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const userId = String(payload.userId || '');
  const expectedMode = String(payload.expectedMode || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !['delete', 'deactivate'].includes(expectedMode)) {
    return json({ error: 'invalid_request' }, 400);
  }
  if (userId === callerId) return json({ error: 'No puedes darte de baja a ti mismo desde aquí.' }, 400);

  const { data: result, error } = await admin.rpc('perform_account_closure', {
    p_user_id: userId, p_expected_mode: expectedMode, p_admin_id: callerId,
  });
  if (error) return json({ error: error.message }, 409);

  if (result?.mode === 'deactivate') {
    // Veto de acceso permanente y correo anónimo (libera el real). Idempotente: si falla, volver a
    // pedir la baja lo reintenta (la parte de la base de datos ya está hecha y no cambia).
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      email: `baja+${userId}@garser.invalid`,
      email_confirm: true,
      ban_duration: '876000h',
      user_metadata: {},
    });
    if (authError) {
      console.error('[admin-account-closure] Auth:', authError.message);
      return json({ error: 'Los datos ya se han dado de baja, pero no se ha podido cerrar el acceso. Vuelve a intentarlo.', partial: true }, 502);
    }
  }
  return json({ success: true, mode: result?.mode, userId });
});
