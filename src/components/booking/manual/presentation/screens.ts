/**
 * Pantallas del asistente manual (lógica pura, sin React).
 *
 * Traduce los pasos del schema a las pantallas que ve el cliente según la presentación del
 * servicio, y calcula el progreso honesto «Pregunta X de Y». No decide nada de datos: qué
 * campos son visibles lo sigue diciendo el schema (`getVisibleFields`).
 */
import {
  getVisibleFields,
  type ManualAnswers,
  type ManualFieldDef,
  type ManualServiceSurvey,
  type ManualStep,
} from '../../../../shared/manualEntry/manualEntrySchema';
import type { ManualScreenPresentation, ManualServicePresentation } from './manualEntryPresentation';

export interface ManualScreen {
  id: string;
  /** Pasos del schema visibles en esta pantalla, en el orden del schema. */
  steps: ManualStep[];
  /** `stepId` que se emiten al completar la pantalla (telemetría), en orden. */
  stepIds: string[];
  /** Campos visibles de todos sus pasos, en orden. */
  fields: ManualFieldDef[];
}

const stepById = (survey: ManualServiceSurvey) => new Map(survey.steps.map((step) => [step.id, step]));

const isStepVisible = (step: ManualStep, answers: ManualAnswers) => getVisibleFields(step, answers).length > 0;

const buildScreen = (
  screen: ManualScreenPresentation,
  steps: Map<string, ManualStep>,
  answers: ManualAnswers,
): ManualScreen | null => {
  const visible = screen.stepIds
    .map((id) => steps.get(id))
    .filter((step): step is ManualStep => Boolean(step) && isStepVisible(step as ManualStep, answers));
  if (visible.length === 0) return null;
  return {
    id: screen.id,
    steps: visible,
    stepIds: visible.map((step) => step.id),
    fields: visible.flatMap((step) => getVisibleFields(step, answers)),
  };
};

/** Pantallas que se ven con las respuestas actuales, en orden. */
export function getVisibleScreens(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
  answers: ManualAnswers,
): ManualScreen[] {
  const steps = stepById(survey);
  return presentation.screens
    .map((screen) => buildScreen(screen, steps, answers))
    .filter((screen): screen is ManualScreen => screen !== null);
}

const isUnanswered = (value: unknown) => value === undefined || value === null || value === '';

/**
 * ¿Puede llegar a verse esta pantalla? Sí si se ve ya, o si depende de alguna respuesta que aún
 * no se ha dado (entonces cuenta en el total por si acaso).
 */
const mayBeShown = (
  screen: ManualScreenPresentation,
  steps: Map<string, ManualStep>,
  answers: ManualAnswers,
) => {
  if (buildScreen(screen, steps, answers)) return true;
  return (screen.dependsOn || []).some((key) => isUnanswered(answers[key]));
};

export interface QuestionProgress {
  /** Número de la pregunta actual (1…total). */
  current: number;
  /** Total de preguntas: pantallas posibles + retirada de restos si el servicio la pregunta. */
  total: number;
}

/**
 * «Pregunta X de Y» (SISTEMA-UX §6.9).
 *
 * - `screenId`: pantalla actual del elemento. `'waste'` para la pregunta de retirada de restos,
 *   que es la última pregunta del servicio.
 * - Y cuenta las pantallas que se ven y las que aún pueden aparecer (dependen de una respuesta
 *   sin dar), más la retirada si aplica. Así, al ir respondiendo, Y solo puede bajar.
 */
export function getQuestionProgress(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
  answers: ManualAnswers,
  screenId: string,
  options: { asksWaste: boolean },
): QuestionProgress {
  const steps = stepById(survey);
  const counted = presentation.screens.filter((screen) => mayBeShown(screen, steps, answers)).map((screen) => screen.id);
  const total = counted.length + (options.asksWaste ? 1 : 0);
  if (screenId === 'waste') return { current: total, total };
  const index = counted.indexOf(screenId);
  return { current: index >= 0 ? index + 1 : 1, total };
}

/**
 * Comprobación de coherencia entre la presentación y el schema: cada paso del schema aparece en
 * exactamente una pantalla y en el mismo orden. Se usa en los tests de los 7 servicios.
 */
export function describePresentationMismatch(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
): string | null {
  const schemaOrder = survey.steps.map((step) => step.id);
  const presented = presentation.screens.flatMap((screen) => screen.stepIds);
  if (presented.length !== new Set(presented).size) return `pasos repetidos: ${presented.join(', ')}`;
  if (presented.join('|') !== schemaOrder.join('|')) {
    return `orden o pasos distintos: presentación [${presented.join(', ')}] · schema [${schemaOrder.join(', ')}]`;
  }
  const ids = presentation.screens.map((screen) => screen.id);
  if (ids.length !== new Set(ids).size) return `pantallas con el mismo id: ${ids.join(', ')}`;
  return null;
}
