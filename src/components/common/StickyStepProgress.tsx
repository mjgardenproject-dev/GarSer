import React, { useRef } from 'react';
import { SUB_HEIGHT_VAR, usePublishStickyHeight } from '../../hooks/useStickyHeight';

/**
 * Progreso de un alta por pasos, FIJO justo bajo la barra general (Navbar). Antes iba dentro de la
 * página y, si la pantalla no estaba arriba del todo, el Navbar lo tapaba y solo se veía deslizando
 * hacia abajo (fallo 1 del móvil, 2026-11-05). Fija, se ve siempre. Ver useStickyHeight.ts.
 *
 * Se usa en lugar del AppHeader, nunca junto a él (comparten la variable --app-sticky-sub-h).
 */
interface Props {
  title: string;
  /** «Paso 2 de 5» */
  stepLabel: string;
  /** 0-100 */
  percent: number;
  className?: string;
}

const StickyStepProgress: React.FC<Props> = ({ title, stepLabel, percent, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);
  usePublishStickyHeight(ref, SUB_HEIGHT_VAR);
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      ref={ref}
      className={`sticky z-30 border-b border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur ${className}`}
      style={{ top: 'var(--app-navbar-h, 0px)' }}
    >
      <div className="mx-auto w-full sm:max-w-xl">
        <div className="mb-1.5 flex items-center justify-between text-sm text-gray-600">
          <span className="font-medium text-gray-800">{title}</span>
          <span>{stepLabel}</span>
        </div>
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
        >
          <div className="h-2 rounded-full bg-emerald-700 transition-all duration-300" style={{ width: `${clamped}%` }} />
        </div>
      </div>
    </div>
  );
};

export default StickyStepProgress;
