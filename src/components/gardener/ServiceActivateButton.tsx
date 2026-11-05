import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { ServiceActivationState } from '../../utils/serviceActivation';

/**
 * Botón «Activar» de un servicio, con tres estados (2026-11-05). Sustituye al círculo mudo que había:
 *  · locked — gris muy claro: todavía no se puede activar (falta configurar el precio). Sigue siendo
 *    tocable (no es un botón muerto): quien lo usa lleva a configurarlo y explica qué falta.
 *  · ready  — gris más oscuro: configurado, se puede activar.
 *  · active — verde, «Activado».
 */
interface Props {
  state: ServiceActivationState;
  serviceName: string;
  onClick: () => void;
  busy?: boolean;
  className?: string;
}

const STYLE: Record<ServiceActivationState, string> = {
  locked: 'bg-gray-100 text-gray-500 border-gray-200',
  ready: 'bg-gray-300 text-gray-900 border-gray-400 hover:bg-gray-400/70',
  active: 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800',
};

const ServiceActivateButton: React.FC<Props> = ({ state, serviceName, onClick, busy = false, className = '' }) => {
  const label = state === 'active' ? 'Activado' : 'Activar';
  const aria =
    state === 'active'
      ? `${serviceName}: activado. Toca para desactivarlo`
      : state === 'ready'
        ? `Activar ${serviceName}`
        : `Activar ${serviceName}: primero hay que configurar su precio`;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClick();
      }}
      // `aria-disabled` y no `disabled`: en «locked» se puede tocar para ir a configurarlo.
      aria-disabled={state === 'locked' ? true : undefined}
      aria-busy={busy || undefined}
      aria-label={aria}
      data-state={state}
      className={`inline-flex min-h-11 min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation] ${STYLE[state]} ${className}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : state === 'active' ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      {label}
    </button>
  );
};

export default ServiceActivateButton;
