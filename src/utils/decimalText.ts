/**
 * Números escritos a mano en español (coma decimal).
 *
 * Punto único de lectura para los campos numéricos que se escriben con el teclado: los
 * configuradores de tarifas del jardinero (`UnifiedNumericInput`) y los campos del asistente
 * manual de la reserva. Solo convierte texto en número; qué rango vale lo decide cada campo.
 */

/** Lo que vale el texto de la casilla («0,» → 0, «12,5» → 12.5); `null` si está vacía. */
export const parseDecimalText = (text: string): number | null => {
  if (text === '') return null;
  const num = parseFloat(text.replace(',', '.'));
  return Number.isNaN(num) ? null : num;
};

/**
 * Normaliza lo que se va tecleando en una casilla de tarifa: el punto pasa a coma, fuera
 * cualquier carácter que no sea cifra o coma, una sola coma, «,5» → «0,5» y sin ceros de más a
 * la izquierda («05» → «5», «00,5» → «0,5»).
 */
export const sanitizeDecimalTyping = (input: string): string => {
  let raw = input.replace(/\./g, ',');
  raw = raw.replace(/[^0-9,]/g, '');
  const parts = raw.split(',');
  if (parts.length > 2) {
    raw = parts[0] + ',' + parts.slice(1).join('');
  }
  if (raw.startsWith(',')) {
    raw = '0' + raw;
  }
  return raw.replace(/^0+(?=\d)/, '');
};

export type ManualNumberFormat =
  /** Cantidades grandes (m², metros lineales, unidades): «1.000» son mil (D-07). */
  | 'quantity'
  /** Medidas con decimales pequeños (altura del seto): el punto es decimal, como la coma. */
  | 'decimal';

export type ManualNumberReading =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'number'; value: number };

const THOUSANDS_GROUPED = /^\d{1,3}(\.\d{3})+(,\d+)?$/;
const PLAIN = /^\d+([.,]\d+)?$/;
const TRAILING_SEPARATOR = /^\d+[.,]$/;

/**
 * Lee lo que el cliente ha escrito en un campo numérico del asistente manual.
 *
 * - Vacío (o solo espacios) → `empty`.
 * - Coma o punto decimal: «2,5» y «2.5» → 2.5; un separador final («2,») cuenta como el entero.
 * - En `quantity`, el punto seguido de grupos de exactamente tres cifras es separador de miles:
 *   «1.000» → 1000, «12.500,5» → 12500.5. En cualquier otro caso el punto es decimal
 *   («12.5» → 12.5). En `decimal` el punto siempre es decimal.
 * - Cualquier otra cosa (letras, dos comas, signos) → `invalid`, para mostrar un error en vez de
 *   adivinar un número que cambiaría el precio.
 */
export const readManualNumber = (input: string, format: ManualNumberFormat): ManualNumberReading => {
  const text = input.replace(/\s+/g, '');
  if (text === '') return { kind: 'empty' };

  if (format === 'quantity' && THOUSANDS_GROUPED.test(text)) {
    const [integerPart, decimalPart] = text.split(',');
    const value = Number(`${integerPart.replace(/\./g, '')}${decimalPart !== undefined ? `.${decimalPart}` : ''}`);
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
  }

  if (TRAILING_SEPARATOR.test(text)) return { kind: 'number', value: Number(text.slice(0, -1)) };
  if (!PLAIN.test(text)) return { kind: 'invalid' };

  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
};
