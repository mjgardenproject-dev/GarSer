import React from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Eraser, X } from 'lucide-react';

/**
 * Aviso que se muestra al pulsar "Restablecer" en un configurador de precios: el
 * jardinero elige entre deshacer solo lo que lleva editado en esta sesión, o borrar
 * toda la configuración del servicio como si nunca la hubiera tocado. Con X para
 * cerrar sin hacer ninguna de las dos.
 */

interface ResetOptionsModalProps {
  isOpen: boolean;
  serviceName: string;
  onResetToSaved: () => void;
  onResetToBlank: () => void;
  onClose: () => void;
}

const ResetOptionsModal: React.FC<ResetOptionsModalProps> = ({
  isOpen,
  serviceName,
  onResetToSaved,
  onResetToBlank,
  onClose,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-options-title"
    >
      <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
            <RotateCcw className="w-6 h-6 text-yellow-600" aria-hidden="true" />
          </div>

          <h3 id="reset-options-title" className="text-lg font-bold text-gray-900 mb-2">
            ¿Qué quieres restablecer?
          </h3>

          <p className="text-gray-500 mb-6 text-sm leading-relaxed">
            Elige si quieres deshacer solo los cambios que aún no has guardado en{' '}
            <strong>{serviceName}</strong>, o borrar toda su configuración como si
            nunca la hubieras tocado.
          </p>

          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              onClick={onResetToSaved}
              className="w-full bg-white text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-bold hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-5 h-5" aria-hidden="true" />
              Restablecer cambios no guardados
            </button>

            <button
              type="button"
              onClick={onResetToBlank}
              className="w-full bg-white text-red-600 border border-red-200 py-3 px-4 rounded-xl font-bold hover:bg-red-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Eraser className="w-5 h-5" aria-hidden="true" />
              Restablecer completamente
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ResetOptionsModal;
