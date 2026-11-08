// A dónde lleva /dashboard a una cuenta de profesional (`profiles.role = gardener`).
//
// Es la regla de siempre para el jardinero (pendiente o rechazada → /status, sin enviar → /apply, aprobada
// → su panel) más una: con la solicitud aprobada, su panel depende del MODO de la cuenta (D31, 2026-11-08):
// individual → el panel de siempre; equipo (al menos un empleado activo) → /empresa. El modo lo decide el
// servidor (`useProviderMode`); aquí solo se aplica.

export type ApplicationUiStatus = 'pending' | 'active' | 'denied' | null;

export type ProfessionalHome =
  | 'loading'    // aún no se sabe el estado de la solicitud
  | 'status'     // /status: solicitud pendiente o rechazada
  | 'apply'      // /apply: sin solicitud enviada
  | 'team'       // /empresa: panel de equipo
  | 'individual'; // el panel de jardinero de siempre

export function professionalHome(params: {
  applicationStatus: ApplicationUiStatus;
  statusLoaded: boolean;
  isTeam: boolean;
}): ProfessionalHome {
  const { applicationStatus, statusLoaded, isTeam } = params;
  if (!statusLoaded) return 'loading';
  if (applicationStatus === 'active') return isTeam ? 'team' : 'individual';
  if (applicationStatus === 'pending' || applicationStatus === 'denied') return 'status';
  return 'apply';
}
