import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildProviderSetupSteps, type ProviderSetupStatus } from '../shared/providerSetup';
import { isActivationPaused } from './activationFlow';

// El panel abre solo el cuestionario «Activa tu cuenta» mientras al profesional le falte algo que el
// cuestionario resuelve (decisión D2, 2026-11-11). Si lo pausó («Seguir luego»), en esta sesión no se abre
// solo: el panel enseña la tarjeta para retomarlo.

/**
 * ¿Le falta algo POR HACER? Lo que está en revisión (carnet) o necesita atención no basta: abrirle el
 * cuestionario cada vez por algo que no depende de él sería pesado. Una cuenta suspendida, nunca.
 */
export function needsActivation(status: ProviderSetupStatus | null | undefined): boolean {
  if (!status || status.suspended) return false;
  const summary = buildProviderSetupSteps(status);
  return summary.required.some((step) => step.state === 'todo');
}

/** Devuelve si le falta activarse (para enseñar la tarjeta «Continúa tu activación»). */
export function useActivationAutoOpen(status: ProviderSetupStatus | null | undefined, enabled = true): boolean {
  const navigate = useNavigate();
  const wanted = useMemo(() => enabled && needsActivation(status), [enabled, status]);
  useEffect(() => {
    if (wanted && !isActivationPaused()) navigate('/activar');
  }, [wanted, navigate]);
  return wanted;
}
