import React from 'react';

interface Props {
  id: string;
  label: string;
  help?: string;
  /** Etiqueta corta junto al nombre («Recomendado»). */
  badge?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Opción sí/no (SISTEMA-UX §6.7). Antes solo era pulsable el interruptor (48 × 28 px); ahora lo es
 * la fila entera, con su texto, y mide al menos 56 px de alto.
 */
export const ToggleRow: React.FC<Props> = ({ id, label, help, badge, checked, onChange }) => {
  const helpId = `${id}-help`;
  const badgeId = `${id}-badge`;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={[badge ? badgeId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-xl border bg-white px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation] ${
        checked ? 'border-emerald-600' : 'border-gray-200 [@media(hover:hover)]:hover:border-gray-300'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-gray-900">
          {label}
          {badge ? (
            <span
              id={badgeId}
              className="ml-2 inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 align-middle text-xs font-semibold text-emerald-800"
            >
              {badge}
            </span>
          ) : null}
        </span>
        {help ? (
          <span id={helpId} className="mt-0.5 block text-sm leading-5 text-gray-600">
            {help}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-emerald-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
};
