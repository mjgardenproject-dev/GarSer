/**
 * Cómo se enseña un valor declarado (revisión y listas de elementos), en español de España.
 *
 * Solo presentación: nunca se usa para construir lo que se envía.
 */
import {
  getFieldOptions,
  type ManualAnswers,
  type ManualFieldDef,
} from '../../../../shared/manualEntry/manualEntrySchema';
import { presentOption, resolveFieldPresentation, type ManualFieldPresentation } from './manualEntryPresentation';

export const EMPTY_VALUE = '—';

/**
 * Número con separador de miles (punto) y decimales con coma, sin ceros de relleno:
 * 5000 → «5.000», 2.3 → «2,3», 1234.5 → «1.234,5».
 *
 * No se usa `Intl.NumberFormat('es-ES')` porque en español no agrupa los números de cuatro
 * cifras («5000»), y en un formulario de medidas «5.000 m²» se lee mejor y coincide con cómo se
 * escribe (D-07).
 */
export function formatNumberEs(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const [integerPart, decimalPart = ''] = rounded.toFixed(maxDecimals).split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = decimalPart.replace(/0+$/, '');
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  return `${sign}${grouped}${decimals ? `,${decimals}` : ''}`;
}

/** Valor de un campo tal como lo ve el cliente: etiqueta de la opción, «Sí/No» o número con unidad. */
export function formatManualValue(
  field: ManualFieldDef,
  answers: ManualAnswers,
  rawFieldPresentation?: ManualFieldPresentation,
): string {
  const value = answers[field.key];
  const fieldPresentation = resolveFieldPresentation(rawFieldPresentation, answers);

  if (field.type === 'boolean') {
    // Booleano que se elige con tarjetas («Acceso normal / Acceso difícil»): se enseña lo elegido.
    if (field.options && field.options.length > 0) {
      if (value !== true && value !== false) return EMPTY_VALUE;
      const option = field.options.find((o) => o.value === String(value));
      return option ? presentOption(option, fieldPresentation).label : value ? 'Sí' : 'No';
    }
    return value === true ? 'Sí' : 'No';
  }

  if (field.type === 'enum') {
    if (value === undefined || value === null || value === '') return EMPTY_VALUE;
    const option = getFieldOptions(field, answers).find((o) => o.value === value);
    return option ? presentOption(option, fieldPresentation).label : String(value);
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY_VALUE;
  const unit = fieldPresentation?.reviewUnit?.(answers) ?? fieldPresentation?.unit?.(answers) ?? field.unit;
  return `${formatNumberEs(value)}${unit ? ` ${unit}` : ''}`;
}
