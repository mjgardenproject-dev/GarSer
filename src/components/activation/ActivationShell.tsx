import React from 'react';
import { ChevronLeft } from 'lucide-react';
import StickyStepProgress from '../common/StickyStepProgress';

// Marco de cada pantalla del cuestionario «Activa tu cuenta» (2026-11-11): progreso fijo bajo la barra
// general, «Atrás» y «Seguir luego» arriba, y el botón principal fijo abajo (con el margen del iPhone),
// para que se alcance con el pulgar sin bajar.

interface Props {
  stepLabel: string;
  percent: number;
  onBack?: () => void;
  onPause: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export const PRIMARY_BUTTON_CLASS =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]';

export const SECONDARY_BUTTON_CLASS =
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-base font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]';

const ActivationShell: React.FC<Props> = ({ stepLabel, percent, onBack, onPause, children, footer }) => (
  <div className="flex min-h-[calc(100dvh-var(--app-navbar-h,4rem))] flex-col">
    <StickyStepProgress title="Activa tu cuenta" stepLabel={stepLabel} percent={percent} />
    <div className="mx-auto w-full max-w-xl flex-1 px-1 pb-6 pt-3 sm:px-4">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Atrás
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onPause}
          className="inline-flex min-h-11 items-center rounded px-2 text-sm font-semibold text-gray-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
        >
          Seguir luego
        </button>
      </div>
      {children}
    </div>
    <div
      className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 px-1 pt-3 backdrop-blur sm:px-4"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto w-full max-w-xl">{footer}</div>
    </div>
  </div>
);

export default ActivationShell;
