import type { ActivationServiceName } from './serviceCatalog';
import { AREA_QUESTIONNAIRES, type ServiceQuestionnaire } from './pricingQuestions';
import { UNIT_QUESTIONNAIRES } from './unitQuestionnaires';

// Todas las preguntas de tarifas del cuestionario «Activa tu cuenta», por servicio.

export const SERVICE_QUESTIONNAIRES: Partial<Record<ActivationServiceName, ServiceQuestionnaire>> = {
  ...AREA_QUESTIONNAIRES,
  ...(UNIT_QUESTIONNAIRES as Partial<Record<ActivationServiceName, ServiceQuestionnaire>>),
};
