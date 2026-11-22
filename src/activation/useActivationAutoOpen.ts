import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildProviderSetupSteps, type ProviderSetupStatus, type SetupStepId } from '../shared/providerSetup';
import { isActivationPaused } from './activationFlow';

// El panel abre solo el cuestionario «Activa tu cuenta» mientras al profesional le falte algo que el
// cuestionario resuelve (decisión D2, 2026-11-11). Si lo pausó («Seguir luego»), en esta sesión no se abre
// solo: el panel enseña la tarjeta para retomarlo.

const QUESTIONNAIRE_STEPS: ReadonlySet<SetupStepId> = new Set<SetupStepId>(['services', 'coverage', 'schedule', 'team']);

/**
 * ¿Le falta algo POR HACER? Lo que está en revisión (carnet) o necesita atención no basta: abrirle el
 * cuestionario cada vez por algo que no depende de él sería pesado. Una cuenta suspendida, nunca.
 *
 * Y una vez TERMINADO el cuestionario (QA-196/QA-108) tampoco: lo que quede pendiente (el carnet por
 * subir, un servicio sin activar) ya no lo resuelve el cuestionario sino «Completa tu cuenta
 * profesional», que el panel enseña. Si no, «Ir a mi panel» le devolvía a la Bienvenida y en cada inicio
 * de sesión volvía a empezar.
 */
export function needsActivation(status: ProviderSetupStatus | null | undefined): boolean {
  if (!status || status.suspended || status.activation_done) return false;
  const summary = buildProviderSetupSteps(status);
  // Solo cuentan los pasos que el cuestionario RESUELVE (zona, servicios y tarifas, horario, equipo). El
  // carnet fitosanitario y «alguien de tu equipo hace este servicio» no (QA-202, QA-108): el carnet lo sube
  // el profesional desde «Completa tu cuenta» y lo aprueba GarSer, y asignar servicios se hace en «Equipo».
  // Abrir la Bienvenida por ellos obligaba a repasar 9 pantallas ya hechas para llegar a lo único que faltaba.
  return summary.required.some((step) => step.state === 'todo' && QUESTIONNAIRE_STEPS.has(step.id));
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
