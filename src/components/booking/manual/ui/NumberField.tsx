import React, { useEffect, useState } from 'react';
import { readManualNumber, type ManualNumberFormat } from '../../../../utils/decimalText';
import { formatNumberEs } from '../presentation/formatManualValue';
import { INVALID_NUMBER_MESSAGE } from '../presentation/fieldErrors';
import { FieldError } from './FieldError';

interface Props {
  id: string;
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  format: ManualNumberFormat;
  unit?: string;
  /** Solo enteros (teclado sin coma). */
  integer?: boolean;
  /** Mensaje de error de la validación (ya en lenguaje del cliente). */
  error?: string | null;
  /** Mostrar errores: tras salir del campo o tras pulsar «Siguiente». */
  showError: boolean;
  /** `id` del texto de ayuda que describe el campo, si lo hay. */
  helpId?: string;
  onBlur?: () => void;
  /** Intro avanza a la pregunta siguiente (P-16). */
  onEnter?: () => void;
  /** `compact`: la casilla central de un stepper (sin etiqueta propia ni mensajes debajo). */
  size?: 'large' | 'compact';
  /** Avisa de si lo escrito es un número claro (el stepper pinta el error bajo toda la fila). */
  onValidityChange?: (invalid: boolean) => void;
  /** `id` del error que pinta el contenedor (stepper), para `aria-describedby`. */
  externalErrorId?: string;
  /** Línea de contexto bajo el campo (p. ej. un tramo de tarifa). */
  feedback?: string | null;
}

const toText = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value).replace('.', ',') : '';

/**
 * Campo numérico del asistente manual (SISTEMA-UX §6.4).
 *
 * `type="text"` con teclado numérico, no `type="number"` (GOV.UK): este último descartaba la
 * coma decimal y «1,5» se quedaba en «15» (P-15). Lo escrito se lee con `readManualNumber`:
 * coma o punto decimal, miles con punto en cantidades («1.000» = 1000, D-07). Lo que no es un
 * número claro se marca como error en vez de adivinarlo, y nunca se corrige un valor en silencio
 * (P-10): si se sale del rango, se dice y el cliente decide.
 */
export const NumberField: React.FC<Props> = ({
  id,
  label,
  value,
  onChange,
  format,
  unit,
  integer = false,
  error,
  showError,
  helpId,
  onBlur,
  onEnter,
  size = 'large',
  onValidityChange,
  externalErrorId,
  feedback,
}) => {
  const [text, setText] = useState(() => toText(value));
  const [syncedValue, setSyncedValue] = useState(value);

  // Si el valor cambia desde fuera (botones de un stepper, borrador restaurado) se reescribe la
  // casilla en el mismo render —con un efecto se veía un instante el valor anterior tras cada
  // toque de «+»—; si lo que hay escrito ya vale eso, se respeta («2,» mientras se teclea).
  if (value !== syncedValue) {
    setSyncedValue(value);
    const current = readManualNumber(text, format);
    const typed = current.kind === 'number' ? current.value : undefined;
    if (typed !== value && !(value === undefined && current.kind === 'invalid')) setText(toText(value));
  }

  const reading = readManualNumber(text, format);
  const invalid = reading.kind === 'invalid';
  useEffect(() => {
    onValidityChange?.(invalid);
  }, [invalid, onValidityChange]);
  const message = showError ? (invalid ? INVALID_NUMBER_MESSAGE : error) : null;
  const errorId = externalErrorId ?? `${id}-error`;
  // Si se escribe un punto, se dice cómo se ha leído: «1.000» son mil, «12.5» son doce y medio.
  const readingNote =
    size === 'large' && reading.kind === 'number' && text.includes('.')
      ? `Se leerá como ${formatNumberEs(reading.value)}${unit ? ` ${unit}` : ''}.`
      : null;
  const describedBy = [message ? errorId : null, helpId].filter(Boolean).join(' ') || undefined;

  const input = (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        enterKeyHint="next"
        aria-label={label}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy}
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const next = readManualNumber(raw, format);
          onChange(next.kind === 'number' ? next.value : undefined);
        }}
        onBlur={() => {
          // En medidas con decimales, lo escrito con punto se reescribe con coma al salir
          // («2.1» → «2,1»): el número es el mismo y se lee como se escribe en español.
          if (format === 'decimal' && reading.kind === 'number' && text.includes('.')) setText(toText(reading.value));
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onEnter?.();
          }
        }}
        className={`w-full rounded-xl border bg-white font-semibold tabular-nums text-gray-900 placeholder:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 ${
          message ? 'border-red-600' : 'border-gray-300'
        } ${size === 'large' ? 'h-14 pl-4 pr-16 text-2xl' : 'h-12 px-3 text-center text-2xl'} ${size === 'compact' && unit ? 'pr-9' : ''}`}
      />
      {unit ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-500 ${size === 'large' ? 'right-4 text-base' : 'right-3 text-sm'}`}
        >
          {unit}
        </span>
      ) : null}
    </div>
  );

  if (size === 'compact') return input;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[15px] font-medium text-gray-900">
        {label}
      </label>
      {input}
      <FieldError id={errorId} message={message} />
      {readingNote && !message ? <p className="mt-2 text-sm text-gray-600">{readingNote}</p> : null}
      {feedback && !message ? <p className="mt-2 text-sm text-gray-600">{feedback}</p> : null}
    </div>
  );
};
