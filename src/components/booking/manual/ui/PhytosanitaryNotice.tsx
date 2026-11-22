import React from 'react';
import { Check, ShieldAlert } from 'lucide-react';
import {
  PHYTOSANITARY_ACK_REQUIRED,
  PHYTOSANITARY_ACK_TEXT,
  PHYTOSANITARY_NOTICE_BODY,
  PHYTOSANITARY_NOTICE_TITLE,
} from '../../../../shared/manualEntry/legalCopy';

interface Props {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  showError: boolean;
  /** Desbroce con herbicida: además se dice que encarece el servicio (QA-168). */
  costNote?: string | null;
}

/**
 * Aviso de los tratamientos con producto fitosanitario (QA-170): quién los aplica, quién responde del
 * producto, la dosis y los plazos, y que GarSer solo gestiona la reserva. La casilla llega SIN marcar y
 * sin ella no se sigue. Los textos están en `legalCopy.ts` (un único sitio, versionados).
 */
export const PhytosanitaryNotice: React.FC<Props> = ({ id, checked, onChange, showError, costNote }) => (
  <div
    id={id}
    tabIndex={-1}
    className={`rounded-xl border px-4 py-3 outline-none ${showError && !checked ? 'border-red-300 bg-red-50/40' : 'border-amber-200 bg-amber-50/60'}`}
  >
    <p className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      {PHYTOSANITARY_NOTICE_TITLE}
    </p>
    <p className="mt-1 text-sm leading-6 text-gray-700">{PHYTOSANITARY_NOTICE_BODY}</p>
    {costNote ? <p className="mt-1 text-sm leading-6 text-gray-700">{costNote}</p> : null}
    <label className="mt-2 flex cursor-pointer items-start gap-3">
      <span className="relative -m-2.5 flex h-11 w-11 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={PHYTOSANITARY_ACK_TEXT}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded border-2 border-gray-400 bg-white text-transparent transition-colors peer-checked:border-emerald-700 peer-checked:bg-emerald-700 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </span>
      <span className="flex-1 text-[15px] leading-6 text-gray-800">{PHYTOSANITARY_ACK_TEXT}</span>
    </label>
    {showError && !checked ? (
      <p className="mt-1 text-sm font-medium text-red-700">{PHYTOSANITARY_ACK_REQUIRED}</p>
    ) : null}
  </div>
);
