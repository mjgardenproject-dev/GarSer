import React from 'react';
import type { ManualPictogramName } from '../presentation/manualEntryPresentation';

/**
 * Dibujos sencillos para las opciones que un icono genérico no explica. Son decorativos
 * (`aria-hidden`): la etiqueta y la ayuda de la opción ya dicen lo mismo con palabras.
 *
 * Setos, «caras a recortar», vistos desde arriba: el seto (verde) y en trazo de color el lado que
 * se recorta. Con una cara, el otro lado da a una pared o a la propiedad vecina (gris).
 */
const HedgeOneFace = () => (
  <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden focusable="false">
    <rect x="4" y="7" width="32" height="5" rx="1" className="fill-gray-400" />
    <rect x="6" y="13" width="28" height="11" rx="5.5" className="fill-emerald-100 stroke-emerald-700" strokeWidth="1.5" />
    <path d="M7 30h26" className="stroke-emerald-700" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
  </svg>
);

const HedgeTwoFaces = () => (
  <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden focusable="false">
    <path d="M7 9h26" className="stroke-emerald-700" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
    <rect x="6" y="14" width="28" height="11" rx="5.5" className="fill-emerald-100 stroke-emerald-700" strokeWidth="1.5" />
    <path d="M7 31h26" className="stroke-emerald-700" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
  </svg>
);

const PICTOGRAMS: Record<ManualPictogramName, React.FC> = {
  'hedge-one-face': HedgeOneFace,
  'hedge-two-faces': HedgeTwoFaces,
};

export const Pictogram: React.FC<{ name: ManualPictogramName }> = ({ name }) => {
  const Component = PICTOGRAMS[name];
  return Component ? <Component /> : null;
};
