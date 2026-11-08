import { useMemo } from 'react';
import { useAccount } from '../contexts/AccountContext';
import type { ProviderMode, ProviderModeInfo } from '../lib/providerMode';

// Modo de la cuenta de un profesional: el ÚNICO sitio de la interfaz que decide si se pinta la
// versión individual (el autónomo de siempre) o la de equipo (D31–D34, docs/garser-empresas/08).
//
// No hay comparaciones `role === 'company'` en el código de producción: una prueba que recorre
// `src/` lo vigila (providerMode.noCompanyRole.test.ts). Lo que cambia según el modo es esto:
//   · individual — sin gestión de equipo, sin vocabulario de empresa;
//   · team       — agenda por persona, reparto de trabajos, horario de cada uno.
//
// El servidor es la autoridad: el navegador no guarda ni decide el modo (D32).

export interface ProviderModeState {
  /** Todavía no se sabe el tipo de cuenta o su modo. */
  loading: boolean;
  /** La cuenta es de profesional (`profiles.role = gardener`), aunque su alta aún no esté aprobada. */
  isProfessionalAccount: boolean;
  /** Es profesional con la solicitud aprobada (tiene ficha): solo entonces tiene modo. */
  isApprovedProfessional: boolean;
  /** `null` si no es profesional aprobado o no se pudo leer. */
  mode: ProviderMode | null;
  isTeam: boolean;
  isIndividual: boolean;
  activeEmployees: number;
  pendingInvitations: number;
  ownerWorks: boolean;
  /** Existe la empresa (en individual puede estar latente). Si no, la primera invitación pide el seguro. */
  hasTeamStructure: boolean;
  liabilityDeclared: boolean;
  suspended: boolean;
  /** La lectura del modo falló: la interfaz cae al panel individual y ofrece reintentar. */
  error: boolean;
  /** Vuelve a leer el modo (sin pantalla de carga). Devuelve el nuevo, o `null` si no se pudo. */
  refresh: () => Promise<ProviderModeInfo | null>;
}

export function useProviderMode(): ProviderModeState {
  const { role, loading, providerMode, providerModeError, refreshProviderMode } = useAccount();
  const isProfessionalAccount = role === 'gardener';
  const info = isProfessionalAccount ? providerMode : null;

  return useMemo<ProviderModeState>(() => {
    const mode = info?.isProfessional ? info.mode : null;
    return {
      loading,
      isProfessionalAccount,
      isApprovedProfessional: info?.isProfessional === true,
      mode,
      isTeam: mode === 'team',
      isIndividual: mode === 'individual',
      activeEmployees: info?.activeEmployees ?? 0,
      pendingInvitations: info?.pendingInvitations ?? 0,
      ownerWorks: info?.ownerWorks ?? true,
      hasTeamStructure: info?.hasTeamStructure ?? false,
      liabilityDeclared: info?.liabilityDeclared ?? false,
      suspended: info?.suspended ?? false,
      error: isProfessionalAccount && Boolean(providerModeError),
      refresh: refreshProviderMode ?? (async () => null),
    };
  }, [loading, isProfessionalAccount, info, providerModeError, refreshProviderMode]);
}
