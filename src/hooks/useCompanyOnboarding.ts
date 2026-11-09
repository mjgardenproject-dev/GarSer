import { useCallback } from 'react';
import { useProviderMode } from './useProviderMode';

// Puerta de las pantallas de equipo (`/empresa/*`, GarSer Empresas F3 en adelante).
//
// Antes decía en qué punto del alta estaba una CUENTA de empresa (borrador, enviada, aprobada…). Desde la
// cuenta de profesional única (D31, 2026-11-08) ya no hay cuentas de empresa: el equipo es un modo del
// profesional. Por eso «aprobada» pasa a significar «está en modo equipo» (`useProviderMode().isTeam`) y
// cualquier otra cuenta es `not_company` y vuelve a su panel.
//
// Las etapas del alta de empresa por solicitud (`none`, `draft`, `submitted`, `rejected`) siguen en el
// tipo porque las pantallas `/empresa/solicitud` y `/empresa/estado` y la cola del admin quedaron
// LATENTES (D38): nadie puede llegar ya a ellas. Se limpiarán aparte (02-HALLAZGOS H-49).

export type CompanyOnboardingStage = 'not_company' | 'none' | 'draft' | 'submitted' | 'rejected' | 'approved';

export interface CompanyApplicationRow {
  id: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  review_comment: string | null;
  [key: string]: unknown;
}

export interface CompanyOnboarding {
  loading: boolean;
  stage: CompanyOnboardingStage;
  application: CompanyApplicationRow | null;
  companyId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Vuelve a preguntar por el modo sin poner la pantalla en «cargando» y devuelve el estado actual. */
  recheck: () => Promise<CompanyOnboardingStage>;
}

export function stageFromMode(isTeam: boolean): CompanyOnboardingStage {
  return isTeam ? 'approved' : 'not_company';
}

export function useCompanyOnboarding(): CompanyOnboarding {
  const { loading, isTeam, error, refresh: refreshMode } = useProviderMode();

  const refresh = useCallback(async () => { await refreshMode(); }, [refreshMode]);
  const recheck = useCallback(async (): Promise<CompanyOnboardingStage> => {
    const next = await refreshMode();
    return stageFromMode(next ? next.mode === 'team' : isTeam);
  }, [refreshMode, isTeam]);

  return {
    loading,
    stage: stageFromMode(isTeam),
    application: null,
    companyId: null,
    error: error ? 'No hemos podido comprobar tu cuenta.' : null,
    refresh,
    recheck,
  };
}
