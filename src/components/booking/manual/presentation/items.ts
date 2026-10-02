/**
 * Elementos de un formulario repetible (árboles, grupos de palmeras, zonas de tratamiento):
 * cuándo un elemento está vacío o completo y cómo se resume en una línea. Lógica pura.
 *
 * Existe por P-01: un elemento añadido y abandonado («Añadir otro» + «Atrás») se quedaba en la
 * lista vacío, el resumen lo enseñaba con guiones y dejaba confirmar; el constructor lo rellenaba
 * con sus valores por defecto y en árboles se cobraba un árbol pequeño con poda estructural que el
 * cliente nunca había declarado. El constructor no se toca: es la interfaz la que ya no deja
 * enviar un elemento incompleto.
 */
import {
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../../shared/manualEntry/manualEntrySchema';
import {
  validateManualField,
  type ManualValidationError,
} from '../../../../shared/manualEntry/manualEntryValidation';
import type { ManualFieldDef } from '../../../../shared/manualEntry/manualEntrySchema';
import { formatManualValue } from './formatManualValue';
import type { ManualFieldPresentation, ManualServicePresentation } from './manualEntryPresentation';
import { getVisibleScreens } from './screens';

/** Elemento recién creado: solo los valores por defecto del schema. */
export function createEmptyManualItem(survey: ManualServiceSurvey): ManualAnswers {
  const item: ManualAnswers = {};
  survey.steps.forEach((step) =>
    step.fields.forEach((field) => {
      if (field.defaultValue !== undefined) item[field.key] = field.defaultValue;
    }),
  );
  return item;
}

/** ¿El cliente no ha contestado nada todavía (solo hay valores por defecto)? */
export function isManualItemEmpty(survey: ManualServiceSurvey, item: ManualAnswers): boolean {
  const defaults = createEmptyManualItem(survey);
  return Object.entries(item).every(([key, value]) => value === undefined || value === defaults[key]);
}

/**
 * Lo que falla en un campo: la validación compartida (la del servidor) y, además, una elección
 * sí/no que la interfaz exige (`requireChoice`, H-N-17). Nunca acepta algo que el servidor rechace.
 */
export function validatePresentedField(
  field: ManualFieldDef,
  value: unknown,
  answers: ManualAnswers,
  fieldPresentation?: ManualFieldPresentation,
): Pick<ManualValidationError, 'field' | 'code'> | null {
  const error = validateManualField(field, value, answers);
  if (error) return error;
  if (fieldPresentation?.requireChoice && field.type === 'boolean' && value !== true && value !== false) {
    return { field: field.key, code: 'required' };
  }
  return null;
}

/** Índice de la primera pantalla con algún dato que falta o no vale (-1 si está completo). */
export function firstIncompleteScreenIndex(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
  item: ManualAnswers,
): number {
  return getVisibleScreens(survey, presentation, item).findIndex((screen) =>
    screen.fields.some((field) => validatePresentedField(field, item[field.key], item, presentation.fields[field.key]) !== null),
  );
}

export function isManualItemComplete(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
  item: ManualAnswers,
): boolean {
  return firstIncompleteScreenIndex(survey, presentation, item) === -1;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Árbol 2», «Grupo de palmeras 1», «Zona de tratamiento 3». */
export const manualItemTitle = (survey: ManualServiceSurvey, index: number) => `${capitalize(survey.itemNoun)} ${index + 1}`;

/** «1 árbol», «2 árboles» (antes: «2 árbols», «2 grupo de palmerass»). */
export const manualItemCount = (survey: ManualServiceSurvey, presentation: ManualServicePresentation, count: number) =>
  `${count} ${count === 1 ? survey.itemNoun : presentation.itemNounPlural}`;

/** Resumen de un elemento en una línea: sus primeras respuestas, ya formateadas. */
export function summarizeManualItem(
  survey: ManualServiceSurvey,
  presentation: ManualServicePresentation,
  item: ManualAnswers,
  maxValues = 3,
): string {
  const values = getVisibleScreens(survey, presentation, item)
    .flatMap((screen) => screen.fields)
    .filter((field) => field.type !== 'boolean' || (field.options && field.options.length > 0))
    .map((field) => formatManualValue(field, item, presentation.fields[field.key]))
    .filter((value) => value !== '—');
  return values.slice(0, maxValues).join(' · ');
}
