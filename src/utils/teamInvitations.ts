import { supabase } from '../lib/supabase';

// Invitar a una persona al equipo (2026-11-11): lo que hacía «Equipo → Invitar» (InviteMemberCard) sacado
// a una función para usarlo también en el cuestionario «Activa tu cuenta», que invita a varios correos.

export interface TeamInvitationResult {
  invitationId: string;
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
  return { invitationId: result.invitation_id, email: result.email, url: `${origin}/invitacion?token=${result.token}`, emailed: !mailError };
}

/** Lo que el titular elige para una persona al invitarla (se aplica cuando acepta). */
export interface PersonPreset {
  name: string;
  serviceIds: string[];
  schedule: 'company' | 'custom';
  /** Para «Otro horario»: días (0 = domingo … 6 = sábado) y una franja en horas en punto. */
  days: number[];
  start: number;
  end: number;
  requestLicense: boolean;
}

export const emptyPersonPreset = (): PersonPreset => ({
  name: '',
  serviceIds: [],
  schedule: 'company',
  days: [1, 2, 3, 4, 5],
  start: 8,
  end: 14,
  requestLicense: false,
});

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00:00`;

/** Lo que se manda al servidor (set_company_invitation_preset), que lo valida y normaliza. */
export function presetPayload(preset: PersonPreset): Record<string, unknown> {
  return {
    ...(preset.name.trim() ? { display_name: preset.name.trim() } : {}),
    service_ids: preset.serviceIds,
    schedule:
      preset.schedule === 'company'
        ? { mode: 'company' }
        : { mode: 'custom', weeks: 4, rules: preset.days.map((day) => ({ day_of_week: day, start_time: hhmm(preset.start), end_time: hhmm(preset.end) })) },
    ...(preset.requestLicense ? { request_license: true } : {}),
  };
}

/** Problema de la configuración ('' si está bien) — el servidor lo vuelve a comprobar. */
export function presetProblem(preset: PersonPreset): string {
  if (preset.schedule === 'custom') {
    if (preset.days.length === 0) return 'Elige al menos un día de trabajo.';
    if (preset.end <= preset.start) return 'La hora de fin tiene que ser después de la de inicio.';
  }
  return '';
}

export async function setInvitationPreset(invitationId: string, preset: PersonPreset): Promise<void> {
  const { error } = await supabase.rpc('set_company_invitation_preset', {
    p_invitation_id: invitationId,
    p_preset: presetPayload(preset) as never,
  });
  if (error) throw error;
}
