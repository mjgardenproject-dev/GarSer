import React from 'react';
import { X } from 'lucide-react';
import { useVisualViewportBox } from '../../hooks/useVisualViewportHeight';

// Marco de la hoja «Pago seguro» (FASE 4, 1.16, QA-135). Antes: cabecera de ~160 pt y un pie FIJO de ~150 pt
// sobre una hoja de 667 pt en el iPhone SE, así que los errores de la tarjeta (caducidad, CVC) quedaban
// tapados por el pie y, con el teclado abierto, «Pagar» desaparecía hasta cerrarlo. Ahora:
//   · la hoja mide lo que el cliente VE (visualViewport): con el teclado abierto se encoge y el pie queda
//     justo encima de él;
//   · el pie es parte de la hoja (no `fixed`): lo que se desplaza es el contenido, que termina donde empieza el pie;
//   · cabecera más compacta.

interface Props {
  title: string;
  amountCaption: string;
  amount: string;
  amountNote: string;
  onClose: () => void;
  canClose: boolean;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
  footer: React.ReactNode;
}

const PaymentSheetShell: React.FC<Props> = ({ title, amount, amountCaption, amountNote, onClose, canClose, closeButtonRef, children, footer }) => {
  const box = useVisualViewportBox();
  // Teclado abierto: el visor mide mucho menos que la pantalla. Entonces la hoja se compacta (cabecera de una
  // fila y pie bajo) para que el campo que se escribe y su error quepan (OBS-PAGO-01/02, iPhone SE).
  const compact = Boolean(box && typeof window !== 'undefined' && window.innerHeight - box.height > 120);
  return (
    <div
      className={`group fixed inset-x-0 z-50 bg-white sm:bg-transparent sm:p-4 ${box ? '' : 'inset-y-0'}`}
      style={box ? { top: box.offsetTop, height: box.height } : undefined}
      data-testid="payment-sheet"
      data-compact={compact ? 'true' : 'false'}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-title"
        className="mx-auto flex h-full max-w-lg flex-col bg-white overscroll-contain sm:max-h-[calc(100vh-2rem)] sm:overflow-hidden sm:rounded-[32px] sm:shadow-2xl"
      >
        <div className="shrink-0 border-b border-gray-100 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] group-data-[compact=true]:pb-1 sm:px-5 sm:pt-4">
          <div className="flex items-center justify-between gap-3">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar pago"
              disabled={!canClose}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
            <p id="payment-sheet-title" className="min-w-0 flex-1 text-center text-base font-semibold text-gray-950 text-balance">
              {title}
              {/* Compacta: el importe va en la misma fila que el título (una fila menos de cabecera). */}
              {compact && (
                <span className="font-bold text-gray-950 tabular-nums"> · {amount}</span>
              )}
            </p>
            <div aria-hidden="true" className="h-9 w-9 shrink-0" />
          </div>

          {compact ? null : (
            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{amountCaption}</p>
                <p className="mt-0.5 text-3xl font-bold leading-none text-gray-950 tabular-nums">{amount}</p>
              </div>
              <p className="max-w-[10rem] text-right text-xs leading-4 text-gray-500">{amountNote}</p>
            </div>
          )}
        </div>

        {/* min-h-0: sin él, un hijo alto empuja al pie fuera de la hoja en lugar de desplazarse. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 sm:px-5">{children}</div>

        <div className={`shrink-0 border-t border-gray-100 bg-white px-4 sm:px-5 ${compact ? 'pb-2 pt-2' : 'pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3'}`}>{footer}</div>
      </div>
    </div>
  );
};

export default PaymentSheetShell;
