import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

interface FooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Muestra la flecha de avance (todas las acciones salvo la final). */
  forward?: boolean;
}

interface Props {
  /**
   * Fijo abajo (página «Detalles»): la acción principal queda siempre en la zona del pulgar,
   * igual que el botón «Continuar» del modo fotos. En un modal (corrección del jardinero) va
   * en línea, para no salirse del modal.
   */
  sticky?: boolean;
  /** Sin «Atrás» cuando no hay adónde volver dentro del asistente (D-08). */
  back?: FooterAction | null;
  primary: FooterAction;
  /** Aviso corto encima de los botones (p. ej. por qué está deshabilitado el botón final). */
  note?: React.ReactNode;
}

const PRIMARY =
  'min-h-12 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]';
const SECONDARY =
  'min-h-12 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 [touch-action:manipulation]';

/** Navegación del asistente manual: «Atrás» (1/3) y la acción principal (2/3). */
export const WizardFooter: React.FC<Props> = ({ sticky = false, back, primary, note }) => {
  const content = (
    <>
      {note ? <div className="mb-2 text-sm text-gray-600">{note}</div> : null}
      <div className="flex gap-3">
        {back ? (
          <button type="button" onClick={back.onClick} disabled={back.disabled} className={`${SECONDARY} flex-1`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {back.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className={`${PRIMARY} ${back ? 'flex-[2]' : 'w-full'}`}
        >
          {primary.label}
          {primary.forward ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </button>
      </div>
    </>
  );

  if (!sticky) return <div className="mt-8">{content}</div>;

  return (
    <div
      data-manual-footer
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto w-full sm:max-w-md">{content}</div>
    </div>
  );
};
