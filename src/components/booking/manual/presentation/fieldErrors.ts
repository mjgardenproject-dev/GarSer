/**
 * Mensajes de error del asistente manual, tal como los lee el cliente (SISTEMA-UX §6.10).
 *
 * La validación compartida (`manualEntryValidation.ts`, que también corre en el servidor) dice
 * QUÉ falla con un código; aquí se decide CÓMO se dice: con artículo, con la unidad y con los
 * números en formato español («5.000 m²»). No cambia qué es válido.
 */
import type { ManualFieldDef } from '../../../../shared/manualEntry/manualEntrySchema';
import type { ManualValidationError } from '../../../../shared/manualEntry/manualEntryValidation';
import { formatNumberEs } from './formatManualValue';
import type { ManualFieldPresentation } from './manualEntryPresentation';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Mensaje cuando lo escrito no es un número (no lo detecta la validación: no llega a ser valor). */
export const INVALID_NUMBER_MESSAGE = 'Escribe solo el número, por ejemplo 80 o 12,5.';

export function formatManualFieldError(
  error: Pick<ManualValidationError, 'code'>,
  field: ManualFieldDef,
  value: unknown,
  fieldPresentation?: ManualFieldPresentation,
): string {
  const name = fieldPresentation?.errorName || field.label.toLowerCase();
  const unit = field.unit ? ` ${field.unit}` : '';
  switch (error.code) {
    case 'required':
      return field.type === 'enum' || field.type === 'boolean' ? 'Elige una opción para continuar.' : `Indica ${name}.`;
    case 'not_integer':
      return 'Escribe un número entero, sin decimales.';
    case 'out_of_range': {
      const num = typeof value === 'number' ? value : Number(value);
      if (typeof field.min === 'number' && num < field.min) {
        return `${capitalize(name)} tiene que ser de al menos ${formatNumberEs(field.min)}${unit}.`;
      }
      return `${capitalize(name)} no puede pasar de ${formatNumberEs(field.max ?? num)}${unit}.`;
    }
    case 'invalid_option':
      return 'Elige una de las opciones.';
    default:
      return 'Revisa este dato.';
  }
}
