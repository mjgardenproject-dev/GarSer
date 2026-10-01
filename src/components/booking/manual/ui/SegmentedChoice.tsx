import React from 'react';
import { FieldError } from './FieldError';

interface Props {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  /** Una ayuda común debajo (las opciones del segmentado no llevan ayuda propia). */
  help?: string;
  /** Línea de contexto según lo elegido (p. ej. el aviso del tramo más alto de palmera). */
  feedback?: string | null;
  error?: string | null;
}

/**
 * Selección entre 2-4 opciones de etiqueta corta y sin ayuda propia (SISTEMA-UX §6.6), con la
 * forma del selector de `AvailabilityManager` («Ajustes puntuales / Horario fijo»). Lo elegido
 * lleva el verde de `OptionList`: blanco sobre gris no bastaba para una respuesta que cambia el
 * precio (F6, acceso de árboles).
 * Lo usan los servicios que lo declaran en su presentación (p. ej. altura de palmera, F7).
 */
export const SegmentedChoice: React.FC<Props> = ({ id, label, options, selected, onSelect, help, feedback, error }) => {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const feedbackId = `${id}-feedback`;
  return (
    <div>
      <div
        id={id}
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, help ? helpId : null, feedback ? feedbackId : null].filter(Boolean).join(' ') || undefined}
        tabIndex={-1}
        className={`grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-gray-100 p-1 outline-none ${error ? 'ring-1 ring-red-300' : ''}`}
      >
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(option.value)}
              className={`min-h-12 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation] ${
                isSelected ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-600' : 'text-gray-700'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {help ? (
        <p id={helpId} className="mt-2 text-sm text-gray-600">
          {help}
        </p>
      ) : null}
      {feedback && !error ? (
        <p id={feedbackId} className="mt-2 text-sm text-gray-600">
          {feedback}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
};
