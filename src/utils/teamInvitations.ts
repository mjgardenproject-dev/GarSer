import { supabase } from '../lib/supabase';

// Invitar a una persona al equipo (2026-11-11): lo que hacía «Equipo → Invitar» (InviteMemberCard) sacado
// a una función para usarlo también en el cuestionario «Activa tu cuenta», que invita a varios correos.

export interface TeamInvitationResult {
  email: string;
  /** Enlace de la invitación (por si el correo no sale: se puede copiar y mandar). */
  url: string;
  /** El correo con la invitación salió. */
  emailed: boolean;
}

/** Correo con forma de correo (la base de datos lo vuelve a comprobar). */
export const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/**
 * Crea la invitación (`create_company_invitation`) y manda el correo. Un autónomo que invita por primera
 * vez declara su seguro (`liabilityDeclared`). Lanza el error del servidor si no se puede crear.
 */
export async function createTeamInvitation(email: string, liabilityDeclared: boolean, origin = window.location.origin): Promise<TeamInvitationResult> {
  const { data, error } = await supabase.rpc(
    'create_company_invitation',
    liabilityDeclared ? { p_email: email, p_liability_declared: true } : { p_email: email },
  );
  if (error) throw error;
  const result = data as { invitation_id: string; token: string; email: string };
  // El único correo que sigue saliendo del navegador (prueba real F3): lleva el código de la invitación en
  // claro, que la base de datos solo guarda cifrado. Un reintento si falla la red; si aun así no sale,
  // queda el enlace para copiarlo.
  let mailError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    ({ error: mailError } = await supabase.functions.invoke('send-email-notification', {
      body: { type: 'company_invitation', invitationId: result.invitation_id, token: result.token },
    }));
    if (!mailError) break;
  }
  return { email: result.email, url: `${origin}/invitacion?token=${result.token}`, emailed: !mailError };
}
