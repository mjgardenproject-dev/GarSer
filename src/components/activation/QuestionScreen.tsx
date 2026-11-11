import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import {
  isNumberValid,
  textOf,
  visibleFields,
  type Answer,
  type Answers,
  type NumberField,
  type Question,
} from '../../activation/pricingQuestions';
import { parseDecimalText, sanitizeDecimalTyping } from '../../utils/decimalText';

// Una pantalla de tarifas (cuestionario «Activa tu cuenta», 2026-11-11): elegir con botones grandes, un
// número, o varios números relacionados (p. ej. «hasta 2 m» y «de 2 a 4 m»). Cada número lleva sus valores
// habituales en botones (decisión D1) y su unidad bien visible.

// Sin separador de miles: el campo lee «.» como coma decimal (decimalText.ts).
const formatNumber = (value: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false }).format(value);

export const formatValue = (unit: string, value: Answer | undefined): string =>
  typeof value === 'number' ? `${formatNumber(value)} ${unit}` : '—';

interface NumberInputProps {
  field: NumberField;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  /** Etiqueta visible encima (pantallas con varios números). Sin ella, la etiqueta es solo para lectores. */
  showLabel: boolean;
  accessibleLabel: string;
}

const NumberInput: React.FC<NumberInputProps> = ({ field, value, onChange, showLabel, accessibleLabel }) => {
  const [text, setText] = useState(() => (typeof value === 'number' ? formatNumber(value) : ''));
  useEffect(() => {
    setText(typeof value === 'number' ? formatNumber(value) : '');
    // Solo al cambiar de campo: mientras se escribe manda el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id]);
  const inputId = `activation-q-${field.id}`;
  const invalid = text !== '' && !isNumberValid(field, value);

  return (
    <div>
      <label htmlFor={inputId} className={showLabel ? 'block text-base font-semibold text-gray-900' : 'sr-only'}>
        {showLabel ? field.label : accessibleLabel}
      </label>
      <div className={`${showLabel ? 'mt-2' : 'mt-5'} flex items-center gap-3`}>
        <input
          id={inputId}
          type="text"
          inputMode={field.decimals ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={text}
          placeholder="0"
          onChange={(event) => {
            const next = sanitizeDecimalTyping(event.target.value);
            setText(next);
            const parsed = parseDecimalText(next);
            onChange(parsed === null ? null : field.decimals ? Math.round(parsed * 100) / 100 : Math.round(parsed));
          }}
          aria-invalid={invalid}
          className="h-14 w-36 rounded-xl border-2 border-gray-300 px-4 text-2xl font-bold text-gray-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <span className="text-lg font-semibold text-gray-700">{field.unit}</span>
      </div>
      {invalid && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {field.allowZero ? 'Pon un número (0 si no cobras nada extra).' : 'Pon un número mayor que 0.'}
          {field.max !== undefined ? ` Como mucho, ${formatNumber(field.max)}.` : ''}
        </p>
      )}
      {field.suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-gray-700">Lo habitual:</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {field.suggestions.map((suggestion) => {
              const selected = value === suggestion;
              return (
                <button
                  key={suggestion}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${formatNumber(suggestion)} ${field.unit}${showLabel ? ` · ${field.label}` : ''}`}
                  onClick={() => {
                    setText(formatNumber(suggestion));
                    onChange(suggestion);
                  }}
                  className={`min-h-11 rounded-full border px-4 text-base font-semibold [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                    selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {formatNumber(suggestion)} {field.unit}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface Props {
  question: Question;
  answers: Answers;
  onChange: (id: string, value: Answer) => void;
  /** «Césped · 2 de 6» */
  position: string;
}

const QuestionScreen: React.FC<Props> = ({ question, answers, onChange, position }) => {
  const title = textOf(question.title, answers);
  const help = textOf(question.help, answers);
  const why = textOf(question.why, answers);

  return (
    <div>
      <p className="text-sm font-semibold text-emerald-800">{position}</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight text-gray-900">{title}</h1>
      {help && <p className="mt-2 text-gray-700">{help}</p>}

      {question.kind === 'choice' && (
        <div className="mt-5 space-y-2" role="radiogroup" aria-label={title}>
          {question.options.map((option) => {
            const selected = answers[question.id] === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(question.id, option.value)}
                className={`flex min-h-16 w-full flex-col justify-center rounded-2xl border-2 px-4 py-3 text-left [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  selected ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <span className="text-lg font-bold text-gray-900">{option.label}</span>
                {option.detail && <span className="text-sm text-gray-600">{option.detail}</span>}
              </button>
            );
          })}
        </div>
      )}

      {question.kind === 'number' && (
        <NumberInput
          field={{ ...question, label: title }}
          value={answers[question.id]}
          onChange={(value) => onChange(question.id, value)}
          showLabel={false}
          accessibleLabel={title}
        />
      )}

      {question.kind === 'multi' && (
        <div className="mt-5 space-y-6">
          {visibleFields(question, answers).map((field) => (
            <NumberInput
              key={field.id}
              field={field}
              value={answers[field.id]}
              onChange={(value) => onChange(field.id, value)}
              showLabel
              accessibleLabel={field.label}
            />
          ))}
        </div>
      )}

      {why && (
        <p className="mt-5 flex gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span>
            <span className="font-semibold">¿Por qué te lo preguntamos?</span> {why}
          </span>
        </p>
      )}
    </div>
  );
};

export default QuestionScreen;
