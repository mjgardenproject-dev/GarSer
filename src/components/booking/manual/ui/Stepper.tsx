import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { ManualNumberFormat } from '../../../../utils/decimalText';
import { INVALID_NUMBER_MESSAGE } from '../presentation/fieldErrors';
import { stepValue } from '../presentation/numberStep';
import { FieldError } from './FieldError';
import { NumberField } from './NumberField';

interface Props {
  id: string;
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step: number;
  format: ManualNumberFormat;
  unit?: string;
  integer?: boolean;
  error?: string | null;
  showError: boolean;
  helpId?: string;
  onBlur?: () => void;
  onEnter?: () => void;
  /** Línea de contexto bajo el control (p. ej. el tramo de tarifa del seto, F5). */
  feedback?: string | null;
}

const BUTTON =
  'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-800 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation] [@media(hover:hover)]:hover:bg-gray-50';

/**
 * Stepper (SISTEMA-UX §6.5): para cantidades pequeñas con un valor por defecto claro (número de
 * palmeras) y para la altura del seto, que tiene tramos. Los botones van a la rejilla del paso
 * (P-03) y la casilla central se puede escribir, con coma.
 */
export const Stepper: React.FC<Props> = ({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
  unit,
  integer,
  error,
  showError,
  helpId,
  onBlur,
  onEnter,
  feedback,
}) => {
  const [invalidText, setInvalidText] = useState(false);
  const current = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const atMin = typeof min === 'number' && current !== undefined && current <= min;
  const atMax = typeof max === 'number' && current !== undefined && current >= max;
  const errorId = `${id}-error`;
  const message = showError ? (invalidText ? INVALID_NUMBER_MESSAGE : error ?? null) : null;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[15px] font-medium text-gray-900">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Disminuir ${label.toLowerCase()}`}
          disabled={atMin}
          onClick={() => onChange(stepValue(current, -1, { min, max, step }))}
          className={BUTTON}
        >
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <NumberField
            id={id}
            label={label}
            value={value}
            onChange={onChange}
            format={format}
            unit={unit}
            integer={integer}
            error={error}
            showError={showError}
            helpId={helpId}
            onBlur={onBlur}
            onEnter={onEnter}
            size="compact"
            onValidityChange={setInvalidText}
            externalErrorId={errorId}
          />
        </div>
        <button
          type="button"
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={atMax}
          onClick={() => onChange(stepValue(current, 1, { min, max, step }))}
          className={BUTTON}
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {feedback ? <p className="mt-2 text-sm text-gray-600">{feedback}</p> : null}
      <FieldError id={errorId} message={message} />
    </div>
  );
};
