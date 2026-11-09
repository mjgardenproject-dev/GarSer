import { supabase } from './supabase';

// Modo de la cuenta de un profesional (D31–D34, docs/garser-empresas/08).
//
// Hay una sola cuenta de profesional. Su modo no se elige ni se guarda en el navegador: lo decide el
// servidor a partir de sus empleados (`my_provider_mode()`):
//   · individual — ningún empleado activo: el panel de autónomo de siempre;
//   · team       — al menos un empleado activo: el panel de equipo.
//
// Todo lo que cambia según el modo cuelga de `useProviderMode()`, que lee esto una vez por sesión y
// al refrescar (D39: sin tiempo real).

export type ProviderMode = 'individual' | 'team';

export interface ProviderModeInfo {
  /** Tiene ficha de profesional (solicitud aprobada). Un aspirante aún no la tiene. */
  isProfessional: boolean;
  /** `null` mientras no es profesional aprobado: no tiene modo. */
  mode: ProviderMode | null;
  /** Existe la empresa (puede estar latente en modo individual: hubo equipo o hay invitaciones). */
  hasTeamStructure: boolean;
  activeEmployees: number;
  pendingInvitations: number;
  /** El titular cuenta como mano de obra (en individual siempre). */
  ownerWorks: boolean;
  suspended: boolean;
  /** Ya declaró el seguro de responsabilidad civil: no se le vuelve a pedir al invitar (D35). */
  liabilityDeclared: boolean;
}

const toCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Lee la respuesta de `my_provider_mode()`. Lo que no entiende no lo convierte en equipo. */
export function parseProviderMode(raw: unknown): ProviderModeInfo {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const isProfessional = row.is_professional === true;
  return {
    isProfessional,
    mode: isProfessional ? (row.mode === 'team' ? 'team' : 'individual') : null,
    hasTeamStructure: row.has_team_structure === true,
    activeEmployees: toCount(row.active_employees),
    pendingInvitations: toCount(row.pending_invitations),
    ownerWorks: row.owner_works !== false,
    suspended: row.suspended === true,
    liabilityDeclared: row.liability_declared === true,
  };
}

export async function fetchProviderMode(): Promise<ProviderModeInfo> {
  const { data, error } = await supabase.rpc('my_provider_mode');
  if (error) throw error;
  return parseProviderMode(data);
}
