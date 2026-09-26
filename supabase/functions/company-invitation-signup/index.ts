// Supabase Edge Function: el empleado invitado crea su cuenta desde la invitación (GarSer Empresas,
// D21 / H-39, 2026-09-26).
//
// Antes, para unirse a una empresa el invitado tenía que registrarse como cliente, confirmar el
// correo con un segundo mensaje y volver al enlace en el mismo navegador; en el móvil casi nunca
// llegaba a su panel. Ahora la página /invitacion le pide nombre y contraseña y esta función:
//   1. comprueba el token con invitation_preview (vivo, empresa activa) y toma de AHÍ el correo:
//      el correo nunca lo decide quien llama;
//   2. crea la cuenta YA CONFIRMADA: el token (256 bits, un solo uso, caduca en 7 días, solo se
//      guarda su hash) solo llegó a ese buzón, así que tenerlo prueba que el correo es suyo, igual
//      que un enlace mágico;
//   3. la une al equipo con accept_company_invitation_as_service (las mismas reglas que al aceptar
//      con sesión). Si esto falla, borra la cuenta recién creada: no quedan cuentas a medias.
// Si ya hay una cuenta con ese correo responde 409 `account_exists` y la página pide entrar.
// Pública (verify_jwt = false): el token ES la credencial.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveServiceRoleKey } from '../_shared/functionAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // límite de bcrypt

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PREVIEW_MESSAGES: Record<string, string> = {
  revoked: 'La empresa ha anulado esta invitación. Pídele que te envíe otra.',
  accepted: 'Esta invitación ya se ha usado.',
  expired: 'Esta invitación ha caducado. Pide a la empresa que te envíe otra.',
  company_inactive: 'La empresa que te invita no está activa ahora mismo.',
  invalid: 'Este enlace de invitación no es válido. Comprueba que lo has copiado entero.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  try {
    const payload = await req.json().catch(() => ({}));
    const token = String(payload?.token || '').trim();
    const fullName = String(payload?.fullName || '').trim().replace(/\s+/g, ' ');
    const password = String(payload?.password || '');

    if (!token) return reply(400, { error: 'invalid_invitation', message: PREVIEW_MESSAGES.invalid });
    if (fullName.length < 2 || fullName.length > 80) {
      return reply(400, { error: 'invalid_name', message: 'Escribe tu nombre (entre 2 y 80 caracteres).' });
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return reply(400, { error: 'invalid_password', message: `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.` });
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = resolveServiceRoleKey();
    if (!url || !serviceKey) throw new Error('Faltan secretos de Supabase.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: preview, error: previewError } = await admin.rpc('invitation_preview', { p_token: token });
    const state = String((preview as { state?: string } | null)?.state || 'invalid');
    if (previewError || state !== 'valid') {
      return reply(409, { error: `invitation_${state}`, message: PREVIEW_MESSAGES[state] || PREVIEW_MESSAGES.invalid });
    }
    const email = String((preview as { email?: string }).email || '').toLowerCase();
    if (!email) return reply(409, { error: 'invitation_invalid', message: PREVIEW_MESSAGES.invalid });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, requested_role: 'client' },
    });
    if (createError || !created?.user) {
      const code = (createError as { code?: string } | null)?.code || '';
      const text = String(createError?.message || '').toLowerCase();
      if (code === 'email_exists' || code === 'user_already_exists' || text.includes('already been registered') || text.includes('already registered')) {
        return reply(409, { error: 'account_exists', email, message: 'Ya tienes una cuenta con este correo: entra con tu contraseña para unirte.' });
      }
      if (code === 'weak_password') {
        return reply(400, { error: 'invalid_password', message: 'Esa contraseña es demasiado débil. Prueba con otra más larga.' });
      }
      console.error('company-invitation-signup: createUser falló', code || createError?.message);
      return reply(500, { error: 'signup_failed', message: 'No se ha podido crear tu cuenta. Inténtalo de nuevo.' });
    }

    const userId = created.user.id;
    const { error: acceptError } = await admin.rpc('accept_company_invitation_as_service', { p_user_id: userId, p_token: token });
    if (acceptError) {
      // La cuenta se creó solo para esta invitación: si no se ha podido unir, no se deja a medias.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      return reply(409, { error: 'accept_failed', message: acceptError.message || 'No se ha podido aceptar la invitación.' });
    }

    return reply(200, { ok: true, email });
  } catch (error) {
    console.error('company-invitation-signup error:', error instanceof Error ? error.message : 'desconocido');
    return reply(500, { error: 'internal_error', message: 'No se ha podido crear tu cuenta. Inténtalo de nuevo.' });
  }
});
