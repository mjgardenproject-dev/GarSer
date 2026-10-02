import React, { useRef } from 'react';
import { FieldError } from './FieldError';

export interface OptionListItem {
  value: string;
  label: string;
  help?: string;
  /** Dibujo a la izquierda (solo cuando explica algo que la etiqueta no; p. ej. caras del seto). */
  media?: React.ReactNode;
}

interface Props {
  id: string;
  /** Nombre del grupo (el `label` del campo); también lo usan los recorridos de prueba. */
  label: string;
  options: OptionListItem[];
  selected: string;
  onSelect: (value: string) => void;
  error?: string | null;
  /** Enseñar el nombre del grupo encima (pantallas con varias preguntas). */
  showLabel?: boolean;
}

/**
 * Selección única en una columna (SISTEMA-UX §6.6).
 *
 * Sustituye a la rejilla de dos columnas: a 375 px cada tarjeta medía 145 px y la ayuda quedaba
 * a una o dos palabras por línea, con palabras que se salían. Aquí cada opción ocupa el ancho:
 * etiqueta, una línea de ayuda y un radio a la derecha con hueco fijo, así que al seleccionar no
 * aparece nada nuevo y nada se recoloca (T-06). Teclado como un grupo de radios: Tab entra en la
 * opción elegida y las flechas cambian de opción.
 */
export const OptionList: React.FC<Props> = ({ id, label, options, selected, onSelect, error, showLabel = false }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === selected);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const errorId = `${id}-error`;

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onSelect(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div>
      {showLabel ? (
        <p aria-hidden className="mb-2 text-[15px] font-medium text-gray-900">
          {label}
        </p>
      ) : null}
      <div
        id={id}
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        tabIndex={-1}
        className="space-y-2 rounded-xl outline-none"
      >
        {options.map((option, index) => {
          const isSelected = option.value === selected;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === focusIndex ? 0 : -1}
              onClick={() => onSelect(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation] ${
                isSelected
                  ? 'border-emerald-600 bg-emerald-50 ring-1 ring-inset ring-emerald-600'
                  : `bg-white [@media(hover:hover)]:hover:border-gray-300 ${error ? 'border-red-300' : 'border-gray-200'}`
              }`}
            >
              {option.media ? <span className="shrink-0">{option.media}</span> : null}
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-gray-900">{option.label}</span>
                {option.help ? <span className="mt-0.5 block text-sm leading-5 text-gray-600">{option.help}</span> : null}
              </span>
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  isSelected ? 'border-emerald-600' : 'border-gray-300'
                }`}
              >
                {isSelected ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
};
