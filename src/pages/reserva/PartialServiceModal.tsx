import React from 'react';
import { AlertTriangle, Check, X, Info } from 'lucide-react';

interface PartialServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  coveredGroups: any[];
  missingGroups: any[];
}

export const PartialServiceModal: React.FC<PartialServiceModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  coveredGroups,
  missingGroups
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Servicio Parcial
          </h2>
          
          <p className="text-sm text-gray-600 mb-6">
            El profesional seleccionado no puede realizar el servicio completo. Por favor, revisa lo que se incluye y lo que quedará pendiente.
          </p>

          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <h3 className="flex items-center gap-2 font-semibold text-green-800 mb-2 text-sm">
                <Check className="w-4 h-4" />
                Sí se realizará:
              </h3>
              <ul className="space-y-1">
                {coveredGroups.map((g, i) => (
                  <li key={i} className="text-sm text-green-700 flex items-start gap-2">
                    <span className="mt-1 opacity-50">•</span>
                    <span>{g.quantity || 1}x {g.species} ({g.height})</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h3 className="flex items-center gap-2 font-semibold text-red-800 mb-2 text-sm">
                <X className="w-4 h-4" />
                NO se realizará (no se cobrará):
              </h3>
              <ul className="space-y-1">
                {missingGroups.map((g, i) => (
                  <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                    <span className="mt-1 opacity-50">•</span>
                    <span>{g.quantity || 1}x {g.species} ({g.height})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="mt-6 flex items-start gap-3 bg-blue-50 p-3 rounded-lg border border-blue-100">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 leading-relaxed">
              Al confirmar, el precio y el tiempo estimado se ajustarán automáticamente. Las palmeras no incluidas no aparecerán en la orden de trabajo de este profesional.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-colors"
          >
            Aceptar y Continuar
          </button>
        </div>
      </div>
    </div>
  );
};
