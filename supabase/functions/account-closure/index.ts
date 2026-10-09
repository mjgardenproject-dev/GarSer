// Supabase Edge Function: el propio usuario cierra su cuenta desde «Mi cuenta» (pendiente PH-01).
//
// Antes «Cerrar cuenta» actualizaba una columna equivocada desde el navegador: decía «Cuenta
// cerrada» y no tocaba nada. Ahora es la misma baja segura que la del admin (F6, D23):
//   · el análisis lo pide la web con su sesión (`my_account_closure_preview`);
//   · aquí se ejecuta (`perform_self_account_closure`, que vuelve a comprobarlo todo en una
//     transacción) SOLO sobre el usuario del token: nunca se acepta un id del navegador;
//   · con historial, veto de acceso y correo anónimo; después, sus ficheros (PH-04) y el cierre
//     de todas sus sesiones.
// Si algo bloquea (reservas sin terminar, pagos, incidencias, planes), no se toca nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { presentedToken, resolveServiceRoleKey } from '../_shared/functionAuth.ts';
import { cleanupAccountStorage, closeAuthAccess } from '../_shared/accountClosure.ts';

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

  // Quién llama: un usuario real con sesión. Solo puede cerrar SU cuenta.
  const token = presentedToken(req);
  const { data: caller } = token ? await admin.auth.getUser(token) : { data: null };
  const userId = caller?.user?.id || '';
  if (!userId) return json({ error: 'Inicia sesión para cerrar tu cuenta.' }, 403);

  let payload: { expectedMode?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const expectedMode = String(payload.expectedMode || '');
  if (!['delete', 'deactivate'].includes(expectedMode)) return json({ error: 'invalid_request' }, 400);

  const { data: result, error } = await admin.rpc('perform_self_account_closure', {
    p_user_id: userId, p_expected_mode: expectedMode,
  });
  if (error) return json({ error: error.message }, 409);

  if (result?.mode === 'deactivate') {
    // Fuera todas sus sesiones (en todos sus dispositivos) y veto de acceso.
    await admin.auth.admin.signOut(token, 'global').catch(() => null);
    const authError = await closeAuthAccess(admin, userId);
    if (authError) {
      console.error('[account-closure] Auth:', authError);
      return json({ error: 'Tus datos ya se han borrado, pero no se ha podido cerrar el acceso. Vuelve a intentarlo.', partial: true }, 502);
    }
  }

  // Sus ficheros. Si falla, queda apuntado y lo reintenta el reloj: la baja ya está hecha.
  const files = await cleanupAccountStorage(admin, userId);
  if (files.status === 'failed') console.error('[account-closure] Storage:', files.message);

  return json({ success: true, mode: result?.mode, filesDeleted: files.deleted, filesPending: files.status === 'failed' });
});
