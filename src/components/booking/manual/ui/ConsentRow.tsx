import React from 'react';
import { Check } from 'lucide-react';
import { MANUAL_ENTRY_CONSENT_TEXT } from '../../../../shared/manualEntry/legalCopy';
import { MANUAL_ENTRY_STRINGS } from '../../../../shared/manualEntry/strings';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const C = MANUAL_ENTRY_STRINGS.consent;

/**
 * Declaración de veracidad (SISTEMA-UX §6.13). La casilla tiene una zona táctil de 44 px (antes
 * 16 px) y toda la frase la marca. El texto que se registra es el íntegro de `legalCopy.ts`, sin
 * cambiar ni una coma: va en la misma pantalla, plegado.
 */
export const ConsentRow: React.FC<Props> = ({ checked, onChange }) => (
  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
    <label className="flex cursor-pointer items-start gap-3">
      <span className="relative -m-2.5 flex h-11 w-11 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={C.checkboxAriaLabel}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded border-2 border-gray-400 text-transparent transition-colors peer-checked:border-emerald-700 peer-checked:bg-emerald-700 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </span>
      <span className="flex-1 text-[15px] leading-6 text-gray-800">{C.shortLabel}</span>
    </label>
    <details className="mt-1">
      <summary className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg text-sm font-semibold text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
        {C.fullTextToggle}
      </summary>
      <p className="mt-1 text-sm leading-6 text-gray-600">{MANUAL_ENTRY_CONSENT_TEXT}</p>
    </details>
  </div>
);
